fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "ready",
            "set_expanded",
            "set_surface_geometry",
            "hide_island",
            "get_settings",
            "save_settings",
            "get_displays",
            "get_autostart",
            "set_autostart",
            "get_media_snapshot",
            "media_control",
            "select_media_session",
            "quit_app",
        ]),
    ))
    .expect("could not build Nivo permissions");
}
