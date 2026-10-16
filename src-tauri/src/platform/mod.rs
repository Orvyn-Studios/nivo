#[cfg(windows)]
mod windows;

#[cfg(windows)]
pub use windows::{initialize, set_bounds, set_surface_region, show_without_activation};

#[cfg(not(windows))]
pub fn initialize(_: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn set_bounds(
    window: &tauri::WebviewWindow,
    placement: &crate::placement::Placement,
) -> Result<(), String> {
    window
        .set_size(tauri::PhysicalSize::new(placement.width, placement.height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(placement.x, placement.y))
        .map_err(|error| error.to_string())
}

#[cfg(not(windows))]
pub fn set_surface_region(
    _: &tauri::WebviewWindow,
    _: &crate::placement::SurfaceRegion,
) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn show_without_activation(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())
}
