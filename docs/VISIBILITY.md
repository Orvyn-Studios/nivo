# Visibilidad sobre aplicaciones — 17 de octubre de 2026

La isla quedaba detrás de ventanas normales porque no era topmost. El usuario ha solicitado que permanezca visible por defecto y que el comportamiento anterior sea opcional.

En Preferencias → General aparece **Ocultar detrás de otras apps**, desactivado por defecto. `hide_behind_apps=false` mantiene el HWND de Nivo encima de las ventanas normales; activarlo retira topmost y permite que otras aplicaciones lo cubran. No implica cerrar Discord/Spotify ni ocultar forzosamente la isla ante cualquier cambio de foco: controla su orden de superposición.

**Ocultar en pantalla completa** sigue siendo una opción independiente; también está desactivada en las preferencias nuevas. Se respetan valores existentes explícitos. La nueva clave tiene `serde(default)` y el parser TS usa false al cargar configuraciones antiguas, conservando las demás preferencias. En esta entrega se aplica expresamente la configuración visible solicitada por el usuario a su instalación actual, sin cambiar otras opciones.

El orden Z se ajusta solo al iniciar/aplicar preferencias, en el HWND propio, sin activación ni sondeo o intentos repetidos de imponerse a otras ventanas. Se usan HWND_TOPMOST/HWND_NOTOPMOST con SWP_NOACTIVATE, conforme a [SetWindowPos de Microsoft](https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-setwindowpos). La configuración inicial de Tauri sigue oculta hasta que esté preparado el frontend.

La prueba física descubrió otro fallo: el show Win32 directo no actualiza el indicador inicial de visibilidad que conserva Tao. Por ello, `window.hide()` podía no ocultar realmente la isla aunque el observador detectase correctamente fullscreen. Ahora show y hide pasan por la misma capa Win32, con SWP_SHOWWINDOW/SWP_HIDEWINDOW y sin activar ni cambiar geometría o región. Esto también corrige la ocultación manual y los bloqueos que reutilizan esa política. Se conserva la lógica de intención/pausa/bloqueadores y su rollback.

## Validación

`test/native-visibility-fixture.ps1` crea una ventana externa real de vida acotada. Se prueba el HWND propio de Nivo por PID, título y región. El helper usa comandos por stdin y verifica WindowFromPoint, IsWindowVisible, estilo topmost y foreground. Si Windows deniega activación, solo puede hacer clic en su propia superficie verificada y restaura el cursor; no cambia otras aplicaciones ni ajustes del sistema. El helper vuelve a ser una ventana normal antes de tomar las muestras.

`test/native-visibility.mjs` verifica estos cinco estados y exige que la ventana de prueba conserve el foreground:

| Caso | Visible | Topmost | Punto de isla pertenece a Nivo |
|---|---|---|---|
| App normal, configuración por defecto | Sí | Sí | Sí |
| App normal, ocultar detrás activado | Sí, cubierta | No | No |
| Fullscreen sin bordes, ocultar en fullscreen activado | No | Sí | No |
| Volver a app normal tras fullscreen | Sí | Sí | Sí |
| Fullscreen sin bordes, ocultación desactivada | Sí | Sí | Sí |

También se activa/desactiva el checkbox en la ventana real de Preferencias y se comprueba su persistencia mediante el backend. Se conserva el resto del smoke: instancia única, seguimiento por todo el escritorio, accesibilidad de foco, ACL de Preferencias, GSMTC/CoreAudio, integraciones autenticadas y región de entrada. No se envían órdenes de reproducción.

Validación automatizada: 84 pruebas Node, 53 Rust y una ignorada explícita, typecheck, rustfmt, Clippy, build Windows; pruebas visuales generales y musicales. El smoke nativo se conserva por hash junto a la copia privada del ejecutable. Los escenarios de ventanas normales y fullscreen sin bordes se comprobaron con HWNDs reales; no se afirma haber probado juegos exclusivos, todas las apps, DPI mixto o todos los modos de presentación de Windows.

La solicitud actual autoriza mantener la isla sobre otras apps, y la prueba de fullscreen requerida por las instrucciones locales se ha ejecutado antes de entregar esta copia. La política anterior de topmost desactivado y los informes de movimiento anteriores describen versiones previas.

El arnés restaura las preferencias al terminar. Solo la variable explícita de entrega `NIVO_APPLY_VISIBLE_DEFAULTS=1` aplica los dos false solicitados al restaurar; no modifica autostart ni otras opciones. No es una variable ni un flujo del producto.
