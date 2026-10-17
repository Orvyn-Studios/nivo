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

[Coucou](https://github.com/Louis-CFM/coucou) se revisa como referencia conceptual de continuidad y carácter. No se importa su código, Mochi, sonidos o recursos. La referencia no implica copiar su identidad. Para la nueva ventana se consulta la [documentación oficial de WebviewWindowBuilder](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html), incluida su advertencia sobre creación síncrona en Windows.

## Evidencia visual y alcance

`test/redesign-ui.mjs` captura 19 estados mediante componentes y CSS de producción, con proveedores simulados únicamente en el test. Incluye compacto/hover, calma, música, audio, micrófono, dispositivo, teclado, batería, descargas, agentes, Drop y preferencias. Se prueba restauración, comandos, interrupción, movimiento reducido y persistencia. Las simulaciones de viewport/deviceScaleFactor 100/125/150/200 % no equivalen a monitores físicos con DPI mixto.

Los JSON, capturas y comparación anterior/posterior se guardan en `artifacts/`; el informe final identifica los ensayos nativos ejecutados y los pendientes. No se declaran FPS presentados, fluidez subjetiva, compatibilidad con juegos ni aceptación prolongada de memoria a partir de capturas o compilación.
