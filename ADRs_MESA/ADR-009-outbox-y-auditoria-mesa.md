# ADR-009 · Outbox de efectos por proceso y auditoría de acceso en la Mesa

**Estado:** aceptado · **Fecha:** 2/11/2026 · **Decisión:** cierre P3
**Relacionado:** `ADR-006` (Mesa central con PostgreSQL y RLS), `docs/faberloom/mesa-outbox-auditoria.md`

## Contexto

El cierre de la Mesa dejó dos escrituras de ítem que todavía vivían solo en el SQLite local:

1. `noteAccess` registraba la lectura de un ítem N3/N4 con `items().update`, así que el evento de auditoría existía en el respaldo del proceso y no en `mesa_events`. Dos usuarios del mismo tenant no veían la auditoría del otro.
2. El consumidor del outbox (`dispatchOne`, `expireForDispatch`, la revalidación y el consumo) leía y escribía el ítem en local. Un ítem aprobado en la Mesa podía ser invisible para el consumidor de otro proceso, o un respaldo atrasado podía cancelar un efecto que la Mesa seguía autorizando.

La fila de la Mesa es la autoridad compartida. El outbox, en cambio, no es estado del ítem: es una cola de trabajo con intentos, backoff y una reserva de despacho que solo tiene sentido en el proceso que tiene montado el adaptador del destino.

## Decisión

### 1. El outbox sigue siendo una cola de lease por proceso

Las tablas `effect_reservations`, `effect_outbox` y `effect_alerts` siguen en el almacén local (`ctx.storageDomain`). No se centralizan.

Por qué:

- **La cola no es estado compartido.** El despacho es la llamada al adaptador, que vive en este proceso; centralizar la cola obligaría a un protocolo de claim distribuido (lease, renovación, vencimiento) sobre una tabla nueva con RLS, y el beneficio sería el mismo: un solo emisor por efecto.
- **El ítem ya es la barrera.** Todo lo que decide si un efecto puede salir —estado, ventana de reversión, revalidación de controles, reserva— se calcula sobre el ítem, y el ítem ahora se lee y se escribe en la Mesa. La cola no decide nada.
- **La duplicación ya está cerrada en la cola.** `dispatchOne` reclama el mensaje (`PENDIENTE → DESPACHADO`) antes de llamar al adaptador, bajo la sección serial del tenant y con la re-verificación de `messageIsDispatchable` dentro del `update`; un segundo despacho del mismo efecto responde `OUTBOX_NOT_PENDING` sin emitir.

Regla que acompaña la decisión: **en `on`, todo ítem que toca el outbox se lee y se escribe en la Mesa.** `dispatchOne` usa un lector consciente del modo (`readItemRecord`), `expireForDispatch` pasa por `commitItem` (el mismo camino que `expireWindow`), y la copia local solo recibe el espejo del commit. Un respaldo ausente o atrasado nunca cancela ni autoriza un efecto.

Límite aceptado: si el proceso muere entre la aceptación y el despacho, su cola local se pierde. El ítem de la Mesa conserva `effectKey`, `executionId`, `actionType`, `reversalDeadline` y el evento `effect.accepted` con `destination` e `idempotencyKey`, que son los datos con los que un operador puede reconstruir el mensaje. La reconstrucción automática no forma parte de esta decisión.

### 2. La auditoría de acceso va a `mesa_events` por una ruta propia

Se añade `POST /board/items/:id/access`:

- El actor sale de la sesión (el token del proceso). El cuerpo solo acepta `detail`; `email`, `ownerId`, `tenantId` y `role` se rechazan con `INVALID_INPUT`, y cualquier otro campo se ignora. Un evento no puede nombrar a otro actor.
- La ruta exige la misma regla de lectura que `GET /items/:id` (dueño o administrador del tenant; otro tenant es `NOT_FOUND`).
- Deduplica en el servidor: dentro de la transacción busca un evento `access` del mismo actor en la última hora y, tras tomar el lock del ítem, vuelve a comprobarlo antes de insertar. Dos procesos que auditan al mismo actor y hora producen un solo evento.
- No mueve `rowVersion`: un acceso no es un comando, y moverlo dejaría obsoleta cualquier pestaña abierta.
- Responde `201 {event, recorded:true}` cuando inserta y `200 {event, recorded:false}` cuando ya existía uno en la hora.

En `off` y `shadow` la auditoría sigue en el registro local con la misma ventana de una hora por actor e ítem.

## Alternativas

| Alternativa | Por qué no |
|---|---|
| Centralizar el outbox en tablas de la Mesa | Exige claim distribuido, lease y recuperación nuevos, con su propio DDL y RLS, para una cola cuyo emisor es el proceso que tiene el adaptador; no mejora la garantía de una emisión por efecto |
| Auditar con `commit` (`command: 'access'`) | Incrementa `rowVersion` y por tanto invalida la versión que leyeron las demás pestañas; un acceso es una lectura |
| Auditar con `GET /events` + `POST /events` desde el cliente | La comprobación de la hora sería una carrera entre procesos y el cliente elegiría el momento de insertar; el servidor no podría garantizar un evento por actor y hora |
| Aceptar `actor` en el cuerpo de la ruta | Permite falsificar la auditoría; la identidad solo puede venir de la credencial |

## Consecuencias

- Un ítem N3/N4 leído por dos usuarios deja un evento por usuario y hora en `mesa_events`, visible para ambos.
- El consumidor despacha un efecto cuyo ítem solo existe en la Mesa, y la transición de ventana (`window.expired`) se persiste allí.
- El respaldo SQLite sigue recibiendo copia de cada commit, pero ninguna decisión del outbox depende de él.
- `on` hace una petición de auditoría por lectura N3/N4; el servidor deduplica, así que la frecuencia de la petición no infla la tabla.
- La API gana un índice parcial (`mesa_events_access_idx`) para la comprobación de la hora; es aditivo e idempotente.

## Evidencia

| Garantía | Prueba |
|---|---|
| El acceso N3/N4 queda en la Mesa y no en la copia local | `packages/faberloom/board/tests/remote-outbox.spec.ts`: «records an N3 read through the Mesa and leaves no local-only event» |
| Un evento por actor y hora, sin falsificar el actor | `remote-outbox.spec.ts`: «keeps one access event per actor and hour for two users of the tenant»; `gateway/board-api.test.mjs`: suites «auditoría de acceso N3/N4» |
| Despacho con el ítem solo en la Mesa, una sola emisión | `remote-outbox.spec.ts`: «dispatches an effect whose item exists only in the Mesa, exactly once» |
| Dos llamadas concurrentes del consumidor emiten una vez | `remote-outbox.spec.ts`: «emits once when two consumer calls race for the same effect» |
| Una copia local atrasada no decide | `remote-outbox.spec.ts`: «never lets a stale local backup decide the dispatch» |
| La recuperación no marca huérfana una reserva que la Mesa registra | `remote-outbox.spec.ts`: «does not orphan a reservation the Mesa still records» |
| La expiración de ventana se persiste en la Mesa | `remote-outbox.spec.ts`: «expires the reversal window on the Mesa before emitting» |
| El cliente HTTP llama a la ruta sin identidad en el cuerpo | `packages/faberloom/board/tests/remote.spec.ts`: «records the access audit without sending an identity» |
