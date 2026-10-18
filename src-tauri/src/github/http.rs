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
    #[cfg(test)]
    fixture_origin: Option<String>,
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
            #[cfg(test)]
            fixture_origin: None,
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
                self.url(path),
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
    fn url(&self, path: &str) -> String {
        #[cfg(test)]
        if let Some(origin) = &self.fixture_origin {
            return format!("{origin}{path}");
        }
        format!("https://api.github.com{path}")
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
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };
    fn fixture(responses: Vec<String>, delay: Duration) -> (Api, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let server = thread::spawn(move || {
            let mut requests = vec![];
            for response in responses {
                let until = std::time::Instant::now() + Duration::from_secs(2);
                let mut socket = loop {
                    match listener.accept() {
                        Ok((socket, _)) => break socket,
                        Err(e)
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                && std::time::Instant::now() < until =>
                        {
                            thread::sleep(Duration::from_millis(2))
                        }
                        Err(e) => panic!("Owned mock request not received: {e}"),
                    }
                };
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                let mut request = vec![];
                let mut buffer = [0u8; 1024];
                while request.len() < 8192 && !request.ends_with(b"\r\n\r\n") {
                    let n = socket.read(&mut buffer).unwrap();
                    if n == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..n]);
                }
                requests.push(String::from_utf8(request).unwrap());
                thread::sleep(delay);
                let _ = socket.write_all(response.as_bytes());
            }
            requests
        });
        (fixture_api(address), server)
    }
    fn fixture_api(address: std::net::SocketAddr) -> Api {
        Api {
            client: Client::builder()
                .no_proxy()
                .timeout(Duration::from_millis(500))
                .build()
                .unwrap(),
            token: Zeroizing::new("explicit_mock_not_a_real_token".into()),
            cache: Mutex::new(BTreeMap::new()),
            fixture_origin: Some(format!("http://{address}")),
        }
    }
    #[tokio::test(flavor = "current_thread")]
    async fn transport_reuses_etag_and_never_parses_error_bodies_as_identity() {
        let (api,server)=fixture(vec!["HTTP/1.1 200 OK\r\nContent-Length: 8\r\nETag: \"fixture\"\r\nConnection: close\r\n\r\n{\"id\":1}".into(),"HTTP/1.1 304 Not Modified\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),"HTTP/1.1 401 Unauthorized\r\nContent-Length: 19\r\nConnection: close\r\n\r\nprivate_server_body".into()],Duration::ZERO);
        assert_eq!(api.get("/user").await.unwrap()["id"], 1);
        assert_eq!(api.get("/user").await.unwrap()["id"], 1);
        let error = api.get("/user").await.unwrap_err();
        assert_eq!(error.kind, "auth");
        assert!(!error.message.contains("private_server_body"));
        let requests = server.join().unwrap();
        assert!(requests[1]
            .to_ascii_lowercase()
            .contains("if-none-match: \"fixture\""));
    }
    #[tokio::test(flavor = "current_thread")]
    async fn transport_bounds_bodies_and_honors_rate_limit_headers() {
        let (api,server)=fixture(vec!["HTTP/1.1 429 Too Many Requests\r\nRetry-After: 17\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",MAX_BODY+1)],Duration::ZERO);
        let error = api.get("/user").await.unwrap_err();
        assert_eq!(error.kind, "rateLimit");
        assert_eq!(error.retry_seconds, 17);
        assert!(api
            .get("/user")
            .await
            .unwrap_err()
            .message
            .contains("límite local"));
        server.join().unwrap();
    }
    #[tokio::test(flavor = "current_thread")]
    async fn abort_drops_an_inflight_transport_without_a_late_result() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let api = fixture_api(listener.local_addr().unwrap());
        let task = tokio::spawn(async move { api.get("/user").await });
        // Hold the actual accepted connection open without responding; abort only
        // after connect, independent of scheduler timing or desktop load.
        let _connection = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
    }
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
