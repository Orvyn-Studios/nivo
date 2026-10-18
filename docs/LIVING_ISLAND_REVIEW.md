# Revisión de continuidad — 18 de octubre de 2026

Se revisó primero `feature/nivo-mvp`, limpia en `fd2e27d`. Se conservaron el
motor de resortes, HRGN, proveedores, tarjeta compartida de Drop y dibujo de la
mascota blanca. Sin Wardrobe, nuevas funciones de producto, cambios de `main`,
force-push, releases ni ejecuciones de GitHub Actions.

## Defectos observados y corregidos

- El resultado ZIP conservaba el icono PDF y el tooltip anterior. Nombre, tipo,
  tamaño, icono y tooltip ahora corresponden al resultado, sobre la misma tarjeta.
  Se retiró la repetición del mensaje de éxito en dos líneas distintas.
- Progreso y resultado podían superponer texto. La salida dura 60 ms; la entrada
  permanece transparente durante ese intervalo real. El easing se aplica después
  de esa espera visual, sin retrasar datos, operaciones, geometría o controles.
- Al volver a música aparecía la portada sobre el contexto saliente. La entrada
  del panel completo participa ahora en la coreografía existente, conservando los
  nodos originales y la animación de la portada.
- La altura nueva del scroll cortaba los controles musicales salientes. Durante
  esa salida, el scroll deja el recorte a la silueta de la isla/HRGN; vuelve a su
  comportamiento normal al terminar. No amplía la región nativa de interacción.
- Un aviso saliente con `min-height:100%` se recentraba contra la altura entrante.
  Sus mínimos se neutralizan durante la salida y se restauran después; no queda
  un tamaño congelado al invertir la transición.
- El contenido saliente se anclaba al borde de un panel cuyo ancho ya había
  cambiado. Ahora se ancla al centro fijo de la isla. Las secuencias comprueban
  que su desplazamiento lateral sea menor de 1 DIP durante la salida.
- El inicio de trabajo de Codex llamaba a render directamente y podía saltarse
  la transición de superficie. Ahora pasa por el controlador existente. Al llegar
  el resultado se conserva el contenido de trabajo saliente durante su fade,
  evitando sustituirlo anticipadamente por «Todo en calma».

## Evidencia temporal reproducible

`node test/living-transitions.mjs` y su variante PowerShell
`$env:NIVO_MOTION='reduced'; node test/living-transitions.mjs` validan 23 secuencias
por modalidad: Drop archivo/progreso/resultado/restauración, música/volumen,
Codex trabajo/resultado/restauración, micrófono, dispositivo, teclado, batería,
descarga/resultado, mezclador y compacto/expandido.

Cada una guarda estado previo, seis PNG intermedios/finales, identidad de la
tarjeta, geometría, animaciones y controles salientes inertes. Se comprueban IDs
únicos, un solo footer, ausencia de restos al terminar y restauración sin órdenes
de reproducción. `transitions.webm` muestra las secuencias completas; las hojas
`filmstrip*.png` permiten revisar antes/durante/después. Los tiempos muestreados
encuadran la solicitud/respuesta del PNG; no representan la exposición de DWM.

**Todos esos proveedores y los bytes/resultados ZIP son fixtures explícitos**,
rotulados en el vídeo. No se presentan como arrastre Explorer, compresión nativa,
cuenta GitHub real o medida de FPS. Salida local: `artifacts/living-review/`.

`node test/github-ui.mjs` también guarda `github-context-fixture.webm`, con una
cuenta, PR, revisión/CI y calendario sintéticos; navegación y desconexión sin
autenticación ni red real. Las pruebas generales de UI y música siguen pasando.
El viewport del vídeo permanece fijo: se evitó el recorte artificial que las
capturas de un elemento producían en el screencast de Chromium durante la prueba.

El estrés extendido `review-final-browser` pasó 77 acciones, inversiones,
preparación retrasada, cambios de contexto, reducción de movimiento y ocultación
durante vuelo. Su única long task de 65 ms es el bloqueo intencional del test.
Se conserva el vídeo, sin confundir sus callbacks RAF con frames presentados.

## Windows y sincronización

Fuente funcional final `80aa25d`, ejecutable SHA256
`b552e2c87fb2b08cedacebe0fae2e0f10620b531f15dd1a9ef93ee6a522a4f7d`.
La pasada `review-accepted-native` pasó 72 acciones (30 ciclos y 12 inversiones),
con 1294 muestras HRGN (175 siluetas distintas) y cero hits fuera de la silueta/esquinas redondeadas.
Backing fijo de 420 × 352; DPI observado 96. Preferencias restauradas al finalizar.

RAF observado: p95 4,3 ms, máximo 68 ms; cero long tasks en esa pasada.
Preparación máxima de tracks en las últimas 32 transiciones retenidas: 1,2 ms.
El escritor de superficie registró máximo histórico de ack 6,3 ms y cero paquetes
obsoletos en esas transiciones. El wrapper IPC del test **no interceptó** el bridge
capturado al inicio: sus muestras vacías son indisponibilidad, no coste cero.

Estos datos son callbacks, confirmaciones y regiones Win32, no fotogramas DWM
presentados ni una garantía de fluidez o 240 FPS. No se acredita aquí una sesión
larga, juegos exclusivos, Alt+Tab o monitores físicos con DPI mixto. Se conserva
el intervalo máximo observado de 68 ms, sin ocultarlo ni atribuir una causa no medida.

## CPU y memoria

Tres muestras seriales de 120 segundos, cinco segundos de preparación y 60
registros cada una. Base `fd2e27d` (SHA `63736948…`), compilación intermedia
`927a0f0` (SHA `dcdfdbbb…`) y final `80aa25d` (SHA `b552e2c8…`). Mismas
preferencias persistidas y proveedores Windows; sin CDP ni builds/pruebas de
navegador durante cada intervalo. Entre las muestras hubo compilación y validación;
no son una pareja inmediatamente consecutiva ni un escritorio aislado.

| Medida del árbol de procesos | Base | Intermedia | Final |
| --- | ---: | ---: | ---: |
| Registros / intervalos CPU incompletos | 60 / 1 | 60 / 1 | 60 / 1 |
| CPU media normalizada, intervalos válidos | 0,01150 % | 0,01970 % | 0,00601 % |
| CPU máxima de un intervalo válido | 0,2542 % | 0,3810 % | 0,1268 % |
| Working set sumado, mediana | 379,55 MiB | 381,40 MiB | 374,79 MiB |
| Memoria privada comprometida, mediana | 165,79 MiB | 165,14 MiB | 159,11 MiB |

La suma de working sets cuenta páginas compartidas más de una vez; compromiso
privado es otra medida, no RAM residente que se deba sumar. La variación no prueba
una optimización, una mejora causal de CPU o ausencia de fugas: solo una muestra
breve por compilación en un escritorio compartido, sin potencia ni sesión larga.

Datos originales y definiciones en `artifacts/actions/performance-pair/`:
`2026-10-18T19-46-46-503Z` (base/intermedia) y
`2026-10-18T19-54-01-957Z` (final, ejecución explícita `--current-only`). Esta última
no mide de nuevo la base; su JSON lo indica. CSV y JSON incluyen las identidades
de los procesos y hashes; el auxiliar cerró normalmente solo su PID/ruta propios.

## Explorer, ZIP y cuenta real

El auxiliar WinForms/OLE anterior no completó la entrega. En esta revisión,
computer-use pudo localizar Explorer, pero no una ventana operable de Nivo tras
el reintento. La copia iniciada para esa comprobación se cerró normalmente.
**No se declara aceptado el arrastre real ni el flujo completo del selector/ZIP.**

[MANUAL_DROP_ACCEPTANCE.md](MANUAL_DROP_ACCEPTANCE.md) contiene la prueba exacta,
criterios por paso, cancelación, restauración de música, movimiento reducido y
registro de fallos/no ejercitado. `python test/manual-drop.py prepare` ya preparó
archivos Unicode, binarios y un caso de 128 MiB, con tamaños y SHA256. El verificador
independiente pasó una prueba positiva con un ZIP generado por Python y rechazó
uno incorrecto; esa autocomprobación tampoco acredita el ZIP producido por Nivo.
Los tests Rust sobre archivos reales de Deflate/cancelación siguen pasando.

GitHub real queda pendiente de autorización expresa y de que el usuario introduzca
el token directamente en Nivo. No se ha solicitado, leído ni utilizado un PAT real.

## Comprobaciones

93 tests Node, TypeScript, Rustfmt, 67 tests Rust (uno de audio del entorno omitido),
Clippy con warnings como errores y compilación local de Windows. Referencias y
`origin` actualizados a `https://github.com/Orvyn-Studios/nivo.git`; identidad de
commits `SnoW-099 <ryze0910@gmail.com>`. Los binarios, perfiles y vídeos permanecen
como evidencia local ignorada, sin publicaciones automáticas.
