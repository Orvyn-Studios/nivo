# Motor de movimiento — 17 de octubre de 2026

Implementación de desarrollo en `feature/nivo-mvp`. Código de aplicación: `5c1382e` y `a4302fd`. Autor y committer: `SnoW-099 <ryze0910@gmail.com>`. Se conservan diseño, mascota, proveedores Windows y reproductor 360 × 172/140, carátula 56 × 56 y controles 36 × 36. La sesión sigue siendo la activa de Windows, sin selector.

## Auditoría y cambios

El resorte anterior generaba muestras uniformes y sustituía su último punto por el destino con velocidad cero. Para cerrar de 360 a 112 en 190 ms, la solución natural todavía quedaba 2,775 DIP por encima del destino; el último paso era de −4,708 DIP, con velocidad anterior de −101,14 DIP/s. También se perdía la opacidad de contenido al interrumpir y el cambio de variables semánticas podía redimensionar el DOM antes de preparar la región nativa.

Ahora se usa una solución analítica de resorte críticamente amortiguado por tiempo transcurrido. Una corrección quíntica durante el último cuarto llega exactamente al destino con derivada continua. Los perfiles semánticos son responsive, smooth, gentle, expressive e instant; expressive queda disponible sin modificar las expresiones de la mascota. Las muestras densas finitas se comprimen por error geométrico (prueba <0,03 DIP), sin presuponer una frecuencia de pantalla. WAAPI interpola offsets variables; nunca se integra suponiendo 60 Hz.

Una interrupción conserva geometría, velocidad, opacidad, transformación y origen del contenido. Se congelan dimensiones antes de cambiar el contexto. La intención más reciente sustituye la pendiente; la preparación nativa se serializa y las respuestas antiguas quedan cercadas por revisión/epoch. Un fallo de preparación no descarta la recuperación solicitada desde el manejador de error.

Windows mantiene un backing de 420 × 352 DIP; cambiar entre cápsula y panel ya no redimensiona ni recoloca la ventana. Durante el movimiento, HRGN es la silueta común de pintura y entrada; el modo navegador sigue usando clip CSS. Así se elimina el avance independiente de dos máscaras. Antes de reducir el backing visual se confirma una sola geometría final. Las transiciones no esperan IPC en cada frame: hay un envío en vuelo y una última muestra pendiente, deduplicación en píxeles y descarte de epochs antiguos. Un cambio de DPI/preferencias permite una sola recuperación de epoch, sin bucle de reintentos.

El contenido entra por grupos según el avance geométrico; controles secundarios más tarde. La carátula existente comparte su transformación desde el espacio compacto al expandido, sin clonar controles ni escalar texto. El cierre conserva su presentación saliente hasta terminar. Las filas de integración solo se reconstruyen cuando sus datos cambian. No se añadió dependencia de animación ni sondeo en reposo. El RAF de geometría y medición existe únicamente durante una transición visible y finita; reduced motion y ocultación lo cancelan.

## Medición reproducible

Base inmutable: `f0ee264`, SHA256 `c714ea6107b6e68fc2abae08c5c4b3187cad0e40b6be9cf249bc4230a681e6a8`.

Ejecutable nuevo: fuente `a4302fd`, SHA256 `88627e9b7ddb8fc411d6909d4f690267931100ac93c2b76e8705fb8eaa8ac21f` (3.772.928 bytes). Se compiló con `npm run verify` y se probó ese hash en WebView2 real. El export privado incluye manifiesto y smoke por hash; no es una release.

El arnés `test/motion-benchmark.mjs` hace 30 ciclos completos y 12 inversiones a 18/27/36/45 ms. El modo extendido de navegador prueba música/HUD, eventos consecutivos, Drop, agente, canción cambiada al abrir, reduced motion en vuelo, ocultación y un bloqueo controlado de 65 ms. Esos proveedores son fixtures explícitos. Guarda frames y métricas CDP; `test/native-motion-probe.ps1` lee región y hit testing de la ventana propia durante 20 s. `test/motion-report.mjs` resume JSON y CSV, incluyendo decimales de la configuración regional española.

Ejemplo (PowerShell, cerrar primero la otra copia de Nivo):

```powershell
$env:NIVO_MOTION_MODE='native'
$env:NIVO_MOTION_LABEL='review'
$env:NIVO_MOTION_REGION_PROBE='1'
node test/motion-benchmark.mjs
```

Para reproducir la base, proporcionar `NIVO_MOTION_BINARY` con su ejecutable. `NIVO_MOTION_IDLE_SECONDS=120` añade reposo instrumentado. `NIVO_MOTION_EXTENDED=1` activa las pruebas extendidas en navegador. Los resultados permanecen en `artifacts/motion`, ignorados por Git; se adjunta copia local al ejecutable. No se habilita CDP en el producto ni se registran argumentos/datos de IPC.

### Comparación nativa de movimiento

Una pasada secuencial por versión, mismo escritorio compartido, pantalla declarada por Windows a 240 Hz, DPI 96, WebView2, CDP y sonda de región de 20 s. Base `baseline-compare-native`; nueva `final-region-native`. Ambas registraron 72 acciones y 32 muestras de transición al final (buffer acotado). Son observaciones locales, sin significación estadística ni medición de frames presentados por DWM.

| Medida | Antes | Después |
|---|---:|---:|
| Tamaños cliente observados | 144 × 66 y 420 × 352 | Solo 420 × 352 |
| Muestras nativas | 3.271 | 3.422 |
| Captura en exterior/esquina transparente examinados | 0 | 0 |
| Ventana propia en foreground durante la sonda | 0 | 0 |
| Primer cambio de región, mediana aproximada | 9,77 ms | 11,44 ms |
| Primer cambio de región, p95 aproximado | 23,59 ms | 15,27 ms |
| Tiempo acumulado ScriptDuration de CDP | 1.125 ms | 977 ms |
| Tiempo acumulado TaskDuration de CDP | 6.503 ms | 3.063 ms |
| LayoutCount | 433 | 451 |
| RecalcStyleCount | 4.302 | 4.407 |
| Heap JS final, sin forzar GC | 3,82 MiB | 7,56 MiB |
| Intervalo RAF p95 observado | 4,3 ms | 4,3 ms |
| Máximo intervalo RAF observado | 74,7 ms | 79,9 ms |
| Long tasks >50 ms observadas | 0 | 0 |

Hay menos tiempo acumulado de tarea/script en esta pasada; no se ha eliminado todo layout ni se demuestra mayor FPS. El heap final aumentó en esta captura y depende del momento del GC; no es una medición de fuga. El p95 de primer cambio de región mejora mientras la mediana aumenta ligeramente. La sonda tiene cuantización de unos 5 ms, error de alineación entre relojes y 58/59 aperturas o cierres completos cubiertos, no 60; no mide presentación de píxeles. El máximo RAF incluye arranque/cambio de intención y no mejora en esta pasada. La construcción máxima de track observada después fue 1,2 ms.

El wrapper inyectado para contar IPC no interceptó la referencia capturada al arrancar: cero muestras significa medida no disponible. Se conservan métricas internas acotadas del writer nuevo (coalescing/deduplicación, latencia de acknowledgements), sin inventar un contador comparable de la base. `baseline-ipc-native` se excluye de la comparación porque solo ejecutó tres animaciones antes de quedar sin movimiento; el arnés ahora exige que cada acción llegue al estado solicitado. Una primera `final-compare-native` se excluye porque la enumeración escogió una ventana auxiliar sin HRGN; la sonda ahora selecciona explícitamente una ventana propia visible con región.

Los listeners CDP permanecieron en 48 antes y después del estrés en ambas versiones. Los nodos observados pasaron de 657 a 605 en la base y de 669 a 633 en la nueva; el contador de documentos pasó de 3 a 1 en ambas. Estos snapshots sin GC forzado no certifican ausencia de fugas prolongadas. El buffer de métricas conserva como máximo 32 transiciones y los handlers de controles no se vuelven a registrar en cada render.

### Reposo y memoria

Se miden el proceso propio y descendientes WebView2 cada 2 s. CPU se normaliza entre los 24 procesadores lógicos; working set sumado incluye páginas compartidas repetidas y private bytes es memoria comprometida, no RAM residente que deba sumarse al working set. GPU y procesos compartidos externos no se atribuyen.

Reposo instrumentado tras el mismo estrés, 120 s por versión, proveedores/mascota desactivados:

| Medida | Antes | Después |
|---|---:|---:|
| CPU media normalizada | 0,0332 % | 0,0212 % |
| Working set mediano sumado | 432,13 MiB | 417,14 MiB |
| Private commit mediano | 240,46 MiB | 223,75 MiB |
| Private commit inicial → final | 309,72 → 230,88 MiB | 266,77 → 216,48 MiB |

Son ventanas cortas en escritorio compartido; se ejecutaron otras tareas de desarrollo durante parte de ellas. No son una garantía de consumo ni una prueba de fuga prolongada. La pasada de producción sin CDP se registra por separado: base 120 s con música visible y compilación simultánea, nueva 300 s incluyendo arranque. Sus duraciones/carga externa no son equivalentes; no se presenta una reducción porcentual como causal. El resumen y CSV adjuntos permiten consultar la ventana final de 120 s y los intervalos incompletos de procesos WebView2 que salen.

La pasada nueva sin CDP completó 300,04 s y 148 muestras, con un intervalo de CPU incompleto por salida de un descendiente. CPU media de intervalos válidos: 0,1180 %; pico 2,1199 % durante el arranque. En los últimos 120 s: CPU media 0,0319 %, working set mediano sumado 454,51 MiB y private commit mediano 267,86 MiB. La base de 120 s registró 0,0327 %, 376,68 MiB y 184,14 MiB respectivamente. La memoria de esta pasada de producción es mayor; **no se da por demostrada una mejora de memoria ni ausencia de regresión en uso musical prolongado**. La nueva ejecución incluye calentamiento de WebView2, más tiempo y cambios de canción/sesión real; requiere repetir con calentamiento, contenido y duración controlados antes de atribuir la diferencia al motor. El reposo instrumentado con proveedores desactivados no reproduce ese aumento. Se conserva esta discrepancia explícitamente, sin escoger solo la medición favorable.

## Validación y evidencia

- Verificación local completa: 83 pruebas Node; typecheck, build web, rustfmt, 53 Rust y una ignorada explícitamente, Clippy y compilación Windows release. La ignorada no se da por superada.
- 20 capturas generales y 12 musicales con los componentes reales y fixtures etiquetados. Sin selector, controles únicos, alineación de tiempos, viewport/DPI simulado y movimiento reducido.
- Smoke del hash nuevo: segunda copia rechazada, seguimiento real por ambos extremos del escritorio, reposo del cursor sin eventos, reduced motion desregistra el input, preferencias independientes con ACL, eventos de integración autenticados y sesión GSMTC real. No se enviaron órdenes de reproducción.
- Regiones finales a DPI 96 coinciden con CSS dentro de la cuantización GDI de 1–2 píxeles; centro interactivo, padding y esquinas excluidos. Durante el estrés, 3.422 muestras de región con exterior libre y backing fijo. No sustituye una captura de cada píxel presentado.
- Repetición final `acceptance-native`: 72 acciones superadas con la aserción reforzada de que cada acción alcanza la intención solicitada. Sin long tasks observadas. No se depende únicamente de que hayan terminado las animaciones.
- Estrés extendido del navegador completado; una long task de 65 ms es la carga intencional. Al terminar no queda animación activa ni grupo de acciones duplicado. La grabación `motion-preview.webm` es navegador con fixtures, no vídeo del compositor de Windows. Se conservan también PNG de música/HUD/Drop/agente y capturas de la sesión musical real.

Quedan pendientes juegos y fullscreen reales, Alt+Tab/Narrador con revisión humana, suspensión/reanudación, varias pantallas físicas con DPI mixto y tasas diferentes, sesiones de 30 min o más y medición de presentación DWM/GPU con instrumentación apropiada. Las frecuencias 60/120/144/165/240/280 se verifican en la matemática; solo la configuración actual de 240 Hz fue observada físicamente. No se habilitó topmost, autostart, protecciones nuevas ni workflows; no se modificó main ni se publicaron binarios remotos.
