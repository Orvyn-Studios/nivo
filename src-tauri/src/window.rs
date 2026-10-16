use crate::{display, events, placement, platform, settings::Settings};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::WebviewWindow;

#[derive(Default)]
pub struct IslandState {
    expanded: AtomicBool,
    tray_available: AtomicBool,
}

impl IslandState {
    pub fn expanded(&self) -> bool {
        self.expanded.load(Ordering::Relaxed)
    }
    pub fn set_expanded(&self, expanded: bool) {
        self.expanded.store(expanded, Ordering::Relaxed);
    }
    pub fn set_tray_available(&self, available: bool) {
        self.tray_available.store(available, Ordering::Relaxed);
    }
    pub fn tray_available(&self) -> bool {
        self.tray_available.load(Ordering::Relaxed)
    }
}

pub fn require_island(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "island" {
        return Err("Ventana no permitida.".into());
    }
    Ok(())
}

pub fn place(window: &WebviewWindow, expanded: bool, settings: &Settings) -> Result<(), String> {
    require_island(window)?;
    settings.validate()?;
    let monitor = display::selected(window, settings.monitor_name.as_deref())?;
    let area = monitor.work_area();
    let p = placement::fit(
        (area.position.x, area.position.y),
        (area.size.width, area.size.height),
        monitor.scale_factor(),
        expanded,
        settings.horizontal_position,
        settings.top_gap,
    )
    .map_err(str::to_owned)?;
    let region = placement::surface_region(&p, expanded).map_err(str::to_owned)?;
    platform::set_bounds(window, &p)?;
    platform::set_surface_region(window, &region)
}

pub fn show(
    window: &WebviewWindow,
    state: &IslandState,
    settings: &Settings,
) -> Result<(), String> {
    require_island(window)?;
    let configured =
        platform::initialize(window).and_then(|_| place(window, state.expanded(), settings));
    // A placement failure must leave an accessible UI, but is still returned
    // to the caller instead of being presented as a successful native startup.
    platform::show_without_activation(window)?;
    events::visibility(window, true)?;
    configured
}

pub fn hide(window: &WebviewWindow) -> Result<(), String> {
    require_island(window)?;
    window.hide().map_err(|error| error.to_string())?;
    if let Err(error) = events::visibility(window, false) {
        // The frontend must not keep rendering an island which was hidden
        // without its knowledge. Restore visibility before reporting failure.
        if let Err(rollback) = platform::show_without_activation(window) {
            return Err(format!(
                "{error} Tampoco se pudo volver a mostrar Nivo: {rollback}"
            ));
        }
        if let Err(restored) = events::visibility(window, true) {
            return Err(format!(
                "{error} Nivo está visible, pero falló la comunicación de recuperación: {restored}"
            ));
        }
        return Err(error);
    }
    Ok(())
}
