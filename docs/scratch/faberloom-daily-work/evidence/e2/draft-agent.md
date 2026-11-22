# Agente de borradores: conversación, contexto, historial y aprendizaje

English | [中文](draft-agent.zh.md)

- Base: worktree `deepseek-harness-t14`, con cambios sin confirmar. Producción no se modificó.
- Alcance: borrador editable desde la conversación nativa, contexto autorizado de origen e hilo, adjuntos, sesión persistente, revisiones, aprendizaje por propuestas, firma y Space explícito.
- Nivel: C1-I.
- Estado: CLOSED.
- Gate y aprobación: ninguna para esta ejecución aislada. No hay autorización de despliegue.
- Autor: OpenCode.
- Revisión independiente: revisión funcional final **PASS** y revisión de seguridad final **PASS**, ambas sobre el código actual y con los hallazgos de las rondas anteriores cerrados.
- Fixture de composición: `packages/faberloom/view/tests/draft-agent-composition.spec.ts`, SHA-256 `0D4C00B86BB5BBCE7998BE3429F32277F17037C32F8FD754843F497B40D99BFC`, contenido sintético.

## Comandos y resultados

- Pruebas enfocadas Host: `mail-attachments`, `draft-revisions`, `draft-agent`, `space-files`, `space-from-email`, `space-entry-authority`, `spaces`, `draft-tools`, `send-space-file-by-email`, `save-space-attachment` y `export-space-view`: **11 archivos, 147/147 pruebas aprobadas**.
- `corepack pnpm exec vitest run packages/client/ui-faberloom`: **22 archivos, 283/283 pruebas aprobadas**.
- `corepack pnpm exec tsc -b` de `view`, `tool-faberloom`, `connections`, `spaces`, `working-directory` y `ui-faberloom`: **0 errores**.
- `corepack pnpm run build:artifacts`: **8/8 gates aprobados** (native, Typert, Host compiler y bundle, Desktop, Client compiler y bundle, Web). Registró 381 artefactos de cliente.
- `corepack pnpm run build:check`: **2/2 comprobaciones aprobadas**, Host y Cliente.
- `corepack pnpm run verify-tool-catalog`: catálogo actualizado.
- `corepack pnpm run verify-upgrade-guides`: guías conformes.
- `corepack pnpm run verify-client-ui-i18n`: **1398 archivos** con texto propiedad de los diccionarios.
- `verify-export-jsdoc` sobre los archivos de esta entrega: sin hallazgos nuevos; los 58 avisos restantes son deuda T14 preexistente en `packages/fs`.
- Snapshot keyless `faberloom-draft` con `DSH_SNAPSHOT=replay`: **PASS**. El intento anterior mezcló todos los snapshots y falló por ejecutar el modo real, no por una regresión de este cambio.
- Los cuatro pares README modificados: consistentes. `test:docs` conserva fallos T14 ajenos y no se presenta como verde.

## Comportamiento observado

El editor guarda antes de abrir. `draftSessionStart` crea en el Host una sesión dedicada, inyecta el contexto sin despertar un turno y la vincula con CAS sobre la sesión anterior y la revisión revisada. El Cliente ya no puede proporcionar un `sessionId` o seed arbitrario. Al recrear un agente vinculado, `agent/created` reinstala la política.

Solo se anuncian cuatro tools de lectura, update, historial y restore del borrador. Un guard del executor rechaza cualquier otra tool y cualquier otro `draftId`. La composición hostil intentó `faberloom_mail_trash` y una escritura sobre otro borrador; ambas quedaron denegadas antes del cuerpo de la tool.

El hash cubre mensaje, adjuntos, origen, Space y `aiText`. `saveDraft` solo crea: un id existente se rechaza y toda sustitución pasa por `updateDraft` con la revisión esperada. Restaurar y transferir exigen la revisión que la persona tenía abierta. Enviar exige siempre el hash antes de crear un intento o contactar SMTP. `updateDraftAndRecord` conserva el snapshot exacto y ordena update e historial por borrador.

El seed completo tiene un máximo de 48.000 caracteres, ocho mensajes, doce adjuntos convertidos y doce lecciones acotadas. Space valida la confirmación antes de efectos; después del commit, un fallo posterior devuelve el estado real con `completion: 'partial'` y la interfaz no navega.

Las sesiones provisionadas sin turno se liberan al superar el límite de ocho: `provision` llama a `evict` y una prueba crea nueve borradores y observa exactamente un `dispose`. El seed ya no nombra una tool denegada; cuando la conversión no está disponible pide el archivo al owner.

## Controles negativos

Las pruebas rechazan owner incorrecto, identidad read-only, escritura o restore obsoleto, doble binding concurrente, seed sobre una sesión de borrador, reintento con seed antiguo, Space sin Workspace y confirmación obsoleta sin crear, copiar, provisionar ni adjuntar. Ninguna prueba activa una lección. No se envió, movió, marcó ni borró correo.

La ronda de seguridad añadió controles ejecutados: `faberloom_mail_download` rechaza loopback, redes privadas, link-local, multicast, credenciales en la URL y cuerpos de más de 20 MB, y revalida cada redirección; una ejecución sin sesión se rechaza con `MAIL_WORKSPACE_UNAVAILABLE`; el adjunto aterriza en el directorio efectivo de `workingDirectory`, no en el `cwd` original; el directorio `correo-adjuntos` se revalida por identidad antes de cada escritura; los límites de adjunto se miden sobre los bytes decodificados y no sobre el `size` declarado; firmas y `seedMailSession` rechazan una identidad read-only; y renombrar, borrar, abrir, exportar o guardar un adjunto en un Space exige `canManage`, rechaza un enlace simbólico que resuelva fuera del área y no sobrescribe un archivo existente.

`space-entry-authority.spec.ts` ejerce esas denegaciones por el ejecutor: `renameSpaceEntry`, `deleteSpaceEntries`, `openSpaceFile`, `attachMailToSpace`, `saveSpaceAttachment` y `sendSpaceFileByEmail` rechazan a un lector no gestor antes de tocar el disco o el buzón; un enlace dentro del área se rechaza en renombrar, borrar, abrir y enviar; y renombrar/borrar un archivo regular siguen funcionando para quien gestiona. `export-space-view.spec.ts` añade la denegación por falta de gestión, el rechazo de `exportaciones` como enlace y el de un destino enlazado.

## Snapshot keyless

`snapshots/session/faberloom-draft` monta almacenamiento y tools reales mediante `dsh --profile headless`, sin buzón ni red. El replay filtrado con `DSH_SNAPSHOT=replay` pasó sobre el build final y cubre creación, schemas y prompt del agente de borradores.

## Recorrido visual

Perfil aislado `visual-t14` en `http://127.0.0.1:3099`, con dos borradores sintéticos y almacenamiento en `C:/Users/ale13/AppData/Local/Temp/visual-t14-data`. En tema oscuro se verificó: lista de dos borradores, editor con adjunto, «Versión revisada», historial #1/#2, botón de IA como conversación, y consola sin errores. Se editó el texto, se pulsó «Vincular a default-workspace» y el texto mecanografiado siguió en el editor; el historial añadió #3 (guardado previo) y #4 (vínculo), y el botón pasó a «Este borrador ya pertenece a un Space».

Los tokens `--dsw-*` resolvieron dentro de `[data-faberloom]`: `--dsw-font-ui-body` = 13px/20px, `--dsw-control-hit-target` = 44px, fondo oscuro `rgb(21, 21, 23)` con texto `rgb(249, 250, 251)`, y sin desbordamiento horizontal a 1000×700.

En móvil, Playwright con viewport 390×844 reprodujo el editor completo: `scrollWidth` 390 = `clientWidth` 390, sin desbordamiento horizontal, `--dsw-control-hit-target` 44px, el cuerpo y el texto añadido visibles, el historial #1–#6 y el aviso de Space presentes, y consola sin errores. Captura: `mail-mobile-editor.png` en esta carpeta.

## Limitaciones y trabajo separado

No se usaron buzones, proveedores, credenciales ni producción. El ancho móvil se comprobó con emulación de viewport en Playwright, no en un dispositivo físico. No hay despliegue ni commit. La transferencia conserva la sesión anterior e inyecta historia acotada; no clona el log completo. Update e historial siguen siendo dos escrituras no transaccionales y la serialización está probada por instancia, no entre procesos.

Quedan como trabajo T14 separado, sin declararse cerrados: el token de ingesta que `faberloom_sources_register` devuelve en el resultado y el log, la duplicación de bytes de adjuntos por revisión de historial (requiere un almacén content-addressed), los fallos de `spaces-ask`, `board-accounts` y `workspace-board`, la decisión de instalación `.zip` y la rotación de credenciales pegadas en el chat.

El escritor de adjuntos no puede abrir el directorio una sola vez con `dirfd` porque Node no expone esa API; la mitigación compara `dev`/`ino` y `realpath` antes y después de cada escritura. Queda una ventana TOCTOU residual que requiere un proceso hostil con acceso de escritura al workspace.

La descarga no usa `fetch`: resuelve una vez, valida todas las direcciones y conecta con `node:https.request` a la dirección aprobada, con `servername` para TLS y `Host` original. La prueba comprueba que el socket usa `93.184.216.34` y no vuelve a resolver, lo que cierra el DNS rebinding clásico.
