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

- Máquina de estados TypeScript: intención compacta/expandida, hover, notificaciones superpuestas con prioridad y restauración, colas acotadas y protección frente a eventos multimedia obsoletos.
- Temporizador real con plazo absoluto, pausa, reanudación, cancelación y recuperación local. No acumula deriva de intervalos; incluye suspensión. Un cambio manual del reloj hacia delante puede anticipar el final. La validación de suspensión/ocultación en WebView2 está pendiente.
- Interfaz de 112 × 34 DIP con panel de 388 × 320 DIP, teclado, Escape, movimiento reducido y notificaciones propias del temporizador. Máscara animada sin cambiar ancho/alto en cada frame y resorte que conserva velocidad al interrumpir. Fluidez pendiente de medición en Windows.
- Compañero vectorial original y opcional: mirada dentro de la isla, parpadeo al pulsar y reacción a estados reales. Sin seguimiento global ni movimiento continuo. Activo por defecto en configuraciones nuevas; respeta las preferencias existentes.
- Backend modular con preferencias validadas y guardado local atómico, selección de pantalla y posición, región redondeada Win32, estilo de herramienta y operaciones sin activación. Compila y supera 39 pruebas Rust en Windows; la aceptación visual e interactiva sigue pendiente.
- Proveedor GSMTC real por eventos: sesiones, metadatos, portada acotada y controles cuando Windows los permite. El frontend nunca inventa una sesión. Desactivar la integración borra inmediatamente sus datos y descarta respuestas obsoletas.
- Observación Win32 de pantalla completa, bloqueo, suspensión y cambios de pantalla. La intención de ocultar o pausar sobrevive a estos eventos. No usa hooks de entrada ni inyección. Su matriz de aceptación en juegos y varios monitores está pendiente.
- Bandeja Mostrar/Ocultar/Pausar/Preferencias/Salir. Inicio automático opcional desde Preferencias, limitado a la entrada propia `Orvyn.Nivo` en HKCU. Nunca se activa en la instalación o en las pruebas automatizadas.
- Puente de doce comandos finitos, sin plugins de shell, archivos arbitrarios, red ni ejecución remota. Preferencias nativas en el directorio de configuración de `com.orvyn.nivo`; temporizador en almacenamiento local del webview. No se guarda historial de notificaciones.

Pendientes de aceptación: nueva animación y compañero, música con un reproductor compatible, fullscreen/juegos, cambios de monitor/DPI, suspensión y startup real. Notificaciones externas y agentes siguen sin implementarse. Siempre visible permanece desactivado. La región nativa usa el tamaño final durante las transiciones y recorta la sombra exterior: faltan pruebas y correcciones de esa interacción antes de beta.

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

`npm run verify:web` ejecuta las 62 pruebas actuales y comprueba tipos/build, con logs e informe en `artifacts/verify-web.json`. `npm run verify` añade Rustfmt, tests Cargo con lock, Clippy y compilación del ejecutable. Se detiene ante el primer fallo y no presenta las comprobaciones posteriores como aprobadas. Las pruebas de navegador y aceptación nativa son pasos separados.

El 17 de octubre de 2026 pasan tipos, build web, 62 pruebas Node, 39 pruebas de biblioteca Rust y Clippy con advertencias como errores. El usuario confirma que la build anterior muestra la cápsula, pero indica falta de fluidez y acabado. La última verificación completa falla por error4551 al ejecutar el harness vacío de `main`; las 39 pruebas de biblioteca sí se ejecutan. No se cambian protecciones. Chromium sigue sin crear página, incluso con renderizado por software. No hay capturas ni medidas FPS aprobadas. Consulta [VALIDATION.md](docs/VALIDATION.md) y [la revisión de Coucou](docs/COUCOU_REVIEW.md).

La prueba web permite seleccionar Edge mediante `NIVO_TEST_BROWSER=msedge`, o desactivar el uso de GPU únicamente en el navegador de pruebas mediante `NIVO_TEST_SOFTWARE_RENDERING=1`. Ambos mantienen el sandbox. El informe registra estas condiciones; sus tiempos RAF no acreditan rendimiento nativo.

Se conserva un workflow Windows manual en `.github/workflows/windows-validation.yml`, sin disparadores automáticos. Una ejecución autorizada terminó sin asignar runner ni ejecutar pasos; el usuario informó de un problema de facturación y pidió continuar localmente. No se volverá a ejecutar Actions sin una nueva indicación. El workflow no publica releases ni ejecutables automáticamente, y no sustituye la prueba del ejecutable en un escritorio real.
