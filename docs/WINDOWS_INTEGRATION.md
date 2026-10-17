# Integración Windows de Nivo

## Límites y ciclo de vida

Rust es propietario de las preferencias, la ventana y los proveedores Windows. TypeScript presenta instantáneas validadas y envía comandos finitos. El canal optativo de integración usa una tubería Windows autenticada, sin servidor TCP. No hay PowerShell periódico, shell IPC, telemetría ni carga remota. La configuración no requiere cuenta ni administrador. Estado actual y límites en [PHASE_STATUS](PHASE_STATUS.md).

`window.rs` aplica una política explícita de visibilidad: intención Mostrar/Ocultar/Pausar y bloqueos independientes por pantalla completa, sesión bloqueada y suspensión. Un evento temporal no sustituye la intención del usuario. Mostrar desde bandeja tampoco elimina un bloqueo del sistema. La entrega de visibilidad y la operación HWND confirman el cambio conjuntamente, con restauración y error si falla.

El observador de pantalla completa usa WinEvents fuera de proceso, filtra los cambios de ubicación de la ventana en primer plano y compara su marco DWM con el monitor físico. Excluye escritorio, ventanas minimizadas, ocultas y maximizadas convencionales. No observa teclado/ratón ni lee títulos o nombres de procesos. Una lectura desconocida conserva la supresión anterior. La cola de entrega a la UI conserva solo la última observación.

El observador de ciclo de vida posee una ventana Win32 oculta que recibe `WM_DISPLAYCHANGE`, mensajes de energía y WTS de esta sesión. Registra y libera sus propios recursos en su hilo. Los cambios de monitor vuelven a calcular la posición y notifican al selector de pantallas. La suspensión y el bloqueo no se simulan en las pruebas automatizadas.

## Música real

El worker WinRT MTA pide `GlobalSystemMediaTransportControlsSessionManager` y se suscribe a cambios de sesión, metadatos, reproducción y línea temporal. Sin sesiones publicadas por Windows no aparece ningún reproductor. La secuencia de instantáneas y una generación de suscripción impiden que una respuesta vieja reponga datos tras cerrar una sesión o desactivar la función.

- Hasta ocho sesiones y una cola de dieciséis solicitudes. Eventos repetidos se agrupan.
- Operaciones WinRT con plazo de seis segundos y cancelación. Los comandos esperan en `spawn_blocking`, fuera del hilo UI.
- Portada solo de la sesión activa, máximo 2 MiB, tipo y firma PNG/JPEG/WebP comprobados. Caché acotada a una portada; no se descarga contenido remoto desde el frontend.
- Anterior, reproducir/pausar y siguiente solo cuando la sesión lo admite. No hay seek ficticio ni estado optimista de reproducción.
- El progreso muestra la última posición comunicada por Windows; no se extrapola como si fuera una medición nueva.
- Desactivar borra sesiones, portada y errores; revoca suscripciones. El frontend también elimina inmediatamente los datos y rechaza eventos tardíos.
- Al salir se liberan callbacks y capturas de `AppHandle`, evitando ciclos de propiedad.

La compatibilidad depende de que el reproductor exponga una sesión GSMTC. La prueba de componente anterior de esta sesión devolvió `0x80070424`, sin sesiones; eso indica una capacidad indisponible en ese entorno, no una prueba de Spotify ni una conclusión sobre todos los Windows. No se modifican servicios para cambiar el resultado.

## Inicio automático

Solo una acción explícita de Preferencias puede crear o borrar `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Orvyn.Nivo`. Se registra exclusivamente la ruta local del ejecutable actual, entre comillas, sin argumentos. Se rechazan rutas de red/dispositivo, caracteres de control, flujos alternativos y comandos demasiado largos. Las pruebas cubren la validación, sin activar el inicio automático real. Windows puede impedir el arranque independientemente de esta entrada; el control indica registro, no garantiza ejecución.

## Notificaciones y privacidad

El temporizador se ha retirado. Los avisos de audio, teclado, energía y adaptadores usan el coordinador con prioridades y cola acotada; no requieren acceso global a notificaciones ajenas. El modo privado y el ajuste de desactivación no conceden permisos de Windows.

La documentación de Microsoft exige la capability `userNotificationListener` en un manifiesto de paquete, autorización explícita solicitada desde el hilo UI y comprobar el permiso antes de leer. La build actual es un Win32 Tauri sin identidad MSIX configurada. Por tanto, **no ofrece lectura de notificaciones ajenas**. Se conserva el fallback de avisos propios; no se muestran mensajes de demostración. Una futura distribución con identidad necesita una investigación y aceptación propias, incluida revocación del permiso y No molestar.

Referencias: [Notification listener](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/notification-listener), [identidad para el listener en escritorio](https://github.com/MicrosoftDocs/windows-dev-docs/issues/1601), [ejemplo oficial GSMTC de escritorio](https://devblogs.microsoft.com/oldnewthing/20231108-00/?p=108980), [Run y RunOnce](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys).

## Aceptación pendiente

Compilar y pasar pruebas no acredita toda la ventana. Antes de beta faltan pruebas reales de foco, clics durante animación, bandeja, DPI/hotplug, bloqueo/suspensión, juegos y mediciones de CPU/RAM/FPS. Siempre visible sigue desactivado. La región Win32 ahora sigue las muestras de la máscara animada, con epoch para ignorar muestras antiguas. La sombra se dibuja dentro de la superficie. Esto corrige la implementación anterior; no acredita aún clics físicos ni sincronización con cada frame presentado.
