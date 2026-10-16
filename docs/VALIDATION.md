# Validación inicial — 2026-10-16

## Estado más reciente: dependencias disponibles y compilación intentada

- El usuario terminó la descarga. `npm ls --depth=0` confirma Playwright1.63.0, Tauri CLI2.12.2, TypeScript7.0.2 y Vite8.3.4. Hay lockfiles reales generados por npm y Cargo. `cargo metadata --locked --offline --no-deps` pasa.
- TypeScript y build Vite pasan. Salida final observada: HTML 6.63 KB, CSS 6.44 KB y JS 19.88 KB antes de comprimir. Son tamaños de artefactos, no consumo de RAM.
- `npm run verify:web` pasa, con **38 tests, 0 fallos, 0 omitidos**, además de tipos y build. Se retiraron el frontend/servidor antiguos y sus siete tests; el test nuevo sirve el TypeScript actual por Vite y comprueba aislamiento de Host y rechazo de fuentes nativas/Git. La diferencia respecto a44tests anteriores corresponde a esta migración, no a pruebas omitidas.
- `cargo test --locked` se ejecutó realmente. El primer intento fue bloqueado al lanzar un build-script de `serde_json`. Un intento posterior avanzó y se detuvo al cargar `schemars_derive-8556a15adf8c9a49.dll`: **Control de aplicaciones, os error 4551**, repetido también en el último intento solicitado por el usuario. El comando completo `npm run verify` reprodujo el bloqueo y guardó sus logs e informe fallido en `artifacts/verify-desktop.json`; se detuvo sin presentar Clippy ni build de escritorio como aprobados. No se llegó a compilar el código Rust de Nivo; no se pueden acreditar los 13 tests Cargo ni un ejecutable Tauri.
- Se investigó si el bloqueo se podía evitar quitando una función opcional: `cargo tree --locked --offline --invert schemars@0.8.22 --edges features` y los manifiestos instalados muestran que `tauri-build 2.7.3` depende directamente de `schemars 0.8.22`; además, `tauri-utils` activa su feature `schema` a través de `build-2`. No encontramos un interruptor soportado por la configuración de Nivo para eliminar esta macro. No se modificaron crates, binarios ni protecciones para eludir Control de aplicaciones.
- Rustfmt pasa. Los cinco tests de geometría que se compilaron y ejecutaron directamente mediante MSVC siguen siendo la única prueba Rust aprobada de esta fundación.
- El test de navegador ya carga las dependencias y conecta con Chromium153.0.8010.12. Su proceso GPU sale con `0xC0000022` y el navegador termina sin crear página. Edge155.0.4283.45 y el intento de Chromium con GPU desactivada tampoco crean la página. Todos mantienen sandbox. El test ahora registra el fallo tras15s y cierra recursos. No se ha aprobado ninguna captura, interacción de navegador ni métrica RAF.
- Se corrigió Vite para no vigilar `src-tauri/` ni `artifacts/`; antes el watcher intentaba abrir DLL/PDB del compilador y daba EBUSY. La comprobación HTTP real del servidor actual pasa.
- Se añadió `npm run verify` para reproducir tipos, tests, lint y build con logs; `verify:web` tiene alcance explícito web. Hay un workflow manual Windows preparado y acciones oficiales fijadas por SHA, sin publicación automática. No se ha ejecutado ni se ha creado/subido repositorio remoto.
- Se guardó la migración de frontend en `da50840` y la fundación nativa preparada en `6bc4550`, en la rama de desarrollo. El mensaje del commit nativo indica expresamente el bloqueo y la aceptación pendiente; guardar el código para revisión no lo convierte en una beta validada.
- Fuente del comportamiento general de Control de aplicaciones: [Microsoft Learn](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/windows-defender-application-control/wdac). No se ha identificado ni alterado la política concreta de este equipo; se informa el error observado y no se presupone que sea Smart App Control.

La integración nativa permanece pendiente de compilación y aceptación. Los criterios de beta no están cumplidos; no hay medidas nativas de CPU/RAM/FPS. StarOptimizer no se ha modificado.

Los siguientes apartados conservan el historial de trabajo anterior.

## Continuación: fundación tipada y nativa

Este apartado refleja el estado más reciente. Los apartados posteriores conservan el registro histórico del primer scaffold.

- Rama: `feature/nivo-mvp`. StarOptimizer no se ha modificado ni publicado.
- Rust y Cargo instalados por el usuario: 1.99.1, host `x86_64-pc-windows-msvc`. Node 24.20.0, npm 11.19.0, MSVC y WebView2 detectados.
- Auditoría inicial: cinco tests pasaban; no había datos multimedia simulados. Se detectaron una carrera de microtasks, errores recuperables tratados como desconexión, panel con aparición instantánea, dimensiones mayores que el brief y márgenes nativos que podían bloquear clics.
- Ahora `npm test`: **44 aprobadas, 0 fallos, 0 omitidas**. Incluye 18 pruebas de dominio, 9 de transiciones, 3 de animación con adaptador DOM de prueba, 6 de prerrequisitos, 1 de validadores/contadores Windows y 7 de la base anterior. Estas últimas siguen como control de la migración, no prueban la nueva interfaz Vite.
- **5 tests Rust de geometría compilados con MSVC y ejecutados** mediante `rustc --edition=2021 --test`. `cargo fmt --check`, comprobaciones sintácticas Node y `git diff --check` pasan. Esto no compila Tauri ni acredita toda la integración Win32.
- Cinco commits locales de correcciones, dominio, transiciones, QA y animación: `5854f65`, `7bc7337`, `1470a88`, `0ca0f42`, `c0bcda3`.
- Integración escrita y todavía pendiente de compilación: entrada TypeScript/Vite, cápsula112×34, temporizador y avisos propios, preferencias, módulos nativos, región Win32, pantallas, bandeja, salida y evento de visibilidad. Estos cambios permanecen en el árbol de trabajo para completar su verificación antes de un commit de integración.
- `npm run typecheck` falla porque no está instalado TypeScript. `npm run test:ui` falla explícitamente con `UI_DEPENDENCIES_UNAVAILABLE`; su JSON de resultado indica bloqueo, sin capturas ni métricas aprobadas. No se confunde ejecución con eliminación de tipos con una comprobación estática.
- La descarga npm desde esta sesión falla con `EACCES`; Cargo no conecta con `index.crates.io`. Offline no encuentra `serde`. No hay aún un `Cargo.lock` generado ni un lock npm actualizado para Vite/TypeScript/Tauri. El usuario dispone de `scripts/setup-windows.cmd` para descargar las dependencias desde su terminal normal. No se han inventado lockfiles ni reutilizado dependencias de StarOptimizer durante esta continuación.
- Próximo paso al terminar la descarga: tipos, build Vite, tests/check/clippy Cargo, compilación Tauri, ejecutar el binario y corregir los fallos reales. Después retirar la vista/servidor anteriores, completar prueba visual y commitear la migración verificada.

### Límites que impiden declarar una beta

No hay aún ejecutable Tauri ejecutado, datos GSMTC ni controles musicales reales; tampoco fullscreen, hotplug inmediato, autostart o notificaciones externas. La región nativa sigue el tamaño final durante las animaciones y recorta la sombra exterior. Falta comprobar foco, Alt+Tab, clics durante las transiciones, DPI y bandeja reales. Siempre visible continúa desactivado.

El temporizador usa plazo absoluto de reloj civil: no suma deriva de ticks e incluye suspensión, pero un ajuste manual positivo del reloj puede anticipar su final. Su comportamiento nativo al ocultar/suspender todavía requiere prueba real. Las métricas RAF son intervalos de callbacks JavaScript durante transiciones, no fotogramas presentados por el compositor. No se han medido CPU, RAM, 30 minutos de actividad ni 60 FPS.

Los scripts de medición y aceptación nativa están preparados. El muestreador PowerShell completo no se ha ejecutado contra Nivo; la política de ejecución rechazó el archivo y no se alteró. Sí se probaron por separado sus parámetros, contadores y helper Win32 en tests. La política no se ha omitido para ejecutar el cuerpo del script.

Estado: **base de desarrollo; no publicar ni presentar como aplicación nativa probada**.

## Ejecutado

- Node 24.20.0 y npm 11.19.0.
- `npm test`: 5 aprobadas, 0 fallos, 0 omitidas. Incluye estado sin datos ficticios, reducción de movimiento, serialización con intención más reciente, error/reintento y servidor HTTP real con rutas, métodos, Host y CSP.
- Comprobación sintáctica de JavaScript y `git diff --check`.
- Inicialización de un repositorio separado en `C:\Users\angel\Documents\Codex\Nivo`, rama `feature/nivo-mvp`. Se usa esa carpeta porque crear `C:\Users\angel\Nivo` fue denegado por Windows.
- El frontend no depende de Electron ni de StarOptimizer. Playwright es una herramienta de pruebas, no parte del producto.

## Bloqueado o pendiente

- Rust/Cargo no encontrados: `npm run check:native` falla porque cargo no está disponible. No se ha compilado Tauri ni ejecutado sus tres tests Rust. Las capacidades, el icono de bandeja, la geometría y las firmas de API deben validarse con el compilador. vswhere sí detecta el componente C++ en Visual Studio 18 BuildTools.
- No se ha generado Cargo.lock: falta una resolución de dependencias Rust real y reproducible.
- `npm install --offline` de Playwright devolvió ENOTCACHED; el lock de esas tres dependencias de pruebas se preparó a partir de metadatos íntegros ya presentes en el proyecto existente, sin cambiar versiones ni hashes.
- La instalación existente de Chromium 1243 no llegó a estar disponible para automatización con sandbox durante el sondeo de 15 segundos. Los tests visuales no se consideran aprobados. No se ha desactivado el sandbox para forzar un resultado verde.
- La prueba UI preparada se intentó con Playwright 1.63.0 existente mediante NODE_PATH; el proceso no completó su arranque y el ejecutor terminó con ETIMEDOUT a los 22 segundos. Su registro está en artifacts/ui-validation.log; no es una captura ni una prueba visual aprobada.
- Sin aceptación de WebView2/Win32, foco, Alt+Tab, bandeja, juegos, DPI o multimonitor. No hay medición de consumo ni rendimiento nativo.
- Se intentó acceder por HTTPS al instalador oficial de rustup en static.rust-lang.org: la sesión no pudo conectar con el servidor remoto. No se ha instalado software ni cambiado PATH para ocultar ese bloqueo.
- Multimedia, notificaciones y protección frente a pantalla completa son próximos hitos, no capacidades implementadas.

## Revisión UI con ui-craft

**Checked:** código de estados, semántica de botones/etiquetas, Escape y restauración de foco, condiciones de movimiento reducido, ausencia de animación continua y no presentación de datos ficticios. La comprobación de foco/teclado en un navegador real sigue pendiente, aunque su test está preparado.

**Passed:** las cinco pruebas Node descritas arriba. No se infiere de ellas la calidad visual ni compatibilidad Windows.

**Left alone:** el sistema visual propio de la isla, con pastilla negra, fuentes del sistema y tokens de Orvyn; sin librerías de animación, dashboard, mascota, pistas demo o peticiones de acceso a notificaciones.

**Verdict:** la base permite continuar el desarrollo y probar el frontend local. El siguiente paso es compilar y validar Tauri en Windows antes de conectar datos nativos o distribuir.

## Vista de desarrollo disponible

Se inició `npm run dev` en http://127.0.0.1:1420. Una petición HTTP real devuelve 200, los encabezados CSP esperados y el markup de la isla. Esto comprueba que se sirve el frontend, no su renderizado visual ni un proceso Tauri. El servidor es temporal; puede volver a iniciarse con el comando documentado en README.
