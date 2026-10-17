mod activity_bridge;
mod audio;
mod autostart;
mod display;
mod drop_files;
mod events;
mod fullscreen;
mod integration;
mod media;
mod placement;
mod platform;
mod power;
mod preferences_window;
mod settings;
mod tray;
mod visibility;
mod window;
pub use activity_bridge::native_messaging_host;

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
) -> Result<u64, String> {
    window::require_island(&window)?;
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
    if expanded && !previous {
        let size = window.inner_size().map_err(|error| error.to_string())?;
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        window::set_surface_geometry(
            &window,
            &state,
            state.surface_epoch(),
            placement::SurfaceGeometry {
                left: (f64::from(size.width) / scale - 112.0) / 2.0,
                top: 16.0,
                width: 112.0,
                height: 34.0,
                radius: 17.0,
            },
        )?;
    }
    Ok(state.surface_epoch())
}

#[tauri::command]
fn set_surface_geometry(
    window: WebviewWindow,
    state: State<IslandState>,
    epoch: u64,
    shape: placement::SurfaceGeometry,
) -> Result<bool, String> {
    window::set_surface_geometry(&window, &state, epoch, shape)
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
    preferences_window::require_known(&window)?;
    settings.snapshot()
}

#[tauri::command]
fn save_settings(
    window: WebviewWindow,
    state: State<IslandState>,
    store: State<SettingsStore>,
    media: State<Arc<media::MediaService>>,
    audio: State<Arc<audio::AudioService>>,
    activity: State<activity_bridge::ActivityBridge>,
    settings: Settings,
) -> Result<Settings, String> {
    preferences_window::require_known(&window)?;
    let window = window
        .app_handle()
        .get_webview_window("island")
        .ok_or("Nivo no está disponible.")?;
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
            window
                .emit_to("island", "nivo://settings", &settings)
                .map_err(|error| error.to_string())?;
            if !settings.drop_enabled {
                window
                    .app_handle()
                    .state::<Arc<drop_files::DropFiles>>()
                    .clear();
            }
            audio.set_enabled(settings.audio_enabled);
            let handle = window.app_handle().clone();
            activity.set_enabled(settings.integrations_enabled, move |event| {
                let _ = handle.emit_to("island", "nivo://integration", event);
            })?;
            if let Some(lifecycle) = window
                .app_handle()
                .try_state::<platform::lifecycle::LifecycleGuard>()
            {
                lifecycle.set_keyboard(settings.caps_lock_enabled, settings.num_lock_enabled)?;
            }
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
    preferences_window::require_known(&window)?;
    display::list(&window)
}

#[tauri::command]
fn get_autostart(window: WebviewWindow) -> Result<bool, String> {
    preferences_window::require_known(&window)?;
    autostart::status()
}

#[tauri::command]
fn set_autostart(window: WebviewWindow, enabled: bool) -> Result<bool, String> {
    preferences_window::require_known(&window)?;
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
fn get_audio_snapshot(
    window: WebviewWindow,
    audio: State<Arc<audio::AudioService>>,
) -> Result<audio::AudioSnapshot, String> {
    window::require_island(&window)?;
    audio.snapshot()
}

#[tauri::command]
fn get_power_snapshot(
    window: WebviewWindow,
    power: State<power::PowerService>,
) -> Result<power::PowerSnapshot, String> {
    preferences_window::require_known(&window)?;
    power.refresh()
}

#[tauri::command]
fn get_drop_snapshot(
    window: WebviewWindow,
    files: State<Arc<drop_files::DropFiles>>,
    settings: State<SettingsStore>,
) -> Result<Vec<drop_files::DroppedFile>, String> {
    window::require_island(&window)?;
    if !settings.snapshot()?.drop_enabled {
        return Ok(vec![]);
    }
    files.snapshot()
}

#[tauri::command]
async fn drop_action(
    window: WebviewWindow,
    files: State<'_, Arc<drop_files::DropFiles>>,
    settings: State<'_, SettingsStore>,
    action: drop_files::DropAction,
    id: Option<String>,
) -> Result<String, String> {
    window::require_island(&window)?;
    if !settings.snapshot()?.drop_enabled {
        return Err("Nivo Drop está desactivado.".into());
    }
    let files = Arc::clone(files.inner());
    #[cfg(windows)]
    let owner = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    #[cfg(not(windows))]
    let owner = 0;
    tauri::async_runtime::spawn_blocking(move || files.action(action, id, owner))
        .await
        .map_err(|_| "La acción de archivo no pudo terminar.".to_string())?
}

#[tauri::command]
async fn audio_control(
    window: WebviewWindow,
    audio: State<'_, Arc<audio::AudioService>>,
    action: audio::AudioAction,
) -> Result<(), String> {
    window::require_island(&window)?;
    let audio = Arc::clone(audio.inner());
    tauri::async_runtime::spawn_blocking(move || audio.control(action))
        .await
        .map_err(|_| "El control de audio no pudo terminar.".to_string())?
}

#[tauri::command]
fn open_sound_settings(window: WebviewWindow) -> Result<(), String> {
    window::require_island(&window)?;
    #[cfg(windows)]
    {
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        // Fixed documented Windows Settings URI; never accepts a path/command from the webview.
        let result = unsafe {
            ShellExecuteW(
                None,
                windows::core::w!("open"),
                windows::core::w!("ms-settings:sound"),
                None,
                None,
                SW_SHOWNORMAL,
            )
        };
        if result.0 as isize <= 32 {
            return Err("No se pudo abrir la configuración de sonido.".into());
        }
    }
    Ok(())
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

#[tauri::command]
async fn open_preferences(window: WebviewWindow) -> Result<(), String> {
    window::require_island(&window)?;
    preferences_window::open(window.app_handle()).await
}

pub fn run() {
    let result = tauri::Builder::default()
        .manage(IslandState::default())
        .invoke_handler(tauri::generate_handler![
            open_preferences,
            preferences_window::close_preferences,
            ready,
            set_expanded,
            set_surface_geometry,
            hide_island,
            get_settings,
            save_settings,
            get_displays,
            get_autostart,
            set_autostart,
            get_media_snapshot,
            get_audio_snapshot,
            get_power_snapshot,
            get_drop_snapshot,
            drop_action,
            audio_control,
            open_sound_settings,
            media_control,
            select_media_session,
            quit_app
        ])
        .setup(|app| {
            app.manage(power::PowerService::default());
            app.manage(Arc::new(drop_files::DropFiles::default()));
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
            let audio_enabled = settings
                .snapshot()
                .map(|value| value.audio_enabled)
                .unwrap_or(false);
            app.manage(settings);
            let activity = activity_bridge::ActivityBridge::new(
                app.path().app_config_dir()?.join("integrations"),
            );
            let activity_enabled = app
                .state::<SettingsStore>()
                .snapshot()
                .map(|value| value.integrations_enabled)
                .unwrap_or(false);
            let activity_handle = app.handle().clone();
            if let Err(error) = activity.set_enabled(activity_enabled, move |event| {
                let _ = activity_handle.emit_to("island", "nivo://integration", event);
            }) {
                eprintln!("Nivo integration: {error}");
            }
            app.manage(activity);
            let audio_handle = app.handle().clone();
            app.manage(Arc::new(audio::AudioService::start(
                audio_enabled,
                move |snapshot| {
                    let _ = audio_handle.emit_to("island", "nivo://audio", snapshot);
                },
            )));
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
                    if let Ok(settings) = app.state::<SettingsStore>().snapshot() {
                        service
                            .set_keyboard(settings.caps_lock_enabled, settings.num_lock_enabled)?;
                    }
                    app.manage(service);
                }
                Err(error) => eprintln!("Nivo lifecycle observer unavailable: {error}"),
            }
            Ok(())
        })
        .on_webview_event(|webview, event| {
            if webview.label() != "island" {
                return;
            }
            let app = webview.app_handle();
            if !app
                .state::<SettingsStore>()
                .snapshot()
                .is_ok_and(|settings| settings.drop_enabled)
            {
                return;
            }
            if let tauri::WebviewEvent::DragDrop(event) = event {
                let phase = match event {
                    tauri::DragDropEvent::Enter { .. } => "enter",
                    tauri::DragDropEvent::Leave => "leave",
                    tauri::DragDropEvent::Drop { paths, .. } => {
                        match app.state::<Arc<drop_files::DropFiles>>().accept(paths) {
                            Ok(files) => {
                                let _ = app.emit_to("island", "nivo://drop-files", files);
                            }
                            Err(error) => {
                                let _ = app.emit_to("island", "nivo://drop-error", error);
                            }
                        }
                        "drop"
                    }
                    _ => return,
                };
                let _ = app.emit_to("island", "nivo://drop-phase", phase);
            }
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
                if let Some(activity) = handle.try_state::<activity_bridge::ActivityBridge>() {
                    activity.shutdown();
                }
                if let Some(audio) = handle.try_state::<Arc<audio::AudioService>>() {
                    audio.shutdown();
                }
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
