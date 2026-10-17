use super::{
    await_operation, native_error,
    session::{ManagerWatch, SessionWatch, PLAYBACK, TIMELINE},
};
use crate::media::{
    service::{Shared, OPERATION_LIMIT},
    MediaAction, MediaSnapshot, MediaStatus, Playback, MAX_SESSIONS,
};
use std::{
    sync::{atomic::Ordering, Arc},
    time::Instant,
};
use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status;

#[derive(Default)]
pub(super) struct Worker {
    manager: Option<ManagerWatch>,
    sessions: Vec<SessionWatch>,
    selected: Option<String>,
    current_id: Option<String>,
    next_id: u64,
    attempted: bool,
}

impl Worker {
    pub(super) fn disconnect(&mut self) {
        self.sessions.clear();
        self.manager = None;
        self.selected = None;
        self.current_id = None;
        self.attempted = false;
    }

    pub(super) fn refresh(&mut self, shared: &Arc<Shared>, epoch: u64) {
        if !shared.current(epoch) {
            return;
        }
        if self.manager.is_none() {
            if self.attempted {
                return;
            }
            self.attempted = true;
            match ManagerWatch::connect(shared, epoch) {
                Ok(manager) => {
                    self.manager = Some(manager);
                    shared.topology_dirty.store(true, Ordering::Release);
                }
                Err(error) => {
                    shared.publish(
                        epoch,
                        MediaSnapshot::empty(MediaStatus::Unavailable, Some(error)),
                    );
                    return;
                }
            }
        }
        let mut error = None;
        if shared.topology_dirty.swap(false, Ordering::AcqRel) {
            if let Err(message) = self.reconcile(shared) {
                shared.publish(
                    epoch,
                    MediaSnapshot::empty(MediaStatus::Unavailable, Some(message)),
                );
                return;
            }
        }
        // One deadline bounds the whole batch, including up to eight property
        // reads and the selected artwork. Slow players cannot grow a work queue.
        let deadline = Instant::now() + OPERATION_LIMIT;
        for session in &mut self.sessions {
            if !shared.current(epoch) {
                return;
            }
            if let Some(message) = session.refresh(shared, epoch, deadline) {
                error.get_or_insert(message);
            }
        }
        let active = self.active_id();
        for session in &mut self.sessions {
            if active.as_deref() == Some(session.id.as_str()) {
                session.load_artwork(shared, epoch, deadline);
            } else {
                // Only the active session retains an encoded artwork cache.
                if let Some(dto) = session.dto.as_mut() {
                    dto.artwork = None;
                }
                session.artwork_loaded = false;
            }
        }
        let sessions: Vec<_> = self
            .sessions
            .iter()
            .filter_map(|session| session.dto.clone())
            .collect();
        let status = if sessions.is_empty() && error.is_some() {
            MediaStatus::Unavailable
        } else {
            MediaStatus::Ready
        };
        shared.publish(
            epoch,
            MediaSnapshot {
                sequence: 0,
                status,
                sessions,
                active_session_id: active,
                error,
            },
        );
    }

    fn reconcile(&mut self, shared: &Arc<Shared>) -> Result<(), String> {
        let manager = &self
            .manager
            .as_ref()
            .ok_or("Multimedia no está conectada.")?
            .manager;
        let available = manager
            .GetSessions()
            .map_err(|error| native_error("No se pudieron consultar las sesiones", error))?;
        let current = manager.GetCurrentSession().ok();
        let mut raw = Vec::with_capacity(MAX_SESSIONS);
        // Keep the system's current session within the bounded list even when
        // more than eight compatible applications have published sessions.
        if let Some(current) = current.as_ref() {
            raw.push(current.clone());
        }
        let count = available
            .Size()
            .map_err(|error| native_error("No se pudo consultar el número de sesiones", error))?;
        for index in 0..count.min(MAX_SESSIONS as u32) {
            if raw.len() == MAX_SESSIONS {
                break;
            }
            let candidate = available
                .GetAt(index)
                .map_err(|error| native_error("Una sesión dejó de estar disponible", error))?;
            if !raw.contains(&candidate) {
                raw.push(candidate);
            }
        }
        let mut previous = std::mem::take(&mut self.sessions);
        let mut sessions = Vec::with_capacity(raw.len());
        for session in raw {
            if let Some(index) = previous.iter().position(|watch| watch.session == session) {
                sessions.push(previous.swap_remove(index));
            } else {
                self.next_id = self
                    .next_id
                    .checked_add(1)
                    .ok_or("Se agotaron los identificadores de sesión.")?;
                sessions.push(SessionWatch::connect(
                    session,
                    format!("session-{}", self.next_id),
                    shared,
                )?);
            }
        }
        self.current_id = current.as_ref().and_then(|current| {
            sessions
                .iter()
                .find(|watch| watch.session == *current)
                .map(|watch| watch.id.clone())
        });
        self.sessions = sessions;
        if self
            .selected
            .as_ref()
            .is_some_and(|id| !self.sessions.iter().any(|watch| watch.id == *id))
        {
            self.selected = None;
        }
        Ok(())
    }

    fn active_id(&self) -> Option<String> {
        let visible = |id: &str| {
            self.sessions
                .iter()
                .any(|watch| watch.id == id && watch.dto.is_some())
        };
        self.selected
            .as_ref()
            .filter(|id| visible(id))
            .cloned()
            .or_else(|| self.current_id.as_ref().filter(|id| visible(id)).cloned())
            .or_else(|| {
                self.sessions
                    .iter()
                    .find(|watch| {
                        watch
                            .dto
                            .as_ref()
                            .is_some_and(|dto| dto.playback == Playback::Playing)
                    })
                    .map(|watch| watch.id.clone())
            })
            .or_else(|| {
                self.sessions
                    .iter()
                    .find(|watch| watch.dto.is_some())
                    .map(|watch| watch.id.clone())
            })
    }

    pub(super) fn control(
        &mut self,
        shared: &Shared,
        epoch: u64,
        id: &str,
        action: MediaAction,
        deadline: Instant,
    ) -> Result<(), String> {
        if !shared.current(epoch) || Instant::now() >= deadline {
            return Err("La acción multimedia caducó o fue cancelada.".into());
        }
        let watch = self
            .sessions
            .iter()
            .find(|watch| watch.id == id)
            .ok_or("La sesión seleccionada ya no está disponible.")?;
        let info = watch
            .session
            .GetPlaybackInfo()
            .map_err(|error| native_error("La sesión ya no está disponible", error))?;
        let controls = info
            .Controls()
            .map_err(|error| native_error("No se pudieron consultar los controles", error))?;
        let status = info.PlaybackStatus().map_err(|error| {
            native_error("No se pudo confirmar el estado de reproducción", error)
        })?;
        if status == Status::Closed {
            return Err("La sesión seleccionada ya se cerró.".into());
        }
        let operation = match action {
            MediaAction::PlayPause if controls.IsPlayPauseToggleEnabled().unwrap_or(false) => {
                watch.session.TryTogglePlayPauseAsync()
            }
            MediaAction::PlayPause
                if status == Status::Playing && controls.IsPauseEnabled().unwrap_or(false) =>
            {
                watch.session.TryPauseAsync()
            }
            MediaAction::PlayPause
                if status != Status::Playing && controls.IsPlayEnabled().unwrap_or(false) =>
            {
                watch.session.TryPlayAsync()
            }
            MediaAction::Previous if controls.IsPreviousEnabled().unwrap_or(false) => {
                watch.session.TrySkipPreviousAsync()
            }
            MediaAction::Next if controls.IsNextEnabled().unwrap_or(false) => {
                watch.session.TrySkipNextAsync()
            }
            _ => return Err("La aplicación multimedia no permite este control.".into()),
        }
        .map_err(|error| native_error("No se pudo solicitar el control multimedia", error))?;
        if !await_operation(operation, shared, epoch, deadline)? {
            return Err("La aplicación multimedia rechazó la acción.".into());
        }
        watch.dirty.fetch_or(PLAYBACK | TIMELINE, Ordering::AcqRel);
        Ok(())
    }

    pub(super) fn select(
        &mut self,
        shared: &Shared,
        epoch: u64,
        id: String,
        deadline: Instant,
    ) -> Result<(), String> {
        if !shared.current(epoch) || Instant::now() >= deadline {
            return Err("La selección multimedia caducó o fue cancelada.".into());
        }
        if !self
            .sessions
            .iter()
            .any(|watch| watch.id == id && watch.dto.is_some())
        {
            return Err("La sesión seleccionada ya no está disponible.".into());
        }
        self.selected = Some(id);
        Ok(())
    }
}
