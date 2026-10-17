# Integraciones locales optativas

Nivo no observa conversaciones, historial del navegador ni descargas de todos los procesos. Los adaptadores deben instalarse y activarse voluntariamente. Se revisó Codex CLI 0.162.1, con la función `hooks` estable habilitada. No se han modificado su configuración ni la confianza de sus hooks.

## Canal de actividad

Activa **Canal local de actividad** en Preferencias. Nivo crea una tubería Windows de nombre aleatorio, rechaza clientes remotos y limita la DACL al usuario actual y SYSTEM. El directorio propio `%APPDATA%\com.orvyn.nivo\integrations` protege la clave de sesión; no se debe compartir `connection.json` ni guardarlo en Git. Al desactivar o salir se revoca la conexión. No hay servidor TCP.

Solo admite eventos tipados de agente o descarga, hasta 8 KiB, con clave válida. No admite comandos, rutas de ejecución, prompts ni transcripciones. Los IDs de Codex se resumen con SHA-256; no se envían directorios, texto de mensajes ni entradas de herramientas. Las tareas se acotan a ocho y las descargas a treinta y dos en memoria, sin historial persistente.

## Codex

Ejecuta `node integrations/generate-codex-hooks.mjs` para revisar las definiciones con la ruta absoluta de tu copia. Combina conscientemente sus entradas con un `hooks.json` de usuario o de un proyecto elegido; no reemplaces configuraciones existentes. Revisa y confía en las definiciones mediante `/hooks` en Codex. No uses flags para omitir su confianza.

Se usan `UserPromptSubmit`, `PermissionRequest`, `Stop` e `Interrupt`. Son señales de inicio, revisión, final de turno y espera. Un final de turno no garantiza que todo el objetivo del usuario esté terminado. El adaptador nunca concede ni deniega permisos. No lee el archivo de transcripción, no produce salida y falla sin interrumpir Codex si Nivo está cerrado. No se presume acceso a tareas de otros procesos o sesiones no autorizadas.

Los estados de error están admitidos en el contrato para proveedores que dispongan de esa señal; estos cuatro hooks no ofrecen una detección universal de fallos de tareas. La conexión real de una sesión del usuario sigue pendiente de activar y confiar en el adaptador.

Fuente: [hooks oficiales de Codex](https://learn.chatgpt.com/docs/hooks).

## Descargas Chrome y Edge

La extensión de `integrations/browser/` solo pide `downloads` y `nativeMessaging`. No pide acceso a páginas, cookies, pestañas ni navegación. Remite nombre de archivo y medidas de descarga; no URLs ni rutas de destino. No se habilita en incógnito. Muestrea una vez por segundo mientras existen descargas activas; cierra la conexión cuando no queda ninguna. La finalización procede del estado `complete` del navegador.

Para probarla voluntariamente, carga esa carpeta como extensión sin empaquetar en un perfil de desarrollo y anota su ID. Con Nivo compilado y cerrado, revisa primero:

```powershell
.\integrations\browser\register-host.ps1 -ExtensionId ID_DE_32_LETRAS -NivoExecutable RUTA_ABSOLUTA_A_NIVO.exe -Browser Edge -WhatIf
```

El mismo comando sin `-WhatIf`, ejecutado por el usuario, registra únicamente el host propio de Nivo en HKCU para Chrome o Edge. El manifiesto limita el origen al ID indicado. No se ha ejecutado ese registro ni instalado la extensión en el perfil del usuario durante el desarrollo. No cambiar ExecutionPolicy si Windows rechaza el script.

La extensión no sustituye un gestor universal de descargas. Solo usa porcentajes cuando el navegador proporciona bytes recibidos y un total positivo. BITS y carpetas tienen lugar explícito en el contrato, pero sus proveedores todavía no están implementados. Un proveedor de carpeta deberá usar notificaciones del filesystem y describir actividad, sin inferir finalización por un tamaño estable. No se leen bases de datos privadas de Steam/Epic ni memoria de procesos.

Fuentes: [API de descargas Chrome](https://developer.chrome.com/docs/extensions/reference/api/downloads), [mensajería nativa Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [mensajería nativa Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging).
