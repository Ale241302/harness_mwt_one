# Revisión independiente de O3, ronda 3

- Fecha: 2026-11-17
- Alcance: O3-01, O3-02A, O3-02B, O3-02C, O3-03, O3-04, O3-05 y O3-06 de `tasks/todo.md`, más T10-E1 y la revisión de seguridad del gate. No incluye O4, PC3, E2 ni los casos T12/T13 globales.
- Revisión verificada: `c7a20b03a1` para el código, la composición y los expedientes, HEAD `0e6315d167` para la ejecución.
- Método: lectura de código, de composición y de los expedientes (C1-L) más pruebas unitarias, e2e y programas de tipos ejecutados sobre el árbol (C1-E).
- Veredicto: **NEEDS_WORK**.

## 1. Revisión y árbol

`c7a20b03a1` existe y es ancestro de HEAD. `git diff --stat c7a20b03a1..HEAD -- packages apps` no muestra archivos: el commit posterior solo toca expedientes y documentos generados. `git cat-file -e c7a20b03a1:<ruta>` devuelve las cinco rutas que abrí: `packages/preset/agent-presets/src/index.ts`, `packages/bundle/faberloom-app/cordis.patch.yml`, `apps/web/tests/preset-composition.e2e.ts`, `apps/web/tests/scaffold.ts` y `packages/preset/agent-presets/tests/settings.spec.ts`.

El árbol estaba limpio antes de la revisión. La corrida de `email-panel.e2e.ts` regeneró tres capturas en `docs/scratch/faberloom-daily-work/e1/visual/` (`email-wide-look-a.png`, `email-wide-look-b.png`, `mesa-scratch-task.png`); las restauré a HEAD con `git checkout --` y el árbol volvió a quedar sin cambios. No son parte de esta revisión.

## 2. Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `vitest run` sobre `access`, `connections`, `effects-mail`, `execution`, `shares`, `notices`, `handlers`, `workflows`, `tool-faberloom`, `routines`, `view` y `packages/preset/agent-presets` | 79 archivos, 843 pruebas pasan, 1 omitida, salida 0 |
| `tsc -b tsconfig.host.json` | salida 0 |
| `DSH_SNAPSHOT=replay vitest run --config vitest.web.config.ts apps/web/tests/preset-composition.e2e.ts apps/web/tests/email-panel.e2e.ts` | 2 archivos, 2 pruebas pasan, salida 0 |
| `tsx scripts/faberloom-daily/check-plan.ts` | PASS (modelo, documentos, baseline) |
| `tsx scripts/faberloom-daily/check-closure.ts` | PASS (configuración, evidencia: 16 archivos, 0 problemas) |
| `tsx scripts/gen-cordis-catalog.ts --check` | 107 archivos generados al día, salida 0 |
| `tsx scripts/gen-config-catalog.ts --check` | excepción: 2 violaciones por la forma de `inject` (ver R-2) |
| `git diff --stat c7a20b03a1..HEAD -- packages apps` | vacío |
| `git cat-file -e c7a20b03a1:<ruta>` para cinco rutas | las cinco existen |

La prueba omitida sigue siendo la de enlaces simbólicos de `discovery.spec.ts:359`, fuera del alcance de O3.

## 3. Estado de los seis hallazgos de la ronda 2

| Hallazgo | Estado | Qué lo sostiene |
|---|---|---|
| N-1 selector y `modeSelectionEnabled` | **Parcial** | El techo existe y está probado para el selector, el default guardado y `select`: `selectionPolicy()` (`agent-presets/src/index.ts:255-265`) calcula `enabled = config.modeSelectionEnabled !== false && (settings?.modeSelectionEnabled ?? true)`; el bundle fija `modeSelectionEnabled: false`; `settings.spec.ts:179-200` prueba que un `true` y un `default: standard` guardados no reabren ni mueven el default, y que `select` rechaza. Queda la creación de una sesión nueva por la API con `agentPreset` explícito. Ver R-1. |
| N-2 prueba estática | **Cerrado** | `apps/web/tests/preset-composition.e2e.ts` arranca `base + web-app + faberloom-app`, crea una sesión desde la UI y comprueba `defaultId`, `modeSelectionEnabled`, el catálogo (`faberloom_mail_send` presente; `bash`, `pwsh`, `edit`, `read`, `read_image`, `write`, `web_fetch`, `web_search` ausentes) y el rechazo de `select`. Pasa en mi corrida. El arreglo del scaffold (`scaffold.ts:504-530`) conserva el `config` compuesto y ya no pisa el default del producto. |
| N-3 fila de T10 sobre la descripción | **Cerrado** | `t10-surfaces.md:34` cita `keeps the tool definition honest: it says the send is refused` y las dos frases que exige. |
| N-4 fila 1 del censo | **Cerrado** | `authority-census.md:26` remite a `identity.md` y dice que la identidad se corrigió. |
| N-5 persona del preset | **Cerrado** | `presets/faberloom/agent.cordis.yml:36-40` describe al agente de trabajo, lo que hace y que no tiene shell, fs ni web. |
| N-6 JSDoc de `shares` | **Cerrado** | `shares/src/index.ts:340-363`: `requireNotices` tiene su bloque y `notify` recuperó el suyo, con `@param notices`. |

## 4. Hallazgos de esta ronda

### R-1 · La creación de sesión por la API acepta un preset explícito y esquiva el techo

**Qué.** La política cierra el selector, el default guardado y `select`, pero la creación de una sesión nueva por el remoto acepta `agentPreset` y monta el preset pedido sin consultar el techo.

**Dónde.** La cadena es: `packages/api/session-controller/src/index.ts:247` (`@Remote('create')`) → `packages/api/session-controller/src/commands.ts:98-120` (pasa `request.agentPreset` a `ensureSession`) → `packages/api/session-controller/src/agent.ts:486-500` (`composeAgent` llama a `presets.resolve(presetId)` y a `presets.mount(agentCtx, resolvedId)`). En `packages/preset/agent-presets/src/index.ts`, `resolve` (`:378`) y `mount` (`:449`) no consultan `selectionPolicy`; el techo solo se aplica en `select` (`:734-740`) y en la proyección de la lista (`:295`).

**Por qué importa.** Un cliente con la sesión del dueño puede crear una sesión nueva con `agentPreset: 'standard'` y recuperar shell, fs y web, que es exactamente la ruta que N-1 cerró en el selector. La UI no manda el campo (el `create` del cliente no lo incluye), pero el remoto lo acepta y el e2e solo prueba `select`. El gate de efectos exige que toda ruta que monte el shell pase por la misma autoridad o se desmonte; esta ruta lo monta sin pasar por la política que el despliegue acaba de cerrar.

**Qué lo cierra.** En la creación de una sesión nueva (sin `sessionId`), rechazar con `RemoteError('agent-preset/locked', ...)` un `agentPreset` distinto del default cuando `selectionPolicy().enabled` sea falso, y dejar intacta la reanudación de una sesión existente con el preset que ya tiene guardado. Añadir una prueba que llame al remoto `create` con `agentPreset: 'standard'` y espere el rechazo, y cubrir el caso en el e2e o en una prueba del controlador de sesión.

### R-2 · El catálogo de configuración generado está roto y no incluye el campo nuevo

**Qué.** `verify-config-catalog` no puede correr: el generador lanza una excepción por dos declaraciones de `inject`, y `docs/config-catalog.md` no lista `modeSelectionEnabled` en el bloque de `agent-presets`.

**Dónde.** `tsx scripts/gen-config-catalog.ts --check` termina con `gen-config-catalog: 2 violation(s)` y nombra `packages/faberloom/notices/src/index.ts` y `packages/faberloom/assignment/src/index.ts`: en los dos, `inject is not a plain string-array literal`. Ambos usan `static inject = ['storageDomain'] as const`. El bloque generado de `agent-presets` está en `docs/config-catalog.md:124-142` y no tiene `modeSelectionEnabled`, aunque el `Config` de `packages/preset/agent-presets/src/preset.ts` lo declara y el loader lo acepta. `scripts/run-gates.ts:752` incluye `verify-config-catalog` en `doc-sync`.

**Por qué importa.** El catálogo es la referencia generada de las opciones que el loader acepta, y su frescura es un gate del repositorio. Sin el campo, la opción que cierra el selector no está documentada donde se busca, y `doc-sync` queda rojo. `notices` es un paquete de O3; `assignment` puede ser de otra ola, pero el generador falla antes de escribir para los dos y el campo nuevo es de esta ola.

**Qué lo cierra.** Enseñar al generador la forma `as const` (o ajustar las dos declaraciones), regenerar `docs/config-catalog.md` y `docs/config-catalog.zh.md`, y dejar `verify-config-catalog` en verde. Comprobar que el bloque de `agent-presets` incluye `modeSelectionEnabled?: boolean`.

### R-3 · El punto de control conserva un agregado y una referencia viejos

**Qué.** `wave-checkpoint.md:41` dice "841 pruebas, 79 archivos" y `:70` apunta la firma de O3 a `O3-review-round-1.md`.

**Por qué importa.** La corrida medida de esta revisión da 843 pruebas en 79 archivos (1 omitida), y la revisión pendiente es esta ronda 3. El punto de control es el documento que el CEO lee al cerrar; un agregado y una referencia que no corresponden obligan a corregirlos después de la firma.

**Qué lo cierra.** Actualizar el agregado a 843 pruebas (o "843 pasan, 1 omitida") y la referencia a `O3-review-round-3.md` en el mismo cambio del cierre.

### R-4 · Las dos frases del gate no citan la prueba ejecutable del shell

**Qué.** La fila Shell de `t10-surfaces.md:20` y el veredicto de `gate-security-review.md:78` citan solo `faberloom-preset.spec.ts` para la ausencia de shell.

**Por qué importa.** La ronda 2 pidió una prueba que no fuera estática. `apps/web/tests/preset-composition.e2e.ts` existe, arranca el producto y mira el catálogo, y pasa; pero los dos documentos que sostienen la frase del gate no la nombran. Un lector que abra la cita encuentra el test de YAML y no el arranque.

**Qué lo cierra.** Añadir la cita del e2e en las dos filas, manteniendo el test estático como comprobación de las filas del preset.

## 5. Qué no cubre esta revisión

- O4 (recepción de dos cuentas, lector, búsqueda, adjuntos), PC3, E2 y los casos T12/T13 globales. El expediente declara que no los cierra y esta revisión no los abre.
- Un envío real por shell, por MCP o por cualquier vía. R-1 es lectura de la cadena de creación de sesión; no ejecuté una creación con `agentPreset: 'standard'` porque no puedo añadir pruebas en esta revisión.
- Un prompt de modelo real con canario; `custody.md` §2 ya lo asigna a E2.
- La rotación de credenciales y la retirada de las copias 3, 4 y 5, que siguen en manos del CEO según `decision-register.md` §6.
- La corrección del generador de configuración. R-2 documenta el fallo y su cierre, pero no lo arreglé.

## 6. Consecuencia para el cierre

La ola no se puede marcar `CLOSED` con esta revisión. Los seis hallazgos de la ronda 2 están cerrados, salvo la puerta de la API de creación de sesión que deja abierta N-1 (R-1), y el gate generado del catálogo de configuración (R-2) sigue rojo. R-3 y R-4 son correcciones de expediente y de cita que deben viajar con el cierre.

No hay frase firmable en esta ronda. La revisión que habilite el cierre tiene que ejecutarse sobre una revisión que contenga el rechazo de `agentPreset` explícito en la creación de sesión, su prueba, y el catálogo de configuración regenerado con `verify-config-catalog` en verde; y tiene que decir en una línea que el selector, el default, `select` y la creación de sesión quedan cerrados por la misma política.
