//! Core Audio controls. The worker owns COM; no recording, samples or process inspection.
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc::{self, SyncSender},
    Arc, Mutex,
};
use std::time::Duration;

#[cfg(windows)]
#[path = "audio/windows.rs"]
mod windows;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioEndpoint {
    pub id: String,
    pub name: String,
    pub volume: f32,
    pub muted: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSession {
    pub id: String,
    pub name: String,
    pub volume: f32,
    pub muted: bool,
    pub active: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSnapshot {
    pub sequence: u64,
    pub status: String,
    pub output: Option<AudioEndpoint>,
    pub input: Option<AudioEndpoint>,
    pub devices: Vec<AudioDevice>,
    pub sessions: Vec<AudioSession>,
    pub error: Option<String>,
}
impl AudioSnapshot {
    fn empty(status: &str) -> Self {
        Self {
            sequence: 0,
            status: status.into(),
            output: None,
            input: None,
            devices: vec![],
            sessions: vec![],
            error: None,
        }
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum AudioAction {
    OutputVolume { id: String, value: f32 },
    OutputMute { id: String, muted: bool },
    InputMute { id: String, muted: bool },
    SessionVolume { id: String, value: f32 },
    SessionMute { id: String, muted: bool },
}
impl AudioAction {
    fn validate(&self) -> Result<(), String> {
        let (id, value) = match self {
            Self::OutputVolume { id, value } | Self::SessionVolume { id, value } => {
                (id, Some(*value))
            }
            Self::OutputMute { id, .. }
            | Self::InputMute { id, .. }
            | Self::SessionMute { id, .. } => (id, None),
        };
        if id.is_empty()
            || id.len() > 2048
            || id.chars().any(char::is_control)
            || value.is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
        {
            return Err("Control de audio no válido.".into());
        }
        Ok(())
    }
}
enum Request {
    Wake,
    Control(
        u64,
        std::time::Instant,
        AudioAction,
        SyncSender<Result<(), String>>,
    ),
}
type Callback = Box<dyn Fn(AudioSnapshot) + Send + Sync>;
struct Shared {
    tx: SyncSender<Request>,
    enabled: AtomicBool,
    epoch: AtomicU64,
    stopped: AtomicBool,
    wake_pending: AtomicBool,
    topology_dirty: AtomicBool,
    snapshot: Mutex<AudioSnapshot>,
    callback: Mutex<Option<Callback>>,
}
impl Shared {
    fn wake(&self, topology: bool) {
        if topology {
            self.topology_dirty.store(true, Ordering::Release);
        }
        if !self.wake_pending.swap(true, Ordering::AcqRel) {
            let _ = self.tx.try_send(Request::Wake);
        }
    }
    fn publish(&self, epoch: u64, mut next: AudioSnapshot) {
        let Ok(mut current) = self.snapshot.lock() else {
            return;
        };
        if epoch != self.epoch.load(Ordering::Acquire) {
            return;
        }
        if !self.enabled.load(Ordering::Acquire) {
            next = AudioSnapshot::empty("disabled");
        }
        next.sequence = current.sequence;
        if *current == next {
            return;
        }
        next.sequence = current.sequence.saturating_add(1);
        *current = next.clone();
        if let Ok(callback) = self.callback.lock() {
            if let Some(callback) = callback.as_ref() {
                callback(next);
            }
        }
    }
}
pub struct AudioService {
    shared: Arc<Shared>,
    worker: Mutex<Option<std::thread::JoinHandle<()>>>,
}
impl AudioService {
    pub fn start(enabled: bool, callback: impl Fn(AudioSnapshot) + Send + Sync + 'static) -> Self {
        let (tx, rx) = mpsc::sync_channel(32);
        let shared = Arc::new(Shared {
            tx,
            enabled: AtomicBool::new(enabled),
            epoch: AtomicU64::new(0),
            stopped: AtomicBool::new(false),
            wake_pending: AtomicBool::new(false),
            topology_dirty: AtomicBool::new(true),
            snapshot: Mutex::new(AudioSnapshot::empty(if enabled {
                "connecting"
            } else {
                "disabled"
            })),
            callback: Mutex::new(Some(Box::new(callback))),
        });
        let owned = shared.clone();
        let worker = std::thread::Builder::new()
            .name("nivo-audio".into())
            .spawn(move || {
                #[cfg(windows)]
                windows::run(owned, rx);
                #[cfg(not(windows))]
                {
                    let _ = (owned, rx);
                }
            })
            .ok();
        if worker.is_none() {
            let mut error = AudioSnapshot::empty("unavailable");
            error.error = Some("No se pudo iniciar Core Audio.".into());
            shared.publish(0, error);
        }
        Self {
            shared,
            worker: Mutex::new(worker),
        }
    }
    pub fn snapshot(&self) -> Result<AudioSnapshot, String> {
        self.shared
            .snapshot
            .lock()
            .map(|value| value.clone())
            .map_err(|_| "Audio no disponible.".into())
    }
    pub fn set_enabled(&self, enabled: bool) {
        if self.shared.enabled.swap(enabled, Ordering::AcqRel) == enabled {
            return;
        }
        // Revoke metadata immediately, even if Windows is still unwinding its callbacks.
        let epoch = self.shared.epoch.fetch_add(1, Ordering::AcqRel) + 1;
        self.shared.publish(
            epoch,
            AudioSnapshot::empty(if enabled { "connecting" } else { "disabled" }),
        );
        self.shared.wake(true);
    }
    pub fn control(&self, action: AudioAction) -> Result<(), String> {
        action.validate()?;
        if !self.shared.enabled.load(Ordering::Acquire)
            || self.shared.stopped.load(Ordering::Acquire)
        {
            return Err("Audio desactivado.".into());
        }
        let (tx, rx) = mpsc::sync_channel(1);
        self.shared
            .tx
            .try_send(Request::Control(
                self.shared.epoch.load(Ordering::Acquire),
                std::time::Instant::now() + Duration::from_secs(3),
                action,
                tx,
            ))
            .map_err(|_| "Audio ocupado; vuelve a intentarlo.".to_string())?;
        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| "Windows no respondió al control de audio.".to_string())?
    }
    pub fn shutdown(&self) {
        if self.shared.stopped.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Ok(mut callback) = self.shared.callback.lock() {
            *callback = None;
        }
        self.shared.wake(false);
        // The worker releases each subscription on its owning COM thread.
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
    }
}
impl Drop for AudioService {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "read-only integration with the actual Windows audio environment"]
    fn native_audio_snapshot() {
        let (tx, rx) = mpsc::sync_channel(8);
        let service = AudioService::start(true, move |snapshot| {
            let _ = tx.try_send(snapshot);
        });
        let snapshot = rx
            .recv_timeout(Duration::from_secs(8))
            .expect("Core Audio did not respond");
        println!(
            "NIVO_AUDIO_READ_ONLY {}",
            serde_json::to_string(&snapshot).unwrap()
        );
        assert_eq!(snapshot.status, "ready", "{:?}", snapshot.error);
        assert!(snapshot
            .output
            .as_ref()
            .is_none_or(|value| (0.0..=1.0).contains(&value.volume)));
        service.set_enabled(false);
        assert!(service.snapshot().unwrap().sessions.is_empty());
        assert!(service.snapshot().unwrap().output.is_none());
        service.shutdown();
    }

    #[test]
    fn old_audio_epochs_cannot_restore_metadata_after_opt_out() {
        let service = AudioService::start(false, |_| {});
        service.shared.epoch.store(2, Ordering::Release);
        let mut snapshot = AudioSnapshot::empty("ready");
        snapshot.output = Some(AudioEndpoint {
            id: "fixture".into(),
            name: "fixture".into(),
            volume: 0.5,
            muted: false,
        });
        service.shared.publish(1, snapshot);
        assert_eq!(service.snapshot().unwrap().status, "disabled");
        service.shutdown();
    }
    #[test]
    fn audio_controls_reject_unbounded_ids_and_invalid_levels() {
        for value in [-1.0, f32::NAN, f32::INFINITY, 1.01] {
            assert!(AudioAction::OutputVolume {
                id: "known".into(),
                value
            }
            .validate()
            .is_err());
        }
        assert!(AudioAction::InputMute {
            id: "".into(),
            muted: true
        }
        .validate()
        .is_err());
        assert!(AudioAction::SessionVolume {
            id: "known".into(),
            value: 0.5
        }
        .validate()
        .is_ok());
    }
    #[test]
    fn disabled_audio_has_no_private_state_and_rejects_controls() {
        let service = AudioService::start(false, |_| {});
        let snapshot = service.snapshot().unwrap();
        assert!(
            snapshot.output.is_none() && snapshot.input.is_none() && snapshot.sessions.is_empty()
        );
        assert!(service
            .control(AudioAction::InputMute {
                id: "x".into(),
                muted: false
            })
            .is_err());
        service.shutdown();
        service.shutdown();
    }
}
