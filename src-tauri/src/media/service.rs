use super::{valid_session_id, MediaAction, MediaSnapshot, MediaStatus};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

pub(super) const OPERATION_LIMIT: Duration = Duration::from_secs(6);
pub(super) type Reply = SyncSender<Result<(), String>>;
type UpdateCallback = Box<dyn Fn(MediaSnapshot) + Send + Sync>;

pub(super) enum Request {
    Wake,
    Control {
        epoch: u64,
        id: String,
        action: MediaAction,
        deadline: Instant,
        reply: Reply,
    },
    Select {
        epoch: u64,
        id: String,
        deadline: Instant,
        reply: Reply,
    },
}

pub(super) struct Shared {
    pub tx: SyncSender<Request>,
    pub stopped: AtomicBool,
    pub enabled: AtomicBool,
    pub epoch: AtomicU64,
    pub topology_dirty: AtomicBool,
    wake_pending: AtomicBool,
    snapshot: Mutex<MediaSnapshot>,
    on_update: Mutex<Option<UpdateCallback>>,
}

impl Shared {
    pub fn wake(&self) {
        // A full queue already guarantees worker activity. Every received
        // request is followed by inspecting dirty flags, so no event is lost.
        if !self.wake_pending.swap(true, Ordering::AcqRel) {
            let _ = self.tx.try_send(Request::Wake);
        }
    }

    pub fn received(&self) {
        self.wake_pending.store(false, Ordering::Release);
    }

    pub fn current(&self, epoch: u64) -> bool {
        !self.stopped.load(Ordering::Acquire)
            && self.enabled.load(Ordering::Acquire)
            && self.epoch.load(Ordering::Acquire) == epoch
    }

    pub fn snapshot_for_worker(&self) -> Result<MediaSnapshot, String> {
        self.snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .map_err(|_| "No se pudo acceder al estado multimedia.".into())
    }

    fn emit(&self, snapshot: MediaSnapshot) {
        if let Ok(callback) = self.on_update.lock() {
            if let Some(callback) = callback.as_ref() {
                callback(snapshot);
            }
        }
    }

    pub fn publish(&self, epoch: u64, mut next: MediaSnapshot) {
        if let Ok(mut previous) = self.snapshot.lock() {
            if !self.current(epoch) {
                return;
            }
            next.sequence = previous.sequence;
            if *previous != next {
                next.sequence = previous.sequence.saturating_add(1);
                *previous = next.clone();
                // Serialize callback order with snapshots and opt-out. This
                // callback must only enqueue the Tauri event, never call back
                // into this service synchronously.
                self.emit(next);
            }
        }
    }
}

pub struct MediaService {
    shared: Arc<Shared>,
}

impl MediaService {
    pub fn start(enabled: bool, on_update: impl Fn(MediaSnapshot) + Send + Sync + 'static) -> Self {
        let (tx, rx) = mpsc::sync_channel(16);
        let shared = Arc::new(Shared {
            tx,
            stopped: AtomicBool::new(false),
            enabled: AtomicBool::new(enabled),
            epoch: AtomicU64::new(0),
            topology_dirty: AtomicBool::new(true),
            wake_pending: AtomicBool::new(false),
            snapshot: Mutex::new(MediaSnapshot::empty(
                if enabled {
                    MediaStatus::Connecting
                } else {
                    MediaStatus::Disabled
                },
                None,
            )),
            on_update: Mutex::new(Some(Box::new(on_update))),
        });
        let worker = shared.clone();
        if let Err(error) = std::thread::Builder::new()
            .name("nivo-media".into())
            .spawn(move || run(worker, rx))
        {
            shared.publish(
                0,
                MediaSnapshot::empty(
                    MediaStatus::Unavailable,
                    Some(format!("No se pudo iniciar multimedia: {error}")),
                ),
            );
        } else {
            shared.wake();
        }
        Self { shared }
    }

    pub fn snapshot(&self) -> Result<MediaSnapshot, String> {
        self.shared.snapshot_for_worker()
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        if self.shared.stopped.load(Ordering::Acquire) {
            return Err("El servicio multimedia ha terminado.".into());
        }
        let mut snapshot = self
            .shared
            .snapshot
            .lock()
            .map_err(|_| "No se pudo acceder al estado multimedia.")?;
        if self.shared.enabled.load(Ordering::Acquire) == enabled {
            return Ok(());
        }
        self.shared.epoch.fetch_add(1, Ordering::AcqRel);
        self.shared.enabled.store(enabled, Ordering::Release);
        let mut next = MediaSnapshot::empty(
            if enabled {
                MediaStatus::Connecting
            } else {
                MediaStatus::Disabled
            },
            None,
        );
        next.sequence = snapshot.sequence.saturating_add(1);
        *snapshot = next.clone();
        self.shared.emit(next);
        drop(snapshot);
        self.shared.topology_dirty.store(true, Ordering::Release);
        self.shared.wake();
        Ok(())
    }

    pub fn control(&self, session_id: String, action: MediaAction) -> Result<(), String> {
        self.request(session_id, Some(action))
    }

    /// Selects Nivo's active session; GSMTC has no setter for Windows' current session.
    pub fn select(&self, session_id: String) -> Result<(), String> {
        self.request(session_id, None)
    }

    /// Reconnects after a real system resume. Old reads and queued controls
    /// belong to the previous generation and cannot republish or target a
    /// newly discovered session. No timer/polling is started.
    pub fn refresh(&self) -> Result<(), String> {
        let mut snapshot = self
            .shared
            .snapshot
            .lock()
            .map_err(|_| "No se pudo acceder al estado multimedia.")?;
        let epoch = self.shared.epoch.load(Ordering::Acquire);
        if !self.shared.current(epoch) {
            return Ok(());
        }
        self.shared.epoch.fetch_add(1, Ordering::AcqRel);
        let mut next = MediaSnapshot::empty(MediaStatus::Connecting, None);
        next.sequence = snapshot.sequence.saturating_add(1);
        *snapshot = next.clone();
        self.shared.emit(next);
        drop(snapshot);
        self.shared.topology_dirty.store(true, Ordering::Release);
        self.shared.wake();
        Ok(())
    }

    fn request(&self, id: String, action: Option<MediaAction>) -> Result<(), String> {
        if !valid_session_id(&id) {
            return Err("Identificador de sesión no válido.".into());
        }
        let epoch = self.shared.epoch.load(Ordering::Acquire);
        if !self.shared.current(epoch) {
            return Err("La integración multimedia está desactivada.".into());
        }
        let (reply, response) = mpsc::sync_channel(1);
        let deadline = Instant::now() + OPERATION_LIMIT;
        let request = match action {
            Some(action) => Request::Control {
                epoch,
                id,
                action,
                deadline,
                reply,
            },
            None => Request::Select {
                epoch,
                id,
                deadline,
                reply,
            },
        };
        self.shared
            .tx
            .try_send(request)
            .map_err(|error| match error {
                mpsc::TrySendError::Full(_) => {
                    "Multimedia está ocupada; vuelve a intentarlo.".to_string()
                }
                mpsc::TrySendError::Disconnected(_) => {
                    "El servicio multimedia no está disponible.".to_string()
                }
            })?;
        response
            .recv_timeout(OPERATION_LIMIT + Duration::from_millis(250))
            .map_err(|_| "Windows no respondió a tiempo a la acción multimedia.".to_string())?
    }

    /// Nonblocking: wakes an idle worker. A pending Windows operation has a
    /// bounded deadline and cannot republish metadata after this call.
    pub fn shutdown(&self) {
        self.shared.stopped.store(true, Ordering::Release);
        self.shared.epoch.fetch_add(1, Ordering::AcqRel);
        self.shared.wake();
        // Release an AppHandle captured by the callback, avoiding a managed
        // service -> callback -> app/state ownership cycle during teardown.
        let callback = self
            .shared
            .on_update
            .lock()
            .ok()
            .and_then(|mut callback| callback.take());
        drop(callback);
    }
}

impl Drop for MediaService {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(windows)]
fn run(shared: Arc<Shared>, rx: Receiver<Request>) {
    super::windows::run(shared, rx);
}

#[cfg(not(windows))]
fn run(shared: Arc<Shared>, rx: Receiver<Request>) {
    while let Ok(request) = rx.recv() {
        shared.received();
        if shared.stopped.load(Ordering::Acquire) {
            break;
        }
        match request {
            Request::Wake => shared.publish(
                shared.epoch.load(Ordering::Acquire),
                MediaSnapshot::empty(
                    MediaStatus::Unavailable,
                    Some("GSMTC solo está disponible en Windows.".into()),
                ),
            ),
            Request::Control { reply, .. } | Request::Select { reply, .. } => {
                let _ = reply.try_send(Err("GSMTC solo está disponible en Windows.".into()));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_service_never_accepts_controls() {
        let service = MediaService::start(false, |_| {});
        assert_eq!(service.snapshot().unwrap().status, MediaStatus::Disabled);
        assert!(service
            .control("session-1".into(), MediaAction::Next)
            .is_err());
        service.shutdown();
        assert!(service.set_enabled(true).is_err());
    }

    #[test]
    fn generation_rejects_late_metadata_and_opt_out_clears_immediately() {
        let service = MediaService::start(false, |_| {});
        service.set_enabled(true).unwrap();
        let epoch = service.shared.epoch.load(Ordering::Acquire);
        service.set_enabled(false).unwrap();
        service
            .shared
            .publish(epoch, MediaSnapshot::empty(MediaStatus::Ready, None));
        let snapshot = service.snapshot().unwrap();
        assert_eq!(snapshot.status, MediaStatus::Disabled);
        assert!(snapshot.sessions.is_empty());
        assert!(snapshot.active_session_id.is_none());
        assert!(snapshot.sequence >= 2);
    }

    #[test]
    fn shutdown_releases_callback_captures_and_is_idempotent() {
        struct Capture(Arc<AtomicBool>);
        impl Drop for Capture {
            fn drop(&mut self) {
                self.0.store(true, Ordering::Release);
            }
        }
        let released = Arc::new(AtomicBool::new(false));
        let capture = Capture(released.clone());
        let service = MediaService::start(false, move |_| {
            let _ = &capture;
        });
        assert!(!released.load(Ordering::Acquire));
        service.shutdown();
        assert!(released.load(Ordering::Acquire));
        service.shutdown();
    }
}
