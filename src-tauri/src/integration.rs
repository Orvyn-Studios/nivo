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
    window
        .emit_to("island", "nivo://displays", display::list(window)?)
        .map_err(|error| format!("No se pudo comunicar el cambio de pantallas: {error}"))
}

fn apply(window: &WebviewWindow, event: SystemEvent) -> Result<(), String> {
    match event {
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
