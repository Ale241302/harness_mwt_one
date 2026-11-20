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

**Resultado: T14 continúa abierto como bloqueo de migración de API.** El worktree `deepseek-harness-t14` conserva el intento reproducible; `main` sigue en `1088155b5c` y producción en ese mismo SHA. Cerrar T14 exige completar la migración del producto, regenerar catálogos y snapshots, repetir los recorridos y obtener revisión independiente.
