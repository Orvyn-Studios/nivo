# Importación inicial a GitHub

El 17 de octubre de 2026 el usuario autorizó inicializar el repositorio vacío `SnoW-099/nivo` con un README en `main` y subir el código a `feature/nivo-mvp` mediante el conector de GitHub. Git en la terminal de esta sesión no podía conectar con `github.com:443`.

## Evidencia de la copia

- Repositorio: [SnoW-099/nivo](https://github.com/SnoW-099/nivo).
- Rama del código: [feature/nivo-mvp](https://github.com/SnoW-099/nivo/tree/feature/nivo-mvp).
- Inicialización de `main`: `2be558d0483939ae8d872718d38d5531626a83de`, únicamente un README que apunta a la rama de desarrollo.
- Commit local de origen: `efa507dca0bf85bbbd8bf98a3add1f2cd04a452d`.
- Commit remoto de importación: `1918e81690603788b2ab6d185b480911fda60b4f`.
- Árbol de contenido compartido: `8283fe8a3d9577ab11172b8b3f3719b6c8a89051`.
- Los 54 archivos, sus modos y sus SHA de blob se comprobaron contra el árbol remoto. Total de contenido: 378.215 bytes. Este documento y la actualización de instrucciones se añaden después de esa copia inicial.

El historial local original no se ha reescrito. Antes de la importación se creó y verificó una copia Git completa en `artifacts/github-import/nivo-before-import.bundle`, ignorada por Git. El conector creó commits remotos nuevos; no se afirma haber enviado los SHA locales originales.

## Continuar sin sobrescribir trabajo

Los cambios siguientes pertenecen a `feature/nivo-mvp`. Una subida por API debe partir de su último commit remoto y actualizar la referencia con ese SHA esperado, sin forzarla. No usar un push forzado para sustituir la importación por el historial local.

Cuando la terminal vuelva a tener conectividad Git, obtener primero el remoto y revisar ambos historiales. Se pueden conservar los dos mediante una fusión explícita en la rama de desarrollo con `--allow-unrelated-histories`, verificando el resultado antes del push. No ejecutar rebase, reset ni reemplazar `main` como atajo. Esa reconciliación todavía no se ha realizado.

## Alcance de esta subida

Se subieron código, pruebas y documentación. No se publicó una release ni un instalador, y no se ejecutó GitHub Actions. La aceptación de Windows continúa pendiente según [VALIDATION.md](VALIDATION.md).

El workflow manual está en la rama de desarrollo; `main` solo contiene el README. GitHub exige que el workflow esté en la [rama predeterminada para recibir `workflow_dispatch`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch). Habilitar su ejecución requiere resolver primero esa configuración, sin dar por aprobadas pruebas que aún no se han ejecutado.
