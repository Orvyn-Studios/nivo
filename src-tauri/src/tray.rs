use crate::{
    settings::SettingsStore,
    window::{self, IslandState},
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, Emitter, Manager,
};

fn icon() -> Image<'static> {
    let mut rgba = vec![0_u8; 32 * 32 * 4];
    // Small optical capsule; generated locally, no bitmap/network asset.
    for y in 10..22_i32 {
        for x in 3..29_i32 {
            let center_x = x.clamp(9, 22);
            let dx = x - center_x;
            let dy = y * 2 - 31;
            if dx * dx * 4 + dy * dy <= 144 {
                let offset = (y as usize * 32 + x as usize) * 4;
                rgba[offset..offset + 4].copy_from_slice(&[240, 242, 248, 255]);
            }
        }
    }
    Image::new_owned(rgba, 32, 32)
}

pub fn install(app: &App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Mostrar Nivo", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Ocultar Nivo", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pausar Nivo", true, None::<&str>)?;
    let preferences = MenuItem::with_id(app, "preferences", "Preferencias", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir de Nivo", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &pause, &preferences, &quit])?;
    TrayIconBuilder::with_id("nivo")
        .icon(icon())
        .tooltip("Nivo by Orvyn")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "show" | "hide" | "pause" | "preferences" => {
                if let Some(island) = app.get_webview_window("island") {
                    let result = match event.id.as_ref() {
                        "hide" => window::hide(&island),
                        "pause" => window::toggle_pause(&island),
                        action => app
                            .state::<SettingsStore>()
                            .snapshot()
                            .and_then(|settings| {
                                window::show(&island, &app.state::<IslandState>(), &settings)?;
                                if action == "preferences" {
                                    // App-owned, fixed payload delivered only to this
                                    // webview. No arbitrary URI/action crosses IPC.
                                    island
                                        .emit_to(
                                            "island",
                                            "nivo://view",
                                            serde_json::json!({"view": "preferences"}),
                                        )
                                        .map_err(|error| error.to_string())?;
                                }
                                Ok(())
                            }),
                    };
                    if let Err(error) = result {
                        eprintln!("Nivo tray: {error}");
                    }
                    let label = app.state::<IslandState>().paused().map(|paused| {
                        if paused {
                            "Reanudar Nivo"
                        } else {
                            "Pausar Nivo"
                        }
                    });
                    match label
                        .and_then(|label| pause.set_text(label).map_err(|error| error.to_string()))
                    {
                        Ok(()) => {}
                        Err(error) => eprintln!("No se pudo actualizar el menú de Nivo: {error}"),
                    }
                }
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}
