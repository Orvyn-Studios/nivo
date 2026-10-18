//! HTTPS-only GitHub reader. No token/HTTP response body is included in errors.
use reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, IF_NONE_MATCH},
    Client, Method,
};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroizing;
#[derive(Clone, Debug)]
pub struct ApiError {
    pub status: u16,
    pub message: String,
    pub retry_seconds: u64,
    pub kind: &'static str,
}
impl ApiError {
    pub fn local(message: &str) -> Self {
        Self {
            status: 0,
            message: message.into(),
            retry_seconds: 30,
            kind: "network",
        }
    }
}
pub struct Api {
    client: Client,
    token: Zeroizing<String>,
    cache: Mutex<BTreeMap<String, (String, Value)>>,
}
pub const MAX_BODY: usize = 2 * 1024 * 1024;
impl Api {
    pub fn new(token: Zeroizing<String>) -> Result<Self, ApiError> {
        let client = Client::builder()
            .https_only(true)
            .tls_backend_native()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .pool_max_idle_per_host(1)
            .pool_idle_timeout(Duration::from_secs(30))
            .user_agent("Nivo-by-Orvyn/0.1 (read-only desktop integration)")
            .build()
            .map_err(|_| ApiError::local("No se pudo preparar una conexión segura con GitHub."))?;
        Ok(Self {
            client,
            token,
            cache: Mutex::new(BTreeMap::new()),
        })
    }
    pub async fn get(&self, path: &str) -> Result<Value, ApiError> {
        self.json(path, None).await
    }
    pub fn store_credential(&self) -> Result<(), String> {
        super::secrets::write(&self.token)
    }
    pub async fn graphql(&self, query: &'static str, variables: Value) -> Result<Value, ApiError> {
        self.json(
            "/graphql",
            Some(serde_json::json!({"query":query,"variables":variables})),
        )
        .await
    }
    async fn json(&self, path: &str, body: Option<Value>) -> Result<Value, ApiError> {
        if !path.starts_with('/') || path.starts_with("//") || path.len() > 1024 {
            return Err(ApiError::local("Consulta GitHub no válida."));
        }
        let bearer = Zeroizing::new(format!("Bearer {}", self.token.as_str()));
        let mut authorization = HeaderValue::from_str(&bearer)
            .map_err(|_| ApiError::local("Formato de token no válido."))?;
        authorization.set_sensitive(true);
        let cached = self.cache.lock().ok().and_then(|c| c.get(path).cloned());
        let mut request = self
            .client
            .request(
                if body.is_some() {
                    Method::POST
                } else {
                    Method::GET
                },
                format!("https://api.github.com{path}"),
            )
            .header(AUTHORIZATION, authorization)
            .header(ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(body) = body {
            request = request.json(&body);
        } else if let Some((etag, _)) = &cached {
            request = request.header(IF_NONE_MATCH, etag);
        }
        let response = request.send().await.map_err(|_| {
            ApiError::local(
                "No se pudo contactar con GitHub. Comprueba la conexión e inténtalo de nuevo.",
            )
        })?;
        let status = response.status().as_u16();
        let headers = response.headers().clone();
        if status == 304 {
            if let Some((_, value)) = cached {
                return Ok(value);
            }
            return Err(ApiError::local(
                "GitHub devolvió una respuesta sin datos en caché.",
            ));
        }
        if status != 200 {
            return Err(status_error(status, &headers));
        }
        let etag = headers
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .filter(|v| v.len() < 256)
            .map(str::to_string);
        let bytes = bounded_body(response, MAX_BODY).await?;
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| ApiError::local("GitHub devolvió datos no válidos."))?;
        if path != "/graphql" && bytes.len() < 256 * 1024 {
            if let Some(etag) = etag {
                if let Ok(mut cache) = self.cache.lock() {
                    if cache.len() >= 12 && !cache.contains_key(path) {
                        cache.pop_first();
                    }
                    cache.insert(path.into(), (etag, value.clone()));
                }
            }
        }
        Ok(value)
    }
    pub async fn avatar(&self, user_id: u64) -> Option<String> {
        use base64::Engine;
        // The avatar host/path are constructed from GitHub's numeric user ID. No PAT
        // is attached; redirects are disabled. Remote URLs never reach the webview.
        let response = self
            .client
            .get(format!(
                "https://avatars.githubusercontent.com/u/{user_id}?s=64&v=4"
            ))
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        let bytes = bounded_body(response, 256 * 1024).await.ok()?;
        let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
            "image/jpeg"
        } else {
            return None;
        };
        Some(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    }
}
async fn bounded_body(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, ApiError> {
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(ApiError::local(
            "La respuesta de GitHub supera el límite local.",
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ApiError::local("La respuesta de GitHub se interrumpió."))?
    {
        if bytes.len() + chunk.len() > limit {
            return Err(ApiError::local(
                "La respuesta de GitHub supera el límite local.",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
pub fn status_error(status: u16, headers: &HeaderMap) -> ApiError {
    let now = SystemTime::now();
    let retry = headers
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            v.parse::<u64>().ok().or_else(|| {
                httpdate::parse_http_date(v)
                    .ok()
                    .map(|t| t.duration_since(now).unwrap_or_default().as_secs())
            })
        });
    let exhausted = headers
        .get("x-ratelimit-remaining")
        .is_some_and(|v| v == "0");
    let reset = headers
        .get("x-ratelimit-reset")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .map(|t| t.saturating_sub(now.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()));
    let message=match status{401=>"El token no es válido o ha sido revocado. Vuelve a conectar la cuenta.",403 if exhausted=>"Se alcanzó el límite de GitHub. Se respetará su tiempo de espera.",403=>"GitHub denegó el acceso. Revisa los permisos de lectura y la aprobación de la organización.",404=>"Repositorio no disponible, eliminado o sin autorización para este token.",429=>"GitHub solicita reducir las consultas. Se aplicará una espera.",_=>"GitHub no pudo completar la consulta. No se han interpretado datos desconocidos como éxito."};
    ApiError {
        status,
        message: message.into(),
        retry_seconds: retry
            .or(if exhausted { reset } else { None })
            .unwrap_or(60)
            .clamp(1, 86400),
        kind: if status == 429 || status == 403 && (exhausted || retry.is_some()) {
            "rateLimit"
        } else if status == 401 {
            "auth"
        } else if status == 403 {
            "permissions"
        } else if status == 404 {
            "notFound"
        } else {
            "network"
        },
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn errors_are_sanitized_and_retry_after_is_respected() {
        let mut h = HeaderMap::new();
        h.insert("retry-after", HeaderValue::from_static("120"));
        assert_eq!(status_error(429, &h).retry_seconds, 120);
        assert!(status_error(401, &h).message.contains("revocado"));
        assert!(status_error(403, &h).message.contains("organización"));
        assert!(status_error(404, &h).message.contains("autorización"));
    }
}
