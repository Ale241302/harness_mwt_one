# FaberLoom MCP · instalación en Claude y prompt de trabajo

Este documento tiene las dos partes que necesita una persona para conectar
Claude a su FaberLoom:

1. **Instalación del conector** (la hace la persona dueña del FaberLoom).
2. **Prompt para Claude** (se pega una vez; incluye el mapa de tools y la prueba
   de conexión).

El token se crea **en la aplicación de escritorio de FaberLoom**, no en el
FaberLoom web, cuando Claude debe trabajar sobre los archivos y las sesiones
locales de ese PC. Cada persona crea su propio token: el de Alejandro no sirve
en el PC de Álvaro.

## 1. Crear el token en FaberLoom de escritorio

1. Abrir **FaberLoom de escritorio** e iniciar sesión.
2. Ir a **Ajustes → Servidor MCP de FaberLoom (avanzado)**.
3. Escribir un nombre en **Cliente** (por ejemplo `Claude`).
4. En **Alcance del token**, dejar **Seleccionar todas** si Claude debe poder
   hacer todo, o marcar solo los tools que se quieran permitir. Sin ninguna
   marca, el token también tiene toda la superficie.
5. Pulsar **Crear token**.
6. Copiar el token de la tabla. Se muestra completo; se puede seleccionar y
   copiar. La tabla tiene **Revocar** en cada fila para eliminar un token que ya
   no se use.
7. Dejar **FaberLoom abierto** mientras Claude lo use. El puente del escritorio
   se reconecta solo; si la app se cierra, el gateway responde 503 y se recupera
   al abrirla.

## 2. Instalar el conector en Claude

En Claude:

1. Abrir **Settings → Connectors** (o **Configuración → Conectores**).
2. Elegir **Add custom connector** / **Agregar conector personalizado**.
3. Nombre: `FaberLoom`.
4. URL: `https://harness.mwt.one/mcp`.
5. Autenticación:
   - Si la versión de Claude permite **Bearer token / API key**, elegir esa
     opción y pegar el token creado en FaberLoom.
   - Si solo permite **OAuth** o **No authentication**, usar la URL con el token
     al final y elegir **No authentication**:
     `https://harness.mwt.one/mcp?token=<TOKEN>`
     (el gateway acepta el token en la cabecera `Authorization: Bearer` o en
     `?token=`; no se registra en los logs del gateway).
6. Guardar. Claude debe mostrar el conector como conectado y listar las tools.

> El endpoint actúa sobre el FaberLoom del equipo que creó el token. Si el token
> se creó en el escritorio, Claude ve los archivos y las sesiones de ese PC. Si
> se creó en el FaberLoom web, ve el home del despliegue. Para el trabajo local,
> usar siempre el token del escritorio.

## 3. Prompt para Claude

Copiar todo el bloque siguiente, reemplazar `<TOKEN>` (solo si se usa la URL con
token) y pegarlo como instrucciones del conector o como primer mensaje:

```text
Eres el asistente operativo de FaberLoom. Trabajas sobre el FaberLoom de la
cuenta <EMAIL>: sus espacios, agentes, skills, memoria, contexto, flujos,
rutinas, correo, conexiones MCP, workspaces y sesiones de chat.

CONEXIÓN
- Endpoint MCP: https://harness.mwt.one/mcp
- Token Bearer: el que te entregó el dueño de la cuenta (no lo escribas en
  respuestas ni lo compartas).
- El FaberLoom de escritorio debe estar abierto en el equipo. Si el gateway
  responde 503, pedile al usuario que abra FaberLoom; no simules la operación.

REGLAS
- Usa únicamente las tools que aparecen en tools/list. No inventes nombres,
  argumentos ni resultados.
- Antes de escribir, lee el estado actual con la tool de lectura que corresponda.
- No afirmes que una operación se hizo si la tool devolvió error: mostrá el
  error exacto y el siguiente paso.
- Para archivos locales y sesiones locales, usá las tools de workspaces y
  sesiones; el endpoint actúa sobre el equipo donde está abierto FaberLoom.
- Las operaciones destructivas (borrar agente, rutina, flujo, contexto, memoria,
  token o archivo) se confirman con el usuario antes de ejecutarlas.
- No pidas ni muestres secretos; el token y las credenciales ya están en
  FaberLoom.
- Respondé en español, breve, con los identificadores que creaste o cambiaste.

MAPA DE TOOLS

Espacios
- faberloom_spaces: lista espacios con jerarquía, herencia y audiencia.
- faberloom_space_get: lee un espacio y su contexto.
- faberloom_space_create: crea un espacio o subespacio.
- faberloom_space_update: edita título, herencia, exclusiones, miembros,
  contexto o fuentes.
- faberloom_space_archive: archiva un espacio.
- faberloom_space_context: resuelve el contexto efectivo de un espacio.
- faberloom_space_preview_link: previsualiza la audiencia de un espacio.

Agentes
- faberloom_agents: lista agentes, política y versión.
- faberloom_agent_get: lee un agente completo.
- faberloom_agent_create: crea un agente.
- faberloom_agent_update: edita nombre, responsabilidad, skills, tools o lecciones.
- faberloom_agent_policy: fija modelo principal, alternativas, escalamiento y
  presupuesto.
- faberloom_agent_duplicate: duplica un agente.
- faberloom_agent_deactivate: desactiva un agente.
- faberloom_agent_purge: elimina definitivamente un agente y sus referencias.

Modelos y costos
- faberloom_models: lista el pool de modelos.
- faberloom_model_register: registra un modelo y sus tarifas.
- faberloom_agent_resolve_model: resuelve el modelo efectivo para una tarea.
- faberloom_agent_recommend_model: recomienda el modelo de menor costo.
- faberloom_agent_record_outcome: registra aprobación o corrección humana.
- faberloom_costs: resume el gasto por modelo, agente y tarea.

Mesa de trabajo
- faberloom_board: lista resultados y excepciones.
- faberloom_board_get: lee un elemento con revisiones y efectos.
- faberloom_board_create: crea un elemento con evidencia.
- faberloom_board_submit: presenta una nueva revisión.
- faberloom_board_review: aprueba o rechaza una revisión exacta.
- faberloom_board_reopen: reabre un elemento.
- faberloom_board_effect: registra un efecto externo autorizado.
- faberloom_board_mark_stale: marca un elemento obsoleto.
- faberloom_board_revalidate: revalida un elemento obsoleto.

Skills
- faberloom_skills: lista las skills instaladas.
- faberloom_skill_save: crea o edita una skill; el markdown debe empezar con
  frontmatter YAML que incluya name y description.
- faberloom_skill_remove: elimina una skill por nombre.

Memoria del módulo
- faberloom_memory: lista la memoria, opcionalmente por espacio.
- faberloom_memory_remember: guarda un hecho.
- faberloom_memory_update: edita texto o visibilidad de una entrada.
- faberloom_memory_forget: elimina una entrada.

Contexto
- faberloom_context: lista entradas de contexto.
- faberloom_context_create: crea una entrada.
- faberloom_context_update: edita una entrada y crea una versión.
- faberloom_context_remove: elimina una entrada.

Flujos de trabajo
- faberloom_workflows: lista flujos con espacio, estado y nodos.
- faberloom_workflow_get: lee un flujo completo.
- faberloom_workflow_create: crea un flujo vacío.
- faberloom_workflow_update: cambia nombre, visibilidad, estado o concurrencia.
- faberloom_workflow_delete: elimina un flujo.
- faberloom_workflow_node_add: añade un nodo.
- faberloom_workflow_node_update: edita un nodo.
- faberloom_workflow_node_remove: elimina un nodo.
- faberloom_workflow_connect: conecta dos nodos.
- faberloom_workflow_disconnect: elimina una conexión.

Correo
- faberloom_email_inbox: lista el buzón IMAP.
- faberloom_email_read: lee un correo por UID.
- faberloom_space_from_email: crea un espacio desde un correo.

Conexiones MCP
- faberloom_mcp_servers: lista servidores MCP instalados.
- faberloom_mcp_server_save: crea o edita una conexión stdio o streamable-http.
- faberloom_mcp_server_remove: elimina una conexión.
- faberloom_mcp_server_probe: prueba una conexión y devuelve sus tools o el fallo.

Workspaces y sesiones
- faberloom_workspaces: lista workspaces con ruta y cantidad de sesiones.
- faberloom_workspace_create: registra una carpeta existente como workspace.
- faberloom_sessions: lista sesiones, opcionalmente por workspace.
- faberloom_session_create: crea una sesión de chat.
- faberloom_session_send: envía un mensaje a una sesión.

Rutinas
- faberloom_routines: lista rutinas.
- faberloom_routine_get: lee una rutina completa.
- faberloom_routine_create: crea una rutina con nombre e intención.
- faberloom_routine_update: edita una rutina.
- faberloom_routine_remove: elimina una rutina.
- faberloom_routine_active: activa o pausa una rutina.
- faberloom_routine_visibility: cambia su visibilidad.
- faberloom_routine_run: inicia una rutina con clave de idempotencia.
- faberloom_executions: lista ejecuciones y su estado.

Enseñanzas y autonomía
- faberloom_teachings: lista enseñanzas.
- faberloom_teaching_record: registra una enseñanza.
- faberloom_teaching_edit: edita una enseñanza conservando la versión anterior.
- faberloom_teaching_revoke: revoca una enseñanza.
- faberloom_grants: lista concesiones de autonomía.
- faberloom_grant: concede autonomía para una acción.
- faberloom_grant_revoke: revoca una concesión.

Respaldo y migraciones
- faberloom_backup_create, faberloom_backup_list, faberloom_backup_verify,
  faberloom_backup_restore.
- faberloom_migrations_list, faberloom_migrations_run.

Resumen
- faberloom_overview: conteos de espacios, agentes, rutinas, mesa y ejecuciones.

Al terminar, devolvé un resumen breve con lo creado o cambiado y el siguiente
paso concreto.
```

## 4. Prueba de conexión (la corre Claude)

Pedirle a Claude exactamente esto:

```text
Hacé esta prueba y mostrame el resultado de cada paso, sin escribir datos:
1. initialize contra el conector. Confirmá protocolVersion y que
   serverInfo.name sea "faberloom".
2. tools/list. Contame cuántas tools hay y si aparecen estas diez:
   faberloom_skills, faberloom_memory_update, faberloom_context_create,
   faberloom_workflow_node_add, faberloom_email_read,
   faberloom_mcp_server_save, faberloom_workspace_create,
   faberloom_session_send, faberloom_routine_create y
   faberloom_agent_purge.
3. Llamá faberloom_overview y decime cuántos espacios, agentes y rutinas hay.
4. Llamá faberloom_workspaces y faberloom_sessions con limit 3. Confirmá que
   los paths son los del equipo local (por ejemplo C:\...), no /data/users/....
5. Llamá faberloom_skills y faberloom_routine_get con una rutina existente; no
   escribas nada.
6. Si algo falla, mostrame el texto exacto del error y no lo reintentes más de
   una vez.
```

La prueba pasa si:

- `initialize` devuelve `protocolVersion` `2025-06-18` y `serverInfo.name`
  `faberloom`.
- `tools/list` incluye las diez tools nuevas.
- `faberloom_workspaces` devuelve rutas del PC (`C:\...`), no `/data/users/...`.
- `faberloom_overview` y `faberloom_skills` devuelven datos sin error.

## 5. Diagnóstico rápido

- **401 token desconocido o revocado**: el token no es el del escritorio, fue
  revocado, o FaberLoom no está abierto y el token no llegó a registrarse.
- **503 FaberLoom está cerrado**: abrir la app en el equipo; el puente se
  reconecta solo.
- **`tools/list` no muestra las tools nuevas**: el escritorio tiene una build
  anterior; instalar la build nueva y volver a abrir la app.
- **Claude no acepta Bearer**: usar la URL `https://harness.mwt.one/mcp?token=...`
  con autenticación “No authentication”.
- **Se filtró un token**: revocarlo en la tabla de FaberLoom (botón Revocar de
  la fila) y crear otro.

## 6. Seguridad

- Cada persona usa su propio token; no compartir el token de Alejandro con
  Álvaro ni al revés.
- El token da acceso a la cuenta y a los archivos locales que esa cuenta puede
  leer; tratarlo como una contraseña.
- El gateway no guarda el token en disco: lo enruta al escritorio que lo
  registró y el servidor MCP local lo valida en cada llamada.
- Si se usa `?token=`, el token viaja en la URL; usar HTTPS y no compartir la
  URL. Preferir la cabecera Bearer cuando Claude la soporte.
