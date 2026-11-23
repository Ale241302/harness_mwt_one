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

## Estado del 2026-11-22: candidato integrado, T14 abierto

La migración se completó sobre el árbol exacto del objetivo (`39163dd30f`) con la capa propia superpuesta. El núcleo del candidato es idéntico al del objetivo: `git diff --name-only 39163dd30f HEAD -- packages/core` no devuelve ninguna ruta. El gate de actualización ahora mide árboles y no rangos de commits (`coreFilesTouched`), porque un candidato que estrena el árbol del objetivo sobre la historia del fork hacía que `target...HEAD` contara como propios todos los cambios del objetivo; su veredicto es `PASS` con 48 specifiers, 0 faltantes, 1 carga propia y 657 archivos propios.

### Medido

| Agregado | Comando | Resultado |
|---|---|---|
| Compilación host | `tsc -b tsconfig.host.json` | 0 diagnósticos |
| Compilación cliente | `tsc -b tsconfig.client.json` | 0 diagnósticos |
| Build completo | `pnpm run build` | 10/10 gates, 0 fallos, 381 artefactos de cliente |
| Gate de actualización | `tsx scripts/faberloom-daily/update-gate.ts . 39163dd30f` | PASS; 0 archivos de núcleo distintos |
| Vista, borradores, acciones de buzón | `vitest run packages/faberloom/view/tests` | 27 archivos, 302 pruebas PASS |
| Panel de correo (componente) | `vitest run packages/client/ui-faberloom/tests` | 22 archivos, 283 pruebas PASS |
| Recepción, escritura IMAP, envío, conciliación | `vitest run packages/faberloom/connections/tests packages/faberloom/inbound/tests` | 14 archivos, 106 PASS |
| Migración v3→v4 y persistencia | `vitest run packages/session/session-format-v3-to-v4/tests packages/session/session-persistence/tests` | 21 archivos, 421 PASS |
| Copia y espejo | `vitest run packages/faberloom/backup/tests packages/faberloom/mirror/tests` | 81/82; el fallo por orden se reproduce igual en el fork |
| Gates del plan | `vitest run scripts/faberloom-daily` | 4 archivos, 79 PASS |
| Correo en el producto ensamblado | `DSH_SNAPSHOT=replay vitest run --config vitest.web.config.ts apps/web/tests/email-panel.e2e.ts` | 6/9; 3 casos pendientes de alinear (abajo) |

### Pruebas migradas al contrato nuevo

- `board-accounts.spec.ts` responde al lote de herramientas (`{calls:[…]}` → `{results:[{result}]}`) y comprueba los argumentos serializados.
- `workspace-board.spec.ts` deja de exigir `forgetSpacePath`/`adoptWorkspaceTitle`: el registro del objetivo no publica `workspace/removed` ni `workspace/renamed`, así que el espejo se reconcilia solo desde `deleteSpace`/`renameSpace`. Una edición del sidebar ya no renombra el Space.

### Lo que impide cerrar T14

1. La capa propia está incompleta. Faltan 1 955 archivos que el fork añadió y el objetivo no tiene: `skills-catalog/` (682), `skills-shared/` (445), `agents-shared/` (73), `packages/bundle/faberloom-app/` (7), `scripts/push-to-vps.ps1` y los de copia y restauración (27), `snapshots/session/*` (22), los activos públicos de `apps/web` (marca y tipografías), los e2e propios de `apps/web/tests`, `deploy/consola-provider-keys/` y `nginx/harness.conf`. Con ese hueco el producto no se puede empaquetar ni desplegar, y las snapshots del producto no se ejecutan.
2. Tres casos del panel ensamblado no coinciden con la conducta actual: el contexto del correo viaja como `source:{kind:'user'}` y se pinta como burbuja de usuario en lugar de la fila de inyección de contexto; el título de la sesión tras crear el Space no aparece donde el caso lo busca; y «Pedir un cambio a la IA» abre hoy la conversación nativa, no el cuadro de texto que el caso espera.
3. Falta la revisión independiente sobre este candidato.

No se fusionó ni se desplegó nada.
