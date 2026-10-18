# Explorer y ZIP: aceptación manual pendiente

Esta prueba debe hacerse en Nivo para Windows, no en el navegador de desarrollo.
La automatización WinForms/OLE anterior no entregó los archivos. En esta revisión,
computer-use no encontró una ventana operable de Nivo después de refrescar las
ventanas; no se sustituyó ese resultado por un evento Drop simulado. **Explorer,
selector de destino y ZIP completo siguen sin aceptación de extremo a extremo.**
Los tests Rust sí verifican compresión, Unicode, cancelación y originales sobre
archivos reales; las grabaciones Chromium solo verifican presentación con fixtures.

## Preparación reproducible

Desde la raíz del repositorio, ejecutar `python test/manual-drop.py prepare`.
El comando crea una carpeta única en `artifacts/manual-drop/`, devuelve sus rutas
y guarda `manifest.json` con tamaños y SHA256. No toca archivos personales.
`entrada` contiene exactamente dos archivos: `diseño-ñ.txt` y `muestra.bin`.
Fuera de ella queda `cancelar-128MiB.bin`, para la prueba de cancelación.

Abrir la compilación local actual y anotar su SHA256 con
`Get-FileHash src-tauri/target/release/nivo-desktop.exe -Algorithm SHA256`.
Anotar Windows, escalado de pantalla, monitor y preferencias de movimiento.
Activar Nivo Drop en Preferencias si está desactivado. Usar primero movimiento
completo y visibilidad sobre otras aplicaciones; anotar y restaurar las elecciones
anteriores al terminar. No activar GitHub ni introducir credenciales para esta prueba.
Para observar restauración musical, iniciar una canción desde el reproductor habitual
y abrir su contexto en Nivo. La prueba no debe cambiar la reproducción.

## Ejecución y criterios

1. Abrir `entrada` en **Explorador de Windows**. Arrastrar ambos archivos, con
   el botón izquierdo, hasta el centro visible de la isla. Mantener el puntero
   medio segundo y soltar. Deben aparecer exactamente dos archivos, con sus
   nombres y tamaños reales. Guardar una grabación de pantalla desde antes del
   arrastre; un evento inyectado o un archivo elegido desde otro control no acredita este paso.
2. Repetir un arrastre y salir de la isla antes de soltar. El contexto previo
   debe recuperarse sin dejar tarjeta ni modificar la música.
3. Soltar los dos archivos otra vez. Pulsar **Crear ZIP…** y cancelar el selector
   de Windows. Debe aparecer **Operación cancelada**, sin éxito ni destino creado.
   Pulsar **Listo** y comprobar restauración del contexto musical anterior.
4. Repetir el arrastre de ambos archivos y **Crear ZIP…**. Elegir como destino
   `resultado.zip` en la carpeta devuelta por el preparador, fuera de `entrada`.
   Observar archivo → destino → progreso → resultado en la grabación. La tarjeta
   compartida debe mantenerse; nunca deben cruzarse textos de progreso y resultado,
   duplicarse controles o aparecer un rectángulo de interacción exterior a la isla.
   Un ZIP rápido puede acabar sin mostrar un porcentaje intermedio: no se exige
   una duración artificial. **ZIP listo** solo debe aparecer tras confirmar el archivo.
5. Pulsar **Abrir carpeta**. Debe abrir el destino real y volver al contexto previo
   sin pausar ni cambiar de canción. Verificar el ZIP con
   `python test/manual-drop.py verify --manifest "RUTA_MANIFEST" --zip "RUTA_RESULTADO"`.
   El verificador lee las entradas sin extraerlas, exige Deflate, nombres Unicode,
   tamaños y contenido SHA256 idénticos; también comprueba todos los originales.
   Su éxito acredita integridad del ZIP, no los pasos de interfaz por sí solo.
6. Arrastrar solamente `cancelar-128MiB.bin` y elegir un destino nuevo,
   `cancelado.zip`. Pulsar **Cancelar** durante trabajo cancelable. Debe acabar como
   cancelación y eliminar exclusivamente su propio parcial; el original debe mantener
   su SHA256. Si termina antes de poder cancelar, registrar **no ejercitado**, nunca
   convertir una operación completada en prueba de cancelación.
7. Repetir con movimiento reducido. No debe quedar ninguna animación pendiente,
   progreso ficticio, controles duplicados o bloqueados. Probar también Escape/Volver
   durante destino y trabajo, anotando si espera la respuesta del selector de Windows.

Guardar vídeo, SHA del ejecutable, manifiesto, salida del verificador y una tabla
con cada paso: **pasó / falló / no ejercitado**, resultado observado y ruta de evidencia.
Ante cualquier fallo, conservar la grabación y el destino; no borrar archivos
personales ni declarar aceptado el flujo completo. Restaurar las preferencias originales.

## GitHub real

Pendiente por decisión del usuario. Solo después de su autorización, el usuario
introducirá el PAT directamente en Preferencias de Nivo. No se recopila por chat,
scripts, vídeos, fixtures ni logs. Validar entonces identidad, selección de un repo
autorizado, datos reales, refresco, desactivación y desconexión; la evidencia visual
debe excluir el token y cualquier dato privado no autorizado.
