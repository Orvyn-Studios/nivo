# Estado por fases · 17 de octubre de 2026

Rama `feature/nivo-mvp`. Desarrollo local en Windows; sin publicación, cambios en main ni ejecución de Actions. Rust MSVC y herramientas C++ instalados con autorización del usuario. La versión sigue siendo alpha y no se presenta como Nivo 1.0 terminado.

| Fase | Implementación y archivos principales | Verificación y límites |
| --- | --- | --- |
| 0 · Auditoría | Revisados AGENTS, historial, contratos y preferencias. Conservadas música, ventana y bandeja. | Herramientas reales y lockfiles; no se trasladan bloqueos del portátil a la torre. |
| 1 · Base | `src/domain/event-coordinator.ts`, `island.ts`, `main.ts`; retirado `timer.ts`. Prioridades, preempción con tiempo restante, FIFO acotado, agrupación y pausa. | Tests de tormentas, duplicados, ocultación, preferencias y restauración. Almacenamiento antiguo intacto y no leído. |
| 1 · Diseño y ventana | Mascota SVG blanca mínima con siete expresiones distintas; `motion.ts`, `native-surface.ts`, `placement.rs`, `window.rs`. Región animada Win32, cola de un envío y epoch. | Tests de geometría, DPI numérico e interrupciones. La comprobación de clics externos, DPI físico, foco y fluidez sigue pendiente. |
| 2 · Audio | `audio.rs`, `audio/windows.rs`, `audio-state.ts`, `components/audio.ts`. Endpoints y sesiones Core Audio reales, micrófono y mezclador. | Enumeración real en esta torre y pruebas de contratos/controles. No se cambiaron volúmenes ni silencio físicos para probar. No graba audio ni detecta qué aplicación usa el micrófono. Cambio de dispositivo predeterminado remite a ajustes Windows. |
| 3 · Sistema | `power.rs`, `power-state.ts`, `platform/lifecycle/windows.rs`. Batería, energía y Caps/Num Lock optativos. Dispositivos de audio mediante Core Audio. | GetSystemPowerStatus confirma ausencia de batería en esta torre. Umbrales y estados desconocidos probados. Caps/Num requieren comprobación física; no hay proveedor USB/Bluetooth general. |
| 4 · Descargas | `activity_bridge.rs`, `integration-state.ts`, `integrations/browser/`. Canal local con DACL de usuario/SYSTEM, autenticación, mensajes tipados y extensión opcional. | Pipe probado con credenciales erróneas/válidas. Progreso solo con total positivo. No se ha instalado una extensión ni registrado un host en perfiles del usuario. BITS y carpetas son contratos reservados, sin proveedor. No cubre Steam/Epic universalmente. |
| 5 · Drop | `drop_files.rs`, `drop-state.ts`, `components/drop.ts`, eventos Tauri de arrastre. Hasta 16 archivos locales; copiar ruta, carpeta, copia y ZIP. | Archivos temporales reales, lectura del ZIP y rechazo de sobrescrituras. Interfaz probada mediante fixture; no equivale a arrastre OLE real. Sin carpetas, rutas de red, movimiento, borrado de originales ni Compartir. ZIP Stored hasta 512 MiB, sin compresión. |
| 6 · Codex | `integrations/codex-hook.mjs`, `generate-codex-hooks.mjs`. Inicio, espera, revisión y fin de turno por hooks documentados. | Se descartan prompts, transcripciones y rutas; no se modificó hooks.json ni su confianza. Fin de turno no significa objetivo completo. Estos hooks no ofrecen detección universal de errores. |
| 7 · Validación | `scripts/verify.mjs`, `test/ui.mjs`, `test/native-ui.mjs`, pruebas Rust y Node. | Informes en `artifacts/`. La aceptación de juegos, varios monitores, suspensión, accesibilidad con Narrador y rendimiento prolongado sigue abierta. |

## Commits de implementación

- `d1b794d`: silueta mínima y expresiones diferenciadas.
- `c273017`: retirada del temporizador y coordinador contextual.
- `3c89a55`: región nativa animada y control de respuestas obsoletas.
- `7006502`: mezclador Core Audio y micrófono.
- `3b4710f`: eventos de energía y teclas de bloqueo optativos.
- `148d910`: canal autenticado y adaptadores locales.
- `21faf52`: entrada del host ejecutable, IDs de navegador y registro de varios orígenes.
- `8a52081`: Nivo Drop, copia/ZIP sin sobrescritura y pruebas de interfaz.

## Siguiente hito

Completar aceptación manual de ventana y arrastre con archivos de prueba, activar voluntariamente los adaptadores preparados y registrar compatibilidad real. Después, añadir los proveedores pendientes de eventos/dispositivos y descargas. No distribuir antes de cerrar los criterios aplicables de NATIVE_ACCEPTANCE.

## Resultados de esta iteración

- `npm run verify`: aprobado. 73 tests Node, tipos, Vite, Rustfmt, 49 tests Rust y Clippy con advertencias como errores; ejecutable release compilado. Una prueba de audio real está omitida por defecto y se ejecutó explícitamente después: aprobada, solo lectura.
- `npm run test:ui`: aprobado en Chromium 153 con sandbox y GPU normal. Incluye siete expresiones a dos tamaños, teclado/Escape, movimiento reducido, retirada del temporizador, audio con fixture, privacidad y restauración de Drop.
- `NIVO_NATIVE_TEST_PROFILE=release node test/native-ui.mjs`: aprobado en el ejecutable release con WebView2. Enumera salida THX Spatial, micrófono HyperX SoloCast, siete salidas y cinco sesiones de audio reales. Capturas del panel y del micrófono inspeccionadas. Los niveles físicos no se modificaron.
- El mismo ensayo entrega eventos tipados de prueba por la tubería autenticada y mediante el modo host del ejecutable; su progreso llega al DOM real. No es una sesión real de Codex ni una descarga real del navegador. No registra extensiones ni hooks. Restaura las preferencias originales y sale.
- Cuatro transiciones del ejecutable completadas sin errores comunicados por la región. No equivalen a medir frames presentados, fluidez perceptiva o clics a través de bordes.
- No se publican instaladores, ejecutables, releases ni resultados de rendimiento no medidos. Siempre visible y autostart no se activan.
