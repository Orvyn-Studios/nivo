use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[tauri::command]
pub fn close_preferences(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "preferences" {
        return Err("Ventana no permitida.".into());
    }
    window.close().map_err(|error| error.to_string())
}

pub fn require_known(window: &WebviewWindow) -> Result<(), String> {
    if matches!(window.label(), "island" | "preferences") {
        Ok(())
    } else {
        Err("Ventana no permitida.".into())
    }
}

/// Async to avoid the documented WebView2 synchronous-window creation deadlock.
pub async fn open(app: &AppHandle) -> Result<(), String> {
    static OPEN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = OPEN.lock().await;
    if let Some(window) = app.get_webview_window("preferences") {
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    WebviewWindowBuilder::new(
        app,
        "preferences",
        WebviewUrl::App("preferences.html".into()),
    )
    .title("Preferencias de Nivo")
    .inner_size(820.0, 620.0)
    .min_inner_size(600.0, 480.0)
    .center()
    .resizable(true)
    .maximizable(false)
    .disable_drag_drop_handler()
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}
