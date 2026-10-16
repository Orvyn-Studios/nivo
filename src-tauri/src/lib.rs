mod display;
mod events;
mod placement;
mod platform;
mod settings;
mod tray;
mod window;

use settings::{Settings, SettingsStore};
use tauri::{Manager, State, WebviewWindow, WindowEvent};
use window::IslandState;

#[tauri::command]
fn ready(
    window: WebviewWindow,
    state: State<IslandState>,
    settings: State<SettingsStore>,
) -> Result<(), String> {
    window::require_island(&window)?;
    let configured = window::show(&window, &state, &settings.snapshot()?);
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
        Ok(settings) => Ok(settings),
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
            quit_app
        ])
        .setup(|app| {
            let settings = match app.path().app_config_dir() {
                Ok(directory) => SettingsStore::open(directory.join("settings.json")),
                Err(error) => SettingsStore::unavailable(format!(
                    "Directorio de preferencias no disponible: {error}"
                )),
            };
            app.manage(settings);
            match tray::install(app) {
                Ok(()) => app.state::<IslandState>().set_tray_available(true),
                Err(error) => eprintln!("Nivo tray unavailable: {error}"),
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "island" {
                return;
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
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("Nivo could not start: {error}");
        std::process::exit(1);
    }
}
