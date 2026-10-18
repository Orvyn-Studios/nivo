# Living Island — continuidad de contenido

## Auditoría y primer alcance

El motor existente ya conserva posición y velocidad de la superficie nativa al
interrumpirse, usa una región HWND como silueta de pintura e interacción y comparte
la portada musical. No se sustituye. La discontinuidad de Drop estaba dentro del
panel: ocultaba toda la lista al empezar y sustituía el archivo por texto de resultado.
Además, cualquier resultado, incluida una cancelación, activaba alegría.

`src/choreography.ts` añade una capa pequeña de contenido: captura posiciones
compositadas antes de mutar, cancela la transición anterior y aplica FLIP de posición
y opacidad con WAAPI. No escala texto, clona vistas, incorpora dependencias ni
espera promesas visuales para aceptar un resultado real. Perfiles instant, soft,
completion y dismiss son finitos; la superficie conserva sus resortes actuales.

Drop mantiene la misma tarjeta y cabecera durante acción, progreso y resultado.
Los controles secundarios se retiran y la región de progreso entra en la misma
superficie. El resultado actualiza la tarjeta con la capacidad del archivo creado.
Una copia o ZIP muy breve puede interrumpir inmediatamente la entrada. Los bytes
siguen siendo los informados por Rust; no existe duración artificial de operación.
La mascota del encabezado reutiliza el SVG y las expresiones originales; cancelar
recupera atención y solo un resultado confirmado activa alegría. Ocultar, reducir
movimiento y desmontar cancelan el trabajo visual.

La misma capa retira los contextos salientes (música, HUD, agente, Drop y GitHub)
reutilizando sus nodos originales durante un fade breve, fuera del flujo, sin
interacción ni exposición a accesibilidad. Al interrumpirse, la limpieza no puede
ocultar el nuevo estado. La entrada sigue coordinada por IslandMotion, incluso si
dos contextos tienen idéntica geometría. Los controles preparados permanecen
utilizables durante la animación; el hit testing nativo sigue limitado a HRGN.
Cambios de privacidad y desconexión limpian sin retener una salida animada privada.

## Evidencia intermedia

- 92 tests Node y TypeScript correctos.
- 67 tests Rust correctos; uno de audio del entorno omitido explícitamente.
- Fixture visual de Drop correcto con movimiento reducido y normal.
- `artifacts/actions/motion/*.webm`: grabación de Chromium con operación y música
  **simuladas explícitamente**, no prueba de ZIP nativo ni medida de FPS de Windows.
- Tests de coreografía: interrupción desde posición compositada, resultado rápido,
  cancelación, reducción de movimiento, ocultación y liberación al desmontar.

- Estrés temporal extendido `living-context-stable-browser`: 77 acciones,
  30 ciclos, 12 inversiones, cambios música/HUD, avisos, Drop, agente, movimiento
  reducido y ocultación durante vuelo; recuperación tras bloqueo intencionado de
  65 ms. Vídeo y secuencias guardados. Los intervalos RAF no son FPS presentados.

Siguen pendientes pruebas temporales nativas de Drop y validación con una cuenta
GitHub real. El auxiliar OLE
no completó el arrastre en este entorno (ni devolvió las callbacks esperadas);
se registra como prueba fallida, sin afirmar que haya validado Explorer o ZIP nativo.
Se conserva la preferencia de visibilidad elegida; esta fase no activa topmost.

## Aceptación Windows del 18 de octubre de 2026

Fuente funcional `ddc1e6c`, SHA256
`63736948880bf4dd40aa16c1e70980f5241613c02732dadffc49dc58aacc1866`,
Windows x64, 4.393.984 bytes. `npm run verify` pasó y la suite WebView2 real pasó
para ese hash: instancia única, foco conservado en otra HWND, visibilidad normal y
pantalla completa sin bordes, opción de ocultar/restaurar, mirada en ambos extremos
del escritorio, ausencia de eventos repetidos en reposo breve, movimiento reducido,
chevron ratón/teclado, ACL, preferencias, canal local con fixtures explícitos y
región nativa con esquinas/padding no interactivos. La sesión GSMTC real conservó
la altura de 172 DIP y tiempos alineados; sin órdenes de reproducción.

Se corrigió un defecto detectado durante la aceptación: dos eventos de entrada
coalescidos podían emitir la misma posición. El observador deduplica ahora píxeles
sin añadir polling. También se habilita la flecha solo tras confirmar ready nativo.

Comparación secuencial de movimiento con la base `54fb85c`, mismo escritorio y
proveedores desactivados temporalmente en ambas versiones (preferencias restauradas):

| Observación | Base | Nueva |
| --- | ---: | ---: |
| Acciones / inversiones | 72 / 12 | 72 / 12 |
| Muestras de HRGN | 3428 | 3426 |
| Hits en exterior/esquina redondeada | 0 | 0 |
| Primer cambio de región, mediana aprox. | 11,72 ms | 12,17 ms |
| Primer cambio de región, p95 aprox. | 16,79 ms | 15,81 ms |
| Intervalo RAF p95 observado | 4,3 ms | 4,3 ms |
| Máximo intervalo RAF observado | 20,8 ms | 25,0 ms |
| Long tasks durante esos ciclos | 0 | 0 |

Los tiempos de región tienen cuantización de unos 5 ms y error de alineación de
relojes. Una pasada por versión, escritorio compartido, sin significación estadística.
Son regiones y callbacks; no son píxeles presentados por DWM ni una garantía de FPS.
El indicador DOM firstResponse del arnés no mide el primer cambio visual cuando la
región nativa gobierna la máscara; no se publica como latencia de clic.

Informes: `artifacts/native-ui/native-ui.json`,
`artifacts/motion/living-final-{before,after}-native`,
`artifacts/actions/native-motion-summary.json`. La evidencia de Drop/correo y del
calendario GitHub continúa marcada como fixture, separada de esta aceptación.
No se acreditan juegos exclusivos, Alt+Tab, DPI físico mixto ni uso prolongado.

## Recursos sin depurador

`test/actions-performance.mjs` lanzó ambas versiones secuencialmente, con cinco
segundos de preparación, 120 segundos por versión, intervalo de dos segundos y
cierre normal del PID/ruta propios. Mismas preferencias persistidas; proveedores
Windows reales y GitHub sin configurar. No se ejecutaron builds durante la pareja.

| Medida del árbol observado | Base | Nueva |
| --- | ---: | ---: |
| Muestras / intervalos CPU incompletos | 60 / 0 | 60 / 0 |
| CPU media normalizada | 0,01892 % | 0,01838 % |
| CPU máxima de un intervalo | 0,1279 % | 0,1915 % |
| Working set sumado, mediana | 349,93 MiB | 352,65 MiB |
| Memoria privada comprometida, mediana | 166,39 MiB | 169,16 MiB |

CPU se normaliza por los procesadores lógicos que registra el medidor. Working set
sumado cuenta páginas compartidas más de una vez; compromiso privado es otra
medida y no se suma como RAM residente adicional. La diferencia de unos 2,8 MiB
no demuestra crecimiento sostenido ni una fuga. Tampoco se declara una mejora de
CPU a partir de esta única pareja: actividad del escritorio/proveedores no aislada,
sin sesión prolongada y sin medir potencia o FPS presentados.

CSV, metadatos, definiciones y resumen:
`artifacts/actions/performance-pair/2026-10-18T10-41-34-505Z`.

## Alcance entregado y aceptación pendiente

Código y commits en feature/nivo-mvp, con autor y committer
SnoW-099 <ryze0910@gmail.com>. Sin cambios de main, force-push, releases ni Actions.
La mascota, su dibujo, el reproductor y las preferencias anteriores se conservan.

La coreografía, acciones ZIP/copia/correo básico y GitHub de solo lectura están
implementados. Quedan pruebas con un PAT real introducido en la aplicación y el
flujo OLE/selector completo: el auxiliar de arrastre no consiguió entregarlo en esta
sesión y sus resultados fallidos se conservan. No se ha enviado correo real ni se
ha verificado un cliente de correo concreto. Compartir y correo avanzado no se
ofrecen como funciones conectadas. Sin metadata explícita verificable, tampoco se
ofrecen acciones de proyecto/PR inventadas para Codex ni proveedores simulados.
