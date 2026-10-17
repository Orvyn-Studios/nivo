# Compa?ero blanco de Nivo

Silueta vectorial original: peque?a piedra suave con una cresta desplazada, base estable y volumen blanco roto mediante un gradiente de tres tonos. Sin orejas, extremidades, filtros, texturas o im?genes externas. Los ojos oscuros tienen brillo peque?o y proporciones distintas seg?n atenci?n; la boca sigue siendo secundaria.

## Estados y prioridad

1. `complete`: temporizador finalizado, ojos curvos y sonrisa; elevaci?n ?nica de 240 ms.
2. `timer`: temporizador activo o pausado; mirada concentrada. La pausa sigue expres?ndose en el texto de la UI.
3. `unavailable`: proveedor nativo multimedia indisponible con integraci?n activada; asimetr?a leve y gesto de duda. La vista web y un reproductor vac?o no implican error.
4. `music`: reproducci?n real; sonrisa y balanceo ?nico de 320 ms al entrar.
5. `focus`: panel o aviso abierto; mirada atenta.
6. `hover`: isla bajo el cursor; inclinaci?n leve y curiosidad.
7. `quiet`: reposo sereno, sin respiraci?n ni parpadeo peri?dico.

El movimiento reducido conserva estas expresiones sin seguimiento, transiciones ni reacciones WAAPI. No hay un estado adicional de sue?o con temporizador de inactividad: el reposo calmado cumple esa funci?n sin a?adir trabajo programado.

## Integraci?n y mantenimiento

`companion-state.ts` resuelve la prioridad; `components/companion.ts` controla recursos de interacci?n y reacciones finitas; `styles.css` aplica poses mediante atributos. Mirada, parpadeo y forma corporal tienen capas separadas para evitar que sus transformaciones se sobrescriban. El markup conserva ambas instancias con gradientes de ID ?nico.

Sin m?sica, aparece en compacto y cabecera expandida. Con sesi?n multimedia, el compacto prioriza portada o logo del reproductor; el compa?ero vuelve al expandir. Bienvenida solo sin sesi?n y en Actividad, sin animar cuando est? oculta. Desactivarlo restaura el logo; se respeta la preferencia guardada. Ninguna API, permiso ni integraci?n nativa cambia.

Transiciones de pose de 160 ms, sin bucles. RAF solo cuando llega movimiento del cursor; se agrupan eventos y se cachea geometr?a. Cambiar estado, ocultar, reducir movimiento o desactivar cancela trabajo pendiente. Los renders repetidos no reinician reacciones.

## Validaci?n y l?mites

64 pruebas Node, tipos, build y pruebas Chromium aprobados; capturas en `artifacts/` regenerables con `npm run test:ui`. La galer?a est? etiquetada como fixture de pruebas y nunca se a?ade a la aplicaci?n distribuida.

El resultado se distingue de la base azul por silueta, volumen, ojos y expresiones, y se ha inspeccionado a tama?o real. La valoraci?n est?tica final corresponde al usuario. Falta aceptaci?n de esta revisi?n en WebView2/Windows, con m?sica real, escalas DPI y medidas de consumo. En esta torre faltan Rust/Cargo y MSVC; no se presenta la vista de navegador como ejecutable validado.
