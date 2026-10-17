//! Explicitly enabled local event input. No TCP, prompts, code, transcripts or arbitrary commands.
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AgentStatus {
    Working,
    Waiting,
    Review,
    Complete,
    Error,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DownloadState {
    Active,
    Complete,
    Error,
    Activity,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DownloadSource {
    Browser,
    Bits,
    Folder,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum IntegrationEvent {
    Agent {
        task_id: String,
        status: AgentStatus,
    },
    Download {
        id: String,
        source: DownloadSource,
        name: String,
        state: DownloadState,
        received: Option<u64>,
        total: Option<u64>,
        bytes_per_second: Option<f64>,
    },
}
fn valid(value: &str, max: usize) -> bool {
    !value.is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}
impl IntegrationEvent {
    pub fn validate(&self) -> bool {
        match self {
            Self::Agent { task_id, .. } => valid(task_id, 128),
            Self::Download {
                id,
                name,
                received,
                total,
                bytes_per_second,
                ..
            } => {
                valid(id, 128)
                    && valid(name, 256)
                    && received.is_none_or(|v| v <= 9_007_199_254_740_991)
                    && total.is_none_or(|v| v <= 9_007_199_254_740_991)
                    && bytes_per_second.is_none_or(|v| v.is_finite() && v >= 0.0)
            }
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Credentials {
    pipe: String,
    token: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    token: String,
    event: IntegrationEvent,
}

pub struct ActivityBridge {
    directory: PathBuf,
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}
impl ActivityBridge {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            task: Mutex::new(None),
        }
    }
    pub fn set_enabled(
        &self,
        enabled: bool,
        callback: impl Fn(IntegrationEvent) + Send + Sync + 'static,
    ) -> Result<(), String> {
        let mut task = self
            .task
            .lock()
            .map_err(|_| "El canal local no está disponible.".to_string())?;
        if enabled && task.is_some() {
            return Ok(());
        }
        if let Some(task) = task.take() {
            task.abort();
        }
        let path = self.directory.join("connection.json");
        if !enabled {
            if path.exists() {
                std::fs::remove_file(path)
                    .map_err(|_| "No se pudo revocar el canal local.".to_string())?;
            }
            return Ok(());
        }
        #[cfg(not(windows))]
        {
            let _ = callback;
            return Err("El canal local requiere Windows.".into());
        }
        #[cfg(windows)]
        {
            let mut bytes = [0u8; 32];
            getrandom::fill(&mut bytes)
                .map_err(|_| "No se pudo crear la clave local.".to_string())?;
            let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
            let credentials = Credentials {
                pipe: format!(r"\\.\pipe\Orvyn.Nivo.{}", &token[..24]),
                token,
            };
            std::fs::create_dir_all(&self.directory)
                .map_err(|_| "No se pudo preparar el canal local.".to_string())?;
            let security = security::OwnerSecurity::new()?;
            security.protect_directory(&self.directory)?;
            if path.exists() {
                security.protect_directory(&path)?;
            }
            let (ready, response) = std::sync::mpsc::sync_channel(1);
            let owned = credentials.clone();
            let handle = tauri::async_runtime::spawn(async move {
                serve(owned, callback, ready).await;
            });
            match response.recv_timeout(std::time::Duration::from_secs(3)) {
                Ok(Ok(())) => {}
                _ => {
                    handle.abort();
                    return Err("No se pudo abrir la tubería local de Nivo.".into());
                }
            }
            if std::fs::write(
                &path,
                serde_json::to_vec(&credentials)
                    .map_err(|_| "Clave local no válida.".to_string())?,
            )
            .is_err()
            {
                handle.abort();
                return Err("No se pudo guardar la conexión local protegida.".into());
            }
            *task = Some(handle);
            Ok(())
        }
    }
    pub fn shutdown(&self) {
        let _ = self.set_enabled(false, |_| {});
    }
}
impl Drop for ActivityBridge {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Chrome/Edge start the same executable as a short-lived native-messaging host.
/// It relays only typed download fields to the explicitly enabled Nivo instance.
pub fn native_messaging_host() {
    use std::io::{Read, Write};
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    loop {
        let mut length = [0u8; 4];
        if input.read_exact(&mut length).is_err() {
            break;
        }
        let length = u32::from_le_bytes(length) as usize;
        if length == 0 || length > 8192 {
            break;
        }
        let mut bytes = vec![0u8; length];
        if input.read_exact(&mut bytes).is_err() {
            break;
        }
        let accepted = serde_json::from_slice::<IntegrationEvent>(&bytes)
            .ok()
            .filter(|event| {
                matches!(
                    event,
                    IntegrationEvent::Download {
                        source: DownloadSource::Browser,
                        ..
                    }
                ) && event.validate()
            })
            .is_some_and(relay);
        let response: &[u8] = if accepted {
            b"{\"ok\":true}"
        } else {
            b"{\"ok\":false}"
        };
        if output
            .write_all(&(response.len() as u32).to_le_bytes())
            .and_then(|_| output.write_all(response))
            .and_then(|_| output.flush())
            .is_err()
        {
            break;
        }
    }
}

fn relay(event: IntegrationEvent) -> bool {
    use std::io::{BufRead, Read, Write};
    let Some(roaming) = std::env::var_os("APPDATA") else {
        return false;
    };
    let path = PathBuf::from(roaming)
        .join("com.orvyn.nivo")
        .join("integrations")
        .join("connection.json");
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let Ok(credentials) = serde_json::from_reader::<_, Credentials>(file.take(16384)) else {
        return false;
    };
    let Some(suffix) = credentials.pipe.strip_prefix(r"\\.\pipe\Orvyn.Nivo.") else {
        return false;
    };
    if suffix.len() != 24
        || !suffix.bytes().all(|value| value.is_ascii_hexdigit())
        || credentials.token.len() != 64
    {
        return false;
    }
    let Ok(mut pipe) = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(credentials.pipe)
    else {
        return false;
    };
    let Ok(mut bytes) =
        serde_json::to_vec(&serde_json::json!({ "token": credentials.token, "event": event }))
    else {
        return false;
    };
    bytes.push(b'\n');
    if pipe.write_all(&bytes).is_err() {
        return false;
    }
    let mut reply = String::new();
    let mut reader = std::io::BufReader::new(pipe.take(128));
    reader.read_line(&mut reply).is_ok() && reply.trim() == r#"{"ok":true}"#
}

#[cfg(windows)]
async fn serve(
    credentials: Credentials,
    callback: impl Fn(IntegrationEvent) + Send + Sync + 'static,
    ready: std::sync::mpsc::SyncSender<Result<(), ()>>,
) {
    use tokio::{
        io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
        net::windows::named_pipe::ServerOptions,
        time::{timeout, Duration},
    };
    let make = |first: bool| -> Result<_, String> {
        let mut options = ServerOptions::new();
        options
            .first_pipe_instance(first)
            .reject_remote_clients(true)
            .max_instances(2);
        security::OwnerSecurity::new()?.create_pipe(&options, &credentials.pipe)
    };
    let mut server = match make(true) {
        Ok(server) => server,
        Err(_) => {
            let _ = ready.send(Err(()));
            return;
        }
    };
    let _ = ready.send(Ok(()));
    loop {
        if server.connect().await.is_err() {
            return;
        }
        let next = match make(false) {
            Ok(next) => next,
            Err(_) => return,
        };
        let mut connection = BufReader::new(server);
        let mut bytes = Vec::new();
        let read = timeout(
            Duration::from_secs(1),
            (&mut connection).take(8193).read_until(b'\n', &mut bytes),
        )
        .await;
        let mut accepted = false;
        if read.is_ok() && bytes.len() <= 8192 && bytes.last() == Some(&b'\n') {
            if let Ok(envelope) = serde_json::from_slice::<Envelope>(&bytes) {
                // Compare a fixed-length secret; never echo it or log rejected payloads.
                let equal = envelope.token.len() == credentials.token.len()
                    && envelope
                        .token
                        .bytes()
                        .zip(credentials.token.bytes())
                        .fold(0, |value, (a, b)| value | (a ^ b))
                        == 0;
                if equal && envelope.event.validate() {
                    callback(envelope.event);
                    accepted = true;
                }
            }
        }
        let reply: &[u8] = if accepted {
            b"{\"ok\":true}\n"
        } else {
            b"{\"ok\":false}\n"
        };
        let _ = timeout(
            Duration::from_secs(1),
            connection.get_mut().write_all(reply),
        )
        .await;
        server = next;
    }
}

#[cfg(windows)]
mod security {
    use std::{path::Path, ptr};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, LocalFree},
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            },
            GetTokenInformation, SetFileSecurityW, TokenUser, DACL_SECURITY_INFORMATION,
            SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };
    pub struct OwnerSecurity(*mut core::ffi::c_void);
    impl OwnerSecurity {
        pub fn new() -> Result<Self, String> {
            unsafe {
                let mut token = ptr::null_mut();
                if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                    return Err("No se pudo identificar al usuario local.".into());
                }
                let mut length = 0;
                GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut length);
                let mut buffer = vec![0usize; (length as usize).div_ceil(size_of::<usize>())];
                let success = GetTokenInformation(
                    token,
                    TokenUser,
                    buffer.as_mut_ptr().cast(),
                    length,
                    &mut length,
                );
                CloseHandle(token);
                if success == 0 {
                    return Err("No se pudo validar el usuario local.".into());
                }
                let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
                let mut sid = ptr::null_mut();
                if ConvertSidToStringSidW(user.User.Sid, &mut sid) == 0 {
                    return Err("SID local no disponible.".into());
                }
                let mut size = 0;
                while *sid.add(size) != 0 {
                    size += 1;
                }
                let value = String::from_utf16_lossy(std::slice::from_raw_parts(sid, size));
                LocalFree(sid.cast());
                let sddl: Vec<u16> = format!("D:P(A;OICI;GA;;;SY)(A;OICI;GA;;;{value})")
                    .encode_utf16()
                    .chain(Some(0))
                    .collect();
                let mut descriptor = ptr::null_mut();
                if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    1,
                    &mut descriptor,
                    ptr::null_mut(),
                ) == 0
                {
                    return Err("No se pudo proteger el canal local.".into());
                }
                Ok(Self(descriptor))
            }
        }
        pub fn protect_directory(&self, path: &Path) -> Result<(), String> {
            use std::os::windows::ffi::OsStrExt;
            let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            if unsafe { SetFileSecurityW(wide.as_ptr(), DACL_SECURITY_INFORMATION, self.0) } == 0 {
                return Err("No se pudo limitar la conexión al usuario actual.".into());
            }
            Ok(())
        }
        pub fn create_pipe(
            &self,
            options: &tokio::net::windows::named_pipe::ServerOptions,
            name: &str,
        ) -> Result<tokio::net::windows::named_pipe::NamedPipeServer, String> {
            let mut attributes = SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: self.0,
                bInheritHandle: 0,
            };
            unsafe {
                options.create_with_security_attributes_raw(
                    name,
                    (&mut attributes as *mut SECURITY_ATTRIBUTES).cast(),
                )
            }
            .map_err(|_| "Tubería local no disponible.".into())
        }
    }
    impl Drop for OwnerSecurity {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn named_pipe_rejects_wrong_tokens_and_delivers_only_valid_typed_events() {
        use std::io::{BufRead, Write};
        let mut random = [0u8; 8];
        getrandom::fill(&mut random).unwrap();
        let directory =
            std::env::temp_dir().join(format!("nivo-bridge-test-{:x}", u64::from_le_bytes(random)));
        let bridge = ActivityBridge::new(directory.clone());
        let (tx, rx) = std::sync::mpsc::sync_channel(2);
        bridge
            .set_enabled(true, move |event| {
                let _ = tx.try_send(event);
            })
            .unwrap();
        let credentials: Credentials =
            serde_json::from_slice(&std::fs::read(directory.join("connection.json")).unwrap())
                .unwrap();
        let send = |token: &str| {
            let mut pipe = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&credentials.pipe)
                .unwrap();
            let request = serde_json::json!({ "token": token, "event": { "kind": "agent", "taskId": "fixture", "status": "complete" } });
            writeln!(pipe, "{request}").unwrap();
            let mut reply = String::new();
            std::io::BufReader::new(pipe).read_line(&mut reply).unwrap();
            reply
        };
        assert!(send("invalid").contains("false"));
        assert!(rx.try_recv().is_err());
        assert!(send(&credentials.token).contains("true"));
        assert!(matches!(
            rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap(),
            IntegrationEvent::Agent {
                status: AgentStatus::Complete,
                ..
            }
        ));
        bridge.shutdown();
        assert!(!directory.join("connection.json").exists());
        std::fs::remove_dir(directory).unwrap();
    }
    #[test]
    fn typed_events_reject_private_extras_unknown_actions_and_unbounded_data() {
        assert!(serde_json::from_str::<IntegrationEvent>(
            r#"{"kind":"agent","taskId":"x","status":"complete","prompt":"private"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<IntegrationEvent>(
            r#"{"kind":"shell","command":"anything"}"#
        )
        .is_err());
        assert!(!IntegrationEvent::Agent {
            task_id: "x".repeat(129),
            status: AgentStatus::Working
        }
        .validate());
        let value: IntegrationEvent = serde_json::from_str(r#"{"kind":"download","id":"x","source":"browser","name":"file.zip","state":"active","received":12,"total":null,"bytesPerSecond":null}"#).unwrap();
        assert!(value.validate());
    }
}
