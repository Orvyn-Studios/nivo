use serde::Serialize;
use tauri::{Emitter, WebviewWindow};

const VISIBILITY_EVENT: &str = "nivo://visibility";

#[derive(Clone, Copy, Debug, Serialize)]
struct VisibilityEvent {
    visible: bool,
}

pub fn visibility(window: &WebviewWindow, visible: bool) -> Result<(), String> {
    // Deliver only to listeners registered by the island webview. The frontend
    // must await registration before invoking ready, and dispose its listener.
    window
        .emit_to(
            window.label(),
            VISIBILITY_EVENT,
            VisibilityEvent { visible },
        )
        .map_err(|error| format!("No se pudo comunicar la visibilidad de Nivo: {error}"))
}
