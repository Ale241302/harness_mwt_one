# T14 · migración del cliente FaberLoom a la arquitectura del SHA `39163dd30f`

Trabajo hecho en el worktree `deepseek-harness-t14` (rama `t14/upstream-39163dd`), limitado a `packages/client/ui-faberloom/**`. No se tocó `packages/core`, el host ni otros paquetes del cliente, y no se confirmó ni desplegó nada.

## Resultado

| Dato | Antes | Después |
|---|---|---|
| `tsc -b tsconfig.client.json` | 43 diagnósticos, todos en `ui-faberloom` | 0 |
| `vitest run packages/client/ui-faberloom/tests` | no ejecutable (el paquete no compilaba) | 22 archivos PASS · 283 pruebas PASS (exit 0) |
| `oxlint packages/client/ui-faberloom` | — | 0 |

Comandos:

```sh
$env:PATH="C:\Users\ale13\AppData\Local\Temp\opencode\node24\node-v24.22.3-win-x64;$env:PATH"
$env:NODE_OPTIONS="--max-old-space-size=8192"
corepack pnpm exec tsc -b tsconfig.client.json
corepack pnpm exec vitest run packages/client/ui-faberloom/tests
corepack pnpm exec oxlint packages/client/ui-faberloom
```

## API retirada y reemplazo usado

| API retirada | Reemplazo | Archivos |
|---|---|---|
| `ctx.sessions.open(id)` | `ctx.uiWorkspace.openSession(target)` — la navegación de sesión es del dueño de la vista (`UiWorkspace` en `packages/client/ui-workspace/src/client/navigation.ts`), no de `ISessions` | `src/client/index.ts`, `src/client/task-chat.ts`, `src/client/space-from-email.ts` |
| `ctx.sessions.binding(x as never)` con el tipo de `open` | `ctx.sessions.binding(id)` sigue existiendo; el id almacenado se tipa con `Parameters<UiWorkspace['forkSession']>[0]` (el `SessionId` real) mediante un `toSessionIdentity` local | `src/client/index.ts`, `src/client/task-chat.ts` |
| `ctx.layout.openFloatConversation()` / `closeFloatConversation()` | Retirado del `ILayout` nuevo (`packages/client/ui-layout/src/client/service.ts`): no hay conversación flotante. Se elimina la llamada; abrir la sesión ya revela el panel central (`replaceMain(..., 'reveal')`) y `selectPanel(null)` se conserva | `src/client/index.ts` (5 llamadas) |
| Slot `float.banner` | Slot `shell.overlay` (lista, capa flotante del frame) con `id: 'faberloom-mail-suggestion'` | `src/client/index.ts`, `src/client/mail-suggestion-banner.tsx`, `src/client/mail-suggestion-banner.module.css` |
| Slot `sidebar.workspaces.rowMenu` (menú de fila de Workspace) | `ctx.contextMenus.register({ target: 'workspace', ... })`: la cabecera de Workspace del sidebar abre el menú compartido con `kind: 'workspace'` (`ui-workspace` `Rows.tsx:302`) | `src/client/index.ts`; se retiraron los tres `*MenuItem` de `workspace-share.tsx`, `workspace-move.tsx`, `workspace-subspace.tsx` |
| Slot-level inject de `sidebar.workspaces` (nuevo `inject: SidebarSectionInjected` + `hookContext: SidebarSectionHookContext`) | La shell local declara el `inject` del ocupante y pasa `hookContext` en `renderSlot` | `src/client/index.ts`, `src/client/sidebar/sidebar.tsx`, `src/client/sidebar/contract.ts` |
| `ctx.remote.directoryPicker.pickFile()` | `pick(undefined)`; el Remote actual sólo expone `pick`/`list`/`createDirectory` (`packages/api/workspace-controller/src/directory-picker.ts`) y el selector del host sólo elige carpetas | `src/client/index.ts` (`pickArchive`) |
| `ctx.get('uiWorkspace') as { startSession }` | `ctx.uiWorkspace.startSession(workspaceId)` con el tipo `UiWorkspace` importado como sólo tipo | `src/client/index.ts`, `src/client/sidebar/contract.ts` |
| Props `workspaceId`/`title`/`close` de las filas de menú de Workspace | El objetivo del menú entrega `{ workspaceId, path, displayTitle }`; cada acción pide su diálogo con `requestShare` / `requestCreate` / `requestMove` sobre las acciones ligadas del store | `src/client/workspace-share.tsx`, `src/client/workspace-move.tsx`, `src/client/workspace-subspace.tsx`, `src/client/index.ts` |

## Decisiones de comportamiento

**Abrir una sesión ya no pasa por `ISessions`.** En la arquitectura nueva `ISessions` sólo retiene generaciones y lista el catálogo ("navigation belongs to view owners", `contract/sessions.ts:50`). `UiWorkspace.openSession` retiene la sesión con `source: 'mainView'`, publica la selección y revela el panel; es el equivalente exacto de lo que hacía `sessions.open`. Las llamadas que además hacían `selectPanel(null)` lo conservan: es idempotente y mantiene el estado previo.

**La conversación flotante no existe.** `ui-layout` retiró `openFloatConversation`/`closeFloatConversation` y el slot `float.banner`. El efecto útil de abrir/cerrar el flotante era mostrar la conversación sobre el panel de correo; hoy la conversación es el panel central y `openSession` la revela. Se eliminan las cuatro llamadas al flotante y el `float.banner` se muda a `shell.overlay`, la capa flotante genérica del frame (`ui-layout/src/client/index.ts:107`). La tarjeta conserva sus tres gestos (adjuntar, descargar, descartar) y pasa a posicionarse como tarjeta fija arriba a la derecha (abajo en pantallas de 640 px o menos).

**Las acciones de Workspace viven en el menú contextual compartido.** El sidebar nuevo no tiene menú de fila de Workspace: el título de cada grupo de sesiones es un disparador `kind: 'workspace'` de `ctx.contextMenus`. Las tres acciones se registran con ids propios (`faberloom.workspace.share`, `.subspace`, `.move`), orden 140/150/160 — entre el rename (100) y el delete (300) del host — y reusan el copy existente (`workspaces.share`, `workspaces.createSubspace`, `workspaces.move`). Cada `run` escribe sobre las acciones ligadas que la registración del diálogo recibe, así que no se crea ninguna instancia de store fuera de una registración (regla de stores del stack cliente).

**El ocupante de `sidebar.workspaces` recibe un `hookContext`.** El contrato nuevo exige `inject` en la declaración del hijo y `hookContext` en el `renderSlot`. La shell de FaberLoom no tiene navegación con scroll por encima del listado —la lista del browser es el único scroller—, así que entrega un `useSectionScroller` estable cuyo `bindScrollerRef` no hace nada. El hand-off de rueda del shell del host no aplica aquí; el scroll nativo de la lista queda intacto.

**Instalar un harness ya no elige un `.zip`.** El selector del host dejó de ofrecer selección de archivos. `pickArchive` ahora abre el mismo selector de carpetas que `pickFolder` y el asistente instala la carpeta elegida. Es la capacidad que se pierde con la migración.

## Pruebas

- `registration.client.spec.tsx` (144 PASS): además de adaptar el bench a la nueva navegación, el overlay del frame (`shell.overlay`) pasó a ser opcional (`bench(..., { overlay: true })`) y hay una prueba nueva que resuelve las tres contribuciones `workspace` del menú contextual y comprueba que la de compartir abre su diálogo con el título capturado.
- `workspace-share.client.spec.tsx`, `workspace-subspace.client.spec.tsx`: se retiraron los bloques que probaban los `*MenuItem` eliminados; el comportamiento equivalente (pedir el diálogo para un Workspace) queda cubierto en la prueba de registro del menú contextual. Las pruebas de store y de diálogo siguen igual.
- `task-chat.client.spec.ts`, `space-from-email.client.spec.ts`: el doble de `ctx` cambia `sessions.open` por `uiWorkspace.openSession` y se afirma la llamada nueva.
- `appearance-tokens.client.spec.ts`: en la primera pasada de esta migración fallaba 1 de 3, por una deriva previa del tema (el merge del upstream reemplazó la escala tipográfica y los tokens de navegación; el CSS del fork leía 24 tokens sin declarar). Comprobé que el archivo CSS tocado aquí (`mail-suggestion-banner.module.css`) no aportaba ninguno. Ese hueco lo cerró un cambio concurrente en el mismo paquete (`appearance-tokens.css`, cargado desde `panels.tsx`), así que la corrida final del conjunto está verde.

## Límites

- **Instalar desde `.zip`**: el host sigue aceptando un zip en `installHarness`, pero el cliente ya no tiene selector de archivos. Hoy sólo se instala una carpeta.
- **Anclaje visual del flotante**: la tarjeta de correo se ancla a la esquina superior derecha del frame en lugar de la parte superior del panel de correo. El componente no cambia; sólo su posición.
- No se ejecutaron `test:gui`, `build:artifacts` ni los e2e de web: la tarea pedía `tsc -b tsconfig.client.json` y la suite del paquete. El ensamblado del navegador sigue sin verificarse en esta rama.
- `packages/client/ui-faberloom/src/client/locales.ts` ya venía modificado en el worktree (una línea de `panel.agents.intro`); no se tocó.
- **Edición concurrente.** Mientras se cerraba esta migración, otra ventana del mismo worktree añadió `src/client/draft-chat.ts`, `src/client/appearance-tokens.css`, `tests/draft-agent.client.spec.ts` y cambios en `panels.tsx`, `tsdown.config.ts` y los README. No forman parte de esta migración; el build y la suite se midieron con ellos ya presentes.
