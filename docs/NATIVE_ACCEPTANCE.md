# Aceptación nativa de Nivo

Este procedimiento verifica una aplicación real en Windows. Las pruebas Node, una vista de navegador o una compilación correcta no sustituyen estos ensayos. **La beta sigue pendiente hasta ejecutar y registrar los criterios aplicables.** No se han declarado objetivos de CPU, RAM ni FPS alcanzados.

## Preparar la compilación

Desde la raíz de Nivo, con Node >=24.0.0 (las pruebas importan TypeScript directamente) y sin administrador:

```powershell
node scripts/preflight.mjs
node scripts/preflight.mjs --json
npm.cmd test
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

El preflight solo consulta instalaciones locales y ejecuta comandos de versión de Node/npm/Rust/Cargo y `vswhere`. No instala dependencias, no inicia Nivo ni examina otros productos Orvyn. Su salida no acredita SDK, enlazado, empaquetado o funcionamiento de WebView2: lo hará la compilación. Si falta Rust, se debe instalar el toolchain MSVC desde la distribución oficial con autorización del usuario antes de continuar. No desactivar protecciones para obtener un resultado favorable.

En Windows, `npm test` también verifica de forma aislada el bloque de parámetros del muestreador, su lectura de contadores del propio proceso PowerShell y el helper Win32 del árbol. No ejecuta el cuerpo del `.ps1`, no inicia Nivo ni cambia ExecutionPolicy. Esa prueba no equivale a medir una aplicación ni autoriza ejecutar un script bloqueado por la política del equipo.

Con dependencias resueltas, generar y revisar `Cargo.lock`. Para las verificaciones siguientes, usar un ejecutable de **release** con los recursos frontend incrustados y el empaquetado que corresponda al hito. Registrar commit, versión, hash del ejecutable, Windows, equipo, pantallas/DPI y condiciones. No publicar ni habilitar distribución como resultado automático de este procedimiento.

## Matriz de aceptación

Registrar cada fila como `aprobada`, `fallida`, `bloqueada` o `no implementada`, con fecha y evidencia. No marcar una integración aprobada si solo se comprobó su estado vacío.

| Ensayo | Pasos y resultado exigido |
| --- | --- |
| Inicio y salida | Ejecutar el binario como usuario normal. Aparece una sola isla. Salir desde bandeja termina Nivo y sus WebView2; repetir tres veces sin procesos huérfanos ni errores. |
| Foco y Alt+Tab | Escribir en una aplicación de prueba; iniciar Nivo y disparar un evento propio autorizado. La aplicación anterior conserva foco. La isla no aparece como ventana convencional en Alt+Tab cuando esa exclusión esté implementada. Pulsar controles de Nivo funciona. |
| Superficie interactiva | Colocar botones de una aplicación de prueba detrás de los márgenes, esquinas transparentes y exterior de la cápsula. Esos clics llegan a la aplicación de prueba. El centro y los controles de Nivo reciben sus clics. Repetir compacta, expandida y durante transición. |
| Apertura y cierre | Abrir/cerrar diez veces y alternar rápidamente durante la animación. No aparecen rectángulos opacos, saltos, contenido fuera de superficie ni estados atascados. Escape recoge y deja un foco utilizable. |
| Teclado y accesibilidad | Tab/Mayús+Tab, Enter/Espacio y Escape permiten usar los controles. Foco visible; nombres comprensibles para Narrador; textos largos no ocultan acciones esenciales. No utilizar solo el color para comunicar errores. |
| Movimiento reducido | Activar la preferencia de Windows y la de Nivo, también durante una transición. No quedan animaciones pendientes, rebotes ni bucles continuos. Desactivar restaura el comportamiento configurado. |
| Pantallas y DPI | Probar 1080p/1440p/4K según hardware disponible, a 100/125/150/200 %. Dos monitores con escalas diferentes y uno con origen negativo. Seleccionar pantalla, cambiar escala, desconectar/reconectar. La isla permanece dentro del área elegida; indicar combinaciones no disponibles. |
| Pantalla completa | Comparar escritorio, ventana normal, maximizada, pantalla completa sin bordes y exclusiva compatible. La maximizada no se confunde sistemáticamente con pantalla completa. Nivo se oculta en la pantalla afectada y vuelve sin foco al salir. Probar monitor secundario. Sin inyección, hooks de entrada ni privilegios. |
| Bandeja | Mostrar, pausar/reanudar, preferencias y salir según funciones disponibles. Ocultar no impide recuperar la isla. La salida sigue disponible cuando una API falla. |
| Multimedia real | Reproducir contenido en una aplicación que exponga GSMTC. Comparar canción, artista, portada y estado con el reproductor. Pausar/reanudar/anterior/siguiente cambian la sesión real cuando están permitidos. Probar cierre de reproductor, dos sesiones y controles no disponibles. |
| Medios incompletos | Usar una fuente real sin portada, sin duración o con texto largo cuando sea posible. La interfaz muestra ausencia de datos con claridad. No inventar progreso ni mostrar imágenes de demostración. |
| Temporizador | Iniciar, pausar, reanudar y cancelar. Comparar con una referencia; registrar error observado. Probar ocultación, cambio de foco y suspensión/reanudación. La finalización ocurre una sola vez y no abre ventanas invasivas. Documentar la política de tiempo durante suspensión. |
| Eventos superpuestos | Durante música o temporizador, disparar una notificación propia real. Al expirar vuelve al contexto correcto. Repeticiones, cancelación y eventos antiguos no destruyen el estado actual. |
| Privacidad/notificaciones | Comprobar modo privado y notificaciones desactivadas. No se persiste contenido de mensajes. Si no hay identidad/permiso compatible, las notificaciones externas figuran como no disponibles; las propias siguen funcionando. No activar lectura global sin permiso. |
| Preferencias | Cambiar ajustes, salir y reiniciar. Se restauran; un archivo inválido provoca valores seguros y un error recuperable. Inicio automático permanece opcional y solo se modifica tras una acción explícita. |
| Ciclo de vida | Bloquear/desbloquear Windows y suspender/reanudar. La isla restaura visibilidad, pantalla y estado de forma coherente. Una API indisponible degrada su función sin bloquear toda la aplicación. |
| Seguridad | Revisar capabilities/CSP y comandos. No hay shell arbitraria, scripts remotos, telemetría o acceso amplio a archivos. Verificar que el binario no solicita administrador. |

Las pruebas de pantalla completa en juegos no garantizan compatibilidad universal con anticheat. Registrar únicamente títulos/modos comprobados; no inyectar ni intentar eludir sus protecciones.

## Medición de procesos

`scripts/measure-process.ps1` muestrea el PID exacto de Nivo y los descendientes observados, incluidos WebView2. Usa Toolhelp32 de Win32 y contadores de proceso; **no necesita CIM**. No registra ventanas, comandos, mensajes, pulsaciones ni capturas. Tampoco modifica la aplicación.

Encontrar el PID del ejecutable verificado en Administrador de tareas. No usar un proceso de navegador o una vista web como sustituto. Ejemplo, reemplazando `1234` por el PID real:

```powershell
& .\scripts\measure-process.ps1 -NivoProcessId 1234 -DurationSeconds 1800 -IntervalSeconds 5 -Condition 'idle-visible' -BuildLabel 'commit y version comprobados' -HardwareDescription 'CPU y RAM del equipo de prueba' -DisplayConfiguration 'principal 2560x1440 125%' -PowerSource AC
```

El nombre esperado es `nivo-desktop`; si el ejecutable se llama `nivo`, usar `-ExpectedProcessName nivo`. Se rechaza cualquier PID con otro nombre y se conserva la hora de inicio para detectar reutilización de PID. Los argumentos inválidos fallan antes de iniciar el muestreo. Para ayuda de parámetros: `Get-Help .\scripts\measure-process.ps1 -Full`.

El directorio predeterminado es `artifacts/performance`, ignorado por Git. Cada ensayo produce un CSV y JSON con duración real, condiciones declaradas, procesos observados y estado. Un error de permisos o contadores se registra como fallo; no se sustituye por ceros. Si Nivo termina pronto, el ensayo queda incompleto. Los fallos anteriores a crear los archivos (PID inválido, permisos o compilación de la lectura Win32) aparecen en consola y no producen una medición válida. Si la política de ejecución local bloquea archivos PowerShell, registrar ese bloqueo y utilizar el procedimiento de scripts autorizado por el propietario del equipo; este proyecto no cambia ni omite esa política.

- **CPU normalizada:** `100 × suma del incremento de segundos CPU / segundos transcurridos / procesadores lógicos de Environment.ProcessorCount`. Registrar este denominador; en equipos con grupos de procesadores o afinidad especial puede no representar toda la topología física.
- **Working set:** suma de memoria residente por proceso. Las páginas compartidas pueden contarse varias veces; no equivale a RAM física única.
- **Private bytes:** suma de memoria privada comprometida. Puede incluir memoria no residente. No es private working set y no se suma a working set.
- El primer registro establece la referencia de CPU. Si desaparece un proceso antes de leer su último contador, o aparece sin una referencia atribuible al intervalo, CPU queda vacía y el CSV explica que el intervalo está incompleto.
- Un proceso que nace y termina entre muestras no es observable; usar intervalos menores para transiciones cortas o una herramienta de perfilado adicional. El árbol no atribuye procesos externos compartidos ni memoria de GPU. El propio script tiene coste de observación.

Las definiciones y estructuras se contrastaron con documentación oficial: [Toolhelp snapshot](https://learn.microsoft.com/en-us/windows/win32/api/tlhelp32/nf-tlhelp32-createtoolhelp32snapshot), [PROCESSENTRY32W](https://learn.microsoft.com/en-us/windows/win32/api/tlhelp32/ns-tlhelp32-processentry32w), [working set](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.workingset64), [private bytes](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.privatememorysize64) y [tiempo CPU acumulado](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.totalprocessortime). Solo se solicita `TH32CS_SNAPPROCESS`; no se inspeccionan módulos ni memoria de otros procesos.

Ejecutar ensayos separados con el mismo binario: arranque, reposo visible 30 minutos, reposo oculto, reproducción real y secuencia de aperturas/cierres. Registrar actividad de fondo conocida y alimentación. Comparar el primer muestreo con los 30 minutos sin descartar crecimiento. No interpretar una columna CPU vacía como 0 % ni una ejecución parcial como un ensayo aprobado.

Los objetivos orientativos son CPU en reposo <1 % y RAM <150 MB, pendientes de medición e interpretación consistente. Presentar working set y private bytes por separado, duración y limitaciones; el script no declara aprobado automáticamente ninguno de esos objetivos.

## Animación y arranque

El muestreador de procesos no mide FPS. Para validar 60 FPS, registrar fotogramas únicamente durante transiciones desde WebView2/DevTools o un perfilador compatible, además de una inspección visual. Documentar duración, equipo, refresco de pantalla, fotogramas largos y percentiles; no mantener un bucle de medición en reposo dentro del producto. Repetir movimiento reducido. Separar tiempo de lanzamiento del proceso, frontend preparado y primera isla presentada; una petición HTTP 200 no mide el inicio nativo.

## Informe y decisión

Guardar logs de compilación/pruebas, matriz completada, mediciones originales y errores conocidos. Diferenciar resultados del navegador de resultados Tauri. Enumerar funciones sin implementar y combinaciones de hardware sin comprobar. Preparar una beta privada únicamente cuando el ejecutable se haya abierto y los criterios mínimos tengan evidencia; esperar autorización para publicar.
