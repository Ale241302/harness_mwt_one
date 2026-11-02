# Outbox de efectos y auditoría de acceso con la Mesa central

English | [中文](mesa-outbox-auditoria.zh.md)

Con `FABERLOOM_BOARD_REMOTE=on` el ítem vive en la Mesa central (`mesa_items` + `mesa_events`) y el SQLite del proceso queda como respaldo. Este documento describe qué ruta toma cada operación, qué garantiza el outbox y qué límites quedan. La decisión y sus alternativas están en [ADR-009](../../ADRs_MESA/ADR-009-outbox-y-auditoria-mesa.md).

## Qué va a la Mesa y qué queda en el proceso

| Operación | `off` / `shadow` | `on` |
|---|---|---|
| `list`, `get` | SQLite (en `shadow` además compara) | Mesa (`GET /board/items`, `GET /board/items/:id`) |
| `create`, `submit` | SQLite | Mesa (`POST /board/items`) con el mismo `id`; copia local |
| Los seis comandos de estado | SQLite | Mesa (`PATCH /board/items/:id` con `command`); copia local |
| `noteAccess` (N3/N4) | evento local | `POST /board/items/:id/access` → `mesa_events` |
| Reserva, mensaje y alertas del outbox | SQLite | SQLite (cola de trabajo del proceso) |
| Ítem que toca el outbox | SQLite | Mesa (lectura y escritura); copia local |

El respaldo local recibe el registro completo de cada commit remoto. Si esa escritura falla, se registra una advertencia y el commit remoto no se revierte: la Mesa ya es la verdad.

## Auditoría de acceso N3/N4

`noteAccess(actor, id, detail)` primero lee el ítem de la Mesa y aplica la regla de lectura del board. Si la clase de datos no es `N3` ni `N4`, no escribe nada.

En `on`, el board llama a `POST /board/items/:id/access` con `{ detail }` y sin identidad:

- El actor es el de la credencial del proceso. La ruta rechaza `email`, `ownerId`, `tenantId` y `role` en el cuerpo con `400 INVALID_INPUT`; un campo desconocido como `actor` se ignora y el evento sigue nombrando al actor de la sesión.
- Solo un lector autorizado audita: dueño del ítem o administrador del tenant. Un `client_b2b` ajeno recibe `403 NO_ACCESS`; otro tenant recibe `404 NOT_FOUND` sin confirmar que el ítem existe.
- Un evento como máximo por actor, ítem y hora. La comprobación ocurre dos veces: antes del lock y otra vez bajo `SELECT … FOR UPDATE` sobre el ítem, así que dos procesos no insertan el mismo par actor/hora.
- Responde `201 { event, recorded: true }` al insertar y `200 { event, recorded: false }` cuando la hora ya tenía uno. `seq` se asigna con `MAX(seq)+1` bajo el lock del ítem.
- No incrementa `rowVersion`: una lectura no es un comando y no invalida las pestañas abiertas.

En `off` y `shadow` la ventana de una hora se evalúa sobre los eventos del registro local, como antes.

## Consumo del outbox

La cola es del proceso: `effect_reservations`, `effect_outbox` y `effect_alerts` viven en el almacén local. El ítem que la cola toca siempre es el de la Mesa.

`dispatchEffect(actor, effectKey)`:

1. Toma el mensaje local y exige que sea despachable (`PENDIENTE`, `dispatchable`).
2. Lee el ítem con el lector del modo: en `on`, `GET /board/items/:id`. Un `NOT_FOUND` remoto cancela el mensaje con `ITEM_MISSING`; un fallo de transporte se propaga como `REMOTE_UNAVAILABLE` y el mensaje queda pendiente.
3. Si la ventana de reversión sigue abierta, responde `WINDOW_OPEN` sin emitir. Si ya cerró, `expireForDispatch` persiste `window.expired` con `commitItem`: en `on` es un `PATCH` a la Mesa y la copia local recibe el espejo.
4. Exige `EJECUCION_PENDIENTE` y una reserva `RESERVADA` de la misma ejecución.
5. Revalida los controles y vuelve a leer el ítem; si cambió, responde `STALE_REVALIDATION` sin emitir.
6. Reclama el mensaje (`DESPACHADO`, `dispatchable: false`) antes de llamar al adaptador y marca la reserva `DESPACHADA`.
7. Emite, aplica el resultado al ítem con `commitItem` (Mesa en `on`) y liquida mensaje y reserva en local.

Dos despachos del mismo efecto: el segundo encuentra el mensaje ya `DESPACHADO` y responde `OUTBOX_NOT_PENDING` sin llamar al adaptador.

`recoverOrphanedReservations(actor)` también lee el ítem en la Mesa: en `on` recorre `GET /board/items` para reunir los `effectKey` que algún ítem registra. Una reserva cuya clave sigue en la Mesa no se libera, aunque el respaldo local no tenga la fila.

## Fallos

| Situación | Efecto sobre el ítem | Efecto sobre el mensaje |
|---|---|---|
| La Mesa no responde en una lectura del consumidor | Ninguno | Queda `PENDIENTE`; el error se propaga |
| El ítem ya no existe en la Mesa | Ninguno | `CANCELADO` con `ITEM_MISSING` |
| La ventana sigue abierta | Ninguno | `PENDIENTE`; se reintenta |
| Un control bloqueante falla en la revalidación | Vuelve a `PENDIENTE_CRITERIO` sin `effectKey` | `CANCELADO` con `REVALIDATION_FAILED` |
| El ítem cambió entre la lectura y la revalidación | Conserva el cambio de otro actor | `PENDIENTE`; se reintenta |
| El adaptador no responde | `DESCONOCIDO` | `DESPACHADO` con `OUTCOME_UNKNOWN`; solo `reconcile` lo cierra |
| La auditoría de acceso no puede escribir | Ninguno; la lectura falla con el error remoto | No aplica |

## Límites

- **La cola no sobrevive al proceso.** Si el proceso muere entre la aceptación y el despacho, otro proceso no ve el mensaje. El ítem de la Mesa conserva `effectKey`, `executionId`, `actionType`, `reversalDeadline` y el evento `effect.accepted` con `destination` e `idempotencyKey`, así que el mensaje se puede reconstruir; la reconstrucción automática no está implementada.
- **La cola no es atómica con el destino.** El mensaje pasa a `DESPACHADO` antes de llamar al adaptador; un crash entre el claim y la respuesta deja una reserva sin confirmación, que `reconcile` resuelve.
- **La auditoría de acceso no se replica al respaldo.** En `on` el evento vive en `mesa_events`; leerlo desde el SQLite local no lo muestra, y ese es el comportamiento buscado.
- **`shadow` no audita en la Mesa.** Compara lecturas; la auditoría de acceso sigue siendo local para no escribir durante la observación.

## Verificación

```sh
npx tsc -p packages/faberloom/board/tsconfig.json --noEmit
npx vitest run packages/faberloom/board/tests
node --test gateway/board-api.test.mjs
```

Las pruebas del acceso remoto y del despacho con el ítem solo en la Mesa están en `packages/faberloom/board/tests/remote-outbox.spec.ts`; la deduplicación y el rechazo de identidad en el cuerpo, en `gateway/board-api.test.mjs`.
