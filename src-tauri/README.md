# Fundación nativa de Nivo

Tauri 2 y WebView2, sin administrador, shell, telemetría, carga remota ni permisos generales de archivos. La lectura y escritura de preferencias solo usa una ruta calculada por Rust: `app_config_dir()/settings.json`.

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
| `quit_app` | ninguna | Salida explícita del proceso; alternativa a Salir desde bandeja. |

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
  "mascot_enabled": false,
  "privacy_mode": true,
  "media_enabled": true,
  "notifications_enabled": true,
  "hide_in_fullscreen": true,
  "monitor_name": null,
  "horizontal_position": 0.5,
  "top_gap": 8
}
```

Los campos de multimedia, mascota y pantalla completa preparan el contrato; no conectan proveedores que todavía no existen. `notifications_enabled` se limita a eventos propios de Nivo. No concede acceso a notificaciones ajenas. No hay ajuste de inicio automático.

`theme`: `system`, `dark`, `light`. `motion`: `system`, `reduced`, `full`. Posición horizontal entre 0 y 1; separación superior entre 0 y 128 DIP, medida desde el borde visible de la cápsula. Nombres de monitor opcionales, máximo 256 bytes y sin caracteres de control. Se rechazan campos desconocidos, esquemas futuros y valores fuera de rango. El archivo tiene un límite de 16 KiB. Un archivo ilegible o inválido permanece intacto, se cargan valores predeterminados y `ready` comunica el problema. Guardar expresamente preferencias nuevas lo sustituye.

La escritura se serializa con un mutex, crea un temporal exclusivo en el mismo directorio, escribe y sincroniza el contenido y usa `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)` en Windows. Nunca elimina primero el archivo de destino. La memoria se actualiza después de una sustitución satisfactoria. Un formato futuro necesita una migración explícita; nunca se interpreta como esquema 1.

## Ventana y pantallas

La superficie compacta mide 112 × 34 DIP; la expandida 388 × 320 DIP. Ambas tienen 16 DIP de margen de ventana por lado: 144 × 66 y 420 × 352 DIP. La geometría se transforma una sola vez a píxeles físicos según la pantalla seleccionada. Se admiten coordenadas negativas y se acota el contenido al área de trabajo.

`WS_EX_TOOLWINDOW` excluye la ventana de Alt+Tab, eliminando `WS_EX_APPWINDOW`. `SetWindowPos` conserva el foco y la posición en el orden de ventanas. No se aplica `WS_EX_NOACTIVATE` permanentemente, para conservar interacción intencionada por teclado y tecnologías asistivas. No se habilita topmost.

`CreateRoundRectRgn` y `SetWindowRgn` restringen el HWND a la superficie redondeada; al transferirla con éxito, Windows asume la propiedad de la región. Los márgenes y esquinas exteriores se excluyen. **Esto también recorta la sombra exterior.** El acabado de esa sombra necesita una solución y validación posterior.

El nombre persistido selecciona una pantalla si hay una coincidencia única; si desaparece o resulta ambiguo, se usa la principal. Se conserva la preferencia para una reconexión futura. La posición se recalcula al mostrar, guardar preferencias y cambiar DPI. **La detección inmediata de desconexiones y cambios de área de trabajo sigue pendiente:** no se afirma soporte completo de hotplug.

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

En la sesión del 16 de octubre de 2026: Rust/MSVC compila y ejecuta los **5 tests de geometría**, y `cargo fmt --check` pasa. Tras descargar las dependencias y generar Cargo.lock, Cargo avanza pero Windows impide cargar `schemars_derive.dll` con **Control de aplicaciones, os error4551**, antes de compilar Nivo. No están acreditados los13tests Cargo de la aplicación. El script de ventana ha superado análisis sintáctico, **todavía no se ha ejecutado contra un binario Tauri**. No hay mediciones acreditadas de CPU, RAM o FPS.

## Referencias primarias

- [Tauri: Monitor](https://docs.rs/tauri/latest/tauri/window/struct.Monitor.html).
- [Tauri: Emitter y destinos](https://docs.rs/tauri/latest/tauri/trait.Emitter.html).
- [Tauri: API event y namespace global](https://v2.tauri.app/reference/javascript/api/namespaceevent/).
- [Tauri CLI: build_options activa tauri/custom-protocol](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/interface/rust.rs).
- [Win32: SetWindowRgn y propiedad del objeto](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowrgn).
- [Win32: estilos extendidos](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles).
- [Win32: SetWindowLongPtrW y errores](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowlongptrw).
- [Win32: MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw).
