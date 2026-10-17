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

Después de compilar, `node scripts/export-private-test.mjs` prepara una copia local de evaluación en `artifacts/private-test/<commit>-<hash>/Nivo.exe`, con hash, referencia de código, licencia y límites de aceptación. Rechaza fuentes sin commit y ejecutables anteriores a las fuentes. Usa esa copia para probar y deja libre el `.exe` de `target/release` para la siguiente compilación. La exportación no publica nada ni acredita beta, rendimiento o firma.

## Implementación actual

El [rediseño contextual](docs/REDESIGN.md) sustituye el panel con pestañas por tamaños según contenido y una ventana independiente de preferencias. Se conservan los proveedores y acciones reales de la fase funcional. Los estados visuales de prueba se encuentran en `artifacts/redesign/`, identificados como fixtures.

- Máquina de estados TypeScript: intención compacta/expandida, hover, notificaciones superpuestas con prioridad y restauración, colas acotadas y protección frente a eventos multimedia obsoletos.
- Temporizador retirado del dominio, controles, eventos y persistencia activa. El almacenamiento antiguo se conserva sin leerlo. Coordinador de actividad con prioridades, interrupción, agrupación, cola acotada y pausa de avisos.
- Cápsula de 112 × 34 DIP; calma 260 × 138, música 360 × 174/202 y HUDs compactos. Tamaños centralizados, listas acotadas y configuración independiente desde la bandeja o el icono de ajustes. Máscara y región Win32 comparten geometría, con épocas y envíos serializados. Fluidez perceptiva pendiente de aceptación.
- Compañero vectorial original y opcional: mirada dentro de la isla, parpadeo al pulsar y reacción a estados reales. Sin seguimiento global ni movimiento continuo. Activo por defecto en configuraciones nuevas; respeta las preferencias existentes.
- Backend modular con preferencias validadas y guardado local atómico, selección de pantalla y posición, región redondeada Win32, estilo de herramienta y operaciones sin activación.
- Proveedor GSMTC real por eventos: sesiones, metadatos, portada acotada y controles cuando Windows los permite. El frontend nunca inventa una sesión. Desactivar la integración borra inmediatamente sus datos y descarta respuestas obsoletas.
- Observación Win32 de pantalla completa, bloqueo, suspensión y cambios de pantalla. La intención de ocultar o pausar sobrevive a estos eventos. No usa hooks de entrada ni inyección. Su matriz de aceptación en juegos y varios monitores está pendiente.
- Bandeja Mostrar/Ocultar/Pausar/Preferencias/Salir. Inicio automático opcional desde Preferencias, limitado a la entrada propia `Orvyn.Nivo` en HKCU. Nunca se activa en la instalación o en las pruebas automatizadas.
- Core Audio por eventos: salida, silencio, micrófono y volumen/silencio por sesión. No graba audio ni atribuye uso del micrófono. Las nuevas integraciones son optativas.
- Energía real mediante Windows, sin batería ficticia en sobremesa. Umbrales configurables y Caps/Num Lock optativos mediante Raw Input, descartando el resto de teclas sin traducir texto.
- Canal local autenticado y adaptadores de Codex y descargas Chrome/Edge; requieren activación voluntaria. Consulta [instalación y límites](docs/LOCAL_INTEGRATIONS.md).
- Nivo Drop para hasta 16 archivos locales: ruta, carpeta, copia y ZIP con selector nativo. No recibe rutas arbitrarias desde JavaScript ni sobrescribe destinos. No implementa todavía Compartir de Windows.
- Comandos finitos con capabilities restringidas; sin shell general, telemetría ni historial de actividad. Configuración nativa en el directorio propio `com.orvyn.nivo`.

Pendientes de aceptación: fluidez, foco/Alt+Tab, clics a través de márgenes, fullscreen/juegos, cambios de monitor/DPI, suspensión, arrastre OLE y startup real. Siempre visible permanece desactivado. No están implementados notificaciones ajenas, dispositivos USB/Bluetooth generales, proveedores BITS/carpetas ni Compartir. Los adaptadores de Codex/navegador están preparados, sin instalarse ni alterar los perfiles del usuario.

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

`npm run verify:web` ejecuta las pruebas Node y comprueba tipos/build, con logs e informe en `artifacts/verify-web.json`. `npm run verify` añade Rustfmt, tests Cargo con lock, Clippy y compilación del ejecutable. Se detiene ante el primer fallo. Las pruebas de navegador y aceptación nativa son pasos separados.

El avance actual y sus pruebas se registran en [estado por fases](docs/PHASE_STATUS.md). Los informes anteriores en VALIDATION conservan su contexto histórico; sus bloqueos no deben atribuirse automáticamente a esta torre. No se declaran cifras de CPU, RAM o FPS sin mediciones del ejecutable.

La prueba web permite seleccionar Edge mediante `NIVO_TEST_BROWSER=msedge`, o desactivar el uso de GPU únicamente en el navegador de pruebas mediante `NIVO_TEST_SOFTWARE_RENDERING=1`. Ambos mantienen el sandbox. El informe registra estas condiciones; sus tiempos RAF no acreditan rendimiento nativo.

Se conserva un workflow Windows manual en `.github/workflows/windows-validation.yml`, sin disparadores automáticos. Una ejecución autorizada terminó sin asignar runner ni ejecutar pasos; el usuario informó de un problema de facturación y pidió continuar localmente. No se volverá a ejecutar Actions sin una nueva indicación. El workflow no publica releases ni ejecutables automáticamente, y no sustituye la prueba del ejecutable en un escritorio real.
