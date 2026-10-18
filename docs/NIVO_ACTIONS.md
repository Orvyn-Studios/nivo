# Nivo Actions — desarrollo por fases

Base auditada: `54fb85c`, ejecutable Windows SHA256 `128b0d4124644f8d9358987e6756c01d2561c11b6b27a00316cc30969c4e74fb`. Rama de desarrollo; no main, releases, Actions ni StarOptimizer. La base ya conserva el motor de movimiento interrumpible, visibilidad por defecto encima de apps, mascota original, GSMTC/CoreAudio y canal local autenticado. README/PHASE_STATUS contienen tamaños y bloqueos históricos: prevalecen MUSIC_POLISH, MOTION_ENGINE y VISIBILITY.

## Fase 1: contrato y auditoría

Se reutilizan las capabilities de archivos nacidas de un drop nativo. JavaScript recibe IDs/nombre/tamaño, nunca autoridad sobre una ruta arbitraria. Las acciones se describen por ID, contexto, nombre, selección, permiso y cancelación en `src/actions.ts`. Ejecución y progreso nativo se separan de la presentación. `src-tauri/src/actions.rs` limita las operaciones a una activa, progreso por bytes con máximo 20 eventos/s durante lectura y cancelación acotada. Los resultados son tipados: éxito confirmado, cancelación o error, sin porcentajes simulados.

Auditoría de Drop: el ZIP anterior usaba Stored (sin compresión); copia/ZIP eran seguros contra sobrescritura, pero sin cancelación/progreso. El frontend reconstruía filas al volver a renderizar, podía borrar el estado de una operación y descartaba el estado anterior al recibir archivos. Se conserva selector nativo, creación exclusiva, archivos originales y validación local; se amplía su flujo.

La línea base de consumo se registra localmente en `artifacts/actions/before-performance` (120 s, producción sin CDP, proceso propio más WebView2). Es una muestra corta de un escritorio compartido; no prueba ausencia de fugas ni frames presentados.

## Integraciones y alcance

El usuario ha indicado que no dispone de una GitHub App/OAuth App. La especificación posterior de GitHub 1.0 cambia la primera conexión a PAT fine-grained, validado contra GitHub y guardado en Windows Credential Manager. No se presentará autenticación real como verificada sin un token autorizado. No se reutilizan credenciales del conector de Codex en el producto. No se instala ningún hook o extensión sin una elección explícita del usuario. No se implementa Wardrobe ni se rediseña la mascota.

## Fase 2: Drop avanzado

Implementadas tarjeta con nombre/tipo/tamaño/icono, acciones secundarias desplegables, selector de destino existente, ZIP Deflate nivel 3 y copia por bloques de 256 KiB. Límite de seguridad 512 MiB por operación; una operación activa, comprobación de cancelación entre bloques y limpieza de destinos parciales propios. Los originales no se modifican ni se sobrescribe un destino existente. El resultado obtiene su propia capability local acotada para abrir su carpeta; al desactivar Drop se revoca y cancela la operación. El ZIP se confirma tras finish/sync_all, no al llegar al 100 % de lectura.

Se conservan/restauran intención anterior y sesión musical al cancelar el arrastre o pulsar Listo. No se envían órdenes de reproducción. El estado de una operación no se reinicia por volver a renderizar preferencias. Las expresiones existentes reflejan atención, trabajo, resultado y error; ningún asset de mascota cambia.

Verificación intermedia: 85 Node, 55 Rust y una ignorada, typecheck, Clippy y las suites generales/musicales. Cinco capturas de acciones con fixtures explícitos: arrastre, archivo, progreso medido, resultado y cancelación. Las pruebas de Rust crean un ZIP Deflate real, comprueban tamaño reducido, Unicode, lectura de contenido, rechazo de sobrescritura, revocación y limpieza al cancelar. La prueba UI asegura restauración musical sin comandos multimedia. La aceptación nativa OLE/selector de esta fase está pendiente; no se confunde con un arrastre desde Explorador.

Los flujos de correo básicos solo preparan el cliente: nunca afirman adjuntar con mailto ni enviar. Compartir usa únicamente mecanismos oficiales compatibles y una acción deliberada. Las APIs avanzadas de correo y OAuth requieren sus propios consentimientos; no se transmiten archivos durante pruebas.

## Correo básico y continuidad

«Más acciones → Redactar correo» abre un compositor dentro de la isla: destinatario,
asunto y mensaje escritos por el usuario. El comando nativo valida tamaños y evita
inyección de cabeceras, escapa UTF-8 y abre exclusivamente un URI mailto. La UI
indica antes de abrir que el archivo debe adjuntarse manualmente; no adjunta, envía
ni confirma entrega. No se guardan borradores ni se consultan cuentas de correo.
El botón de compartir permanece ausente hasta tener una implementación oficial
probada; no hay una acción vacía que prometa compartir. Correo avanzado pendiente.

Abrir la carpeta del resultado recupera ahora el contexto anterior, como Listo.
Durante el cierre normal se impiden nuevos trabajos, se solicita cancelación y se
esperan hasta dos segundos para la limpieza. Un cierre forzado o disco bloqueado
puede interrumpir esa limpieza; no se promete eliminar parciales tras matar el proceso.

La coreografía y las nuevas pruebas se detallan en LIVING_ISLAND.md y la integración
de GitHub en GITHUB_INTEGRATION.md. El arnés OLE experimental no ha completado su
arrastre en esta sesión; su fallo se registra y no se interpreta como aceptación
de Explorer, del selector nativo o del flujo ZIP completo del ejecutable.

Los eventos de agente reflejan turnos, no proyectos completos. Un nuevo estado
working después de un estado terminal abre otro ciclo del mismo ID de sesión,
con una huella de aviso distinta; duplicados terminales y estados waiting tardíos
no reabren el ciclo. Se requiere el orden del proveedor local: sin un identificador
de turno original, no se puede atribuir un Stop retrasado a otro turno solapado.
No se leen prompts/transcripciones para intentar inferir esa asociación.
