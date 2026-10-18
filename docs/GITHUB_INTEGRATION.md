# GitHub 1.0 — implementación y conexión

GitHub es opcional, está desactivado inicialmente y solo lee datos. La red vive en
Rust; el WebView no consulta GitHub. La primera versión usa un PAT fine-grained,
validado con `/user` antes de guardarse en Windows Credential Manager. No hay
comando para leer secretos. Preferencias y la isla tienen capacidades diferentes:
solo Preferencias conecta/configura; la isla recibe datos y puede abrir IDs ya
validados por el backend. No acepta URLs arbitrarias ni ejecuta comandos de Git.

## Conexión en Windows

1. Abre Preferencias → Integraciones → GitHub.
2. En GitHub → Settings → Developer settings → Personal access tokens → Fine-grained
   tokens, elige propietario y repositorios. Usa únicamente permisos de lectura:
   Metadata, Pull requests, Actions, Commit statuses y Checks; Issues si lo activas.
3. Si el propietario es una organización, comprueba su política y la aprobación.
   Un token fine-grained está delimitado por su propietario de recursos: no se
   promete acceso simultáneo a todos los repositorios personales y organizativos.
4. Introduce el token **en la aplicación**, nunca en el chat, y pulsa Conectar.
   El campo se borra antes de la llamada nativa. La identidad mostrada procede de
   GitHub, no del nombre escrito por el usuario.
5. Selecciona hasta ocho repositorios entre los devueltos por la API. La lista
   incluye repositorios personales y de organizaciones accesibles; no activa
   vigilancia automática de organizaciones completas. Guarda la selección.
6. Usa «Actividad de GitHub» en el menú de la bandeja. PR, revisiones, CI, issues y
   contribuciones son filtros del contexto; Volver recupera el estado anterior.

No se requieren permisos de escritura, OAuth App ni un token clásico de alcance
completo. Desconectar aborta las solicitudes, borra credencial y selección y elimina
los datos privados en memoria. Un fallo al borrar la credencial se muestra como
error; nunca se confirma su eliminación si Windows la rechaza.

## Límites y comportamiento

- HTTPS con TLS de Windows, sin redirecciones, tiempos de conexión/solicitud
  acotados, cuerpo JSON máximo 2 MiB y caché ETag por cuenta (12 entradas pequeñas).
- Consulta normal cada 5 minutos (configurable hasta 60), CI pendiente cada 60
  segundos y calendario cada 30 minutos. Respeta Retry-After, rate-limit reset y
  backoff. Ocultar/pausar/suspender Nivo aborta la tarea; desactivar no crea cliente
  ni hace peticiones. Una actualización manual no reinicia una ya en curso.
- Primera consulta silenciosa. Hasta tres avisos por ciclo y 256 huellas persistidas
  sin token, títulos ni contenido de PR. CI correcto no equivale a aprobación de PR;
  «completed» sin conclusión se presenta como resultado desconocido.
- Enumeración accesible limitada a 500 repositorios, explícitamente indicada si se
  alcanza. Por repositorio: hasta 20 PR abiertas recientes, cinco cerradas recientes
  para fusiones, diez ejecuciones y diez issues asignadas. No es un historial completo.
- Las revisiones solicitadas a equipos no se atribuyen a un usuario sin verificar
  pertenencia. No se inspeccionan todas las organizaciones para inferirla.
- Calendario real de GraphQL: conteo anual y últimos 91 días disponibles. Sin acceso
  muestra ausencia/error; no estima contribuciones privadas ni genera actividad.
- Solo se abre un repositorio/PR/issue/run de la selección mediante su ID nativo y
  URL HTTPS estricta de github.com. No se crean PR, comentarios, commits ni workflows.
- No hay asociación automática Codex→PR ni lectura de conversaciones/código local.

## Evidencia y pendientes

Tests unitarios verifican límites de IPC, repositorios organizativos, URLs, estados
de CI, rate-limit, huellas, primera consulta silenciosa y borrado de una credencial
**ficticia en un destino aislado** de Credential Manager. Fixtures Chromium prueban
la UI de cuenta, campo borrado, repositorios, desconexión, detalle PR, separación
CI/revisión, IDs de apertura y calendario. Capturas en `artifacts/github/ui`.

Todavía no se ha usado un PAT real ni se ha confirmado una cuenta real desde Nivo.
Las capturas muestran fixtures, no una conexión autenticada. El transporte se ha
probado contra un servidor local ficticio: ETag/304, 401, 429/Retry-After, respuesta
excesiva y aborto tras aceptar una conexión real sin respuesta. Ese origen de
pruebas solo existe bajo cfg(test), sin URL configurable en el producto.
Las capacidades se han comprobado además en el ejecutable Windows: la isla no
puede conectar/enumerar cuentas y Preferencias no puede abrir items ni correo.
Queda aceptación con permisos, token y organización reales; véase LIVING_ISLAND.md
para resultados nativos y rendimiento del hash final.

## Referencias

Se revisó [Coucou](https://github.com/Louis-CFM/coucou) como referencia conceptual de
credenciales separadas y comparación de estados. Implementación propia; sin copiar
personaje, recursos ni identidad. Contratos de
[repositorios accesibles](https://docs.github.com/en/rest/repos/repos),
[GraphQL](https://docs.github.com/en/graphql/guides/forming-calls-with-graphql) y
[ejecuciones](https://docs.github.com/en/rest/actions/workflow-runs) de GitHub.
