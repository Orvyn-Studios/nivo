# Referencia Coucou — 2026-10-17

Revisado el commit [`434d6a2`](https://github.com/Louis-CFM/coucou/tree/434d6a2b4af2e5ce117fa425170abe25620130b9): `windows/src/core/anim.ts`, `core/layout.ts`, `island/fsm.ts` y los recorridos de animación/interacción en `island/island.ts`, `mochi/engine.ts`, `src-tauri/src/island.rs` y `platform/windows.rs`. También `LICENSE` y `LICENSE-ASSETS.md`.

El código es MIT; Mochi, su aspecto, expresiones y animaciones como personaje, los nombres, iconos y sonidos están excluidos. Nivo adapta solamente el integrador pequeño de resortes. Conserva atribución y MIT íntegra en `public/licenses/coucou-MIT.txt`, incluida por Vite en la build. El compañero de Nivo usa una silueta vectorial original de dos arcos y azul plateado; no importa Mochi ni Nova.

| Antes en Nivo | Cambio | Motivo y comprobación |
| --- | --- | --- |
| Ancho y alto en cada keyframe | Layout completo fijo y máscara animada | El recorrido `main.ts → IslandMotion.to` animaba dimensiones de layout. El test ahora rechaza dimensiones animadas y escala de texto. No acredita aceleración GPU ni FPS. |
| Curva que reiniciaba desde reposo | Resorte con velocidad conservada al interrumpir | Adaptación de `Spring` con subpasos acotados, precalculada en una pista finita WAAPI. Tests de convergencia, cambio de destino y entradas inválidas. |
| Preferencia de mascota sin componente | Compañero SVG opcional, poses de música y temporizador | Derivación explícita de estados reales y opción persistida. Sin tareas de agente inventadas. |
| Sin interacción | Mirada local, parpadeo al pulsar y reacción única al completar | Cien eventos de puntero se agrupan en un frame, sin programar otro al terminar. No se observa el cursor fuera de la isla. |
| Sin control del trabajo de mascota | Cancelación al ocultar, desactivar, reducir movimiento o desmontar | Tests de eventos y cancelación; ninguna animación decorativa continua. |

Coucou usa una ventana amplia y sondea el cursor cada 16 ms mientras está activo para click-through. Nivo conserva su región HWND y eventos locales; no incorpora ese sondeo ni hooks de entrada. La región durante transiciones y la sombra siguen pendientes de corrección y aceptación.

Se mantienen las integraciones GSMTC y Windows de Nivo. No se incorporan chat, micrófono, grabación, credenciales, servicios de red ni proveedores de agentes de Coucou.

Comprobado: código de estos recorridos, licencia, propiedades animadas, cancelación y reposo. Pasan pruebas automatizadas de física e interacción. El usuario confirmó la apertura de la build anterior, pero indicó falta de fluidez y acabado. Los cambios nuevos necesitan revisión visual en Windows: Chromium no crea página ni con renderizado por software y sandbox. No hay medidas de FPS/CPU/RAM ni beta aceptada.
