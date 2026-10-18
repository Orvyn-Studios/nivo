//! One bounded native operation at a time. No paths/commands arrive in events.
use crate::drop_files::DroppedFile;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Condvar, Mutex,
};
use std::time::{Duration, Instant};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub operation_id: String,
    pub phase: &'static str,
    pub completed: u64,
    pub total: Option<u64>,
    pub cancellable: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub operation_id: String,
    pub outcome: &'static str,
    pub message: String,
    pub file: Option<DroppedFile>,
}
#[derive(Default)]
pub struct Operations {
    serial: AtomicU64,
    active: Mutex<Option<(String, Arc<AtomicBool>)>>,
    closing: AtomicBool,
    idle: Condvar,
}
pub struct Operation<'a> {
    owner: &'a Operations,
    pub id: String,
    cancel: Arc<AtomicBool>,
    last: Mutex<Instant>,
    notify: Box<dyn Fn(Progress) + Send + Sync>,
}
impl Operations {
    pub fn begin(
        &self,
        notify: impl Fn(Progress) + Send + Sync + 'static,
    ) -> Result<Operation<'_>, String> {
        let mut active = self.active.lock().map_err(|_| "Operación no disponible.")?;
        if self.closing.load(Ordering::Acquire) {
            return Err("Nivo se está cerrando.".into());
        }
        if active.is_some() {
            return Err("Espera a que termine la operación actual o cancélala.".into());
        }
        let id = format!("action:{}", self.serial.fetch_add(1, Ordering::Relaxed));
        let cancel = Arc::new(AtomicBool::new(false));
        *active = Some((id.clone(), Arc::clone(&cancel)));
        Ok(Operation {
            owner: self,
            id,
            cancel,
            last: Mutex::new(Instant::now() - Duration::from_secs(1)),
            notify: Box::new(notify),
        })
    }
    pub fn cancel(&self, id: &str) -> Result<bool, String> {
        let active = self.active.lock().map_err(|_| "Operación no disponible.")?;
        if let Some((current, cancel)) = active.as_ref() {
            if current == id {
                cancel.store(true, Ordering::Relaxed);
                return Ok(true);
            }
        }
        Ok(false)
    }
    pub fn cancel_all(&self) {
        if let Ok(active) = self.active.lock() {
            if let Some((_, cancel)) = active.as_ref() {
                cancel.store(true, Ordering::Relaxed);
            }
        }
    }
    pub fn busy(&self) -> bool {
        self.active.lock().map_or(true, |v| v.is_some())
    }
    pub fn start_shutdown(&self) -> bool {
        if self.closing.swap(true, Ordering::AcqRel) {
            return false;
        }
        self.cancel_all();
        true
    }
    pub fn drain(&self, timeout: Duration) -> bool {
        let Ok(active) = self.active.lock() else {
            return false;
        };
        self.idle
            .wait_timeout_while(active, timeout, |value| value.is_some())
            .is_ok_and(|(value, _)| value.is_none())
    }
}
impl Operation<'_> {
    pub fn check(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::Relaxed) {
            Err("Operación cancelada.".into())
        } else {
            Ok(())
        }
    }
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
    pub fn progress(&self, phase: &'static str, completed: u64, total: Option<u64>) {
        let Ok(mut last) = self.last.lock() else {
            return;
        };
        if phase == "running" && last.elapsed() < Duration::from_millis(50) {
            return;
        }
        *last = Instant::now();
        (self.notify)(Progress {
            operation_id: self.id.clone(),
            phase,
            completed,
            total,
            cancellable: phase == "running",
        });
    }
    pub fn result(&self, message: impl Into<String>, file: Option<DroppedFile>) -> ActionResult {
        ActionResult {
            operation_id: self.id.clone(),
            outcome: if self.cancelled() && file.is_none() {
                "cancelled"
            } else {
                "success"
            },
            message: message.into(),
            file,
        }
    }
}
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.owner.active.lock() {
            if active.as_ref().is_some_and(|v| v.0 == self.id) {
                *active = None;
                self.owner.idle.notify_all();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn single_operation_cancellation_and_release() {
        let state = Operations::default();
        let op = state.begin(|_| {}).unwrap();
        assert!(state.begin(|_| {}).is_err());
        assert!(!state.cancel("foreign").unwrap());
        assert!(state.cancel(&op.id).unwrap());
        assert!(op.check().is_err());
        drop(op);
        assert!(!state.busy());
        assert!(state.begin(|_| {}).is_ok());
    }
    #[test]
    fn shutdown_seals_new_jobs_and_drains_only_after_cleanup_releases_the_operation() {
        let state = Operations::default();
        let op = state.begin(|_| {}).unwrap();
        assert!(state.start_shutdown());
        assert!(op.cancelled());
        assert!(!state.start_shutdown());
        assert!(!state.drain(Duration::from_millis(1)));
        drop(op);
        assert!(state.drain(Duration::from_millis(1)));
        assert!(state.begin(|_| {}).is_err());
    }
}
