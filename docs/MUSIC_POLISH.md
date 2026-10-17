# Nivo Music · acabado final

Base: `297d3a0`, rama `feature/nivo-mvp`. Autor y committer: `SnoW-099 <ryze0910@gmail.com>`.

## Auditoría y duplicados

La auditoría encontró dos procesos visibles de Nivo: PID 22476 (`nivo-corregido-cd98a19`) y PID 20440 (`nivo-sin-selector-297d3a0`). Había dos ejecutables superpuestos; el HTML solo contenía un `activity-footer`, un botón de audio y uno de preferencias. `mountIcons` sustituye los hijos, no añade otra fila. Los dos procesos se cerraron mediante el cierre normal de su ventana, sin terminarlos por fuerza.

`InstanceGuard` mantiene un objeto de exclusión de Windows durante la vida de la aplicación, con un nombre estable dentro de la sesión de escritorio. Otra copia del nuevo ejecutable sale antes de crear ventanas o proveedores. El kernel libera el identificador al salir, incluso si termina el proceso. Los hosts de mensajería nativa conservan su entrada independiente y no pasan por este guard.

Las versiones antiguas carecen de esta protección: deben permanecer cerradas al evaluar la copia nueva. No se modificaron ni borraron sus ejecutables.

El reproductor también tiene ahora un único grupo de acciones compartidas: se mueve el mismo nodo entre el pie general y la fila de reproducción. No se clona ni se oculta una segunda fila. Las pruebas comprueban un grupo, un botón y un SVG por acción después de transiciones y cambios de vista, además del arranque desde otra carpeta.

## Composición y movimiento

- Vista musical: 360 × 172 DIP con datos temporales válidos; 360 × 140 sin ellos. Antes: 360 × 202 / 174. Las demás geometrías no cambian.
- Portada de 56 × 56, `object-fit: cover`; se mantienen la composición y el botón blanco central. Anterior, reproducción y siguiente tienen áreas de 36 × 36, separación de 12 DIP y centro geométrico común. Las acciones secundarias tienen áreas de 32 × 32.
- Los dos tiempos coinciden con los extremos de la barra, sin el antiguo relleno de 70 DIP. Números tabulares, formato `h:mm:ss` para duraciones largas y ningún avance inventado. Cuando faltan posición o duración, se ocultan y limpian los tiempos.
- La portada local se decodifica antes de sustituir conjuntamente imagen y metadatos. Una revisión invalida resultados antiguos; el plazo de un segundo deja un fallback si la decodificación no termina. Una imagen anterior permanece mientras llega la siguiente. No se cargan recursos remotos.
- Entrada coordinada del bloque musical: 170 ms, opacidad parcial y desplazamiento de 2 DIP. Play/Pausa se funden durante 100–130 ms. Las animaciones anteriores se cancelan y no pueden restaurar un estado obsoleto. No hay sondeo o animaciones permanentes.
- Se conserva el motor de expansión con máscara y geometría nativa, su interrupción y su movimiento reducido. El movimiento reducido o la ocultación cancelan las animaciones musicales. La mascota, sus SVG y su comportamiento no se modifican.

El usuario confirmó expresamente **mantener eliminado el selector**. Se conserva la sesión activa comunicada por Windows. Por eso no se genera una captura de selector abierto ni se añade otro menú; sí se comprueban varias sesiones del mismo título, con identificadores diferentes y comandos dirigidos al identificador activo.

## Validación ejecutada

| Comprobación | Resultado |
| --- | --- |
| `npm run verify` | Aprobado: 76 pruebas Node, TypeScript, Vite, Rustfmt, 51 pruebas Rust, Clippy sin advertencias y build release con recursos incrustados. |
| Prueba Rust omitida | Una prueba de audio físico optativa permanece omitida por defecto. El proveedor real se consulta en el ensayo nativo. |
| `npm run test:ui` | Aprobado: suite general y nueva suite musical. 20 capturas generales y 12 musicales, con fixtures identificados. |
| Portadas y metadatos | Portada correcta, ausente y dañada; título largo; horas; tiempo desconocido; capacidades deshabilitadas; decodificaciones terminadas en orden inverso; movimiento reducido. |
| Composición | Una fila de acciones; controles centrados; inicio y final de tiempos con error inferior a 1 DIP; sin desbordamiento de la vista musical; rueda conservada para listas largas de otras vistas. |
| Release Windows / WebView2 | Aprobado con dos sesiones GSMTC reales y una activa: una fila, tiempos con desviación 0 DIP y altura 172. No se enviaron comandos de reproducción al reproductor real. |
| Segunda copia | Una copia del mismo binario en otra carpeta sale con código 0; la primera continúa. El host de mensajería nativa sigue funcionando. |
| Región HWND real | Expandido: 359 × 171 píxeles; compacto: 111 × 33 al 100 % de DPI. Coincide con 360 × 172 y 112 × 34 dentro de dos píxeles de redondeo GDI. Esquinas transparentes fuera; centro dentro. |
| Regresiones nativas | Preferencias, guardado y Escape, capabilities, Core Audio de lectura, canal autenticado, mensajería nativa, transiciones y salida normal con código 0. Preferencias originales restauradas. |

Binario validado: SHA-256 `c714ea6107b6e68fc2abae08c5c4b3187cad0e40b6be9cf249bc4230a681e6a8`.

`test/music-polish-review.mjs` compone las capturas en HTML y vuelve a fotografiar esa composición. Se revisaron las doce variantes y el antes/después; las imágenes del reproductor no se retocan. La captura nativa usa datos reales de Windows y se entrega separada de los fixtures.

## Límites y pendientes

No se acreditan varios monitores con DPI físico mixto, juegos/pantalla completa, Alt+Tab entre aplicaciones, Narrador, suspensión ni sesiones prolongadas. No se ha repetido una medición de CPU/RAM/FPS. La medición anterior de memoria por encima de 150 MB sigue pendiente de optimización; este acabado no acredita ese objetivo.

La comprobación de reposo del cursor comparte el escritorio con el usuario: dos intentos recibieron tres eventos adicionales durante 150 ms y no completaron esa aserción. Se añadió el registro de posiciones; el ensayo final pasó sin eventos adicionales. No se bloqueó la entrada del usuario y ese intervalo no constituye una medición de rendimiento prolongada.

No se publica una release, se dispara CI ni se modifica `main`. Las imágenes de prueba y el ejecutable se entregan localmente.
