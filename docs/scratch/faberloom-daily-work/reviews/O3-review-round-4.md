# Revisión independiente de O3, ronda 4

- Fecha: 2026-11-17
- Alcance: O3-01, O3-02A, O3-02B, O3-02C, O3-03, O3-04, O3-05 y O3-06 de `tasks/todo.md`, más T10-E1 y la revisión de seguridad del gate. No incluye O4, PC3, E2 ni los casos T12/T13 globales.
- Revisión verificada: `afe9da6cf8` para el código, la composición y los expedientes, HEAD `2391d5e7c8` para la ejecución.
- Método: lectura de código, de composición y de los expedientes (C1-L) más pruebas unitarias, e2e, programas de tipos y generadores ejecutados sobre el árbol (C1-E).
- Veredicto: **PASS**.

## 1. Revisión y árbol

`afe9da6cf8` existe y es ancestro de HEAD. `git diff --stat afe9da6cf8..HEAD -- packages apps` no muestra archivos: el commit posterior solo apunta el campo `Revisión` en los expedientes. `git cat-file -e afe9da6cf8:<ruta>` devuelve las cinco rutas que abrí: `packages/preset/agent-presets/src/index.ts`, `packages/api/session-controller/src/commands.ts`, `packages/api/session-controller/tests/session-presets.host.spec.ts`, `packages/bundle/faberloom-app/cordis.patch.yml` y `docs/config-catalog.md`.

El árbol estaba limpio antes de la revisión. La corrida de `email-panel.e2e.ts` regeneró dos capturas en `docs/scratch/faberloom-daily-work/e1/visual/` (`email-wide-look-a.png` y `mesa-scratch-task.png`); las restauré a HEAD con `git checkout --` y el árbol volvió a quedar sin cambios. No son parte de esta revisión.

## 2. Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `vitest run` sobre `access`, `connections`, `effects-mail`, `execution`, `shares`, `notices`, `handlers`, `workflows`, `tool-faberloom`, `routines`, `view`, `packages/preset/agent-presets` y `packages/api/session-controller` | 119 archivos, 1.612 pruebas pasan, 3 omitidas, salida 0 |
| `tsc -b tsconfig.host.json` | salida 0 |
| `verify-config-catalog` | `docs/config-catalog.md` al día, salida 0 |
| `verify-cordis-catalog` | 107 artefactos al día, salida 0 |
| `verify-cordis-api` | 107 artefactos al día, salida 0 |
| `DSH_SNAPSHOT=replay vitest run --config vitest.web.config.ts apps/web/tests/preset-composition.e2e.ts apps/web/tests/email-panel.e2e.ts` | 2 archivos, 2 pruebas pasan, salida 0 |
| `tsx scripts/faberloom-daily/check-plan.ts` | PASS (modelo, documentos, baseline) |
| `tsx scripts/faberloom-daily/check-closure.ts` | PASS (configuración, evidencia: 16 archivos, 0 problemas) |
| `git diff --stat afe9da6cf8..HEAD -- packages apps` | vacío |
| `git cat-file -e afe9da6cf8:<ruta>` para cinco rutas | las cinco existen |

Las tres pruebas omitidas son dos que dependen de la capacidad de enlaces simbólicos (`discovery.spec.ts:359` y `media-references.host.spec.ts`) y una de plataforma (`media-references.host.spec.ts`, un FIFO en Windows); no son del alcance de O3 y no bajan ningún umbral.

## 3. Estado de los cuatro hallazgos de la ronda 3

| Hallazgo | Estado | Qué lo sostiene |
|---|---|---|
| R-1 creación por la API | **Cerrado para la sesión nueva** | `AgentPresets.selectionEnabled` expone la política (`agent-presets/src/index.ts:255-257`). `commands.create` rechaza con `RemoteError('agent-preset/locked')` cuando la sesión no está viva, el cliente manda un `agentPreset` distinto de `defaultId` y el selector está cerrado (`commands.ts:103-115`). La prueba `refuses a new session on a non-default preset when selection is closed` lo fija, y el mismo archivo comprueba que el default explícito y la creación sin preset siguen funcionando. La adopción de una sesión viva con su preset consta en la prueba `adopts a live Session under the preset selected in its log`. Queda un límite en la adopción en frío: L-1. |
| R-2 catálogo de configuración | **Cerrado** | `notices` y `assignment` usan `static inject = ['storageDomain']` (array simple). `docs/config-catalog.md:149` incluye `modeSelectionEnabled?: boolean`; `verify-config-catalog`, `verify-cordis-catalog` y `verify-cordis-api` están al día. |
| R-3 punto de control | **Cerrado** | `wave-checkpoint.md:41` cita 1.612 pruebas y 119 archivos, que coinciden con mi corrida. La fila de firma apunta a la ronda 3; se actualizará a la ronda que firme en el commit de cierre: L-3. |
| R-4 citas del gate | **Cerrado** | La fila Shell de `t10-surfaces.md:20` y el veredicto de `gate-security-review.md:78` citan `apps/web/tests/preset-composition.e2e.ts` como la prueba ejecutable, además de la estática del preset. |

## 4. Límites declarados

No hay hallazgos abiertos que impidan el gate. Quedan tres límites, ninguno de los cuales reabre la vía del shell ni cambia la frase del gate.

### L-1 · La adopción en frío con `agentPreset` explícito se rechaza

**Qué.** El guard de `commands.create` decide si una sesión es nueva con `this.ctx.sessions.get(sessionId) === undefined`. `SessionStore.get` devuelve solo sesiones vivas (`packages/core/session/src/index.ts:1205-1211`), así que una sesión que existe en disco pero no está viva se trata como nueva. Si un cliente reanuda esa sesión con `agentPreset` igual al que consta en su log y ese preset no es el default, el guard la rechaza con `agent-preset/locked` antes de que `createOrAdopt` lea el log (`agent.ts:581-592`).

**Por qué no bloquea.** El cliente del producto no manda `agentPreset` al reanudar: `manager.create` y `service.create` construyen la petición con `workspaceId`, `cwd` y `sessionId` y nada más (`packages/api/session-controller/src/client/sessions/manager.ts:553-564`, `service.ts:418-423`). La vía del producto reanuda con el preset guardado y las sesiones antiguas creadas en `standard` siguen abriendo. El rechazo falla cerrado: no monta el shell, solo devuelve un error a un cliente que use el campo en la adopción en frío. La prueba de adopción cubre la sesión viva, no la fría.

**Qué lo cerraría, si se decide endurecerlo.** Mover el techo a `createOrAdopt` después de `sessionQuery.observeSession`: si la sesión no existe, aplicar el techo; si existe, dejar que `assertPresetUnchanged` compare y use el preset del log. Añadir una prueba que cree una sesión en `standard`, la deje fría, y la adopte con su preset mientras el selector está cerrado. Queda como límite del API para E2 o la ventana siguiente.

### L-2 · El par chino del catálogo de configuración espera la rutina de traducción

**Qué.** `docs/config-catalog.md` incluye `modeSelectionEnabled?: boolean` en la línea 149; `docs/config-catalog.zh.md` todavía no lo tiene.

**Por qué no bloquea.** El catálogo generado en inglés es la fuente que `verify-config-catalog` verifica y está al día. La pareja china es una contraparte revisada que se actualiza con la rutina de traducción, que es de invocación explícita; el generador no la escribe.

**Qué lo cerraría.** Ejecutar la rutina de traducción sobre el par y comprobar que el bloque de `agent-presets` del `.zh.md` lista el campo.

### L-3 · La fila de firma del punto de control apunta a la ronda 3

**Qué.** `wave-checkpoint.md:70` deja la firma pendiente en `reviews/O3-review-round-3.md`; la revisión que firma es esta ronda 4.

**Por qué no bloquea.** Es una fila de estado que el commit de cierre actualiza al escribir `CLOSED`, como ya ocurrió en las rondas anteriores.

**Qué lo cerraría.** Apuntar la fila a `reviews/O3-review-round-4.md` en el mismo cambio que escribe `CLOSED`.

## 5. Qué no cubre esta revisión

- O4 (recepción de dos cuentas, lector, búsqueda, adjuntos), PC3, E2 y los casos T12/T13 globales. El expediente declara que no los cierra y esta revisión no los abre.
- Un envío real por shell, por MCP o por cualquier vía. La composición y las pruebas cubren el catálogo y los negativos; no ejecuté un envío.
- La adopción en frío con `agentPreset` explícito (L-1): la leí en el código, no la ejecuté con una prueba propia.
- La traducción al chino del catálogo de configuración (L-2): la rutina es de invocación explícita y no la ejecuté.
- Un prompt de modelo real con canario; `custody.md` §2 ya lo asigna a E2.
- La rotación de credenciales y la retirada de las copias 3, 4 y 5, que siguen en manos del CEO según `decision-register.md` §6.

## 6. Frase firmable

La ola O3, contratos O3-01 a O3-06, T10-E1 y la revisión de seguridad del gate, queda cerrada sobre la revisión `afe9da6cf8` con la evidencia ejecutada de la revisión independiente ronda 4; no cubre O4, PC3 ni E2, y acepta los límites L-1, L-2 y L-3 de este informe.
