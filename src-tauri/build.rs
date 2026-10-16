fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "ready",
            "set_expanded",
            "hide_island",
            "get_settings",
            "save_settings",
            "get_displays",
            "quit_app",
        ]),
    ))
    .expect("could not build Nivo permissions");
}
