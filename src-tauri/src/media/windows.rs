//! Official GSMTC integration. A dedicated MTA owns Windows objects and subscriptions.
use super::{
    service::{Request, Shared},
    MediaSnapshot, MediaStatus,
};
use std::{
    sync::{
        atomic::Ordering,
        mpsc::{self, Receiver},
        Arc,
    },
    time::Instant,
};
use windows::{
    core::RuntimeType,
    Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
};
use windows_future::{AsyncOperationCompletedHandler, IAsyncOperation};
#[path = "windows/session.rs"]
mod session;
#[path = "windows/worker.rs"]
mod worker;
use worker::Worker;

fn native_error(context: &str, error: windows::core::Error) -> String {
    // HRESULT is enough to diagnose capability/API failure. Do not accidentally
    // copy a player-supplied title, path or private message into diagnostics.
    format!("{context} (Windows 0x{:08X}).", error.code().0 as u32)
}

struct Apartment;
impl Apartment {
    fn initialize() -> Result<Self, String> {
        // SAFETY: this dedicated new thread owns its WinRT initialization;
        // every COM object below is dropped before the guard is destroyed.
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }
            .map_err(|error| native_error("No se pudo iniciar WinRT", error))?;
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        // SAFETY: exactly balances successful RoInitialize on this thread.
        unsafe { RoUninitialize() };
    }
}

fn await_operation<T: RuntimeType + 'static>(
    operation: IAsyncOperation<T>,
    shared: &Shared,
    epoch: u64,
    deadline: Instant,
) -> Result<T, String> {
    if !shared.current(epoch) {
        let _ = operation.Cancel();
        return Err("La operación multimedia fue cancelada.".into());
    }
    let (tx, rx) = mpsc::sync_channel(1);
    let completed = AsyncOperationCompletedHandler::<T>::new(move |_, _| {
        let _ = tx.try_send(());
        Ok(())
    });
    operation
        .SetCompleted(&completed)
        .map_err(|error| native_error("No se pudo esperar a Windows", error))?;
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() || rx.recv_timeout(remaining).is_err() {
        let _ = operation.Cancel();
        return Err("Windows no respondió a tiempo a la consulta multimedia.".into());
    }
    if !shared.current(epoch) {
        let _ = operation.Cancel();
        return Err("La operación multimedia fue cancelada.".into());
    }
    let result = operation
        .GetResults()
        .map_err(|error| native_error("La operación multimedia no está disponible", error));
    let _ = operation.Close();
    result
}

pub(super) fn run(shared: Arc<Shared>, rx: Receiver<Request>) {
    let apartment = Apartment::initialize();
    let initialization_error = apartment.as_ref().err().cloned();
    let mut worker = Worker::default();
    let mut epoch = shared.epoch.load(Ordering::Acquire);
    while let Ok(request) = rx.recv() {
        shared.received();
        if shared.stopped.load(Ordering::Acquire) {
            break;
        }
        let current_epoch = shared.epoch.load(Ordering::Acquire);
        if epoch != current_epoch {
            worker.disconnect();
            epoch = current_epoch;
        }
        if !shared.enabled.load(Ordering::Acquire) {
            worker.disconnect();
        }
        if let Some(error) = initialization_error.as_ref() {
            shared.publish(
                epoch,
                MediaSnapshot::empty(MediaStatus::Unavailable, Some(error.clone())),
            );
            match request {
                Request::Control { reply, .. } | Request::Select { reply, .. } => {
                    let _ = reply.try_send(Err(error.clone()));
                }
                Request::Wake => {}
            }
            continue;
        }
        let action_error = match request {
            Request::Wake => None,
            Request::Control {
                epoch,
                id,
                action,
                deadline,
                reply,
            } => {
                let result = worker.control(&shared, epoch, &id, action, deadline);
                let error = result.as_ref().err().cloned();
                let _ = reply.try_send(result);
                error
            }
            Request::Select {
                epoch,
                id,
                deadline,
                reply,
            } => {
                let result = worker.select(&shared, epoch, id, deadline);
                let error = result.as_ref().err().cloned();
                let _ = reply.try_send(result);
                error
            }
        };
        worker.refresh(&shared, epoch);
        if let Some(error) = action_error {
            if let Ok(mut snapshot) = shared.snapshot_for_worker() {
                snapshot.error = Some(error);
                shared.publish(epoch, snapshot);
            }
        }
    }
    worker.disconnect();
    // Explicit order: all event sources/WinRT objects are gone before apartment.
    drop(worker);
    drop(apartment);
}
