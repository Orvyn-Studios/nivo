//! Explicit read-only GitHub integration. One abortable polling task, no webview
//! networking or secret reads through IPC. Selection and seen IDs are non-secret.
mod http;
mod model;
mod secrets;
use http::{Api, ApiError};
use model::*;
pub use model::{Connection, Options, Snapshot};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    hash::{Hash, Hasher},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;
use zeroize::Zeroizing;

const PULSE_QUERY:&str="query NivoPulse($owner:String!,$name:String!,$ci:Boolean!,$reviews:Boolean!){repository(owner:$owner,name:$name){pullRequests(first:20,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{databaseId number title url updatedAt headRefOid author{login} reviewDecision @include(if:$reviews) reviewRequests(first:20) @include(if:$reviews){nodes{requestedReviewer{... on User{login}}}} commits(last:1) @include(if:$ci){nodes{commit{statusCheckRollup{state}}}}}}}}";
const CALENDAR_QUERY:&str="query NivoCalendar{viewer{contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount contributionLevel}}}}}}";
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub id: String,
    pub title: String,
    pub body: String,
    pub action_id: String,
    pub action_label: String,
    pub failure: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Update {
    snapshot: Snapshot,
    notices: Vec<Notice>,
}
struct State {
    config: Config,
    view: Snapshot,
    repositories: Vec<Repository>,
    truncated: bool,
    generation: u64,
    active: bool,
    baseline: bool,
    calendar_at: u64,
    cooldown: u64,
    stopping: bool,
}
pub struct GithubService {
    state: Mutex<State>,
    control: Mutex<()>,
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    path: PathBuf,
    app: tauri::AppHandle,
    epoch: tokio::sync::watch::Sender<u64>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
impl GithubService {
    pub fn new(path: PathBuf, app: tauri::AppHandle) -> Arc<Self> {
        let loaded = std::fs::read(&path)
            .ok()
            .filter(|v| v.len() < 128 * 1024)
            .and_then(|v| serde_json::from_slice::<Config>(&v).ok())
            .filter(|v| {
                v.options.validate().is_ok()
                    && v.seen.len() <= 256
                    && v.seen.iter().all(|s| s.len() <= 512)
            });
        let error=(path.exists()&&loaded.is_none()).then(||"La configuración de GitHub no es válida; se conserva el archivo y no se inicia la red.".into());
        let config = loaded.unwrap_or_default();
        let view = Snapshot {
            options: config.options.clone(),
            status: if config.options.enabled {
                "verifying"
            } else {
                "disconnected"
            },
            error,
            ..Snapshot::default()
        };
        Arc::new(Self {
            state: Mutex::new(State {
                config,
                view,
                repositories: vec![],
                truncated: false,
                generation: 0,
                active: false,
                baseline: false,
                calendar_at: 0,
                cooldown: 0,
                stopping: false,
            }),
            control: Mutex::new(()),
            task: Mutex::new(None),
            path,
            app,
            epoch: tokio::sync::watch::channel(0).0,
        })
    }
    pub fn snapshot(&self) -> Result<Snapshot, String> {
        self.state
            .lock()
            .map(|s| s.view.clone())
            .map_err(|_| "GitHub no está disponible.".into())
    }
    pub fn connection(&self) -> Result<Connection, String> {
        let s = self
            .state
            .lock()
            .map_err(|_| "GitHub no está disponible.")?;
        Ok(Connection {
            snapshot: s.view.clone(),
            repositories: s.repositories.clone(),
            truncated: s.truncated,
        })
    }
    fn notify(&self, notices: Vec<Notice>) {
        if let Ok(snapshot) = self.snapshot() {
            let update = Update { snapshot, notices };
            let _ = self.app.emit_to("island", "nivo://github", &update);
            let _ = self.app.emit_to("preferences", "nivo://github", &update);
        }
    }
    fn stop_task(&self) {
        if let Ok(mut task) = self.task.lock() {
            if let Some(task) = task.take() {
                task.abort();
            }
        }
    }
    fn save(&self, state: &State) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or("Directorio de GitHub no disponible.")?;
        std::fs::create_dir_all(parent)
            .map_err(|_| "No se pudo guardar la configuración de GitHub.")?;
        let mut entropy = [0u8; 8];
        getrandom::fill(&mut entropy).map_err(|_| "No se pudo preparar el guardado de GitHub.")?;
        let temp = parent.join(format!(".github-{:016x}.tmp", u64::from_le_bytes(entropy)));
        let result = (|| -> Result<(), String> {
            use std::io::Write;
            let mut file =
                std::fs::File::create_new(&temp).map_err(|_| "No se pudo guardar GitHub.")?;
            file.write_all(
                &serde_json::to_vec(&state.config)
                    .map_err(|_| "Configuración GitHub no válida.")?,
            )
            .and_then(|_| file.sync_all())
            .map_err(|_| "No se pudo confirmar el guardado de GitHub.")?;
            drop(file);
            crate::settings::replace_file(&temp, &self.path)
                .map_err(|_| "No se pudo reemplazar la configuración de GitHub.".to_string())
        })(); // Only our exclusively created temporary file may be removed.
        if result.is_err() {
            let _ = std::fs::remove_file(temp);
        }
        result
    }
    fn restart_locked(self: &Arc<Self>) {
        self.stop_task();
        let generation = {
            let Ok(mut s) = self.state.lock() else { return };
            s.generation += 1;
            self.epoch.send_replace(s.generation);
            s.view.revision += 1;
            s.view.syncing = false;
            s.view.next_refresh = None;
            if s.stopping || !s.active || !s.config.options.enabled {
                return;
            }
            if s.view.profile.is_some()
                && s.config.options.repositories.is_empty()
                && !s.config.options.calendar
            {
                return;
            }
            s.view.syncing = true;
            s.generation
        };
        let service = Arc::clone(self);
        let handle = tauri::async_runtime::spawn(async move {
            service.poll(generation).await;
        });
        if let Ok(mut task) = self.task.lock() {
            *task = Some(handle);
        }
    }
    pub fn set_active(self: &Arc<Self>, active: bool) {
        let Ok(_control) = self.control.lock() else {
            return;
        };
        let changed = {
            let Ok(mut s) = self.state.lock() else { return };
            if s.active == active {
                false
            } else {
                s.active = active;
                true
            }
        };
        if changed {
            self.restart_locked();
            self.notify(vec![]);
        }
    }
    pub fn configure(self: &Arc<Self>, options: Options) -> Result<Connection, String> {
        options.validate()?;
        let _control = self
            .control
            .lock()
            .map_err(|_| "GitHub no está disponible.")?;
        let saved = {
            let mut s = self
                .state
                .lock()
                .map_err(|_| "GitHub no está disponible.")?;
            for name in &options.repositories {
                if !s.repositories.iter().any(|r| r.full_name == *name)
                    && !s.config.options.repositories.contains(name)
                {
                    return Err("Selecciona un repositorio devuelto por GitHub. Si falta, revisa el propietario y la aprobación del token.".into());
                }
            }
            if s.config.options.repositories != options.repositories {
                s.view.items.clear();
                s.baseline = false;
            }
            s.config.options = options.clone();
            s.view.options = options;
            if !s.config.options.enabled {
                s.view.items.clear();
                s.view.calendar = None;
                s.view.profile = None;
                s.repositories.clear();
                s.view.status = "disabled";
                s.baseline = false;
                s.calendar_at = 0;
            }
            self.save(&s)
        };
        self.restart_locked();
        self.notify(vec![]);
        saved?;
        self.connection()
    }
    pub async fn connect(self: &Arc<Self>, token: String) -> Result<Connection, String> {
        let token = Zeroizing::new(token);
        if !valid_token(&token) {
            return Err("Introduce un PAT fine-grained válido (github_pat_…), sin espacios. No se admite un token clásico de acceso completo.".into());
        }
        let (generation, previous_config) = {
            let _control = self
                .control
                .lock()
                .map_err(|_| "GitHub no está disponible.")?;
            self.stop_task();
            let mut s = self
                .state
                .lock()
                .map_err(|_| "GitHub no está disponible.")?;
            s.generation += 1;
            self.epoch.send_replace(s.generation);
            let generation = s.generation;
            let previous = s.config.clone();
            s.config = Config::default();
            s.view = Snapshot {
                revision: s.view.revision + 1,
                status: "connecting",
                syncing: true,
                ..Snapshot::default()
            };
            s.repositories.clear();
            s.baseline = false;
            s.calendar_at = 0;
            s.cooldown = 0;
            secrets::clear()?;
            self.save(&s)?;
            (generation, previous)
        };
        self.notify(vec![]);
        let mut cancelled = self.epoch.subscribe();
        if *cancelled.borrow() != generation {
            return Err("La conexión se canceló antes de empezar.".into());
        }
        let connection = async {
            let api = Api::new(token)?;
            let user = api.get("/user").await?;
            let mut profile = model::profile(&user)
                .ok_or_else(|| ApiError::local("GitHub no confirmó la identidad de la cuenta."))?;
            let (repositories, truncated) = list_repositories(&api).await?;
            profile.avatar = api.avatar(profile.id).await;
            Ok::<_, ApiError>((api, profile, repositories, truncated))
        };
        let result = tokio::select! {biased;_ =cancelled.changed()=>return Err("La conexión se ha cancelado.".into()),result=connection=>result};
        let _control = self
            .control
            .lock()
            .map_err(|_| "GitHub no está disponible.")?;
        {
            let mut s = self
                .state
                .lock()
                .map_err(|_| "GitHub no está disponible.")?;
            if s.generation != generation || s.stopping {
                return Err("La conexión se canceló o cambió antes de terminar.".into());
            }
            match result {
                Ok((api, profile, repositories, truncated)) => {
                    // The token stays exclusively inside the native API reader. Only this
                    // validated connection may write the fixed Credential Manager entry.
                    api.store_credential().inspect_err(|e| {
                        s.view.status = "error";
                        s.view.syncing = false;
                        s.view.error = Some(e.clone());
                    })?;
                    s.config = if previous_config.account_id == Some(profile.id) {
                        previous_config
                    } else {
                        Config::default()
                    };
                    s.config.account_id = Some(profile.id);
                    s.config.options.enabled = true;
                    s.config
                        .options
                        .repositories
                        .retain(|name| repositories.iter().any(|r| r.full_name == *name));
                    s.view.options = s.config.options.clone();
                    s.view.profile = Some(profile);
                    s.view.status = "connected";
                    s.view.error = None;
                    s.view.syncing = false;
                    s.view.revision += 1;
                    s.repositories = repositories;
                    s.truncated = truncated;
                    self.save(&s)?;
                }
                Err(error) => {
                    s.view.status = "error";
                    s.view.error = Some(error.message.clone());
                    s.view.syncing = false;
                    s.view.revision += 1;
                    drop(s);
                    self.notify(vec![]);
                    return Err(error.message);
                }
            }
        }
        self.restart_locked();
        self.notify(vec![]);
        self.connection()
    }
    pub fn disconnect(self: &Arc<Self>) -> Result<Connection, String> {
        let _control = self
            .control
            .lock()
            .map_err(|_| "GitHub no está disponible.")?;
        self.stop_task();
        let result = secrets::clear();
        let saved = {
            let mut s = self
                .state
                .lock()
                .map_err(|_| "GitHub no está disponible.")?;
            s.generation += 1;
            self.epoch.send_replace(s.generation);
            s.config = Config::default();
            s.view = Snapshot {
                revision: s.view.revision + 1,
                error: result.as_ref().err().cloned(),
                ..Snapshot::default()
            };
            s.repositories.clear();
            s.baseline = false;
            s.calendar_at = 0;
            s.cooldown = 0;
            self.save(&s)
        };
        self.notify(vec![]);
        result?;
        saved?;
        self.connection()
    }
    pub fn refresh(self: &Arc<Self>) -> Result<Snapshot, String> {
        let _control = self
            .control
            .lock()
            .map_err(|_| "GitHub no está disponible.")?;
        {
            let s = self
                .state
                .lock()
                .map_err(|_| "GitHub no está disponible.")?;
            if !s.config.options.enabled {
                return Err("Activa GitHub en Preferencias.".into());
            }
            if !s.active {
                return Err(
                    "La sincronización está pausada mientras Nivo está oculto o pausado.".into(),
                );
            }
            if s.cooldown > now() {
                return Err("GitHub ha solicitado esperar antes de volver a consultar.".into());
            }
            if s.view.syncing {
                return Ok(s.view.clone());
            }
            if s.view
                .last_sync
                .is_some_and(|last| now().saturating_sub(last) < 5_000)
            {
                return Ok(s.view.clone());
            }
        }
        self.restart_locked();
        self.notify(vec![]);
        self.snapshot()
    }
    pub fn shutdown(&self) {
        if let Ok(_control) = self.control.lock() {
            self.stop_task();
            if let Ok(mut s) = self.state.lock() {
                s.stopping = true;
                s.generation += 1;
                self.epoch.send_replace(s.generation);
                s.view.items.clear();
                s.view.calendar = None;
                s.view.profile = None;
                s.repositories.clear();
            }
        }
    }
    fn live(&self, generation: u64) -> bool {
        self.state.lock().is_ok_and(|s| {
            s.generation == generation && s.active && s.config.options.enabled && !s.stopping
        })
    }
    async fn poll(self: Arc<Self>, generation: u64) {
        let token = match secrets::read() {
            Ok(Some(token)) => token,
            Ok(None) => {
                self.fail(
                    generation,
                    ApiError {
                        status: 401,
                        message: "No hay una credencial guardada. Conecta GitHub en Preferencias."
                            .into(),
                        retry_seconds: 0,
                        kind: "auth",
                    },
                );
                return;
            }
            Err(message) => {
                self.fail(generation, ApiError::local(&message));
                return;
            }
        };
        let api = match Api::new(token) {
            Ok(api) => api,
            Err(error) => {
                self.fail(generation, error);
                return;
            }
        };
        let mut needs_profile = self.state.lock().is_ok_and(|s| s.view.profile.is_none());
        let mut profile_failures = 0u32;
        while needs_profile {
            let result = async {
                let user = api.get("/user").await?;
                let mut profile = model::profile(&user).ok_or_else(|| {
                    ApiError::local("GitHub no confirmó la identidad de la cuenta.")
                })?;
                let (repos, truncated) = list_repositories(&api).await?;
                profile.avatar = api.avatar(profile.id).await;
                Ok::<_, ApiError>((profile, repos, truncated))
            }
            .await;
            if !self.live(generation) {
                return;
            }
            match result {
                Err(error) => {
                    let auth = error.status == 401;
                    let delay = error
                        .retry_seconds
                        .max(30u64.saturating_mul(1 << profile_failures.min(6)));
                    self.fail(generation, error);
                    if auth {
                        return;
                    }
                    profile_failures = profile_failures.saturating_add(1);
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                    if !self.live(generation) {
                        return;
                    }
                    continue;
                }
                Ok((profile, repos, truncated)) => {
                    let Ok(mut s) = self.state.lock() else { return };
                    if s.generation != generation {
                        return;
                    }
                    if s.config.account_id != Some(profile.id) {
                        s.config.options.repositories.clear();
                        s.config.seen.clear();
                        s.baseline = false;
                    }
                    s.config.account_id = Some(profile.id);
                    s.view.profile = Some(profile);
                    s.repositories = repos;
                    s.truncated = truncated;
                    s.view.options = s.config.options.clone();
                    s.view.status = "connected";
                    s.view.revision += 1;
                    let _ = self.save(&s);
                }
            }
            self.notify(vec![]);
            needs_profile = false;
        }
        let mut failures = 0u32;
        loop {
            if !self.live(generation) {
                return;
            }
            let (options, login, calendar, calendar_at, cooldown) = {
                let Ok(s) = self.state.lock() else { return };
                let Some(profile) = s.view.profile.as_ref() else {
                    return;
                };
                (
                    s.config.options.clone(),
                    profile.login.clone(),
                    s.view.calendar.clone(),
                    s.calendar_at,
                    s.cooldown,
                )
            };
            if cooldown > now() {
                tokio::time::sleep(Duration::from_millis(cooldown.saturating_sub(now()))).await;
                if !self.live(generation) {
                    return;
                }
            }
            if options.repositories.is_empty() && !options.calendar {
                if let Ok(mut s) = self.state.lock() {
                    if s.generation == generation {
                        s.view.syncing = false;
                        s.view.revision += 1;
                    }
                }
                self.notify(vec![]);
                return;
            }
            let result = fetch(&api, &options, &login, calendar, calendar_at).await;
            if !self.live(generation) {
                return;
            }
            let delay = match result {
                Ok(data) => {
                    failures = 0;
                    let delay = if data.items.iter().any(|i| i.ci == CiState::Running) {
                        60
                    } else {
                        options.interval_seconds
                    };
                    let notices = {
                        let Ok(mut s) = self.state.lock() else { return };
                        if s.generation != generation {
                            return;
                        }
                        let notices = changes(&mut s, &data.items);
                        s.view.items = data.items;
                        s.view.calendar = data.calendar;
                        s.view.warnings = data.warnings;
                        s.view.error = None;
                        s.view.status = "connected";
                        s.view.syncing = false;
                        s.view.last_sync = Some(now());
                        s.view.next_refresh = Some(now() + delay * 1000);
                        s.view.revision += 1;
                        if data.calendar_fetched {
                            s.calendar_at = now();
                        }
                        let _ = self.save(&s);
                        notices
                    };
                    self.notify(notices);
                    delay
                }
                Err(error) => {
                    let auth = error.status == 401;
                    let delay = error
                        .retry_seconds
                        .max(30u64.saturating_mul(1 << failures.min(6)))
                        .max(options.interval_seconds);
                    self.fail(generation, error);
                    if auth {
                        return;
                    }
                    failures += 1;
                    delay
                }
            };
            tokio::time::sleep(Duration::from_secs(delay)).await;
        }
    }
    fn fail(&self, generation: u64, error: ApiError) {
        let mut s = match self.state.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        if s.generation != generation {
            return;
        }
        s.view.syncing = false;
        s.view.error = Some(error.message);
        s.view.revision += 1;
        if error.status == 401 {
            let _ = secrets::clear();
            s.config = Config::default();
            s.view.options = s.config.options.clone();
            s.view.status = "disconnected";
            s.view.profile = None;
            s.view.items.clear();
            s.view.calendar = None;
            s.repositories.clear();
            s.view.next_refresh = None;
            s.generation += 1;
            self.epoch.send_replace(s.generation);
            let _ = self.save(&s);
        } else {
            s.cooldown = now() + error.retry_seconds.max(30) * 1000;
            s.view.next_refresh = Some(s.cooldown);
        }
        drop(s);
        self.notify(vec![]);
    }
    pub fn open_item(&self, id: &str, owner: isize) -> Result<(), String> {
        let url = {
            let s = self
                .state
                .lock()
                .map_err(|_| "GitHub no está disponible.")?;
            if s.view.status != "connected" {
                return Err("Conecta GitHub antes de abrir este elemento.".into());
            }
            if let Some(name) = id.strip_prefix("repo:") {
                if !s.config.options.repositories.iter().any(|r| r == name) {
                    return Err("Repositorio no seleccionado.".into());
                }
                format!("https://github.com/{name}")
            } else {
                let item = s
                    .view
                    .items
                    .iter()
                    .find(|i| i.id == id)
                    .ok_or("El elemento ya no está disponible. Refresca GitHub.")?;
                if !s.config.options.repositories.contains(&item.repository)
                    || !safe_url(&item.url, &item.repository)
                {
                    return Err("Destino GitHub no válido.".into());
                }
                item.url.clone()
            }
        };
        #[cfg(windows)]
        {
            use windows::{
                core::PCWSTR,
                Win32::{
                    Foundation::HWND,
                    UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
                },
            };
            let wide: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
            let result = unsafe {
                ShellExecuteW(
                    Some(HWND(owner as *mut _)),
                    windows::core::w!("open"),
                    PCWSTR(wide.as_ptr()),
                    None,
                    None,
                    SW_SHOWNORMAL,
                )
            };
            if result.0 as isize <= 32 {
                return Err("Windows no pudo abrir el navegador predeterminado.".into());
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            let _ = (url, owner);
            Err("Requiere Windows.".into())
        }
    }
}
async fn list_repositories(api: &Api) -> Result<(Vec<Repository>, bool), ApiError> {
    let mut repos = vec![];
    let mut truncated = false;
    for page in 1..=5 {
        let value=api.get(&format!("/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page={page}")).await?;
        let values = value.as_array().ok_or_else(|| {
            ApiError::local("GitHub no devolvió una lista de repositorios válida.")
        })?;
        for value in values {
            if let Some(repo) = repository(value) {
                if !repos.iter().any(|r: &Repository| r.id == repo.id) {
                    repos.push(repo);
                }
            }
        }
        if values.len() < 100 {
            break;
        }
        if page == 5 {
            truncated = true;
        }
    }
    repos.sort_by_key(|a| a.full_name.to_lowercase());
    Ok((repos, truncated))
}
struct Fetched {
    items: Vec<Item>,
    calendar: Option<Calendar>,
    calendar_fetched: bool,
    warnings: Vec<String>,
}
async fn optional(
    api: &Api,
    path: &str,
    warnings: &mut Vec<String>,
) -> Result<Option<Value>, ApiError> {
    match api.get(path).await {
        Ok(value) => Ok(Some(value)),
        Err(error) if matches!(error.kind, "permissions" | "notFound") => {
            if warnings.len() < 8 {
                warnings.push(error.message);
            }
            Ok(None)
        }
        Err(error) => Err(error),
    }
}
async fn fetch(
    api: &Api,
    options: &Options,
    login: &str,
    previous_calendar: Option<Calendar>,
    calendar_at: u64,
) -> Result<Fetched, ApiError> {
    let mut result = Fetched {
        items: vec![],
        calendar: if options.calendar {
            previous_calendar
        } else {
            None
        },
        calendar_fetched: false,
        warnings: vec![],
    };
    for repo in &options.repositories {
        if options.pull_requests || options.reviews {
            let (owner, name) = repo.split_once('/').expect("validated repository");
            let graph = api
                .graphql(
                    PULSE_QUERY,
                    json!({"owner":owner,"name":name,"ci":options.ci,"reviews":options.reviews}),
                )
                .await;
            let mut graph_ok = false;
            match graph {
                Ok(value) => {
                    if let Some(nodes) = value
                        .pointer("/data/repository/pullRequests/nodes")
                        .and_then(Value::as_array)
                    {
                        graph_ok = true;
                        for node in nodes.iter().take(20) {
                            if let Some(item) = graphql_pull(node, repo, login) {
                                result.items.push(item);
                            }
                        }
                    }
                    if value.get("errors").is_some() {
                        result.warnings.push(format!(
                            "{repo}: algunos datos GraphQL no están autorizados o disponibles."
                        ));
                    }
                }
                Err(error) if error.kind == "permissions" => result.warnings.push(error.message),
                Err(error) => return Err(error),
            }
            if !graph_ok {
                if let Some(value) = optional(
                    api,
                    &format!("/repos/{repo}/pulls?state=open&sort=updated&per_page=20"),
                    &mut result.warnings,
                )
                .await?
                {
                    if let Some(values) = value.as_array() {
                        result
                            .items
                            .extend(values.iter().take(20).filter_map(|v| pull(v, repo, login)));
                    }
                }
            }
            if options.pull_requests {
                if let Some(value) = optional(
                    api,
                    &format!(
                        "/repos/{repo}/pulls?state=closed&sort=updated&direction=desc&per_page=5"
                    ),
                    &mut result.warnings,
                )
                .await?
                {
                    if let Some(values) = value.as_array() {
                        result.items.extend(
                            values
                                .iter()
                                .take(5)
                                .filter(|v| v.get("merged_at").is_some_and(|v| !v.is_null()))
                                .filter_map(|v| pull(v, repo, login)),
                        );
                    }
                }
            }
        }
        if options.ci {
            if let Some(value) = optional(
                api,
                &format!("/repos/{repo}/actions/runs?per_page=10"),
                &mut result.warnings,
            )
            .await?
            {
                if let Some(values) = value.get("workflow_runs").and_then(Value::as_array) {
                    result
                        .items
                        .extend(values.iter().take(10).filter_map(|v| workflow(v, repo)));
                }
            }
        }
        if options.issues {
            if let Some(value) = optional(
                api,
                &format!("/repos/{repo}/issues?state=open&assignee={login}&per_page=10"),
                &mut result.warnings,
            )
            .await?
            {
                if let Some(values) = value.as_array() {
                    result
                        .items
                        .extend(values.iter().take(10).filter_map(|v| issue(v, repo)));
                }
            }
        }
    }
    result.items.truncate(MAX_ITEMS);
    result.items.retain(|item| {
        item.kind != "pull" || options.pull_requests || options.reviews && item.review_requested
    });
    let mut ids = HashSet::new();
    result.items.retain(|item| ids.insert(item.id.clone()));
    if options.calendar
        && (result.calendar.is_none() || now().saturating_sub(calendar_at) >= 1800 * 1000)
    {
        match api.graphql(CALENDAR_QUERY, json!({})).await {
            Ok(value) => {
                result.calendar = contribution_calendar(&value);
                result.calendar_fetched = true;
                if result.calendar.is_none() {
                    result.warnings.push("GitHub no devolvió un calendario autorizado. No se han estimado contribuciones.".into());
                }
            }
            Err(error) if error.kind == "permissions" => {
                result.calendar = None;
                result.warnings.push(error.message);
            }
            Err(error) => return Err(error),
        }
    }
    result.warnings.truncate(8);
    Ok(result)
}
fn graphql_pull(node: &Value, repo: &str, login: &str) -> Option<Item> {
    let number = node.get("number")?.as_u64()?;
    let database = node.get("databaseId")?.as_u64()?;
    let url = text(node, "url", 512);
    if !safe_url(&url, repo) {
        return None;
    }
    let requested = node
        .pointer("/reviewRequests/nodes")
        .and_then(Value::as_array)
        .is_some_and(|nodes| {
            nodes.iter().any(|v| {
                v.pointer("/requestedReviewer/login")
                    .and_then(Value::as_str)
                    == Some(login)
            })
        });
    let state = match node
        .pointer("/commits/nodes/0/commit/statusCheckRollup/state")
        .and_then(Value::as_str)
    {
        Some("SUCCESS") => CiState::Success,
        Some("PENDING" | "EXPECTED") => CiState::Running,
        Some("ERROR" | "FAILURE") => CiState::Failure,
        _ => CiState::Unknown,
    };
    let review = match node.get("reviewDecision").and_then(Value::as_str) {
        Some("APPROVED") => "approved",
        Some("CHANGES_REQUESTED") => "changesRequested",
        Some("REVIEW_REQUIRED") => "requested",
        _ => "unknown",
    };
    Some(Item {
        id: format!("pr:{database}"),
        kind: "pull",
        repository: repo.into(),
        title: text(node, "title", 160),
        number,
        state: "open".into(),
        url,
        updated_at: text(node, "updatedAt", 40),
        head_sha: node
            .get("headRefOid")
            .and_then(Value::as_str)
            .filter(|s| s.len() <= 64 && s.bytes().all(|c| c.is_ascii_hexdigit()))
            .map(str::to_string),
        branch: String::new(),
        ci: state,
        review: review.into(),
        mine: node.pointer("/author/login").and_then(Value::as_str) == Some(login),
        review_requested: requested,
        attempt: 1,
    })
}
fn changes(state: &mut State, items: &[Item]) -> Vec<Notice> {
    let previous: HashSet<String> = state.view.items.iter().map(fingerprint).collect();
    let mut notices = vec![];
    for item in items {
        let key = fingerprint(item);
        let unseen = !state.config.seen.contains(&key);
        if state.baseline
            && state.config.options.notifications
            && unseen
            && !previous.contains(&key)
            && notices.len() < 3
        {
            let title = if item.review_requested {
                "Revisión solicitada"
            } else if item.ci == CiState::Failure {
                "Comprobación fallida"
            } else if item.ci == CiState::Success && item.kind == "run" {
                "Comprobación aprobada"
            } else if item.ci == CiState::Running && item.kind == "run" {
                "Comprobación en curso"
            } else if item.state == "merged" {
                "PR fusionada"
            } else if item.kind == "issue" {
                "Issue asignada"
            } else if item.mine {
                "Pull Request actualizada"
            } else {
                continue;
            };
            let mut hash = std::collections::hash_map::DefaultHasher::new();
            key.hash(&mut hash);
            notices.push(Notice {
                id: format!("github:{}:{:x}", item.id, hash.finish()),
                title: title.into(),
                body: format!("{} · {}", item.repository, item.title)
                    .chars()
                    .take(240)
                    .collect(),
                action_id: item.id.clone(),
                action_label: if item.kind == "run" {
                    "Ver ejecución"
                } else if item.kind == "issue" {
                    "Abrir issue"
                } else {
                    "Abrir PR"
                }
                .into(),
                failure: item.ci == CiState::Failure,
            });
        }
        if unseen {
            state.config.seen.push(key);
            if state.config.seen.len() > 256 {
                state.config.seen.remove(0);
            }
        }
    }
    state.baseline = true;
    notices
}

#[cfg(test)]
mod tests {
    use super::*;
    fn state() -> State {
        let mut config = Config::default();
        config.options.enabled = true;
        config.options.notifications = true;
        State {
            view: Snapshot {
                options: config.options.clone(),
                ..Snapshot::default()
            },
            config,
            repositories: vec![],
            truncated: false,
            generation: 1,
            active: true,
            baseline: false,
            calendar_at: 0,
            cooldown: 0,
            stopping: false,
        }
    }
    fn run(ci: CiState) -> Item {
        Item {
            id: "run:42".into(),
            kind: "run",
            repository: "Orvyn-Studios/nivo".into(),
            title: "Fixture".into(),
            number: 42,
            state: "completed".into(),
            url: "https://github.com/Orvyn-Studios/nivo/actions/runs/42".into(),
            updated_at: "2026-10-18T08:00:00Z".into(),
            head_sha: Some("a".repeat(40)),
            branch: "fixture".into(),
            ci,
            review: "unknown".into(),
            mine: false,
            review_requested: false,
            attempt: 1,
        }
    }
    #[test]
    fn first_refresh_is_quiet_and_real_state_changes_deduplicate() {
        let mut s = state();
        let active = run(CiState::Running);
        assert!(changes(&mut s, std::slice::from_ref(&active)).is_empty());
        s.view.items = vec![active];
        let failed = run(CiState::Failure);
        let notices = changes(&mut s, std::slice::from_ref(&failed));
        assert_eq!(notices.len(), 1);
        assert!(notices[0].failure);
        assert_eq!(notices[0].action_id, "run:42");
        assert!(changes(&mut s, std::slice::from_ref(&failed)).is_empty());
        s.view.items = vec![failed];
        let success = run(CiState::Success);
        let notices = changes(&mut s, std::slice::from_ref(&success));
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].title, "Comprobación aprobada");
        assert_eq!(success.review, "unknown");
    }
    #[test]
    fn disabled_notifications_still_record_seen_state_without_replaying_later() {
        let mut s = state();
        s.baseline = true;
        s.config.options.notifications = false;
        let failed = run(CiState::Failure);
        assert!(changes(&mut s, std::slice::from_ref(&failed)).is_empty());
        s.config.options.notifications = true;
        assert!(changes(&mut s, std::slice::from_ref(&failed)).is_empty());
        for attempt in 2..400 {
            let mut item = failed.clone();
            item.attempt = attempt;
            changes(&mut s, &[item]);
        }
        assert_eq!(s.config.seen.len(), 256);
    }
}
