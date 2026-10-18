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
- 60 tests Rust correctos; uno de audio del entorno omitido explícitamente.
- Fixture visual de Drop correcto con movimiento reducido y normal.
- `artifacts/actions/motion/*.webm`: grabación de Chromium con operación y música
  **simuladas explícitamente**, no prueba de ZIP nativo ni medida de FPS de Windows.
- Tests de coreografía: interrupción desde posición compositada, resultado rápido,
  cancelación, reducción de movimiento, ocultación y liberación al desmontar.

- Estrés temporal extendido `living-context-stable-browser`: 77 acciones,
  30 ciclos, 12 inversiones, cambios música/HUD, avisos, Drop, agente, movimiento
  reducido y ocultación durante vuelo; recuperación tras bloqueo intencionado de
  65 ms. Vídeo y secuencias guardados. Los intervalos RAF no son FPS presentados.

Siguen pendientes pruebas temporales nativas de Drop, validación con una cuenta
GitHub real y mediciones comparables del ejecutable final. El primer auxiliar OLE
no completó el arrastre en este entorno (ni devolvió las callbacks esperadas);
se registra como prueba fallida, sin afirmar que haya validado Explorer o ZIP nativo.
Se conserva la preferencia de visibilidad elegida; esta fase no activa topmost.
