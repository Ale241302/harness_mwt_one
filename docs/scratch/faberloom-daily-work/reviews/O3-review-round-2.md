# Revisión independiente de O3, ronda 2

- Fecha: 2026-11-17
- Alcance: O3-01, O3-02A, O3-02B, O3-02C, O3-03, O3-04, O3-05 y O3-06 de `tasks/todo.md`, más T10-E1 y la revisión de seguridad del gate. No incluye O4, PC3, E2 ni los casos T12/T13 globales.
- Revisión verificada: `9b35cdb12b` para el código y la composición, HEAD `78a1fb38d8` para la ejecución.
- Método: lectura de código, de composición y de los expedientes (C1-L) más pruebas y programas de tipos ejecutados sobre el árbol limpio (C1-E).
- Veredicto: **NEEDS_WORK**.

## 1. Revisión y árbol

`9b35cdb12b` existe y es ancestro de HEAD. `git diff --stat 9b35cdb12b..HEAD -- packages apps` no muestra archivos: el commit posterior solo toca diez expedientes en `docs/scratch/faberloom-daily-work/`. `git cat-file -e 9b35cdb12b:<ruta>` devuelve las cinco rutas que abrí para comprobar el código y la composición: `packages/faberloom/access/src/credentials.ts`, `packages/faberloom/tool-faberloom/src/index.ts`, `packages/faberloom/shares/src/index.ts`, `packages/preset/agent-presets/presets/faberloom/agent.cordis.yml` y `packages/faberloom/access/tests/effect-census.spec.ts`.

El árbol estaba limpio antes y después de la revisión (`git status --porcelain` sin líneas). Las corridas no dejaron cambios versionados.

## 2. Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `vitest run` sobre `access`, `connections`, `effects-mail`, `execution`, `shares`, `notices`, `handlers`, `workflows`, `tool-faberloom`, `routines`, `view` y `packages/preset/agent-presets` | 79 archivos, 841 pruebas pasan, 1 omitida, salida 0 |
| `vitest run packages/preset/agent-presets` | 13 archivos, 193 pruebas pasan, 1 omitida |
| `tsc --noEmit` en `access`, `connections`, `effects-mail`, `handlers`, `tool-faberloom`, `shares` y `presets` | salida 0 en los siete |
| `tsx scripts/faberloom-daily/check-plan.ts` | PASS (modelo, documentos, baseline) |
| `tsx scripts/faberloom-daily/check-closure.ts` | PASS (configuración, evidencia: 16 archivos, 0 problemas) |
| `git diff --stat 9b35cdb12b..HEAD -- packages apps` | vacío |
| `git cat-file -e 9b35cdb12b:<ruta>` para cinco rutas | las cinco existen |

La prueba omitida es `discovery.spec.ts:359`, que depende de que el sistema pueda crear enlaces simbólicos. No es una prueba del alcance de O3 y no baja ningún umbral.

## 3. Estado de los nueve hallazgos de la ronda 1

| Hallazgo | Estado | Qué lo sostiene |
|---|---|---|
| H-1 shell montado | **Parcial** | El preset `faberloom` existe, omite las seis filas y el bundle fija `default: faberloom`. Pero el producto monta el selector de presets de `web-app` y `modeSelectionEnabled` sigue en verdadero, así que una persona puede volver a `standard`. Ver N-1 y N-2. |
| H-2 censo anclado a la revisión anterior | **Cerrado** | La cabecera cita `0b01ca39365ba04fe89858bcac56e3523896ee4d`, §1 declara que las anclas describen ese estado y §4 lleva el posterior. Verifiqué las diez anclas contra ese commit. |
| H-3 censo de seis archivos | **Cerrado** | `no-auto-send.md` §3 dice tres archivos y `effect-census.spec.ts` los fija. |
| H-4 conteo de pruebas de `access` | **Cerrado** | `authority-fail-closed.md` §5 dice 41 (26 de autoridad, 3 de censo, 10 de credenciales, 2 de canarios). La corrida da 41. |
| H-5 identidad de la Mesa | **Parcial** | H-7 y §6 del censo remiten a `identity.md`, pero la fila 1 de §2 sigue diciendo "pendiente de la identidad de la Mesa". Ver N-4. |
| H-6 descripción de la herramienta | **Cerrado en código y prueba** | La descripción dice que el envío se rechaza en este build y `mail-send-denied.spec.ts` comprueba `refuses the send`. La tabla de `t10-surfaces.md` quedó vieja. Ver N-3. |
| H-7 conteo y fila partida del censo | **Cerrado** | Dice "diez rutas", las diez filas están separadas y §4 dice "siete rutas de escritura del producto". |
| H-8 estado del plan en la skill | **Cerrado** | La sección final declara O0, O1 y O2 cerradas, PC1 y PC2 firmadas, O3 en revisión y PC3/PC4 abiertas. |
| H-9 aviso silencioso en `shares` | **Cerrado** | `requireNotices()` se resuelve antes de escribir y lanza; la prueba comprueba que no se guarda la concesión ni se publica. |

## 4. Hallazgos de esta ronda

### N-1 · El selector de presets del producto puede volver a montar `standard`

**Qué.** El producto fija `default: faberloom`, pero sigue exponiendo el selector de presets y el valor de política que permite que una persona cambie el default. Con eso, el shell, el sistema de archivos y el web vuelven a estar montados en una sesión del producto.

**Dónde.**
- `packages/bundle/web-app/cordis.patch.yml:332-335` monta `ui-agent-preset`, y el parche de producto no la desactiva.
- `packages/preset/agent-presets/src/index.ts:195` registra la política con `{ default: config.default, modeSelectionEnabled: true }`. El README del paquete (`:64-68`) dice que, mientras ese campo es verdadero, un default del usuario puede sustituir al del despliegue; mientras es falso, el default del despliegue gana aunque el documento del usuario conserve otro.
- `packages/client/ui-agent-preset/src/client/seat-store.ts:87-93` publica `showPicker: modeSelectionEnabled` y todas las opciones del catálogo; `packages/client/ui-agent-preset/src/client/AgentPresetSeat.tsx:135-186` dibuja el selector y llama a `select`.
- `packages/preset/agent-presets/src/index.ts:723-756` permite recomponer una sesión en blanco con cualquier preset del catálogo; `standard` sigue en el catálogo embarcado (`shipped-root.spec.ts` lista los cinco).
- `docs/scratch/faberloom-daily-work/e1/t10-surfaces.md` §1 dice Shell "No" y "no hay proceso que ejecutar"; `gate-security-review.md` §5 y `wave-checkpoint.md` §7 dicen que ninguna vía montada envía; `write-denied.md` §5 dice que shell, HTTP y navegador no están montados. Las tres frases valen para el default, no para el producto entero.

**Por qué importa.** El gate de efectos exige que toda ruta capaz de provocar el efecto pase por la misma autoridad o se desmonte. El selector es una ruta del producto, no del build web genérico: la persona elige `standard`, la sesión recibe `tool-bash` o `tool-pwsh` y el modelo puede abrir su propio socket. La decisión §8 registra el costo de perder shell, pero no registra esta puerta de vuelta. La frase "no hay proceso que ejecutar" es falsa para esa sesión, y la promesa del gate queda condicionada a que nadie cambie el preset.

Esto no dice que el modelo pueda cambiar el preset por su cuenta: el cambio lo hace una persona en una sesión en blanco. La objeción es de composición y de redacción: la tabla dice "No" sin la condición, y el producto ofrece la condición.

**Qué lo cierra.** Una de dos:
1. Quitar la puerta en el producto: fijar la política en `modeSelectionEnabled: false` para el perfil `faberloom`, de modo que el default del despliegue gane aun con un documento de usuario viejo, y desactivar o restringir `ui-agent-preset` en el parche de producto. Alternativa equivalente: un catálogo de producto que solo sirva el preset `faberloom`.
2. Si se conserva el selector, declararlo como vía montada en `t10-surfaces.md` con su control (la elección de una persona y la aprobación `ask` del sandbox) y corregir las tres frases de `gate-security-review.md` §5, `wave-checkpoint.md` §7 y `write-denied.md` §5 para que digan "en el preset del producto" y no "en el producto".

### N-2 · La prueba del preset no monta el producto, y es la única prueba del default

**Qué.** La evidencia del default y de la ausencia de shell es estática: `faberloom-preset.spec.ts` lee el YAML y una expresión regular sobre el parche. `shipped-root.spec.ts` valida la lista de entradas y que el preset figure entre los cinco. Ninguna de las dos arranca el perfil del producto ni mira el catálogo de tools del agente.

**Dónde.** `packages/preset/agent-presets/tests/faberloom-preset.spec.ts:14-45`, `packages/preset/agent-presets/tests/shipped-root.spec.ts:88-100`, `packages/preset/agent-presets/tests/mount.spec.ts:223-224` (monta `minimal`, no `faberloom`). El único arranque del producto completo que existe es `apps/web/tests/experience-session.e2e.ts`, que se auto-omite sin clave y en modo `record` (`:38`) y no consulta el catálogo de tools.

**Por qué importa.** La ronda 1 encontró precisamente que una tabla podía decir "no montado" mientras la composición lo montaba. La prueba nueva repite el mismo patrón en pequeño: comprueba el texto que el autor escribió, no lo que el Loader compone. Un error de resolución de filas, un id que no coincide o un `default` que el usuario puede sustituir no aparecen en un test de YAML. `packages/AGENTS.md` pide una prueba de composición real para un plugin visible del producto; el preset determina el catálogo de tools, así que es visible.

Además, aun con el default correcto, un test estático no puede probar N-1: que la política impide cambiarlo.

**Qué lo cierra.** Una prueba sin clave que arranque `base` + `web-app` + `faberloom-app` por el Loader, cree una sesión sin nombrar preset y afirme:
- `ctx.agentPresets.composedPreset(agent.ctx) === 'faberloom'`;
- el catálogo efectivo del agente no tiene `bash`, `pwsh`, `web_search`, `web_fetch`, `read`, `write` ni `edit` del preset;
- el catálogo sí tiene `faberloom_mail_send`;
- si se aplica la solución de N-1, `remoteExportList().modeSelectionEnabled === false` o el catálogo de presets servido no incluye `standard`.

`apps/web/tests/experience-session.e2e.ts` ya arma el producto y sirve de molde; la prueba nueva no necesita modelo ni red, solo el arranque y la lectura de servicios. Con eso la fila Shell de T10 quedaría probada por ejecución y no por lectura del archivo.

### N-3 · La tabla de T10 cita la prueba vieja de la descripción

**Qué.** `t10-surfaces.md` §2, fila de la tool, sigue diciendo: "la descripción dice «external effect» y la ejecución sigue negando | coherencia entre lo que el modelo lee y lo que pasa". La descripción ahora dice que el envío se rechaza en este build y la prueba se llama `keeps the tool definition honest: it says the send is refused`, con dos comprobaciones: `external effect` y `refuses the send`.

**Por qué importa.** La fila ya no describe la prueba que cita. En la ronda 1 el problema era que la tabla llamaba coherencia a una contradicción; ahora la contradicción no existe, pero la tabla no lo cuenta. Un lector que abra la prueba encuentra otras aserciones.

**Qué lo cierra.** Reescribir la fila con la prueba y la aserción actuales: la descripción dice que el envío se rechaza y la ejecución lo rechaza, y el test fija las dos frases.

### N-4 · La fila 1 del censo conserva el diagnóstico viejo

**Qué.** `authority-census.md` §2, fila 1, mantiene el veredicto "Aceptable en diseño, pendiente de la identidad de la Mesa". H-7 y §6 ya remiten a `identity.md`, pero la fila que tomó la decisión no.

**Por qué importa.** Es el mismo hecho que la ronda 1 señaló en dos lugares; uno quedó. La fila 1 es la que un lector usa para saber si la vía de la Mesa estaba controlada. "Pendiente de la identidad" sugiere un defecto del producto que `identity.md` declaró inexistente.

**Qué lo cierra.** Cambiar el veredicto de la fila 1 por el corregido: el adaptador lee el cuerpo aprobado y la identidad del ítem no estaba rota; los 212 fallos eran el entorno de pruebas.

### N-5 · El `persona` del preset describe al agente como "coding agent"

**Qué.** `packages/preset/agent-presets/presets/faberloom/agent.cordis.yml:32-37` mantiene `You are a coding agent powered by the {{model}} model.` en el preset de un agente de correo, Mesa, memoria y espacios.

**Por qué importa.** Es texto que ve el modelo en cada turno y contradice el propósito del preset y la decisión §8, que describe un agente de trabajo sin shell ni archivos. No es un problema de seguridad ni de composición; es copy model-facing equivocado y puede empujar al agente a comportarse como un agente de código. El autor ya lo señaló como pendiente de su propia revisión; lo registro para que no se pierda.

**Qué lo cierra.** Un `prefix` que nombre al agente de trabajo del producto, con su propia revisión de copy si se quiere separar del gate de O3.

### N-6 · JSDoc huérfano en `shares`

**Qué.** `packages/faberloom/shares/src/index.ts:340-348` conserva el JSDoc de `notify` justo encima del JSDoc de `requireNotices` (`:349-353`); el primer bloque queda huérfano y `notify` (`:362`) no tiene el suyo.

**Por qué importa.** No cambia el comportamiento y las pruebas pasan, pero deja dos contratos pegados y uno sin documento en el método que publica el aviso, que es el que la ronda 1 pidió endurecer. Es limpieza local.

**Qué lo cierra.** Mover el primer bloque a `notify` y dejar `requireNotices` con el segundo, sin tocar el código.

## 5. Qué no cubre esta revisión

- O4 (recepción de dos cuentas, lector, búsqueda, adjuntos), PC3, E2 y los casos T12/T13 globales. El expediente declara que no los cierra y esta revisión no los abre.
- Un arranque ejecutable del perfil del producto con inspección del catálogo de tools. Precisamente por eso N-2 queda abierto; no escribí esa prueba porque esta revisión solo puede crear su propio informe.
- Un envío real por shell, por MCP o por cualquier vía. La objeción de N-1 es de composición y de redacción, no una demostración de que alguien haya enviado.
- Un prompt de modelo real con canario; `custody.md` §2 ya lo asigna a E2.
- La rotación de credenciales y la retirada de las copias 3, 4 y 5, que siguen en manos del CEO según `decision-register.md` §6.

## 6. Consecuencia para el cierre

La ola no se puede marcar `CLOSED` con esta revisión. Los nueve hallazgos de la ronda 1 están cerrados o parcialmente cerrados con evidencia que se reproduce; lo que queda es la puerta de vuelta al preset `standard` (N-1), la prueba ejecutable que demuestre el montaje y el default (N-2) y tres correcciones de expediente o copy (N-3, N-4, N-5) más una limpieza (N-6).

No hay frase firmable en esta ronda. La revisión que habilite el cierre tiene que ejecutarse sobre una revisión que contenga la solución de N-1 y la prueba de N-2, y decir en una línea si el selector de presets se retiró del producto o se declaró como vía con su control.
