# Nivo — próximos hitos

## Estado vigente — iteración en la torre

Consultar [PHASE_STATUS](PHASE_STATUS.md): coordinador contextual sin temporizador, región animada, Core Audio, energía/teclas optativas, adaptadores autenticados y Nivo Drop. La aceptación física de ventana, arrastre, hardware y adaptadores voluntarios es el siguiente hito. BITS, carpetas, USB/Bluetooth generales y Compartir permanecen pendientes. Las secciones siguientes documentan hitos anteriores.

## Estado histórico — antes de la iteración en la torre

La integración completa Tauri compila localmente. Pasan 62 pruebas Node, 39 de biblioteca Rust, tipos, build web y Clippy. El harness vacío de `main` vuelve a estar bloqueado por la política de Windows; la verificación completa queda fallida. GSMTC, fullscreen, eventos de pantallas/energía/sesión y startup optativo están implementados. El usuario confirmó que la cápsula abre y señaló falta de fluidez y acabado: se han añadido máscara animada, resorte con velocidad conservada y compañero original tras revisar Coucou. Su nueva aceptación interactiva sigue pendiente. Actions permanece manual por petición del usuario.

El siguiente hito es ejecutar el binario autónomo y validar ventana, controles musicales, bandeja y recuperación. Corregir la región durante las animaciones y la sombra antes de declarar beta; medir CPU/RAM/fluidez y completar la matriz de [aceptación](NATIVE_ACCEPTANCE.md). Mantener topmost desactivado hasta validar fullscreen. Sin publicación automática.

Los apartados siguientes conservan el plan inicial y no sustituyen este estado ni el registro de [validación](VALIDATION.md).

## 1. Base independiente — preparada

Repositorio independiente [Orvyn-Studios/nivo](https://github.com/Orvyn-Studios/nivo), rama `feature/nivo-mvp`, shell Tauri, vista web y controlador de apertura, preferencias de movimiento, comandos acotados y pruebas Node. La música y las notificaciones se muestran como no conectadas. El código ya está subido; no se ha publicado un binario ni una release.

## 2. Aceptación de la ventana nativa — siguiente paso

Rust MSVC, C++, WebView2 y dependencias ya están disponibles. Los lockfiles están generados; tipos, build Vite y38tests pasan. Cargo se bloquea por Control de aplicaciones (error4551) al cargar una dependencia, antes de compilar Nivo. Completar cargo test/check/clippy y el build en un entorno Windows autorizado que permita esas herramientas, sin cambiar protecciones de este equipo. El usuario ha autorizado validación Windows en GitHub Actions; el workflow se activa con cambios de código en `feature/nivo-mvp` y conserva evidencias, sin distribuir ejecutables automáticamente. La fundación escrita incluye estados tipados, temporizador con recuperación, preferencias validadas, región Win32 y selección de pantalla; su integración sigue pendiente de compilación y prueba del ejecutable.

Probar apertura sin robar el foco, activación por teclado, transparencia sin rectángulo blanco, salida fiable desde bandeja y exclusión de Alt+Tab. Verificar monitor con origen negativo, DPI 100/125/150/200 %, cambio de escala y desconexión de un monitor. Los tests Rust preparados no sustituyen esa matriz.

Antes de permitir topmost: detección real de ventana a pantalla completa/juegos, suspensión de la isla y restauración sin activar ni interferir con otra aplicación. No añadir un sondeo constante sin medirlo y justificarlo.

## 3. Multimedia real

Investigar e implementar el adaptador WinRT para `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager`, con eventos de sesión/metadatos y acciones de reproducción comprobadas. No mostrar reproducción, duración ni carátulas ficticias. Validar cambio de reproductor, cierre de sesión, ausencia de metadatos y comandos que dejan de estar disponibles. Mantener esa integración fuera del controlador visual.

## 4. Notificaciones con consentimiento

Evaluar identidad/manifest y requisitos de distribución para `UserNotificationListener` antes de prometer lectura global de notificaciones desde un Win32 sin empaquetar. Pedir acceso desde una acción del usuario; mantener el sistema funcional si se deniega o revoca. No almacenar el historial de notificaciones por defecto ni enviar contenido fuera del dispositivo.

## 5. Rendimiento y publicación

Medir CPU y RAM con isla visible, oculta, expandida, en reposo y con eventos multimedia. Registrar equipo, compilación, tarea y alimentación. Objetivo de diseño: cero sondeos JS y cero bucles requestAnimationFrame en reposo; el consumo real de WebView2 sigue sin medirse.

Solo tras pruebas nativas, recuperación de errores, revisión de seguridad y autorización: habilitar empaquetado, revisar firma y preparar una prerelease independiente. Las integraciones con agentes y una mascota opcional pertenecen a una fase posterior.

## Referencias primarias

- [Prerrequisitos de Tauri](https://v2.tauri.app/start/prerequisites/).
- [Configuración de ventanas](https://v2.tauri.app/reference/config/#windowconfig).
- [Bandeja de Tauri](https://v2.tauri.app/learn/system-tray/).
- [Capabilities y permisos de comandos](https://v2.tauri.app/security/capabilities/).
- [GSMTC en Microsoft Learn](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager).
- [UserNotificationListener en Microsoft Learn](https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.management.usernotificationlistener).
