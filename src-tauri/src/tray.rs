use crate::{
    settings::SettingsStore,
    window::{self, IslandState},
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, Manager,
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
    let quit = MenuItem::with_id(app, "quit", "Salir de Nivo", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
    TrayIconBuilder::with_id("nivo")
        .icon(icon())
        .tooltip("Nivo by Orvyn")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "show" | "hide" => {
                if let Some(island) = app.get_webview_window("island") {
                    let result = if event.id.as_ref() == "show" {
                        app.state::<SettingsStore>()
                            .snapshot()
                            .and_then(|settings| {
                                window::show(&island, &app.state::<IslandState>(), &settings)
                            })
                    } else {
                        window::hide(&island)
                    };
                    if let Err(error) = result {
                        eprintln!("Nivo tray: {error}");
                    }
                }
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}
