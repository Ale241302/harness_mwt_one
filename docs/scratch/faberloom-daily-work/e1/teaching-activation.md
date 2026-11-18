# O5-06A/B — Activación humana de lecciones

- Contrato: C-FL-04 · Ola O5 · Etapa E1
- Precisión aplicada: PREC-04 — la lección se aprueba por separado de la respuesta
- Estado: **READY_FOR_REVISION** (revisión independiente en curso)
- Alcance: propuesta → aprobación humana → uso → edición/revocación → reinicio; captura fallida visible; cierre de las tres rutas automáticas (tool, flujo, MCP)

## 1. La regla, en un solo lugar

`packages/faberloom/learning/src/activation.ts` decide si una activación puede proceder. Es una función pura y la aplica el servicio en la operación que escribe el estado:

| Situación | Resultado |
|---|---|
| La lección no es `candidate` | `ACTIVATION_NOT_CANDIDATE` |
| La versión aprobada no es la vigente | `ACTIVATION_VERSION_STALE` |
| El aprobador está vacío | `ACTIVATION_NO_APPROVER` |
| El aprobador es una ruta automática (`agent:`, `workflow:`, `mcp:`, `tool:`, `routine:`, `capture:`, `system:`) | `ACTIVATION_APPROVER_IS_MACHINE` |
| No hay referencia al acto humano | `ACTIVATION_NO_APPROVAL_REF` |

Lo válido se guarda en `teaching_activations` (quién, qué acto, qué versión, cuándo). La aprobación no se deduce de haber aprobado la respuesta de la que salió la lección.

## 2. Qué cambia en el ciclo

- `createTeaching` **siempre** crea `candidate`. Ya no existe `active` en la entrada de creación.
- `activateTeaching(ownerId, id, { approvedBy, approvalRef, proposalVersion })` es la única vía a `active`.
- `retrieve` sigue devolviendo solo `active`; una propuesta no influye en ninguna decisión. El perfil de voz del correo (`emailVoice` y el borrador con IA) lee con `retrieve`, así que una propuesta o una revocada no moldea la siguiente respuesta.
- El modelo no puede pedir candidatas por la tool de recuperación: `includeCandidates` ya no está en su esquema. Las propuestas se revisan en la lista de enseñanzas, no se usan.
- Editar una lección activa, registrar un error tardío o importar conocimiento la devuelve a `candidate`: la persona aprobó el texto anterior. El historial de versiones se conserva.
- Revocar es definitivo para esa lección; `activateTeaching` no la revive y una lección nueva es la vía de regreso.

## 3. Las tres rutas automáticas

| Ruta | Qué hace ahora | Prueba |
|---|---|---|
| Tool `faberloom_memory_teach` | No declara `active` y rechaza el argumento si llega | `tool-faberloom/tests/spaces-memory.spec.ts` |
| Flujo `memory.teach` | No lee `active`; si el nodo lo trae, falla con `ACTIVATION_NOT_ALLOWED` | `handlers/tests/steps.spec.ts` |
| MCP `faberloom_teaching_record` | Registra propuesta; rechaza `active` con `ACTIVATION_NOT_ALLOWED` | `mcp-server/tests/mcp.spec.ts` (por el transporte JSON-RPC real) |

El MCP era el hueco concreto: creaba la enseñanza con `active: true` en `tools.ts:2423`. Ya no.

## 4. Captura fallida visible

`recordCaptureFailure` guarda tarea, fuente, detalle e instante; `teachingHealth` devuelve propuestas, activas, revocadas, capturas fallidas y la última. Las dos capturas del correo (`email-trash`, `email`) registran el fallo sin romper la operación que ya había tenido éxito, y el panel de Enseñanzas muestra el contador y el último detalle. La prueba de vista comprueba que el movimiento a papelera se completa y que el fallo queda registrado.

## 5. Evidencia ejecutada

```
vitest learning, backup, view, tool-faberloom, handlers, mcp-server,
       client/ui-faberloom                                  815 pruebas, 80 archivos
tsc -b (los mismos paquetes)                                exit 0
oxlint (los mismos src)                                     sin hallazgos
```

Casos que importan:

| Prueba | Qué demuestra |
|---|---|
| `activation.spec.ts` propuesta | No influye ni con `includeCandidates: false` |
| `activation.spec.ts` aprobación | Activa la versión exacta y queda registrada |
| `activation.spec.ts` rechazos | Máquina, referencia vacía y versión vieja |
| `activation.spec.ts` edición | La aprobación vieja no cubre el texto nuevo |
| `activation.spec.ts` revocación + segundo arranque | No revive ni con una instancia nueva sobre el mismo medio |
| `activation.spec.ts` captura | El fallo se cuenta y se ve |
| `memory.spec.ts` F36/F15/F32 | Edición, error tardío e importación vuelven a propuesta |
| `spaces-memory.spec.ts` / `steps.spec.ts` / `mcp.spec.ts` | Las tres rutas automáticas rechazan `active` |

## 6. Límites declarados

- La aprobación humana se prueba en el servicio y en la ruta del panel (`view/tests/teachings.spec.ts`); **no** hay todavía un e2e de navegador que recorra propuesta → aprobación → uso. Queda para O5-06B/e2e de memoria.
- Las lecciones que ya estaban `active` antes de este cambio se consideran instrucciones explícitas del dueño bajo la regla anterior; no se degradan en bloque. Una copia restaurada o replicada por el mirror sí vuelve como propuesta.
- El panel muestra el contador de capturas fallidas, pero no permite archivarlas ni marcarlas como atendidas.
- La aprobación se escribe antes del estado y se borra si el estado falla. Si el proceso muere entre las dos escrituras, queda una fila de aprobación huérfana; el estado sigue `candidate`, así que no activa nada, pero la historia puede mostrar una aprobación sin efecto.
- `saveTeaching` con `activate: true` aprueba en el mismo gesto humano de registrar; es una decisión del panel, no una aprobación implícita del agente.
