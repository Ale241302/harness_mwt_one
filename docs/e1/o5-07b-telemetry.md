# O5-07B · Eventos, costos y límites durables con denominadores y avisos

- Contrato: C-FL-06 · Ola O5 · Etapa E1
- Fecha: 2026-11-23
- Caso registrado: `T19-E1@509d38cd79@E1-laboratorio`
- Revisión de las suites: árbol desplegado; el único commit posterior (`cb3f775a63`) solo cambia un documento de decisión
- Nivel: C1-E (prueba ejecutada en el runner del repositorio)
- Estado del contrato: **CERRADO**

## 1. Qué pedía el hueco

`e1/o5-checkpoint.md` §4 dejaba abierto «O5-07B eventos, costos y límites durables con denominadores y avisos» y, como pendiente separado, «Límite de ejecución que detiene y avisa». T19-E1 dependía de ambos.

## 2. Qué se implementó

### 2.1 Límite diario que detiene y avisa

`FaberLoomExecutions` acepta `maxRunsPerDay`. Cero o ausente significa sin límite.

- El contador vive en `<DSH_HOME>/faberloom-usage.json` como `{ day, runs }`, con la clave del día en UTC. Un ledger de otro día lee cero, así que el límite se reinicia sin un planificador propio.
- Solo cuenta una ejecución **iniciada**. Un pase que deduplica sobre una ejecución existente no gasta cupo dos veces.
- Al llegar al tope, el pase no inicia nada, devuelve `skipped = "daily execution limit reached (n/max)"` y deja **un aviso interno duradero** con `kind: "usage-limit"` y clave de deduplicación `usage-limit:<día>`. No se envía correo.
- Lo ya iniciado sigue su curso. El límite acota el trabajo que el despachador se procura a sí mismo, no una acción que el dueño ejecuta.

### 2.2 Denominadores separados

`faberloom-metrics.json` pasa a llevar tres bloques:

| Bloque | Contenido | Denominador de qué |
|---|---|---|
| `totals` | runs, failures, needsReview, waiting, retries, deadLettered, alerts | actividad del despachador |
| `denominators` | autonomyRuns, awaitingPerson, failed, unknownResult | **autonomía**: lo que el sistema hizo solo, lo que dejó a una persona y lo que falló |
| `usage` | day, runs, maxRunsPerDay, atLimit | consumo del cupo diario |

`unknownResult` se publica como 0 porque el despachador no produce resultados desconocidos propios: los produce el envío, y ese contador vive con los intentos de correo. Se declara aquí en cero en lugar de omitirlo para que el panel no tenga que adivinar el campo.

### 2.3 Por qué no se añadió un bus de eventos paralelo

Las propuestas, aprobaciones, correcciones y descartes ya son filas durables del tablero (`faberloom_board`), con su evento de auditoría por cambio de estado. Un segundo registro de los mismos hechos sería un segundo dueño del dato y una fuente de doble conteo. El informe del mes (T25/O8C) calcula sus denominadores desde esas filas y desde `faberloom_executions`, que son las fuentes autoritativas. Lo que faltaba no era un registro más, sino el límite y los denominadores publicados.

## 3. Cómo se comprobó

```text
corepack pnpm exec vitest run packages/faberloom/execution/tests
  Test Files  4 passed (4)
  Tests       40 passed (40)
```

`packages/faberloom/execution/tests/usage-limit.spec.ts` cubre tres casos:

1. Con `maxRunsPerDay: 2`, dos pases inician una ejecución cada uno; el tercero devuelve `skipped = "daily execution limit reached (2/2)"`, `started` vacío, un solo aviso `usage-limit`, y el archivo de métricas con `usage = { day: '2026-11-24', runs: 2, maxRunsPerDay: 2, atLimit: true }` y `denominators.autonomyRuns = 2`.
2. El contador queda escrito en `faberloom-usage.json` con `{ day: '2026-11-24', runs: 1 }`, el mismo día se bloquea y el día siguiente vuelve a cero.
3. Sin tope configurado no se bloquea ningún pase y no se publica ningún aviso.

Control positivo: los dos primeros pases del caso 1 inician trabajo real. Control negativo: el tercero no inicia nada y no toca el cupo.

## 4. Lo que este contrato no cubre

- Costo en dinero por ejecución: el presupuesto por agente ya existe (`BudgetPolicy`, `perExecution`), y su contabilidad se publica en el panel de agentes. Este contrato no la duplica.
- Un tope de gasto diario agregado. Si el dueño lo quiere, es una fila más del mismo contador con la misma prueba.
- Motivos de retorno del usuario: siguen siendo observación opcional, como pide N7.

## 5. Efecto en T19

`T19-E1` deja de estar bloqueado por O5-07B: eventos de trabajo, límites, aviso al detenerse y modo degradado tienen prueba ejecutada. Queda fuera de este contrato, y así se registra, la parte de costos por token y la de restauración, que viven en `e1/restore-daily-state.md` y en O5-07C.
