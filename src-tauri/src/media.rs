//! Local GSMTC adapter. No metadata is persisted or sent over the network.
//!
//! Commands that call `control` or `select` must use spawn_blocking: their
//! responses are bounded but may wait for Windows. Snapshot/preferences calls
//! only hold a short lock. The update callback receives a complete snapshot.

use serde::{Deserialize, Serialize};

#[path = "media/service.rs"]
mod service;
#[cfg(windows)]
#[path = "media/windows.rs"]
mod windows;

pub use service::MediaService;

pub(crate) const MAX_SESSIONS: usize = 8;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaAction {
    PlayPause,
    Previous,
    Next,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaStatus {
    Connecting,
    Ready,
    Unavailable,
    Disabled,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Playback {
    Playing,
    Paused,
    Stopped,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSession {
    pub id: String,
    pub title: String,
    pub artist: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork: Option<String>,
    pub playback: Playback,
    pub position_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    pub can_play_pause: bool,
    pub can_previous: bool,
    pub can_next: bool,
    // A seek command is deliberately not exposed in this version.
    pub can_seek: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSnapshot {
    pub sequence: u64,
    pub status: MediaStatus,
    pub sessions: Vec<MediaSession>,
    pub active_session_id: Option<String>,
    pub error: Option<String>,
}

impl MediaSnapshot {
    pub(crate) fn empty(status: MediaStatus, error: Option<String>) -> Self {
        Self {
            sequence: 0,
            status,
            sessions: Vec::new(),
            active_session_id: None,
            error,
        }
    }
}

pub(crate) fn bounded_text(value: &str, utf16_limit: usize) -> String {
    let mut length = 0;
    value
        .chars()
        .filter(|character| !character.is_control())
        .take_while(|character| {
            length += character.len_utf16();
            length <= utf16_limit
        })
        .collect()
}

pub(crate) fn valid_session_id(id: &str) -> bool {
    id.strip_prefix("session-").is_some_and(|number| {
        !number.is_empty() && number.len() <= 20 && number.bytes().all(|byte| byte.is_ascii_digit())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_unicode_without_splitting_surrogates_or_retaining_controls() {
        assert_eq!(bounded_text("a\n\u{1f600}bc", 4), "a\u{1f600}b");
        assert_eq!(bounded_text("\u{1f600}", 1), "");
    }

    #[test]
    fn only_accepts_opaque_session_tokens() {
        assert!(valid_session_id("session-12"));
        for invalid in [
            "",
            "spotify",
            "session-",
            "session--1",
            "session-1\n",
            "session-1/2",
        ] {
            assert!(!valid_session_id(invalid));
        }
    }

    #[test]
    fn serializes_frontend_contract_without_fake_metadata() {
        let snapshot = MediaSnapshot::empty(MediaStatus::Disabled, None);
        let value = serde_json::to_value(snapshot).unwrap();
        assert_eq!(value["status"], "disabled");
        assert!(value["sessions"].as_array().unwrap().is_empty());
        assert!(value["activeSessionId"].is_null());
        assert_eq!(
            serde_json::from_str::<MediaAction>("\"playPause\"").unwrap(),
            MediaAction::PlayPause
        );
        assert!(serde_json::from_str::<MediaAction>("\"shell\"").is_err());
    }
}
