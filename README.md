# Nivo by Orvyn

Isla de escritorio para Windows, independiente de StarOptimizer. Tauri 2 + Rust + TypeScript + Vite, sin framework de interfaz ni servicios externos. Versión de desarrollo `0.1.0-alpha.1`; todavía no es una beta validada.

Repositorio de Nivo: [SnoW-099/nivo](https://github.com/SnoW-099/nivo). El desarrollo continúa en `feature/nivo-mvp`. Los cambios de Nivo se guardan en este repositorio independiente; las releases requieren autorización y aceptación nativa.

La primera subida se realizó mediante el conector de GitHub, con autorización para inicializar el repositorio vacío. El historial local se conserva y los commits remotos de importación tienen SHA diferentes. Consulta [la importación y sincronización](docs/GITHUB_IMPORT.md) antes de reconciliar ambas historias.

## Preparar y ejecutar

Requiere Node 24+, Rust estable MSVC, herramientas C++ y WebView2. Consulta los [prerrequisitos oficiales de Tauri](https://v2.tauri.app/start/prerequisites/). No requiere administrador para el uso normal.

Desde PowerShell, en la carpeta del proyecto:

```powershell
.\scripts\setup-windows.cmd
npm.cmd test
npm.cmd run build:web
npm.cmd run check:native
npm.cmd run desktop
```

El script prepara las dependencias npm y descarga los crates Rust. La CLI Tauri está declarada en el proyecto; no hace falta instalar otra globalmente. `npm run desktop` abre la aplicación Windows. `npm run dev` abre únicamente la vista de desarrollo en `http://127.0.0.1:1420`.

Los lockfiles ya están generados por npm y Cargo; instalaciones repetibles con `npm ci` y `cargo fetch --locked`. La compilación `npm run build` incorpora `dist/` al ejecutable: el producto instalado no necesita Node ni un servidor local. El empaquetado y las releases siguen desactivados hasta completar la aceptación nativa y recibir autorización.

## Implementación actual

- Máquina de estados TypeScript: intención compacta/expandida, hover, notificaciones superpuestas con prioridad y restauración, colas acotadas y protección frente a eventos multimedia obsoletos. El contrato multimedia aún no tiene proveedor Windows conectado.
- Temporizador real con plazo absoluto, pausa, reanudación, cancelación y recuperación local. No acumula deriva de intervalos; incluye suspensión. Un cambio manual del reloj hacia delante puede anticipar el final. La validación de suspensión/ocultación en WebView2 está pendiente.
- Interfaz de 112 × 34 DIP con panel de 388 × 320 DIP, teclado, Escape, movimiento reducido y notificaciones propias del temporizador. Trayectorias amortiguadas cancelables, sin bucle de animación en reposo.
- Backend modular con preferencias validadas y guardado local atómico, selección de pantalla y posición, región redondeada Win32, estilo de herramienta y operaciones sin activación. Código escrito; Control de aplicaciones de Windows impide completar la compilación Tauri en esta sesión (error4551 en una dependencia). Su aceptación real sigue pendiente.
- Bandeja Mostrar/Ocultar/Salir y salida de emergencia desde Preferencias. Si la bandeja falla se impide ocultar una app irrecuperable.
- Puente limitado a siete comandos, sin plugins de shell, archivos arbitrarios, red ni ejecución remota. Preferencias nativas en el directorio de configuración de `com.orvyn.nivo`; temporizador en almacenamiento local del webview. No se guarda historial de notificaciones.

Pendientes: GSMTC real y controles musicales; fullscreen/juegos; hotplug inmediato; autostart optativo; permisos e identidad para notificaciones externas; mascota e integración real de agentes. Siempre visible permanece desactivado. La región nativa usa el tamaño final durante las transiciones y recorta la sombra exterior: faltan pruebas y correcciones de esa interacción antes de beta.

## Comprobar cambios

```powershell
npm.cmd run preflight
npm.cmd test
npm.cmd run typecheck
npm.cmd run build:web
npm.cmd run test:ui
npm.cmd run check:native
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Playwright es solo una dependencia de pruebas. Si falta Chromium, `npx.cmd playwright install chromium`. Los tests Node ejecutan el dominio quitando tipos; solamente `typecheck` comprueba su tipado estático. Las pruebas de navegador no acreditan foco, región de ventana, bandeja o comportamiento en juegos.

Consulta [validación](docs/VALIDATION.md), [aceptación y medición nativa](docs/NATIVE_ACCEPTANCE.md), [contratos Rust](src-tauri/README.md) y [roadmap](docs/PLAN.md). No se publican cifras de CPU, memoria o FPS sin mediciones del ejecutable.

## Verificación repetible y bloqueos actuales

`npm run verify:web` ejecuta las 38 pruebas actuales y comprueba tipos/build, con logs e informe en `artifacts/verify-web.json`. `npm run verify` añade Rustfmt, tests Cargo con lock, Clippy y compilación del ejecutable. Se detiene ante el primer fallo y no presenta las comprobaciones posteriores como aprobadas. Las pruebas de navegador y aceptación nativa son pasos separados.

El 16 de octubre de 2026, tipos, build y las 38 pruebas pasan. Cargo se detiene al cargar `schemars_derive.dll` con error4551 de Control de aplicaciones, antes de compilar Nivo. No se modifica ninguna protección. Chromium y Edge no consiguen crear la página de prueba; el proceso GPU de Chromium falla con `0xC0000022`. Se ha preparado un timeout explícito y cierre del navegador para evitar esperas indefinidas. No hay capturas ni mediciones FPS aprobadas.

La prueba web permite seleccionar Edge mediante `NIVO_TEST_BROWSER=msedge`, o desactivar el uso de GPU únicamente en el navegador de pruebas mediante `NIVO_TEST_SOFTWARE_RENDERING=1`. Ambos mantienen el sandbox. El informe registra estas condiciones; sus tiempos RAF no acreditan rendimiento nativo.

Se incluye un workflow **manual** en `.github/workflows/windows-validation.yml`, dentro de `feature/nivo-mvp`: instala las dependencias, ejecuta las comprobaciones y puede conservar un ejecutable de desarrollo y sus evidencias en un runner Windows. Usa acciones oficiales fijadas por SHA y permisos de lectura. No se ha ejecutado, no crea releases y no sustituye la prueba del ejecutable en un escritorio real. Su activación en la rama predeterminada sigue pendiente; la autorización de subida no incluye ejecutar Actions.
