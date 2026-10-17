//! Application-level wiring for real Windows lifecycle events.
use crate::{
    display,
    media::MediaService,
    platform::lifecycle::{LifecycleGuard, SystemEvent},
    settings::SettingsStore,
    visibility::Blocker,
    window::{self, IslandState},
};
use std::sync::Arc;
use tauri::{App, Emitter, Manager, WebviewWindow};

fn reconcile_display(window: &WebviewWindow) -> Result<(), String> {
    let settings = window.app_handle().state::<SettingsStore>().snapshot()?;
    let state = window.app_handle().state::<IslandState>();
    window::place(window, state.expanded(), &settings)?;
    let displays = display::list(window)?;
    window
        .emit_to("island", "nivo://displays", &displays)
        .map_err(|error| format!("No se pudo comunicar el cambio de pantallas: {error}"))?;
    window
        .emit_to("preferences", "nivo://displays", &displays)
        .map_err(|error| format!("No se pudo comunicar el cambio de pantallas: {error}"))
}

fn apply(window: &WebviewWindow, event: SystemEvent) -> Result<(), String> {
    match event {
        SystemEvent::CursorMoved { x, y } => {
            if window.app_handle().state::<IslandState>().paused()?
                || !window
                    .app_handle()
                    .state::<SettingsStore>()
                    .snapshot()?
                    .mascot_enabled
            {
                return Ok(());
            }
            #[derive(Clone, serde::Serialize)]
            struct CursorPoint {
                x: f64,
                y: f64,
            }
            // Both positions are physical pixels, including negative monitor origins.
            // Divide by the island's DPI exactly once for WebView CSS coordinates.
            let origin = window.inner_position().map_err(|error| error.to_string())?;
            let scale = window.scale_factor().map_err(|error| error.to_string())?;
            window
                .emit_to(
                    "island",
                    "nivo://cursor",
                    CursorPoint {
                        x: (f64::from(x) - f64::from(origin.x)) / scale,
                        y: (f64::from(y) - f64::from(origin.y)) / scale,
                    },
                )
                .map_err(|error| error.to_string())
        }
        SystemEvent::LockKey { caps, enabled } => {
            #[derive(Clone, serde::Serialize)]
            struct LockState {
                caps: bool,
                enabled: bool,
            }
            window
                .emit_to("island", "nivo://lock-key", LockState { caps, enabled })
                .map_err(|error| error.to_string())
        }
        SystemEvent::PowerChanged => {
            let snapshot = window
                .app_handle()
                .state::<crate::power::PowerService>()
                .refresh()?;
            window
                .emit_to("island", "nivo://power", snapshot)
                .map_err(|error| error.to_string())
        }
        SystemEvent::DisplayChanged => reconcile_display(window),
        SystemEvent::Suspended => window::set_system_blocker(window, Blocker::Suspended, true),
        SystemEvent::SessionLocked => window::set_system_blocker(window, Blocker::Locked, true),
        SystemEvent::SessionUnlocked => {
            window::set_system_blocker(window, Blocker::Locked, false)?;
            reconcile_display(window)
        }
        SystemEvent::Resumed => {
            window::set_system_blocker(window, Blocker::Suspended, false)?;
            reconcile_display(window)?;
            if let Some(media) = window.app_handle().try_state::<Arc<MediaService>>() {
                media.refresh()?;
            }
            Ok(())
        }
    }
}

pub fn install(app: &App) -> Result<LifecycleGuard, String> {
    let app = app.handle().clone();
    LifecycleGuard::start(move |event| {
        let ui = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            if let Some(island) = ui.get_webview_window("island") {
                if let Err(error) = apply(&island, event) {
                    eprintln!("Nivo lifecycle event: {error}");
                }
            }
        }) {
            eprintln!("Nivo lifecycle delivery: {error}");
        }
    })
}
