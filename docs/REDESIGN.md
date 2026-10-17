# Rediseño contextual de Nivo

## Auditoría y continuidad

Punto de partida: `60e1101`, rama `feature/nivo-mvp`, árbol limpio y remoto oficial sincronizado. Leídos AGENTS, README, GITHUB_IMPORT, PHASE_STATUS, contratos Windows y tokens. La primera comprobación del encargo pasa 73 pruebas Node, tipos, Vite y la suite visual anterior con Chromium 153 y sandbox. La evidencia anterior se conserva en `artifacts/redesign-before/`; su validación nativa corresponde al release funcional anterior, sin atribuirle cambios nuevos.

Se conservan Core Audio, GSMTC, energía, Raw Input optativo, canal local autenticado, adaptadores y capacidades de archivos de Drop. Los límites de BITS, carpetas, USB/Bluetooth generales y Compartir no cambian. No se activa topmost, autostart, hooks ni extensiones. No se toca main, Actions, StarOptimizer o las protecciones de Windows.

## Decisiones

- La isla es una superficie contextual. Se retiran navegación con pestañas, marca repetida y preferencias incrustadas. Un clic abre música real, actividad conectada o una pequeña vista de calma con acceso al mezclador y configuración.
- `src/geometry.ts` concentra tamaños semánticos en DIP: calma 260×138, música 360×174/202 según progreso y altura adicional para selector, volumen 300×96, teclado 252×68 y Drop/listas con altura acotada por cantidad. No se mide layout en cada frame.
- `src/tokens.css` reúne paleta semántica, tipografía y espaciado. `contextual.css` contiene las composiciones de la isla; `preferences.css` pertenece a la configuración convencional. Iconos vectoriales originales con una misma línea; sin emojis.
- Preferencias se crea al pedirla y se destruye al cerrar. Siete secciones, con controles anteriores conservados. Escape espera las escrituras iniciadas. Una capability separada permite únicamente ajustes, pantalla/energía y la entrada propia de inicio automático; no permite sesiones de audio, Drop o regiones. La creación es asíncrona por la restricción documentada de WebView2.
- Se mantiene el resorte precalculado con velocidad conservada, cancelación y una envolvente que admite las dos geometrías. Solo máscara/opacidad/transformación animadas; no se escala el texto. La región Win32 utiliza las mismas muestras y rechaza épocas antiguas. Cambiar ajustes o monitor vuelve a adquirir la época, aunque siga expandida.
- La ventana de respaldo expandida sigue acotada a 388×320 más padding. Su región recorta el área interactiva a la superficie visible: no es un rectángulo transparente completo que capture el escritorio. Este contrato debe comprobarse en el HWND real.
- Se elige profundidad interior y borde tenue. La sombra exterior decorativa no se dibuja fuera de la región: se prioriza precisión de interacción frente a una sombra recortada o una ventana auxiliar.
- La mascota conserva su dibujo blanco original, con ojos distintos, postura por estado y reacciones finitas. Acompaña la calma y protagoniza avisos de agente; cede espacio a la carátula. No usa assets o animaciones de Coucou.
- Corregido el uso de `hidden` en SVG: Play/Pausa y el fallback de portada necesitan atributos, no una propiedad HTML sin reflejo en SVG.

## Referencias

[Coucou](https://github.com/Louis-CFM/coucou) se revisa como referencia conceptual de continuidad y carácter. Este rediseño no incorpora código, Mochi, sonidos o recursos nuevos de ese proyecto; el resorte existente conserva su atribución anterior. La referencia no implica copiar su identidad. Para la nueva ventana se consulta la [documentación oficial de WebviewWindowBuilder](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html), incluida su advertencia sobre creación síncrona en Windows.

## Evidencia visual y alcance

`test/redesign-ui.mjs` captura 19 estados mediante componentes y CSS de producción, con proveedores simulados únicamente en el test. Incluye compacto/hover, calma, música, audio, micrófono, dispositivo, teclado, batería, descargas, agentes, Drop y preferencias. Se prueba restauración, comandos, interrupción, movimiento reducido y persistencia. Las simulaciones de viewport/deviceScaleFactor 100/125/150/200 % no equivalen a monitores físicos con DPI mixto.

Los JSON, capturas y comparación anterior/posterior se guardan en `artifacts/`; el informe final identifica los ensayos nativos ejecutados y los pendientes. No se declaran FPS presentados, fluidez subjetiva, compatibilidad con juegos ni aceptación prolongada de memoria a partir de capturas o compilación.

## Entrega por etapas

| Etapa | Código y resultado | Evidencia y estado |
| --- | --- | --- |
| 1 · Auditoría | Historial, permisos, proveedores y preferencias revisados. | Base limpia `60e1101`; 73 pruebas y suite visual anterior aprobadas. |
| 2 · Diseño | `tokens.css`, `geometry.ts`, `components/icons.ts`. | `d272d74`: lenguaje visual y medidas semánticas. |
| 3 · Isla contextual | `index.html`, `main.ts`, `contextual.css`; `preferences.html`, `preferences.ts/css`, `preferences_window.rs`. | `b6084c7`: sin pestañas; configuración independiente con ACL propia. |
| 4 · Movimiento/región | `motion.ts`, `transition.ts`, `window.rs`, `placement.rs`. | `b6e19c7`: se conserva la última silueta al recolocar; nunca se abre temporalmente toda la región de respaldo. Prueba numérica a cuatro escalas. |
| 5 · Mascota | `components/companion.ts`, composiciones de agente y calma. | `277c70d`: postura y reacción finita cuando el aviso ya tiene espacio; reducción de movimiento respetada. |
| 6 · Módulos | Música, mezclador, HUDs, descargas, agentes y Drop. | `b6084c7`/`277c70d`: Play/Pausa SVG corregido, porcentajes por sesión y origen de descarga conocido. `2f06273`: privacidad de nombres aplicada inmediatamente. |
| 7 · Revisión | `redesign-ui.mjs`, `redesign-review.mjs`, capturas y comparación a la misma escala CSS. | 19 estados inspeccionados; eventos simulados explícitamente. Foco/teclado, restauración, privacidad e interrupción comprobados. |
| 8 · Windows y evaluación | `native-ui.mjs`, `native-region.ps1`, `export-private-test.mjs`. | Release con recursos incrustados, ventana independiente, ACL y región HWND comprobables; copia privada con hash y manifiesto. |

## Límites que siguen abiertos

- Aceptación física con varios monitores/DPI mixto, foco entre aplicaciones y Alt+Tab, pantalla completa/juegos, desconexión de pantalla, Narrador, suspensión y arrastre OLE.
- El probe Win32 verifica el HWND real en estados estabilizados y tolera dos píxeles físicos de redondeo/GDI. No acredita cada fotograma del compositor ni clics físicos durante toda una transición.
- El muestreo corto con CDP mide el árbol de procesos observado y suma sus working sets, incluidas páginas compartidas por proceso. No mide RAM física única, GPU o FPS. El objetivo de memoria inferior a 150 MB no se da por cumplido. Es necesario perfilar sin herramientas conectadas y durante sesiones prolongadas; no existe una comparación de rendimiento larga anterior/posterior.
- WebView2 comunica al salir un aviso de desregistro `Chrome_WidgetWin_0` (1412) en el ensayo; la aplicación y sus procesos de prueba salen. No se oculta ese diagnóstico ni se interpreta como una prueba de estabilidad prolongada.

Siguiente hito: revisar la copia privada en el escritorio, perfilar memoria sin depuración y completar la matriz física antes de una beta o distribución. No se publica una release.

## Ajustes de flecha, mirada y desplazamiento

La flecha distingue ratón y teclado: al pulsarla con el ratón no conserva el contorno circular de WebView2 después de usar Escape. La navegación con teclado mantiene su foco visible. Las barras de desplazamiento de la isla se ocultan sin desactivar la rueda, los gestos ni el desplazamiento por teclado de las listas.

La mirada recibe movimientos del escritorio mediante Raw Input de Windows, usando el observador existente. No captura ni bloquea el ratón. Un temporizador de un solo disparo agrupa movimientos a unos 30 envíos por segundo y se cancela tras cada entrega; no hay sondeo en reposo. La posición física se convierte al área cliente y DPI de la isla, admitiendo orígenes negativos. La suscripción se desactiva con la mascota, la visibilidad o el movimiento reducido y se libera al salir. Las coordenadas no se guardan ni se transmiten fuera de Nivo.

`test/native-cursor.ps1`, usado solo en las pruebas locales, mueve el cursor sin pulsar botones. `native-ui.mjs` conserva y restaura su posición, comprueba la mirada en ambos extremos del escritorio fuera de la ventana y contrasta la baja por movimiento reducido. Esto no sustituye la matriz de varios monitores y DPI físicos pendiente.

Comprobado con el release Windows en un escritorio físico de 1920 × 1080 al 100 %: mirada hacia ambos extremos en modo compacto y expandido, sin nuevos eventos con el cursor quieto; movimiento reducido detiene la suscripción. La flecha conserva el foco de teclado y elimina el círculo al pulsar con el ratón. La rueda sigue recorriendo una lista larga sin barra visible en la prueba de interfaz. `verify`, pruebas de interfaz y ensayo nativo aprobados. SHA-256 de esta copia: `a1a98873f141c92d17341dd57e9b5afce5e1a3bc677f3222d1f7c67986e31d0b`.

## Resultados finales de esta entrega

Seguimiento de diseño: eliminado el selector de reproductor de la isla, sus estilos, su evento y su permiso de selección manual. El reproductor sigue la sesión activa que informa el proveedor Windows; varias sesiones con el mismo título no generan opciones duplicadas ni añaden 32 DIP de altura. La prueba visual usa dos sesiones de igual título y comprueba que reproducir/pausar apunta al identificador activo, sin modificar la reproducción real del usuario.

- `npm run verify`: aprobado, 76 pruebas Node, tipos, Vite, Rustfmt, 50 pruebas Rust y Clippy con advertencias como errores. Una prueba de audio físico permanece omitida por defecto; el proveedor se contrasta por separado en el release real.
- `npm run test:ui`: aprobado. 19 capturas, privacidad inmediata de archivos, restauración, comandos, teclado, interrupciones y movimiento reducido. Escalas de navegador simuladas; no hardware físico ficticio.
- `NIVO_NATIVE_TEST_PROFILE=release node test/native-ui.mjs`: aprobado sobre el ejecutable incrustado. Preferencias independiente, guardado, cierre con Escape, denegación de sesiones de audio desde su capability, audio real, transporte autenticado y región HWND estabilizada comprobados. DPI físico observado: 100 %.
- Audio real: salida THX Spatial, micrófono HyperX SoloCast y siete salidas. Las sesiones variaron entre cuatro y seis durante los ensayos; el JSON final registra cuatro. No se modificaron niveles ni silencios físicos para probar.
- Binario probado: SHA-256 `be01db3c4d02e7a504dbb05b9bfbe5409bfa2304deb5c3994f5656ee66754ffc`. Los cambios de autoría posteriores no cambian su árbol de fuentes ni el hash del ejecutable.
- Muestreo de 15 segundos con CDP conectado, árbol observado completo incluyendo WebView2: CPU normalizada media 0,0289 %, pico 0,1856 %; working sets sumados hasta 422,22 MiB y bytes privados hasta 249,89 MiB. No son RAM física única y no se suman entre sí. **Objetivo de memoria <150 MB no alcanzado en este ensayo.** No acredita 30 minutos ni ausencia de regresión frente a la build anterior.
- Los commits nuevos utilizan autor y committer `SnoW-099 <ryze0910@gmail.com>`. Se corrigieron únicamente commits locales aún no publicados, conservando árboles idénticos y la base remota. Sin force-push ni reescritura compartida.
