//! Windows lifecycle broadcasts without polling or inspecting other apps.
//!
//! Lock/power state starts unknown; callbacks only describe actual messages.
//! A caller must enqueue work from the callback rather than block WndProc.

use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc, Mutex,
};

#[cfg(windows)]
#[path = "lifecycle/windows.rs"]
mod windows;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SystemEvent {
    DisplayChanged,
    Suspended,
    Resumed,
    PowerChanged,
    LockKey { caps: bool, enabled: bool },
    SessionLocked,
    SessionUnlocked,
}

pub(super) struct ObserverState {
    thread_id: AtomicU32,
    stopped: AtomicBool,
    finished: AtomicBool,
    error: Mutex<Option<String>>,
    caps_enabled: AtomicBool,
    num_enabled: AtomicBool,
}

impl ObserverState {
    fn error(&self, error: String) {
        if let Ok(mut previous) = self.error.lock() {
            *previous = Some(error);
        }
    }
}

pub struct LifecycleGuard {
    state: Arc<ObserverState>,
}

impl LifecycleGuard {
    #[cfg(windows)]
    pub fn start(callback: impl Fn(SystemEvent) + Send + Sync + 'static) -> Result<Self, String> {
        use std::{sync::mpsc, time::Duration};
        let state = Arc::new(ObserverState {
            thread_id: AtomicU32::new(0),
            stopped: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            error: Mutex::new(None),
            caps_enabled: AtomicBool::new(false),
            num_enabled: AtomicBool::new(false),
        });
        let (ready, response) = mpsc::sync_channel(1);
        let worker = state.clone();
        std::thread::Builder::new()
            .name("nivo-lifecycle".into())
            .spawn(move || windows::run(worker, Box::new(callback), ready))
            .map_err(|error| format!("No se pudo iniciar el observador de Windows: {error}"))?;
        let guard = Self { state };
        match response.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => Ok(guard),
            Ok(Err(error)) => Err(error),
            Err(_) => {
                let _ = guard.shutdown();
                Err("Windows no respondió a tiempo al registrar el observador.".into())
            }
        }
    }

    #[cfg(not(windows))]
    pub fn start(_: impl Fn(SystemEvent) + Send + Sync + 'static) -> Result<Self, String> {
        Err("Los eventos de ciclo de vida solo están disponibles en Windows.".into())
    }

    /// Wake/health check only: never invents a display, lock or power event.
    pub fn refresh(&self) -> Result<(), String> {
        if self.state.stopped.load(Ordering::Acquire) || self.state.finished.load(Ordering::Acquire)
        {
            return Err("El observador de Windows ha terminado.".into());
        }
        #[cfg(windows)]
        windows::wake(self.state.thread_id.load(Ordering::Acquire), false)?;
        Ok(())
    }

    pub fn set_keyboard(&self, caps: bool, num: bool) -> Result<(), String> {
        self.state.caps_enabled.store(caps, Ordering::Release);
        self.state.num_enabled.store(num, Ordering::Release);
        self.refresh()
    }

    pub fn error(&self) -> Option<String> {
        self.state
            .error
            .lock()
            .map(|error| error.clone())
            .unwrap_or_else(|_| Some("No se pudo consultar el estado del observador.".into()))
    }

    /// Nonblocking; the owning thread unregisters WTS, destroys its window,
    /// then unregisters its class. No HWND is destroyed from a foreign thread.
    pub fn shutdown(&self) -> Result<(), String> {
        if self.state.stopped.swap(true, Ordering::AcqRel)
            || self.state.finished.load(Ordering::Acquire)
        {
            return Ok(());
        }
        #[cfg(windows)]
        {
            let thread_id = self.state.thread_id.load(Ordering::Acquire);
            if thread_id != 0 {
                if let Err(error) = windows::wake(thread_id, true) {
                    if !self.state.finished.load(Ordering::Acquire) {
                        self.state.error(error.clone());
                        return Err(error);
                    }
                }
            }
        }
        Ok(())
    }
}

impl Drop for LifecycleGuard {
    fn drop(&mut self) {
        if let Err(error) = self.shutdown() {
            eprintln!("Nivo lifecycle: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finished_observer_rejects_refresh_and_shutdown_is_idempotent() {
        let guard = LifecycleGuard {
            state: Arc::new(ObserverState {
                thread_id: AtomicU32::new(0),
                stopped: AtomicBool::new(false),
                finished: AtomicBool::new(true),
                error: Mutex::new(None),
                caps_enabled: AtomicBool::new(false),
                num_enabled: AtomicBool::new(false),
            }),
        };
        assert!(guard.refresh().is_err());
        assert!(guard.shutdown().is_ok());
        assert!(guard.shutdown().is_ok());
        assert!(guard.error().is_none());
    }
}
