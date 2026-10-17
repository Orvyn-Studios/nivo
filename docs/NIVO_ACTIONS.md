# Nivo Actions — desarrollo por fases

Base auditada: `54fb85c`, ejecutable Windows SHA256 `128b0d4124644f8d9358987e6756c01d2561c11b6b27a00316cc30969c4e74fb`. Rama de desarrollo; no main, releases, Actions ni StarOptimizer. La base ya conserva el motor de movimiento interrumpible, visibilidad por defecto encima de apps, mascota original, GSMTC/CoreAudio y canal local autenticado. README/PHASE_STATUS contienen tamaños y bloqueos históricos: prevalecen MUSIC_POLISH, MOTION_ENGINE y VISIBILITY.

## Fase 1: contrato y auditoría

Se reutilizan las capabilities de archivos nacidas de un drop nativo. JavaScript recibe IDs/nombre/tamaño, nunca autoridad sobre una ruta arbitraria. Las acciones se describen por ID, contexto, nombre, selección, permiso y cancelación en `src/actions.ts`. Ejecución y progreso nativo se separan de la presentación. `src-tauri/src/actions.rs` limita las operaciones a una activa, progreso por bytes con máximo 20 eventos/s durante lectura y cancelación acotada. Los resultados son tipados: éxito confirmado, cancelación o error, sin porcentajes simulados.

Auditoría de Drop: el ZIP anterior usaba Stored (sin compresión); copia/ZIP eran seguros contra sobrescritura, pero sin cancelación/progreso. El frontend reconstruía filas al volver a renderizar, podía borrar el estado de una operación y descartaba el estado anterior al recibir archivos. Se conserva selector nativo, creación exclusiva, archivos originales y validación local; se amplía su flujo.

La línea base de consumo se registra localmente en `artifacts/actions/before-performance` (120 s, producción sin CDP, proceso propio más WebView2). Es una muestra corta de un escritorio compartido; no prueba ausencia de fugas ni frames presentados.

## Integraciones y alcance

El usuario ha indicado que no dispone de una GitHub App/OAuth App: se preparará una configuración guiada, sin presentar autenticación de cuenta como verificada. No se reutilizan credenciales del conector de Codex en el producto. No se instala ningún hook o extensión sin una elección explícita del usuario. No se implementa Wardrobe ni se rediseña la mascota.

Los flujos de correo básicos solo preparan el cliente: nunca afirman adjuntar con mailto ni enviar. Compartir usa únicamente mecanismos oficiales compatibles y una acción deliberada. Las APIs avanzadas de correo y OAuth requieren sus propios consentimientos; no se transmiten archivos durante pruebas.
