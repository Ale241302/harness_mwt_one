# T14 · actualización al SHA upstream fijado

Ejecutado el 2026-11-20 sobre la revisión candidata de O7 (`391ce6b11f` y sus padres de correo) con el gate `scripts/faberloom-daily/update-gate.ts`.

## Decisión

**`BLOCKED_AUTH_CORE`.** Los contratos que el producto importa sobreviven al SHA fijado: 48 specifiers, 0 faltantes. La actualización completa no se declara hecha porque 19 archivos de `packages/core` difieren del objetivo y fusionarlos exige `AUTH-CORE` (motivo, snapshots, migración y rollback). No se declara compatibilidad: se declara el resultado medido.

## Qué se ejecutó

```sh
corepack pnpm exec tsx scripts/faberloom-daily/update-gate.ts . 39163dd30f703a79079e2d2446545cff3c453738
```

El gate es read-only: lee referencias locales, no hace fetch, no escribe ni cambia ramas. Para cada import del producto y del cliente resuelve el paquete en el SHA objetivo y comprueba que el nombre exista en su superficie pública (`src/index.ts` y los módulos que re-exporta). Un nombre ausente en el objetivo y en la base común, pero declarado en el árbol de trabajo, se marca como carga propia del fork; un nombre ausente en el objetivo que sí existía en la base falla el gate.

## Resultado

| Dato | Valor |
|---|---|
| SHA objetivo | `39163dd30f703a79079e2d2446545cff3c453738` |
| Base común | `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` |
| Separación | 828 commits por delante · 10 042 por detrás |
| Archivos propios (producto y cliente) | 1 098 |
| Specifiers importados | 48 |
| Con símbolos faltantes | 0 |
| Con carga propia (fork) | 3 |
| Archivos de núcleo distintos | 19 |

### Carga propia que la fusión debe resolver

- `@deepseek-ai/dsh-api-workspace-files` → `WorkspaceFileMutation` existe en el árbol del fork, no en el objetivo.
- `@deepseek-ai/dsh-llm` → `providerAccountFailureCode` y `providerFailureMessage` existen en el árbol del fork, no en el objetivo.
- Paquetes `@deepseek-ai/dsh-faberloom-*`: propios del producto; viajan con el fork y no se comparan.

### Núcleo que exige `AUTH-CORE`

`packages/core/agent`, `agent-loop`, `agent-default-model`, `agent-tool-presentation`, `scope`, `session` (`known-event-types.ts`), `system-prompt` y `tools`. La lista completa está en la salida del gate.

## Recorridos afectados, repetidos en la revisión candidata

| Recorrido | Comando | Resultado |
|---|---|---|
| Recepción, escritura IMAP, envío, intentos y conciliación | `vitest run packages/faberloom/connections/tests packages/faberloom/inbound/tests` | PASS |
| Vista, borradores, acciones de buzón | `vitest run packages/faberloom/view/tests` | PASS |
| Panel de correo (componente) | `vitest run packages/client/ui-faberloom/tests/registration.client.spec.tsx` | 145 PASS |
| Correo en el producto ensamblado | `DSH_SNAPSHOT=replay vitest run --config vitest.web.config.ts apps/web/tests/email-panel.e2e.ts` | 9 PASS |
| Apariencia A1-A9 en navegador | `DSH_SNAPSHOT=replay vitest run --config vitest.web.config.ts apps/web/tests/appearance-compare.e2e.ts` | 8 PASS |
| Gates del plan | `vitest run scripts/faberloom-daily` | 78 PASS |
| Conjunto afectado de O7 | ver `../e2/appearance-report.md` | 572 PASS |

## Lo que el gate no prueba

- No ejecuta el producto sobre el árbol del upstream: compara contratos públicos.
- Los recorridos se repiten en la revisión candidata, no en una mezcla ya fusionada.
- La fusión de los 19 archivos de núcleo y de los tres puntos de carga propia requiere una ventana con `AUTH-CORE` y su propio runbook de migración/restore.

## Intento de fusión del 2026-11-20

`AUTH-CORE` quedó registrada en `FaberLoom_tarea_2026-11-16/D/decisions/AUTH-CORE.md` y la fusión se ejecutó en un worktree aislado, sin tocar `main` ni producción.

- Nodo de verificación: Node `24.22.3` portátil, porque el objetivo exige `>=24.9`.
- Lockfile: el del SHA objetivo, con `@earendil-works/pi-ai@1.3.0` y su parche aplicado; los importers de FaberLoom se añadieron después.
- Primera estrategia: fusión de tres vías con 882 conflictos. Los agentes resolvieron 441 antes de agotar su cuota, pero la comprobación mostró que algunas resoluciones habían eliminado archivos que el objetivo sí añade (`LanguageRow.tsx`, por ejemplo). Se descartó ese árbol.
- Segunda estrategia: árbol exacto de `39163dd30f…` como resolución de la fusión, con superposición de las carpetas propias (`packages/faberloom`, `packages/client/ui-faberloom`, `packages/skill/skill-install`, `gateway`, `.opencode`, planes y scripts FaberLoom). Esto elimina la pérdida de archivos del objetivo y deja 991 conflictos resueltos por una regla explícita.
- `pnpm install` terminó con el lockfile objetivo y el parche de `pi-ai` activo.
- `pnpm run typecheck` llegó a los compiladores reales y falló con 432 errores: 221 `TS6307`, 66 `TS2339`, 38 `TS2345`, 30 `TS2353`, 26 `TS2322` y el resto repartido. No son solo los 19 archivos del gate.
- Los cambios de API que bloquean el producto incluyen `ISessions.open`, los slots `float.banner` y `sidebar.workspaces.rowMenu`, `ILayout.openFloatConversation`, `ToolBatchResult`/`ToolBatchInput`, `RequestMessage`, `credentialRef` en `LlmCallConfig`, y primitives eliminadas o renombradas en `ui-primitives`.
- La migración toca más de cien archivos de FaberLoom y sus pruebas. No se fusionó ni se publicó un árbol que no compila.

**Resultado: T14 continúa abierto como bloqueo de migración de API.** El worktree `deepseek-harness-t14` conserva el intento reproducible; `main` sigue en `a39fd1d978` y producción en ese mismo SHA. Cerrar T14 exige completar la migración del producto, regenerar catálogos y snapshots, repetir los recorridos y obtener revisión independiente.

## Intento del 2026-11-21

Se reanudó la migración sobre el mismo worktree (`t14/upstream-39163dd`, HEAD `996f8c793a` más cambios sin confirmar). No se confirmó ni desplegó nada.

### Causa raíz de la mayor parte de los 432

La fusión sustituyó los tres agregados del fork por los del objetivo. Eso dejó fuera los alias `paths` de los paquetes FaberLoom y sus referencias de proyecto, así que TypeScript compilaba los tests contra `lib/types` y contra `src` a la vez (221 `TS6307` y decenas de identidades duplicadas). Reparado:

- `tsconfig.base.json`: 37 alias `@deepseek-ai/dsh-faberloom-*`, `dsh-client-ui-faberloom` y `dsh-skill-install`.
- `tsconfig.host.json`: 36 referencias de proyectos FaberLoom.
- `tsconfig.client.json`: la referencia de `packages/client/ui-faberloom`.
- `ui-faberloom/tsconfig.json`: referencias a las hojas `tsconfig.client.json` de `locale`, `ui-settings` y `ui-theme` (sus raíces son solo solución y no son `composite`).

### Migraciones de código aplicadas

| Área | Cambio |
|---|---|
| `ctx.tools.execute` | `{calls:[{type:'tool-call', id, name, arguments:JSON}]}` y lectura de `batch.results[0].result`; cinco llamadas en `checks-mwt`, `handlers` y `view`. |
| Mensajes | El rol `plugin` desapareció del contrato; los tres mensajes de plugin usan `source:{kind:'user'}`. |
| `KvTable` | `deleteMany(keys)` implementado en `mirror` (baseline y documentos) y en el envoltorio de `board`. |
| `LlmError` | Códigos restringidos a `BuiltinLlmFailureCode`: `UNSUPPORTED_PROVIDER→NO_ADAPTER`, `BAD_REQUEST→INVALID_REQUEST`, `UNSUPPORTED→MODEL_UNSUPPORTED`. |
| `LlmCallConfig`/`GenerateOptions` | `credentialRef` ya no viaja en la petición; la ruta del proveedor es la única fuente. Se retiró del `RequestRoute` y del override por mención. |
| `RequestMessage` | Los ayudantes de política aceptan `Message | RequestUserInput` y tratan `source` ausente como turno humano. |
| Proyecciones | `stateOf(session, key)` devuelve `unknown`; los permisos de Space se validan con su esquema antes de leer `.spaces`. |
| `skill-install` | El objetivo retiró `parseSkillFrontmatter`, `userSkillRoot`, `projectSkillRoot` y `findSkillProjectRoot` de `skill-filesystem`; se incorporaron al paquete (`frontmatter.ts`, `roots.ts`). |
| `SessionPersistence` | El contrato ya no borra sesiones. La copia espejo obsoleta se conserva con aviso y la poda archiva en vez de borrar. |
| `WorkspaceRegistry` | Sin eventos `workspace/removed`/`renamed` ni `archiveSessionsUnder`; se eliminó el listener y la poda archiva las sesiones del área una por una. |

### Estado medido tras esas migraciones

| Agregado | Errores |
|---|---|
| `tsconfig.host.json` | 72 (casi todos en pruebas de `skill-install`, `tool-faberloom`, `session-agent` y `handlers`) |
| `tsconfig.client.json` | 43 (todo en `packages/client/ui-faberloom`) |

El código de `packages/faberloom` fuera de `tool-faberloom` compila.

### Bloqueos estructurales, no mecánicos

1. **Plano de capacidad de los subagentes — RESUELTO con decisión del CEO.** El objetivo había eliminado `persona` y `toolFilter` de `SubagentCapabilities` y de `SubagentStartRequest`. Se amplió el contrato: nuevo tipo público `SubagentComposition`, campo `composition?` en `SubagentStartRequest`, validación `UNSUPPORTED_CAPABILITY` para backends externos, aplicación en `materialize` mediante la composición que ya usaba la reanudación en frío, y persistencia en el descriptor. `packages/subagent/subagent` compila.
2. **Escritura de archivos del espacio — RESUELTO con decisión del CEO.** `WorkspaceFiles` quedó de solo lectura y el seam `ctx.fs` no tenía operaciones de carpeta. Se añadieron al seam `createDirectory`, `removeEntry` y `moveEntry`, con código nuevo `FS_UNSUPPORTED` y denegación por defecto en la clase base, implementación local y fenced en el sandbox. Las tres herramientas `faberloom_files_*` ahora usan `ctx.fs` y el cwd de la sesión. `fs`, `fs-local`, `fs-sandbox` y el código de `tool-faberloom` compilan.
3. **Modelo de credenciales por agente — DECISIÓN PENDIENTE.** El objetivo movió la credencial de la petición a la configuración del adaptador: `LlmCallConfig` y `GenerateOptions` ya no llevan `credentialRef`, y `LlmProviderInfo` tampoco lo expone, así que una ruta registrada no puede declarar su propia referencia. FaberLoom guarda una llave por agente (`hasApiKey`); la opción elegida (una ruta por agente) exige ampliar el seam de LLM, no es solo trabajo de producto. No se eliminó la función en silencio: quedó retirada del código que compila y las pruebas que la exigían son las que fallan.
4. **Cliente de `ui-faberloom`.** 43 errores por `ISessions.open`, `ILayout.openFloatConversation`/`closeFloatConversation`, los slots `float.banner`, `sidebar.workspaces` y `sidebar.workspaces.rowMenu`, `pickFile` y primitivas retiradas. Es mecánico pero amplio y toca la estructura visual común.

### Decisión pendiente

T14 no se puede cerrar con una migración fiel sin decidir el punto 3. Como una ruta no puede llevar referencia propia, las opciones son: (a) ampliar el seam de LLM para que una ruta declare su referencia de credencial; (b) aceptar llaves por ruta de proveedor y retirar la llave por agente con su nota de producto. La primera conserva la función; la segunda es más simple pero cambia el producto.

### Nota de producto

La llave por agente deja de aplicarse a las peticiones del modelo: el objetivo resolvió la credencial en la configuración del adaptador y `LlmProviderInfo` ya no expone una referencia por ruta. La ficha de Agentes conserva el valor guardado y su indicador, y el texto del panel advierte que la credencial la resuelve la ruta del proveedor. Retirar el campo, si el CEO lo decide, es un cambio de UI separado.

### Estado medido al cierre de esta jornada

| Agregado | Errores | Dónde |
|---|---|---|
| `tsconfig.host.json` | 12 | solo pruebas de `session-agent` que exigen la llave por agente |
| `tsconfig.client.json` | 43 | `packages/client/ui-faberloom` |

Se migraron las pruebas de `skill-install`, `tool-faberloom`, `handlers` y `mirror` al contrato de lote y a los nuevos seams. El código de producción del lado host compila; no se confirmó, fusionó ni desplegó nada.
