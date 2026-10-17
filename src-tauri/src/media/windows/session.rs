use super::{await_operation, native_error};
use crate::media::{
    bounded_text,
    service::{Shared, OPERATION_LIMIT},
    MediaSession, Playback,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
    time::Instant,
};
use windows::{
    Foundation::TypedEventHandler,
    Media::Control::{
        CurrentSessionChangedEventArgs, GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
        MediaPropertiesChangedEventArgs, PlaybackInfoChangedEventArgs, SessionsChangedEventArgs,
        TimelinePropertiesChangedEventArgs,
    },
    Storage::Streams::{DataReader, IRandomAccessStreamReference},
};
const METADATA: u8 = 1;
pub(super) const PLAYBACK: u8 = 2;
pub(super) const TIMELINE: u8 = 4;
const ALL: u8 = METADATA | PLAYBACK | TIMELINE;
const MAX_ARTWORK_BYTES: u64 = 2 * 1024 * 1024;

pub(super) struct ManagerWatch {
    pub(super) manager: Manager,
    sessions_token: Option<i64>,
    current_token: Option<i64>,
}

impl ManagerWatch {
    pub(super) fn connect(shared: &Arc<Shared>, epoch: u64) -> Result<Self, String> {
        let operation = Manager::RequestAsync()
            .map_err(|error| native_error("Windows no permite acceder a GSMTC", error))?;
        let manager = await_operation(operation, shared, epoch, Instant::now() + OPERATION_LIMIT)?;
        let mut watch = Self {
            manager,
            sessions_token: None,
            current_token: None,
        };
        let weak = Arc::downgrade(shared);
        watch.sessions_token = Some(
            watch
                .manager
                .SessionsChanged(
                    &TypedEventHandler::<Manager, SessionsChangedEventArgs>::new(move |_, _| {
                        if let Some(shared) = weak.upgrade() {
                            shared.topology_dirty.store(true, Ordering::Release);
                            shared.wake();
                        }
                        Ok(())
                    }),
                )
                .map_err(|error| native_error("No se pudieron escuchar las sesiones", error))?,
        );
        let weak = Arc::downgrade(shared);
        watch.current_token = Some(
            watch
                .manager
                .CurrentSessionChanged(
                    &TypedEventHandler::<Manager, CurrentSessionChangedEventArgs>::new(
                        move |_, _| {
                            if let Some(shared) = weak.upgrade() {
                                shared.topology_dirty.store(true, Ordering::Release);
                                shared.wake();
                            }
                            Ok(())
                        },
                    ),
                )
                .map_err(|error| native_error("No se pudo escuchar la sesión actual", error))?,
        );
        Ok(watch)
    }
}

impl Drop for ManagerWatch {
    fn drop(&mut self) {
        if let Some(token) = self.sessions_token.take() {
            let _ = self.manager.RemoveSessionsChanged(token);
        }
        if let Some(token) = self.current_token.take() {
            let _ = self.manager.RemoveCurrentSessionChanged(token);
        }
    }
}

#[derive(Default)]
struct Metadata {
    title: String,
    artist: String,
    album: Option<String>,
    thumbnail: Option<IRandomAccessStreamReference>,
}

pub(super) struct SessionWatch {
    pub(super) session: Session,
    pub(super) id: String,
    pub(super) dirty: Arc<AtomicU8>,
    metadata_token: Option<i64>,
    playback_token: Option<i64>,
    timeline_token: Option<i64>,
    metadata: Metadata,
    pub(super) dto: Option<MediaSession>,
    pub(super) artwork_loaded: bool,
}

impl SessionWatch {
    pub(super) fn connect(
        session: Session,
        id: String,
        shared: &Arc<Shared>,
    ) -> Result<Self, String> {
        let mut watch = Self {
            session,
            id,
            dirty: Arc::new(AtomicU8::new(ALL)),
            metadata_token: None,
            playback_token: None,
            timeline_token: None,
            metadata: Metadata::default(),
            dto: None,
            artwork_loaded: false,
        };
        let dirty = watch.dirty.clone();
        let weak = Arc::downgrade(shared);
        watch.metadata_token = Some(
            watch
                .session
                .MediaPropertiesChanged(&TypedEventHandler::<
                    Session,
                    MediaPropertiesChangedEventArgs,
                >::new(move |_, _| {
                    dirty.fetch_or(METADATA, Ordering::AcqRel);
                    if let Some(shared) = weak.upgrade() {
                        shared.wake();
                    }
                    Ok(())
                }))
                .map_err(|error| native_error("No se pudieron escuchar los metadatos", error))?,
        );
        let dirty = watch.dirty.clone();
        let weak = Arc::downgrade(shared);
        watch.playback_token = Some(
            watch
                .session
                .PlaybackInfoChanged(
                    &TypedEventHandler::<Session, PlaybackInfoChangedEventArgs>::new(
                        move |_, _| {
                            dirty.fetch_or(PLAYBACK, Ordering::AcqRel);
                            if let Some(shared) = weak.upgrade() {
                                shared.wake();
                            }
                            Ok(())
                        },
                    ),
                )
                .map_err(|error| native_error("No se pudo escuchar la reproducción", error))?,
        );
        let dirty = watch.dirty.clone();
        let weak = Arc::downgrade(shared);
        watch.timeline_token = Some(
            watch
                .session
                .TimelinePropertiesChanged(&TypedEventHandler::<
                    Session,
                    TimelinePropertiesChangedEventArgs,
                >::new(move |_, _| {
                    dirty.fetch_or(TIMELINE, Ordering::AcqRel);
                    if let Some(shared) = weak.upgrade() {
                        shared.wake();
                    }
                    Ok(())
                }))
                .map_err(|error| native_error("No se pudo escuchar el progreso", error))?,
        );
        Ok(watch)
    }

    pub(super) fn refresh(
        &mut self,
        shared: &Shared,
        epoch: u64,
        deadline: Instant,
    ) -> Option<String> {
        let dirty = self.dirty.swap(0, Ordering::AcqRel);
        if dirty == 0 && self.dto.is_some() {
            return None;
        }
        let mut error = None;
        if dirty & METADATA != 0 {
            // Erase old art immediately on a track change; a failed read cannot
            // leave the previous song impersonating the new session state.
            self.artwork_loaded = false;
            self.metadata = Metadata::default();
            if let Some(dto) = self.dto.as_mut() {
                dto.artwork = None;
            }
            match self.read_metadata(shared, epoch, deadline) {
                Ok(metadata) => self.metadata = metadata,
                Err(message) => error = Some(message),
            }
        }
        let info = match self.session.GetPlaybackInfo() {
            Ok(info) => info,
            Err(failure) => {
                self.dto = None;
                return Some(native_error(
                    "Una sesión multimedia dejó de estar disponible",
                    failure,
                ));
            }
        };
        let status = match info.PlaybackStatus() {
            Ok(status) => status,
            Err(failure) => {
                self.dto = None;
                return Some(native_error(
                    "No se pudo consultar la reproducción",
                    failure,
                ));
            }
        };
        if status == Status::Closed {
            self.dto = None;
            return error;
        }
        let playback = if status == Status::Playing {
            Playback::Playing
        } else if status == Status::Paused {
            Playback::Paused
        } else {
            Playback::Stopped
        };
        let controls = info.Controls().ok();
        let can_play_pause = controls.as_ref().is_some_and(|controls| {
            controls.IsPlayPauseToggleEnabled().unwrap_or(false)
                || if playback == Playback::Playing {
                    controls.IsPauseEnabled().unwrap_or(false)
                } else {
                    controls.IsPlayEnabled().unwrap_or(false)
                }
        });
        let (position_ms, duration_ms) = match self.session.GetTimelineProperties() {
            Ok(timeline) => match (
                timeline.StartTime(),
                timeline.EndTime(),
                timeline.Position(),
            ) {
                (Ok(start), Ok(end), Ok(position)) => {
                    timeline_ms(start.Duration, end.Duration, position.Duration)
                }
                _ => (None, None),
            },
            Err(_) => (None, None),
        };
        let artwork = self.dto.as_mut().and_then(|dto| dto.artwork.take());
        self.dto = Some(MediaSession {
            id: self.id.clone(),
            title: self.metadata.title.clone(),
            artist: self.metadata.artist.clone(),
            album: self.metadata.album.clone(),
            artwork,
            playback,
            position_ms,
            duration_ms,
            can_play_pause,
            can_previous: controls
                .as_ref()
                .is_some_and(|controls| controls.IsPreviousEnabled().unwrap_or(false)),
            can_next: controls
                .as_ref()
                .is_some_and(|controls| controls.IsNextEnabled().unwrap_or(false)),
            can_seek: false,
        });
        error
    }

    fn read_metadata(
        &self,
        shared: &Shared,
        epoch: u64,
        deadline: Instant,
    ) -> Result<Metadata, String> {
        if !shared.current(epoch) || Instant::now() >= deadline {
            return Err("La lectura de metadatos caducó o fue cancelada.".into());
        }
        let operation = self
            .session
            .TryGetMediaPropertiesAsync()
            .map_err(|error| native_error("No se pudieron solicitar los metadatos", error))?;
        let properties = await_operation(operation, shared, epoch, deadline)?;
        let title = properties
            .Title()
            .map(|value| bounded_text(&value.to_string_lossy(), 512))
            .unwrap_or_default();
        let artist = properties
            .Artist()
            .map(|value| bounded_text(&value.to_string_lossy(), 256))
            .unwrap_or_default();
        let album = properties
            .AlbumTitle()
            .ok()
            .map(|value| bounded_text(&value.to_string_lossy(), 256))
            .filter(|value| !value.is_empty());
        Ok(Metadata {
            title,
            artist,
            album,
            thumbnail: properties.Thumbnail().ok(),
        })
    }

    pub(super) fn load_artwork(&mut self, shared: &Shared, epoch: u64, deadline: Instant) {
        if self.artwork_loaded
            || self.dto.is_none()
            || Instant::now() >= deadline
            || !shared.current(epoch)
        {
            return;
        }
        self.artwork_loaded = true;
        let artwork = self.metadata.thumbnail.as_ref().and_then(|reference| {
            read_artwork(reference, shared, epoch, deadline)
                .ok()
                .flatten()
        });
        if let Some(dto) = self.dto.as_mut() {
            dto.artwork = artwork;
        }
    }
}

impl Drop for SessionWatch {
    fn drop(&mut self) {
        if let Some(token) = self.metadata_token.take() {
            let _ = self.session.RemoveMediaPropertiesChanged(token);
        }
        if let Some(token) = self.playback_token.take() {
            let _ = self.session.RemovePlaybackInfoChanged(token);
        }
        if let Some(token) = self.timeline_token.take() {
            let _ = self.session.RemoveTimelinePropertiesChanged(token);
        }
    }
}

fn timeline_ms(start: i64, end: i64, position: i64) -> (Option<u64>, Option<u64>) {
    let duration = end
        .checked_sub(start)
        .filter(|value| *value > 0)
        .map(|value| value as u64 / 10_000)
        .filter(|value| *value > 0 && *value <= 9_007_199_254_740_991);
    let position = position
        .checked_sub(start)
        .filter(|value| *value >= 0)
        .map(|value| value as u64 / 10_000)
        .filter(|value| *value <= 9_007_199_254_740_991)
        .map(|value| duration.map_or(value, |duration| value.min(duration)));
    (position, duration)
}

fn read_artwork(
    reference: &IRandomAccessStreamReference,
    shared: &Shared,
    epoch: u64,
    deadline: Instant,
) -> Result<Option<String>, String> {
    let operation = reference
        .OpenReadAsync()
        .map_err(|error| native_error("La portada no está disponible", error))?;
    let stream = await_operation(operation, shared, epoch, deadline)?;
    let result = (|| {
        let size = stream
            .Size()
            .map_err(|error| native_error("No se pudo consultar la portada", error))?;
        let mime = stream
            .ContentType()
            .map_err(|error| native_error("No se pudo consultar el formato de portada", error))?
            .to_string_lossy()
            .to_ascii_lowercase();
        if size == 0
            || size > MAX_ARTWORK_BYTES
            || !matches!(mime.as_str(), "image/png" | "image/jpeg" | "image/webp")
        {
            return Ok(None);
        }
        let input = stream
            .GetInputStreamAt(0)
            .map_err(|error| native_error("No se pudo abrir la portada", error))?;
        let reader = DataReader::CreateDataReader(&input)
            .map_err(|error| native_error("No se pudo leer la portada", error))?;
        let read_result = (|| {
            let operation = reader
                .LoadAsync(size as u32)
                .map_err(|error| native_error("No se pudo cargar la portada", error))?;
            let loaded = await_operation(operation, shared, epoch, deadline)?;
            if u64::from(loaded) != size {
                return Ok(None);
            }
            let mut bytes = vec![0; size as usize];
            reader
                .ReadBytes(&mut bytes)
                .map_err(|error| native_error("No se pudieron leer los datos de portada", error))?;
            // Only raster signatures are accepted, even if a player supplies a
            // misleading MIME. SVG, HTML, URLs and external resources are refused.
            let valid = match mime.as_str() {
                "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
                "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
                "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
                _ => false,
            };
            Ok(valid.then(|| format!("data:{mime};base64,{}", STANDARD.encode(bytes))))
        })();
        let _ = reader.Close();
        read_result
    })();
    let _ = stream.Close();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_timeline_ticks_and_rejects_missing_duration() {
        assert_eq!(
            timeline_ms(10_000_000, 110_000_000, 30_000_000),
            (Some(2000), Some(10000))
        );
        assert_eq!(timeline_ms(0, 0, 0), (Some(0), None));
        assert_eq!(
            timeline_ms(0, 10_000_000, 30_000_000),
            (Some(1000), Some(1000))
        );
        assert_eq!(timeline_ms(0, 10_000_000, -1), (None, Some(1000)));
        assert_eq!(timeline_ms(i64::MIN, i64::MAX, i64::MAX), (None, None));
    }
}
