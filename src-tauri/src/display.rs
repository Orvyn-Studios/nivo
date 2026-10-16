use serde::Serialize;
use tauri::{Monitor, WebviewWindow};

#[derive(Debug, Serialize)]
pub struct DisplayInfo {
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub work_x: i32,
    pub work_y: i32,
    pub work_width: u32,
    pub work_height: u32,
    pub scale_factor: f64,
    pub primary: bool,
}

fn same_display(left: &Monitor, right: &Monitor) -> bool {
    left.position() == right.position() && left.size() == right.size()
}

// A missing or ambiguous persisted display falls back to the primary display;
// the original preference is retained so reconnecting a display can restore it.
fn selected_index(
    names: &[Option<&str>],
    primary: Option<usize>,
    selected: Option<&str>,
) -> Option<usize> {
    if let Some(selected) = selected {
        let matches: Vec<_> = names
            .iter()
            .enumerate()
            .filter_map(|(index, name)| (*name == Some(selected)).then_some(index))
            .collect();
        if matches.len() == 1 {
            return matches.first().copied();
        }
    }
    primary
        .filter(|index| *index < names.len())
        .or_else(|| (!names.is_empty()).then_some(0))
}

pub fn selected(window: &WebviewWindow, name: Option<&str>) -> Result<Monitor, String> {
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let primary = window
        .primary_monitor()
        .map_err(|error| error.to_string())?;
    let primary_index = primary.as_ref().and_then(|monitor| {
        monitors
            .iter()
            .position(|candidate| same_display(candidate, monitor))
    });
    let names: Vec<_> = monitors
        .iter()
        .map(|monitor| monitor.name().map(String::as_str))
        .collect();
    let index = selected_index(&names, primary_index, name)
        .ok_or("No se pudo consultar ninguna pantalla.")?;
    Ok(monitors[index].clone())
}

pub fn list(window: &WebviewWindow) -> Result<Vec<DisplayInfo>, String> {
    let primary = window
        .primary_monitor()
        .map_err(|error| error.to_string())?;
    Ok(window
        .available_monitors()
        .map_err(|error| error.to_string())?
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            DisplayInfo {
                name: monitor.name().cloned(),
                x: monitor.position().x,
                y: monitor.position().y,
                width: monitor.size().width,
                height: monitor.size().height,
                work_x: area.position.x,
                work_y: area.position.y,
                work_width: area.size.width,
                work_height: area.size.height,
                scale_factor: monitor.scale_factor(),
                primary: primary
                    .as_ref()
                    .is_some_and(|candidate| same_display(monitor, candidate)),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::selected_index;

    #[test]
    fn chooses_requested_display_or_primary_when_disconnected() {
        let names = [Some("DISPLAY1"), Some("DISPLAY2")];
        assert_eq!(selected_index(&names, Some(0), Some("DISPLAY2")), Some(1));
        assert_eq!(
            selected_index(&names, Some(0), Some("disconnected")),
            Some(0)
        );
        assert_eq!(selected_index(&names, Some(1), None), Some(1));
    }

    #[test]
    fn handles_empty_unknown_and_duplicate_display_names() {
        assert_eq!(selected_index(&[], None, None), None);
        assert_eq!(selected_index(&[None], None, Some("DISPLAY1")), Some(0));
        assert_eq!(
            selected_index(&[Some("same"), Some("same")], Some(1), Some("same")),
            Some(1)
        );
        assert_eq!(selected_index(&[None], Some(99), None), Some(0));
    }
}
