# Compañero minimalista de Nivo

Revisión del 17 de octubre de 2026 tras la petición de simplificar el diseño y diferenciar las expresiones. Sustituye el acabado perlado anterior.

Una sola silueta blanca mate, suavemente asimétrica y con base estable. Sin cresta, gradientes, brillos, reflejos ni sombra decorativa. La cara usa dos ojos; la boca solo aparece para completado o duda.

## Expresiones y prioridad

1. `complete`: temporizador finalizado; ojos en arco hacia arriba y sonrisa pequeña. Elevación única de 240 ms.
2. `timer`: temporizador activo o pausado; trazos inclinados hacia el centro que expresan concentración. La UI distingue la pausa mediante texto.
3. `unavailable`: proveedor multimedia nativo indisponible; un ojo redondo, otro oblicuo y boca ladeada. Una vista web o reproductor vacío no implican error.
4. `music`: reproducción real; ojos cerrados en curva relajada, sin boca. Inclinación y balanceo único de 320 ms al entrar.
5. `focus`: panel abierto; ojos altos, más juntos y centrados, sin boca.
6. `hover`: curiosidad; un ojo pequeño y otro más abierto y elevado, con inclinación leve.
7. `quiet`: reposo; dos puntos pequeños y separados, sin boca ni movimiento periódico.

Cada estado tiene geometría propia dentro de `companion-eyes`; no depende de pequeñas variaciones de escala de la misma cara. El parpadeo incluye ahora también las expresiones de música y completado. El movimiento reducido conserva las formas estáticas, sin seguimiento ni reacciones.

## Integración y rendimiento

Se conserva la separación entre resolución de estado (`companion-state.ts`), interacción (`components/companion.ts`) y presentación (SVG/CSS). Mirada, parpadeo y cuerpo siguen en capas distintas.

Sin música, aparece en compacto y cabecera expandida. Con sesión musical, el compacto prioriza portada o logo; la mascota vuelve al expandir. Bienvenida solo sin sesión y en Actividad. Desactivarla restaura el logo y respeta la preferencia guardada.

No se añaden dependencias, listeners ni temporizadores. RAF solo ante movimiento local, con eventos agrupados y geometría cacheada; se cancela al ocultar, desactivar o reducir movimiento. La inclinación cambia mediante una transición de 160 ms; la cara cambia directamente para evitar superponer expresiones. No hay bucles en reposo.

## Validación

`npm run verify:web`: 64 pruebas, tipos y build aprobados. `npm run test:ui`: aprobado en Chromium con sandbox, incluidos temporizador, preferencias, movimiento reducido y viewport de 320 px. La galería verifica una única expresión visible por estado a ambos tamaños y permite revisar las diferencias con el SVG y CSS reales.

Capturas inspeccionadas: compacto 112×34, expandido 388×320 y siete expresiones a 24 px y 52 px. Los fixtures solo viven en las pruebas. La aceptación del ejecutable WebView2, DPI, música real y consumo nativo sigue pendiente: esta torre carece de Rust/Cargo y MSVC.
