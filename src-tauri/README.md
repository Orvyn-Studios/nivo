# Fundación nativa de Nivo

Tauri 2 y WebView2, sin administrador, shell general, telemetría, carga remota ni permisos generales de archivos. Preferencias en `app_config_dir()/settings.json`. El canal optativo guarda credenciales propias bajo `integrations/` con DACL restringida. Drop recibe capacidades de archivos exclusivamente desde el evento nativo, nunca rutas arbitrarias del frontend.

## Contratos IPC

Todos los comandos comprueban que la ventana invocante sea `island` y están enumerados en `build.rs` y `capabilities/island.json`.

| Comando | Entrada | Resultado |
| --- | --- | --- |
| `ready` | ninguna | Posiciona y muestra sin activar. Devuelve los errores de configuración aunque consiga mostrar una ventana de respaldo. |
| `set_expanded` | `{ expanded: boolean }` | Actualiza geometría y región nativa; restaura el tamaño anterior si falla y solo confirma el estado tras éxito. |
| `hide_island` | ninguna | Oculta si existe bandeja; rechaza la operación si no habría forma de recuperarla. |
| `get_settings` | ninguna | Preferencias completas del esquema 1. |
| `save_settings` | `{ settings: Settings }` | Valida, aplica posición y persiste; devuelve el objeto guardado. El fallo de escritura restaura la posición previa. |
| `get_displays` | ninguna | Lista nombres, geometría física, área de trabajo, DPI y pantalla principal. |
| `get_autostart` | ninguna | Consulta si este ejecutable está registrado en la entrada HKCU propia. No modifica Windows. |
| `set_autostart` | `{ enabled: boolean }` | Registra o elimina únicamente `Orvyn.Nivo`, tras una acción explícita del usuario. Ruta local del ejecutable actual; sin argumentos arbitrarios. |
| `get_media_snapshot` | ninguna | Estado GSMTC real, secuencia y hasta ocho sesiones; nunca datos de demostración. |
| `media_control` | `{ sessionId, action }` | Acción `playPause`, `previous` o `next` en un worker, con plazo y validación de sesión/capacidad. |
| `select_media_session` | `{ sessionId }` | Selecciona una sesión conocida y actualiza la instantánea. |
| `quit_app` | ninguna | Salida explícita del proceso; alternativa a Salir desde bandeja. |
| `set_surface_geometry` | `{ shape, epoch }` | Región Win32 acotada al cliente; ignora épocas obsoletas. |
| `get_audio_snapshot` | ninguna | Endpoints y sesiones reales o estado desactivado. |
| `audio_control` | `{ action }` | Solo volumen/silencio de endpoints o sesiones conocidos; worker con plazo. |
| `open_sound_settings` | ninguna | Abre el destino fijo ms-settings:sound. |
| `get_power_snapshot` | ninguna | Energía real; ausencia y datos desconocidos explícitos. |
| `get_drop_snapshot` | ninguna | IDs, nombres y tamaños de archivos aceptados nativamente, sin rutas. |
| `drop_action` | `{ action, id }` | Ruta/carpeta/copia de una capacidad conocida o ZIP del lote; selector nativo y create_new. |

Los campos nuevos de preferencias son optativos con `serde(default)`: audio, batería, aviso de carga completa, Caps/Num Lock, canal local y Drop están desactivados en configuraciones nuevas y al migrar ajustes antiguos. Umbrales por defecto 20/10/5. Los campos previos se conservan.

Después de mostrar u ocultar realmente la ventana, Rust emite `nivo://visibility` exclusivamente hacia `island`, con payload `{ "visible": true }` o `{ "visible": false }`. Esto permite suspender las actualizaciones visuales aunque WebView2 no cambie `document.hidden`. El frontend debe esperar la suscripción antes de llamar a `ready`:

```ts
const unlisten = await window.__TAURI__.event.listen(
  'nivo://visibility',
  ({ payload }) => applyNativeVisibility(payload.visible),
  { target: 'island' },
);
await window.__TAURI__.core.invoke('ready');
// Al desmontar o cerrar el contexto: unlisten().
```

El payload se valida en el puente TypeScript. Las capabilities solo permiten `core:event:allow-listen` y `core:event:allow-unlisten`; no permiten emitir eventos desde el frontend. La bandeja usa las mismas operaciones de mostrar/ocultar que los comandos. Si ocultar consigue cambiar la ventana pero falla comunicarlo, se restaura visible antes de devolver el error; una restauración fallida queda identificada expresamente.

`Settings` emplea campos `snake_case`:

```json
{
  "schema_version": 1,
  "theme": "system",
  "motion": "system",
  "mascot_enabled": true,
  "privacy_mode": true,
  "media_enabled": true,
  "notifications_enabled": true,
  "hide_in_fullscreen": true,
  "monitor_name": null,
  "horizontal_position": 0.5,
  "top_gap": 8
}
```

Multimedia y pantalla completa están conectadas a proveedores Windows. `mascot_enabled` controla el compañero vectorial original del frontend. `notifications_enabled` se limita a eventos propios de Nivo y no concede acceso a notificaciones ajenas. El inicio automático se consulta directamente en su entrada HKCU; no se duplica en JSON ni se activa por defecto.

`theme`: `system`, `dark`, `light`. `motion`: `system`, `reduced`, `full`. Posición horizontal entre 0 y 1; separación superior entre 0 y 128 DIP, medida desde el borde visible de la cápsula. Nombres de monitor opcionales, máximo 256 bytes y sin caracteres de control. Se rechazan campos desconocidos, esquemas futuros y valores fuera de rango. El archivo tiene un límite de 16 KiB. Un archivo ilegible o inválido permanece intacto, se cargan valores predeterminados y `ready` comunica el problema. Guardar expresamente preferencias nuevas lo sustituye.

La escritura se serializa con un mutex, crea un temporal exclusivo en el mismo directorio, escribe y sincroniza el contenido y usa `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)` en Windows. Nunca elimina primero el archivo de destino. La memoria se actualiza después de una sustitución satisfactoria. Un formato futuro necesita una migración explícita; nunca se interpreta como esquema 1.

## Ventana y pantallas

La superficie compacta mide 112 × 34 DIP; la expandida 388 × 320 DIP. Ambas tienen 16 DIP de margen de ventana por lado: 144 × 66 y 420 × 352 DIP. La geometría se transforma una sola vez a píxeles físicos según la pantalla seleccionada. Se admiten coordenadas negativas y se acota el contenido al área de trabajo.

`WS_EX_TOOLWINDOW` excluye la ventana de Alt+Tab, eliminando `WS_EX_APPWINDOW`. `SetWindowPos` conserva el foco y la posición en el orden de ventanas. No se aplica `WS_EX_NOACTIVATE` permanentemente, para conservar interacción intencionada por teclado y tecnologías asistivas. No se habilita topmost.

`CreateRoundRectRgn` y `SetWindowRgn` restringen el HWND a la superficie redondeada; al transferirla con éxito, Windows asume la propiedad de la región. Los márgenes y esquinas exteriores se excluyen. **Esto también recorta la sombra exterior.** El acabado de esa sombra necesita una solución y validación posterior.

El nombre persistido selecciona una pantalla si hay una coincidencia única; si desaparece o resulta ambiguo, se usa la principal. Se conserva la preferencia para una reconexión futura. La posición se recalcula al mostrar, guardar preferencias, cambiar DPI y recibir `WM_DISPLAYCHANGE`. La aceptación de hotplug y cambios de área de trabajo reales sigue pendiente.

La región usa la geometría del estado de destino. **Durante una expansión CSS puede existir una región interactiva mayor que el contenido visible durante la transición.** El script siguiente comprueba el estado compacto estable, no acredita ese criterio durante una transición. Tampoco acredita fullscreen, exclusión de juegos, transparencia visual o lectura multimedia.

## Verificación

Desde la raíz, con dependencias disponibles:

```powershell
npm.cmd run build:web
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Los cinco tests de geometría también se pueden compilar sin descargar dependencias:

```powershell
rustc --edition=2021 --test src-tauri/src/placement.rs -o "$env:TEMP\nivo-placement-tests.exe"
& "$env:TEMP\nivo-placement-tests.exe"
```

Para producir una aplicación autónoma usa la CLI de Tauri; `npm run build` ejecuta `tauri build`, prepara `dist` y activa `tauri/custom-protocol`. No hace falta declarar una feature local del mismo nombre: la CLI añade directamente la feature de la dependencia. **Un `cargo build` o `cargo build --release` sin esa feature sigue siendo una compilación que usa `devUrl`; no es un ejecutable autónomo y necesita el servidor Vite.** Como alternativa explícita, después de generar `dist`, Cargo admite `--features tauri/custom-protocol`.

Prueba del ejecutable de producto real, sin Vite y sin interactuar con otras ventanas mientras arranca:

```powershell
npm.cmd run build
powershell -NoProfile -File src-tauri/scripts/Test-NativeWindow.ps1 -Executable src-tauri/target/release/nivo-desktop.exe
```

El script lanza su propio proceso, comprueba foco, visibilidad, TOOLWINDOW, ausencia de topmost/NOACTIVATE permanente, tamaño físico según DPI y región nativa. Lo cierra enviando `WM_CLOSE`; `-KeepOpen` permite inspección manual. Devuelve una medición observada del tiempo hasta ventana visible, sin confundirla con una medida de fluidez. No modifica políticas ni captura pantalla, teclado o datos de otras aplicaciones.

El 17 de octubre de 2026 se completó una build release y el usuario confirmó la apertura de la cápsula. La nueva revisión ejecuta las 39 pruebas de biblioteca y pasa Clippy para todos los targets con `-D warnings`; el harness vacío de `main` volvió a quedar bloqueado por error4551, por lo que el comando completo de pruebas no se considera aprobado. No se cambian políticas. La apertura anterior no acredita fluidez de las nuevas animaciones, foco, clics ni consumo. Registro: [VALIDATION.md](../docs/VALIDATION.md).

## Referencias primarias

- [Tauri: Monitor](https://docs.rs/tauri/latest/tauri/window/struct.Monitor.html).
- [Tauri: Emitter y destinos](https://docs.rs/tauri/latest/tauri/trait.Emitter.html).
- [Tauri: API event y namespace global](https://v2.tauri.app/reference/javascript/api/namespaceevent/).
- [Tauri CLI: build_options activa tauri/custom-protocol](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/interface/rust.rs).
- [Win32: SetWindowRgn y propiedad del objeto](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowrgn).
- [Win32: estilos extendidos](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles).
- [Win32: SetWindowLongPtrW y errores](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowlongptrw).
- [Win32: MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw).
