mod autostart;
mod display;
mod events;
mod fullscreen;
mod integration;
mod media;
mod placement;
mod platform;
mod settings;
mod tray;
mod visibility;
mod window;

use settings::{Settings, SettingsStore};
use std::sync::Arc;
use tauri::{Emitter, Manager, State, WebviewWindow, WindowEvent};
use window::IslandState;

#[tauri::command]
fn ready(
    window: WebviewWindow,
    state: State<IslandState>,
    settings: State<SettingsStore>,
) -> Result<(), String> {
    window::require_island(&window)?;
    let configured = window::ready(&window, &state, &settings.snapshot()?);
    let mut errors = Vec::new();
    if let Err(error) = configured {
        errors.push(error);
    }
    if let Some(error) = settings.load_error() {
        errors.push(error.to_owned());
    }
    if !state.tray_available() {
        errors.push(
            "La bandeja no está disponible. Puedes cerrar Nivo desde Preferencias o con Alt+F4."
                .into(),
        );
    }
    if let Some(lifecycle) = window
        .app_handle()
        .try_state::<platform::lifecycle::LifecycleGuard>()
    {
        if let Err(error) = lifecycle.refresh() {
            errors.push(error);
        }
        if let Some(error) = lifecycle.error() {
            errors.push(error);
        }
    } else {
        errors.push("Los avisos de bloqueo, suspensión y pantallas no están disponibles.".into());
    }
    if window
        .app_handle()
        .try_state::<window::FullscreenService>()
        .is_none()
    {
        errors.push("La ocultación automática en pantalla completa no está disponible.".into());
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join(" "))
    }
}

#[tauri::command]
fn set_expanded(
    window: WebviewWindow,
    state: State<IslandState>,
    settings: State<SettingsStore>,
    expanded: bool,
) -> Result<(), String> {
    let previous = state.expanded();
    let settings = settings.snapshot()?;
    if let Err(error) = window::place(&window, expanded, &settings) {
        if let Err(rollback) = window::place(&window, previous, &settings) {
            return Err(format!(
                "{error} Tampoco se pudo restaurar el tamaño anterior: {rollback}"
            ));
        }
        return Err(error);
    }
    state.set_expanded(expanded);
    Ok(())
}

#[tauri::command]
fn hide_island(window: WebviewWindow, state: State<IslandState>) -> Result<(), String> {
    window::require_island(&window)?;
    if !state.tray_available() {
        return Err("Nivo no se oculta porque la bandeja no está disponible. Usa Salir de Nivo para cerrarlo.".into());
    }
    window::hide(&window)
}

#[tauri::command]
fn get_settings(window: WebviewWindow, settings: State<SettingsStore>) -> Result<Settings, String> {
    window::require_island(&window)?;
    settings.snapshot()
}

#[tauri::command]
fn save_settings(
    window: WebviewWindow,
    state: State<IslandState>,
    store: State<SettingsStore>,
    media: State<Arc<media::MediaService>>,
    settings: Settings,
) -> Result<Settings, String> {
    window::require_island(&window)?;
    settings.validate()?;
    let previous = store.snapshot()?;
    if let Err(error) = window::place(&window, state.expanded(), &settings) {
        if let Err(rollback) = window::place(&window, state.expanded(), &previous) {
            return Err(format!(
                "{error} Tampoco se pudo restaurar la posición: {rollback}"
            ));
        }
        return Err(error);
    }
    match store.save(settings) {
        Ok(settings) => {
            window::refresh_fullscreen(&window);
            media.set_enabled(settings.media_enabled).map_err(|error| {
                format!("Preferencias guardadas; no se pudo actualizar multimedia: {error}")
            })?;
            Ok(settings)
        }
        Err(error) => {
            if let Err(rollback) = window::place(&window, state.expanded(), &previous) {
                return Err(format!(
                    "{error} Tampoco se pudo restaurar la posición: {rollback}"
                ));
            }
            Err(error)
        }
    }
}

#[tauri::command]
fn get_displays(window: WebviewWindow) -> Result<Vec<display::DisplayInfo>, String> {
    window::require_island(&window)?;
    display::list(&window)
}

#[tauri::command]
fn get_autostart(window: WebviewWindow) -> Result<bool, String> {
    window::require_island(&window)?;
    autostart::status()
}

#[tauri::command]
fn set_autostart(window: WebviewWindow, enabled: bool) -> Result<bool, String> {
    window::require_island(&window)?;
    autostart::set_enabled(enabled)
}

#[tauri::command]
fn get_media_snapshot(
    window: WebviewWindow,
    media: State<Arc<media::MediaService>>,
) -> Result<media::MediaSnapshot, String> {
    window::require_island(&window)?;
    media.snapshot()
}

#[tauri::command]
async fn media_control(
    window: WebviewWindow,
    media: State<'_, Arc<media::MediaService>>,
    session_id: String,
    action: media::MediaAction,
) -> Result<(), String> {
    window::require_island(&window)?;
    let service = Arc::clone(media.inner());
    tauri::async_runtime::spawn_blocking(move || service.control(session_id, action))
        .await
        .map_err(|error| format!("El control multimedia no pudo terminar: {error}"))?
}

#[tauri::command]
async fn select_media_session(
    window: WebviewWindow,
    media: State<'_, Arc<media::MediaService>>,
    session_id: String,
) -> Result<(), String> {
    window::require_island(&window)?;
    let service = Arc::clone(media.inner());
    tauri::async_runtime::spawn_blocking(move || service.select(session_id))
        .await
        .map_err(|error| format!("La selección multimedia no pudo terminar: {error}"))?
}

#[tauri::command]
fn quit_app(window: WebviewWindow) -> Result<(), String> {
    window::require_island(&window)?;
    window.app_handle().exit(0);
    Ok(())
}

pub fn run() {
    let result = tauri::Builder::default()
        .manage(IslandState::default())
        .invoke_handler(tauri::generate_handler![
            ready,
            set_expanded,
            hide_island,
            get_settings,
            save_settings,
            get_displays,
            get_autostart,
            set_autostart,
            get_media_snapshot,
            media_control,
            select_media_session,
            quit_app
        ])
        .setup(|app| {
            let settings = match app.path().app_config_dir() {
                Ok(directory) => SettingsStore::open(directory.join("settings.json")),
                Err(error) => SettingsStore::unavailable(format!(
                    "Directorio de preferencias no disponible: {error}"
                )),
            };
            let media_enabled = settings
                .snapshot()
                .map(|value| value.media_enabled)
                .unwrap_or(false);
            app.manage(settings);
            let handle = app.handle().clone();
            app.manage(Arc::new(media::MediaService::start(
                media_enabled,
                move |snapshot| {
                    if let Err(error) = handle.emit_to("island", "nivo://media", snapshot) {
                        eprintln!("Nivo media event unavailable: {error}");
                    }
                },
            )));
            match tray::install(app) {
                Ok(()) => app.state::<IslandState>().set_tray_available(true),
                Err(error) => eprintln!("Nivo tray unavailable: {error}"),
            }
            match window::install_fullscreen(app) {
                Ok(service) => {
                    app.manage(service);
                }
                Err(error) => eprintln!("Nivo fullscreen observer unavailable: {error}"),
            }
            match integration::install(app) {
                Ok(service) => {
                    app.manage(service);
                }
                Err(error) => eprintln!("Nivo lifecycle observer unavailable: {error}"),
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "island" {
                return;
            }
            if let WindowEvent::Focused(_) = event {
                if let Some(island) = window.app_handle().get_webview_window("island") {
                    window::refresh_fullscreen(&island);
                }
            }
            if let WindowEvent::ScaleFactorChanged { .. } = event {
                if let Some(island) = window.app_handle().get_webview_window("island") {
                    if let Some(settings) = window.app_handle().try_state::<SettingsStore>() {
                        let result = settings.snapshot().and_then(|settings| {
                            window::place(
                                &island,
                                window.state::<IslandState>().expanded(),
                                &settings,
                            )
                        });
                        if let Err(error) = result {
                            eprintln!("Nivo DPI: {error}");
                        }
                    }
                }
            }
        })
        .build(tauri::generate_context!());
    match result {
        Ok(app) => app.run(|handle, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(media) = handle.try_state::<Arc<media::MediaService>>() {
                    media.shutdown();
                }
                if let Some(fullscreen) = handle.try_state::<window::FullscreenService>() {
                    fullscreen.shutdown();
                }
                if let Some(lifecycle) = handle.try_state::<platform::lifecycle::LifecycleGuard>() {
                    if let Err(error) = lifecycle.shutdown() {
                        eprintln!("Nivo lifecycle cleanup: {error}");
                    }
                }
            }
        }),
        Err(error) => {
            eprintln!("Nivo could not start: {error}");
            std::process::exit(1);
        }
    }
}
