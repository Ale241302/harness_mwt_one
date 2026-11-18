# T10-E1 · Vías alternativas en la composición real

- Contrato: C-FL-04 · Ola O3 · Etapa E1
- Revisión: `c7a20b03a1`
- Alcance: UI/API, tool, MCP, shell, HTTP, navegador, subagente, flujo y rutina, con grant y con `effect:false`
- Nivel: C1-E (pruebas ejecutadas) + C1-L (composición)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2

## 1. Qué se montó y qué no

La composición del producto es `base` + `web-app` + `faberloom-app`. Las vías que T10 nombra, una por una:

| Vía | ¿Montada? | Evidencia | Control en E1 |
|---|---|---|---|
| UI (paneles) | Sí | fila `ui-faberloom` | `sendEmailDraft(id, seenUpdatedAt)` exige la versión revisada |
| API (remotos) | Sí | `@Remote` del view | la misma guarda; el actor sale de la sesión |
| Tool del agente | Sí | fila `tool-faberloom` | `faberloom_mail_send` rechaza siempre y su descripción lo dice |
| MCP | Sí | `faberloom-mcp-server` + `mcp.call` | sin herramienta de envío; `mcp.call` exige grant por servidor+herramienta y falla cerrado sin autoridad |
| Shell | **No** | el perfil del producto monta el preset `faberloom`, sin `tool-bash`, `tool-pwsh`, `tool-jobs` ni `shell-env` de sesión; `packages/preset/agent-presets/tests/faberloom-preset.spec.ts` lo fija | no hay proceso que ejecutar |
| HTTP (fetch/búsqueda) | **No** | el mismo preset omite `tool-web`; además `web-search-deepseek` y `web-fetch-http` están `disabled` en el parche de producto | no entra contenido externo por esa puerta |
| Navegador | **No** | ninguna fila `browser-use`/`computer-use` | — |
| Subagente | Sí | registro en `base`; el hijo hereda el preset del padre (`composedPreset`) | el hijo ejecuta la **misma** herramienta registrada: no hay un segundo emisor |
| Flujo | Sí | `faberloom-workflows` + `faberloom-handlers` | manejador `smtp` rechaza; `effect:false` no lo salta |
| Rutina | Sí | `faberloom-routines` + transición O3-05 | rechazo y pausa; ninguna rutina incompleta queda activa |

Las cuatro ausentes no se fingen probadas: si una se monta, T10 obliga a repetir sus controles antes de habilitarla. El build web genérico conserva el preset `standard`, que sí trae shell y web; **no es el perfil del producto** y no se usa para firmar este gate. Además, el producto cierra el selector (`modeSelectionEnabled: false`): el default no se puede mover desde ajustes y `select` rechaza cualquier cambio de preset.

## 2. Negativos ejecutados

| Vía | Prueba | Qué hace | Resultado |
|---|---|---|---|
| Tool | `tool-faberloom/tests/mail-send-denied.spec.ts` | `faberloom_mail_send` con un grant `mail.send` real y vigente en la autoridad | `WRITE_NOT_APPROVED`; `sendMail` nunca se llama |
| Tool | misma | `keeps the tool definition honest: it says the send is refused`: la descripción dice «external effect» y «refuses the send» | el modelo lee que el envío se rechaza; la ejecución sigue negando |
| Flujo/rutina | `handlers/tests/t10-effect-false.spec.ts` | paso `smtp` con `effect:false` | el motor no pide grant, el manejador rechaza; ejecución `failed`, sin envío |
| Flujo/rutina | misma | paso `effect:true`, permiso `mail.send`, grant exacto emitido | el motor autoriza, el manejador rechaza; queda `needs_review` con `EFFECT_UNCERTAIN` |
| Flujo/rutina | misma | paso `effect:true` sin grant | `NOT_AUTHORIZED` antes de llamar al manejador |
| UI/API | `connections/tests/drafts.spec.ts` | envío con la versión anterior a una edición | `DRAFT_CHANGED`; el borrador sigue en `draft` |
| UI/API | misma | envío sin declarar versión | `DRAFT_CHANGED`: omitir la versión no aprueba nada |
| UI/API | `client/ui-faberloom` | el panel guarda y envía la versión que acaba de guardar | el remoto recibe `('draft-1', '2026-09-27T00:00:00Z')` |
| MCP | `board/tests/board-effects.spec.ts` | aceptar un ítem con efecto y despacharlo sin adaptador | `EFFECT_NO_ADAPTER`; el ítem queda `PENDIENTE` |
| MCP | `effects-mail/tests/mail.spec.ts` | composición sin `mail.send` aceptado | el adaptador no se registra |
| MCP | `handlers/tests/steps.spec.ts` | `mcp.call` sin autoridad montada | falla cerrado |
| Canario | `access/tests/canary.spec.ts` | secreto en custodia | no aparece en descripción, rechazo, error, aviso ni log |
| Destinos | `connections/tests/egress.spec.ts` | host fuera de la política, incluso al probar conexión | `EGRESS_DENIED` sin abrir socket |

## 3. Grant genérico

No existe un grant comodín: `check()` compara la acción exacta y los grant se emiten por acción. El comodín solo existe en firmas CEO y está apagado (`allowWildcardSignatures: false`). La prueba del tool emite un grant **real** de `mail.send` y aun así no envía: un grant autoriza una acción, no un mensaje.

## 4. Hallazgo del gate: la guarda no corría en la vía real

`connections.sendDraft(ownerId, id, seenUpdatedAt?)` comparaba la versión solo si el llamador la pasaba. El único llamador de la UI, `view.sendEmailDraft(id)`, no la pasaba: la guarda `DRAFT_CHANGED` era código muerto en la vía que usa una persona. Se corrigió en la cadena completa:

| Pieza | Cambio |
|---|---|
| `connections.sendDraft` | `seenUpdatedAt` obligatorio; ausente o distinto rechaza |
| `view.sendEmailDraft` | recibe y propaga la versión |
| remoto del cliente | transporta el segundo argumento |
| panel | guarda el borrador y envía la versión devuelta por el guardado |

## 5. Evidencia ejecutada

```
vitest handlers + tool-faberloom + connections + view + routines + execution   506 pruebas
tsc --noEmit (connections, view, client)                                       exit 0
gen-cordis-catalog / gen-cordis-api --check                                    al día
verify-doc-budgets / verify-md-wrap / check-closure / check-plan               PASS
```

## 6. Lo que queda para E2

| Pendiente | Dueño |
|---|---|
| Aprobación del mensaje exacto que sustituya cada rechazo | O6 (E2) |
| Habilitar `FABERLOOM_EFFECT_ACTION_TYPES=mail.send` solo con esa aprobación montada | E2/PC4 |
| Prueba de subagente con modelo real (sin clave no hay hijo que razone) | E2 |
| Repetir T10 sobre shell, HTTP o navegador si alguna se monta | E3 |
