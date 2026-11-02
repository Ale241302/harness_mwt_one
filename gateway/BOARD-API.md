# API HTTP de la Mesa central (Opción A)

**Estado:** implementada y probada; **no montada** en `gateway/server.mjs` ni activada.
**Decisión:** A-58/D-5 · [ADR-006](../ADRs_MESA/ADR-006-mesa-central-postgres.md).
**Archivos:** `gateway/board-api.mjs`, `gateway/board-api.test.mjs`, este documento.
**Esquema:** uno solo, `packages/faberloom/board/postgres/schema.sql`.
**Dependencias:** `pg` (runtime) y `@electric-sql/pglite` (dev), declaradas en
`gateway/package.json`.

La Mesa deja de ser un `faberloom_board.json` por usuario y pasa a ser un servicio
central con PostgreSQL. Esta capa **persiste y autoriza**; el motor de estados y los
comandos de producto siguen en `@deepseek-ai/dsh-faberloom-board`.

## 0. Un solo esquema

Este módulo **no tiene DDL embebido**. Al arrancar lee el bootstrap canónico del
paquete del board:

```
packages/faberloom/board/postgres/schema.sql
```

Ese archivo declara las tablas, los tipos `uuid`, las claves compuestas, la FK
`ON DELETE RESTRICT`, los checks, los índices, el trigger, el rol `mesa_app` y las
seis políticas RLS. La API solo lo aplica y escribe con él. Antes existía un segundo
DDL en este módulo (ids `text`, `CASCADE`, una política `FOR ALL`); se retiró para
que no vuelva a divergir.

Resolución de la ruta, en orden:

1. `options.schemaFile` (pruebas o un despliegue que lo inyecte);
2. `MESA_SCHEMA_FILE`;
3. `schema.sql` junto a `board-api.mjs` (la imagen lo copia ahí);
4. `../packages/faberloom/board/postgres/schema.sql` (repo).

Una ruta relativa se resuelve contra el directorio del módulo, no contra el cwd.
`mesaSchemaFile()` devuelve la ruta elegida, `mesaSchemaSql()` el texto y
`applyMesaSchema(target)` lo ejecuta. Es idempotente: aplicarlo dos veces no
cambia nada.

**Compatibilidad:** una base creada por el DDL antiguo tiene `tenant_id`/`id`
`text`. El bootstrap lo detecta y falla con un mensaje explícito; no intenta
convertir tipos en caliente. Esa base se recrea o se migra a `uuid` antes de
activar la API.

## 1. Contrato de identidad

Cada request recibe un actor desde la sesión, con esta forma normalizada:

```json
{ "email": "alice@acme.test", "tenantId": "acme", "role": "admin" }
```

- `email` se compara en minúsculas. `owner_id` se guarda en minúsculas para los
  ítems nuevos y se compara con `lower(owner_id)` para tolerar filas migradas.
- `tenantId` se recorta y se pasa a minúsculas, igual que `resolveClientId` del
  gateway cuando escribe el `companyId` del board. Dos formas del mismo id no
  deben abrir dos espacios de datos.
- El esquema canónico exige `tenant_id uuid`. Si el tenant de la sesión ya es un
  UUID se usa tal cual; si no, se proyecta a un UUIDv5 determinista con
  `mesaTenantUuid()` y el nombre original se guarda en `tenant_key`. El UUID
  deriva del namespace fijo `5f0c7a2e-1b9d-4c3a-8e6f-2d4b7c9a0e11` y del texto
  del tenant (SHA-1, RFC 4122); cualquier herramienta puede recomputarlo. La
  respuesta devuelve `tenantId` con la clave original, no con el UUID.
- `spaceId` sigue la misma regla con `mesaSpaceUuid()` y el namespace
  `b7e4d1c8-3a6f-4e29-9c05-6a8f2b4d7e13`; el original se guarda en `space_key`.
  Un Space que ya sea UUID se usa tal cual.
- `role` ausente o desconocido vale como rol sin privilegios: solo el dueño.
- El servidor **rechaza** `tenantId`, `tenant_id`, `companyId`, `company_id`,
  `ownerId`, `owner_id`, `email` y `role` en el cuerpo con `400 INVALID_INPUT`.
  Ignorarlos en silencio haría creer al cliente que cambió de tenant.

`normalizeActor` acepta el tenant en este orden: `tenantId`, `tenant_id`,
`companyId`, `company_id`, `ent` (la empresa elegida en el gateway), `entityId`,
`legalEntityIds[0]`, `ents[0]`.

### Montaje (cuando se active)

`server.mjs` no se toca en este cambio. La integración es una línea deliberada:

```js
import { createBoardPool, installBoardApi } from './board-api.mjs'

const boardPool = await createBoardPool() // exige DATABASE_URL
installBoardApi(app, {
  pool: boardPool,
  resolveActor: req => {
    const session = getSession(req) // la cookie firmada del gateway
    if (!session) return null
    return {
      email: session.email,
      tenantId: session.ent ?? session.ents?.[0],
      role: readUserState(session.email)?.role,
    }
  },
})
```

El cookie del gateway lleva `email`, `ent`/`ents` y `exp`, pero **no** el rol; el
resolvedor debe leerlo de donde el gateway ya lo guarda (`readUserState`) o de un
middleware que fije `req.boardActor`. Sin ese dato, el actor queda sin privilegios
y solo puede operar sus propios ítems. `createBoardRouter` exige `resolveActor`:
la identidad no se adivina y un montaje sin resolvedor falla al construir.

## 2. Endpoints

Base: `/board`. Todos devuelven JSON, un `X-Request-Id` (el entrante si es válido,
si no uno nuevo) y `Cache-Control: no-store`: la respuesta lleva datos de un
tenant y ningún proxy compartido debe reutilizarla.

### `GET /board/items`

Lista del tenant. Filtros opcionales: `state`, `spaceId`, `limit` (por defecto
50, máximo 200) y `offset` (desde 0, orden estable `created_at DESC, id DESC`).
El adapter del board recorre las páginas hasta la última, así que la Mesa no se
trunca al tamaño de página.

- `state` debe ser un estado conocido; si no, `400 INVALID_INPUT`.
- `limit` por defecto 50, máximo 200.
- Un `client_b2b` recibe solo sus ítems; `admin`/`superadmin`/`ceo`, todos los del
  tenant.
- Orden: `created_at DESC, id DESC`.

```json
{ "items": [ { "id": "…", "state": "PENDIENTE_CRITERIO", "rowVersion": 1 } ] }
```

### `GET /board/items/:id`

`200 { "item": Item }`. Si el ítem no existe **en el tenant del actor**:
`404 NOT_FOUND`. Si existe en el tenant pero el actor no es el dueño ni un
administrador: `403 NO_ACCESS`.

### `POST /board/items`

Cuerpo:

| Campo | Obligatorio | Regla |
|---|---|---|
| `runId` | sí | texto no vacío; si falta, `422 NO_RUN` |
| `idempotencyKey` | sí | texto no vacío; si falta, `422 NO_RUN` |
| `businessKey` | sí | texto no vacío, máximo 256 |
| `title` | sí | texto no vacío, máximo 500 |
| `evidence` | sí | arreglo no vacío de textos; si falta o está vacío, `422 NO_EVIDENCE` |
| `state` | no | estado conocido; por defecto `PENDIENTE_CRITERIO` |
| `spaceId` | no | texto o `null` |
| `payload` | no | objeto JSON; por defecto `{}` |
| `id` | no | UUID que el productor ya asignó; el API genera uno si falta |

`owner_id` es siempre el email de la sesión. No se acepta del cuerpo.

- `201 { "item": Item }` al crear.
- `200 { "item": Item }` + `Idempotent-Replay: true` cuando repite la misma
  `idempotencyKey` con el mismo `businessKey` y el mismo dueño.
- `409 DUPLICATE` cuando la clave de idempotencia pertenece a otro ítem, o la
  clave de negocio pertenece a un ítem **vivo** del tenant.

### `PATCH /board/items/:id`

Cuerpo: `rowVersion` obligatorio (entero positivo) y al menos uno de `state`,
`payload`, `spaceId`. No permite cambiar `title`, `evidence`, `businessKey`,
`runId` ni el dueño. `spaceId` mueve la fila entre espacios y actualiza la
columna que usan los filtros.

- `200 { "item": Item }`; `rowVersion` sube en 1.
- `409 STALE_ROW` si `rowVersion` no es la actual; `details.rowVersion` trae la
  versión vigente y no se escribe nada.
- `403 NO_ACCESS` para un `client_b2b` que no es el dueño; `404 NOT_FOUND` para
  otro tenant.

Sin `command` el PATCH es persistencia pura: `state` acepta cualquier estado
conocido y la máquina de estados queda en el board. Con `command` —el camino que
usa el board en modo `on`— la API verifica las precondiciones que no puede
delegar:

| Transición | Precondición | Error |
|---|---|---|
| `APROBADO` | `payload.severity` no nulo | `422 SEVERITY_REQUIRED` |
| `DESCARTADO` | `payload.discardReason` en la lista cerrada | `422 REASON_REQUIRED` |
| `DESCARTADO` con `OTRA` | `payload.discardNote` no vacía | `422 REASON_REQUIRED` |
| `ITERANDO` | `payload.spaceId` o el espacio actual | `422 WORKSPACE_REQUIRED` |
| `APROBADO`/`DESCARTADO` | `payload.pendingCandidate` nulo | `409 CANDIDATE_PENDING` |
| cualquier transición | el estado actual no es terminal | `409 TERMINAL_STATE` |

### `GET /board/items/:id/events`

Parámetros `after` (seq exclusivo) y `limit` (por defecto 200, máximo 500).

```json
{ "events": [ { "seq": 1, "actor": "alice@acme.test", "command": "created",
  "fromState": null, "toState": "PENDIENTE_CRITERIO", "payload": {}, "at": "2026-11-02T15:00:00.000Z" } ] }
```

`404`/`403` con la misma regla que el ítem.

### `POST /board/items/:id/events`

Añade auditoría sin cambiar el estado ni `rowVersion`.

```json
{ "command": "note", "payload": { "text": "revisar con Álvaro" } }
```

`command` es obligatorio. `201 { "event": Event }`. El `seq` se asigna dentro del
lock del ítem (`SELECT … FOR UPDATE` + `MAX(seq)+1`), así que dos appends
concurrentes no comparten número. `fromState` y `toState` son ambos el estado
vigente: un append no es una transición. Sin `payload`, se guarda `{}` (la
columna es `NOT NULL`).

### `POST /board/items/:id/access`

Registra que el actor de la sesión abrió un ítem restringido (`N3`/`N4`). Es la
ruta que usa el board en modo `on` para `noteAccess`.

```json
{ "detail": "zona:N3" }
```

| Campo | Obligatorio | Regla |
|---|---|---|
| `detail` | no | texto de hasta 500 caracteres; sin él se guarda `{}` |

- El actor sale de la sesión (o del Bearer del proceso). `email`, `ownerId`,
  `tenantId` y `role` en el cuerpo se rechazan con `400 INVALID_INPUT`; el
  evento nunca nombra a otro actor.
- Exige la misma regla de lectura que `GET /items/:id`: dueño o administrador
  del tenant (`403 NO_ACCESS` en el mismo tenant, `404 NOT_FOUND` en otro).
- Conserva **un** evento `access` por actor, ítem y hora. La búsqueda se repite
  bajo el lock del ítem, así que dos procesos concurrentes no insertan dos.
- No mueve `rowVersion` ni el estado: `fromState` y `toState` son el estado
  vigente.
- `201 { "event": Event, "recorded": true }` al insertar;
  `200 { "event": Event, "recorded": false }` cuando la hora ya tenía uno. En
  ambos casos `event.seq` es el del evento vigente.

El índice parcial `mesa_events_access_idx` cubre la comprobación de la hora.


## 3. Forma del ítem

```json
{
  "id": "0f0c…",
  "tenantId": "acme",
  "ownerId": "alice@acme.test",
  "spaceId": null,
  "businessKey": "bk-…",
  "state": "PENDIENTE_CRITERIO",
  "rowVersion": 1,
  "title": "Preparado de prueba",
  "evidence": ["oc:505288"],
  "payload": {},
  "runId": "run-…",
  "createdAt": "2026-11-02T15:00:00.000Z",
  "updatedAt": "2026-11-02T15:00:00.000Z"
}
```

`idempotencyKey` no se devuelve: es una clave de reintento del cliente, no parte
del recurso. `tenantId` y `spaceId` devuelven la clave que mandó la sesión
(`tenant_key`/`space_key`), no el UUID interno; en filas migradas sin clave se
devuelve el UUID. `rowVersion` y `seq` son números, aunque PostgreSQL los guarde
como `bigint`.

## 4. Autorización

| Rol | Leer ítem del tenant | Escribir ítem del tenant | Otro tenant |
|---|---|---|---|
| `admin`, `superadmin`, `ceo` | cualquiera | cualquiera | `404 NOT_FOUND` sin `x-board-tenant`; `403 NO_ACCESS` si la entidad no está en `tenantIds` |
| `client_b2b` | solo `owner_id === email` | solo el propio | `404 NOT_FOUND` |
| rol ausente/desconocido | solo el propio | solo el propio | `404 NOT_FOUND` |

Dentro del mismo tenant, un `client_b2b` que intenta leer o escribir lo ajeno
recibe `403 NO_ACCESS`. Otro tenant recibe `404 NOT_FOUND`, no un 403: un 403
confirmaría que el ítem existe.

**Cross-tenant por entidad (B).** `admin`, `superadmin` y `ceo` pueden operar
cualquiera de sus entidades legales: el token firmado lleva `tenantIds` y la
request nombra la entidad con `x-board-tenant`. La API acepta la cabecera solo
si el rol es administrativo y la entidad está en `tenantIds`; si no, responde
`403 NO_ACCESS`. La transacción fija **una** entidad (`app.tenant_id`), así que
las políticas RLS siguen vigentes y no hace falta `BYPASSRLS` ni mezclar filas
de dos empresas en una respuesta. Un `client_b2b` no puede seleccionar otra
entidad aunque la liste su token.

**Mesa compartida (A).** El gateway emite el token con
`FABERLOOM_BOARD_TENANT` (por ejemplo `5525986c`) como entidad por defecto y esa
misma entidad queda en `tenantIds`; Alejandro y Álvaro leen y escriben la misma
Mesa sin preguntar “cambiar de empresa”.

## 5. Errores

Forma única, con `request_id` en el 100 % de las rutas de error:

```json
{
  "code": "STALE_ROW",
  "message": "el ítem cambió desde que se leyó",
  "details": { "rowVersion": 3 },
  "request_id": "req_a1b2"
}
```

| Código | HTTP | Cuándo |
|---|---|---|
| `UNAUTHENTICATED` | 401 | la sesión no resuelve email y tenant |
| `INVALID_INPUT` | 400 / 413 | cuerpo, filtro o campo inválido; cuerpo demasiado grande |
| `NO_ACCESS` | 403 | mismo tenant, actor sin permiso sobre ese ítem |
| `NOT_FOUND` | 404 | no existe en el tenant del actor |
| `DUPLICATE` | 409 | clave de idempotencia o de negocio tomada |
| `STALE_ROW` | 409 | `rowVersion` no coincide |
| `NO_RUN` | 422 | falta `runId` o `idempotencyKey` |
| `NO_EVIDENCE` | 422 | falta la evidencia o está vacía |
| `INTERNAL` | 500 | error no clasificado; no se filtra el mensaje de la base |

No hay `200` con un error dentro. Los códigos no cambian de significado dentro de
`/board`.

## 6. Modelo de datos

Los tipos son los del `schema.sql` canónico. `bigint` se normaliza a número al
salir (`rowVersion`, `seq`); los timestamps salen ISO 8601.

### `mesa_items`

| Columna | Tipo | Nota |
|---|---|---|
| `tenant_id` | `uuid` | parte de la PK; toda consulta lo filtra |
| `id` | `uuid` | PK junto al tenant; `crypto.randomUUID()` |
| `owner_id` | `text` | email normalizado del actor |
| `tenant_key` | `text` | clave original del tenant si no era UUID; nullable |
| `space_id` | `uuid` | opcional; derivado de `spaceId` |
| `space_key` | `text` | `spaceId` original; nullable |
| `business_key` | `text` | identidad de negocio, no vacía |
| `state` | `text` | estado persistido, sin motor de transiciones |
| `row_version` | `bigint` | concurrencia optimista; la API lo incrementa |
| `title` | `text` | obligatorio en el POST; nullable en la tabla |
| `evidence` | `jsonb` | arreglo; default `[]` |
| `payload` | `jsonb` | objeto; default `{}` |
| `run_id` | `text` | run que produjo el ítem |
| `idempotency_key` | `text` | clave de reintento, única por tenant |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` lo mantiene el trigger |

Las seis columnas de API (`title`, `evidence`, `run_id`, `idempotency_key`,
`tenant_key`, `space_key`) están declaradas en el bootstrap con `ADD COLUMN IF NOT
EXISTS`; no hay una segunda definición de tipos en este módulo. `space_id`/
`tenant_id` son las claves que usan RLS e índices; las `*_key` conservan el valor
opaco que mandó la sesión para devolverlo y para soporte.

### `mesa_events`

`(tenant_id, item_id, seq)` es la PK; `seq` es la auditoría ordenada del ítem.
`payload` es `jsonb NOT NULL DEFAULT '{}'`; `from_state`/`to_state` permiten
reconstruir el cambio y `to_state` es obligatorio. La FK compuesta
`(tenant_id, item_id) → mesa_items(tenant_id, id)` es `ON DELETE RESTRICT`: un
ítem con historia no se borra, y los eventos no se actualizan ni se borran.

### Unicidad

- `mesa_items_tenant_idempotency_key_uniq`: `(tenant_id, idempotency_key)` único
  parcial, solo filas con clave.
- `mesa_items_live_business_key_uniq`: `(tenant_id, business_key)` único parcial,
  solo ítems **vivos**:
  `state NOT IN ('APROBADO','EJECUTADO','DESCARTADO','SUSTITUIDO')`. Un ítem
  cerrado libera la clave para volver a preparar el mismo artefacto, igual que el
  board. Debe coincidir con `TERMINAL_STATES` del módulo.

### Compatibilidad con la migración

`scripts/migrate-board-postgres.mjs` inserta las columnas históricas y no conoce
`title`, `evidence`, `run_id` ni `idempotency_key`; por eso esas columnas son
nullable y tienen default. El script no borra el SQLite: queda como respaldo y para
la reversión. Para que un ítem migrado conserve a su dueño, la migración debe
dejar `owner_id` en minúsculas o la API lo compara igual con `lower(owner_id)`.
Las filas migradas no tienen `tenant_key`/`space_key`; la API devuelve entonces el
uuid.

Antes de crear el índice único de clave de negocio, la migración debe comprobar
que no haya dos ítems **vivos** con la misma `business_key`. Si los hay, el índice
falla y la activación se detiene; es preferible a cerrar ítems en silencio. Los
ítems ya cerrados no colisionan.

## 7. Aislamiento: dos barreras

1. **SQL explícito.** Toda consulta escribe `tenant_id = $1` con el uuid derivado.
   Los filtros usan parámetros nulos (`$2::text IS NULL OR state = $2`), nunca
   concatenación de valores. Un `spaceId` se proyecta a uuid y un valor con
   comillas devuelve una lista vacía, no una consulta distinta.
2. **RLS.** `ENABLE` + `FORCE ROW LEVEL SECURITY` en ambas tablas, con las seis
   políticas del esquema (SELECT/INSERT/UPDATE/DELETE en items; SELECT/INSERT en
   events), todas para `mesa_app`. Cada transacción hace `SET LOCAL ROLE mesa_app`
   y fija `app.tenant_id` (uuid), `app.actor_id` (email) y `app.role` con
   `set_config(..., true)`. El setting es local a la transacción y no queda pegado
   a la conexión del pool. Si nadie lo fijó, `mesa_current_tenant_id()` devuelve
   `NULL` y la política no deja ver ni escribir nada: falla cerrada.

La política de `UPDATE` es de dueño, así que un `SELECT … FOR UPDATE` directo
ocultaría la fila de un `client_b2b` ajeno y devolvería 404 donde el contrato pide
403. El PATCH y el append de eventos leen primero con la política de SELECT
(tenant), autorizan, y bloquean después.

La barrera 2 no reemplaza a la 1. Una consulta futura que olvide el filtro sigue
topando con la política, que es justo lo que pide D-5.

## 8. Idempotencia y concurrencia

- Reintentar el mismo `POST` con la misma `idempotencyKey`, `businessKey` y dueño
  devuelve el ítem existente (`200`, header `Idempotent-Replay: true`) y no crea
  otro.
- La misma clave con otro negocio o otro dueño es `409 DUPLICATE`; no se adivina
  cuál de las dos requests es la buena.
- Dos `POST` simultáneos con la misma clave de negocio: el índice único parcial
  decide; el segundo recibe `409 DUPLICATE`.
- `PATCH` bloquea el ítem con `SELECT … FOR UPDATE`, compara `row_version` y
  actualiza en la misma transacción. El que llega tarde recibe `409 STALE_ROW` y
  no pisa la escritura ganadora.
- Los appends de eventos también bloquean el ítem para asignar `seq` sin carreras.
  No cambian `row_version`.

## 9. Qué queda para el board

Esta capa no implementa, y no debe fingir que implementa:

- El **motor de estados**: transiciones válidas, columnas derivadas, cierres y
  reaperturas. `PATCH` acepta cualquier estado conocido.
- **Aprobaciones** ligadas a revisión/hash, revalidación y verificaciones
  (`approve`, `approveWithEdits`, `runChecks`).
- **Iteración**: lock por intento, drafts, `iterationId`, `generation`,
  `baseVersion`, expiración y recuperación.
- **Candidatos**, sustituciones, rekeys y colisiones de clave de negocio.
- La **clave de negocio derivada** por el servidor (`businessKeyOf`): aquí el
  `businessKey` llega del productor y se guarda tal cual. Un productor que reusa
  la clave de otro artefacto no se detecta en esta capa.
- La **validación de `spaceId`** contra el servicio de Spaces: se persiste como
  referencia opaca; que el Space sea del mismo tenant lo decide el board.
- La **existencia del `runId`** contra un registro de runs: `NO_RUN` solo exige
  que venga informado.
- **Clasificación** de severidad, datos y dudas.
- **Efectos**: reservas, outbox, ventana de reversión, conciliación y alertas.
- **Paridad de comandos** del board antes de retirar el almacén local (ADR-006).
- Lecturas **cross-tenant** para consola, si el producto las decide: endpoint
  aparte, explícito y auditado.
- Paginación por cursor, rate limiting/cuotas, ETag/`If-Match`, webhooks y
  retención/compactación de eventos.
- El **spec OpenAPI y los SDK generados**: este documento fija el contrato; la
  generación tiene sentido cuando la superficie incluya los comandos del board,
  no solo el almacén.
- Aprovisionamiento del rol de base, rotación de secretos y el `schema.sql`
  versionado como migración aplicada por un operador.

Hasta que esas piezas existan, el board local sigue siendo el cerebro y esta API
es su almacén compartido.

## 10. Operación

`createBoardPool()` lee `DATABASE_URL` y falla al construir si no existe. Config:

| Ajuste | Valor |
|---|---|
| `max` | 10 |
| `idleTimeoutMillis` | 30 s |
| `connectionTimeoutMillis` | 5 s |
| `statement_timeout` | 15 s |
| `application_name` | `mesa-board-api` |

El esquema se aplica con `applyMesaSchema(pool)`, que lee el archivo canónico, o
con el SQL de `mesaSchemaSql()`. Debe aplicarlo el **dueño** de las tablas. Para
que RLS alcance también al dueño se usa `FORCE`; el rol de la aplicación debe ser
`NOSUPERUSER NOBYPASSRLS` (un superusuario ignora RLS aunque `FORCE` esté puesto).

El login de runtime entra a `mesa_app` con `SET LOCAL ROLE mesa_app` en cada
transacción (lo hace `withTenant`), así que debe ser miembro de `mesa_app` y no
tener `BYPASSRLS`. Para una conexión que ya usa el rol restringido, `createBoardRouter`
acepta `dbRole: false`.

En la imagen, el `Dockerfile` copia `schema.sql` a `gateway/schema.sql` y el módulo
lo encuentra por la tercera ruta de búsqueda; no hace falta `MESA_SCHEMA_FILE`.

Un `DATABASE_URL` de aplicación que no fije `app.tenant_id` no ve nada: si el
montaje olvida la transacción, el fallo es visible y seguro, no una fuga.

## 11. Pruebas

### PGlite (por defecto, PostgreSQL en WASM)

```sh
node --test gateway/board-api.test.mjs
```

PGlite ejecuta el mismo `schema.sql` que el operador, con roles y RLS, y el test lo
aplica **dos veces** para probar la idempotencia. Resultado: **22/22 pasan**, sin
omisiones. Cubre:

- dos administradores del mismo tenant leen y editan el mismo ítem;
- otro tenant recibe `404 NOT_FOUND` en ítem, PATCH, eventos y lista vacía;
- un `client_b2b` recibe `403 NO_ACCESS` al leer/escribir lo ajeno y solo ve lo
  propio en la lista;
- `UNAUTHENTICATED` sin sesión, con `request_id` conservado;
- `tenantId`/`ownerId` en el cuerpo rechazados;
- replay idempotente, `DUPLICATE` por clave de idempotencia y por clave de negocio
  viva, y liberación de la clave al cerrar el ítem;
- `NO_RUN`, `NO_EVIDENCE`, `STALE_ROW`, append de auditoría con `after`/`limit`,
  filtros por `state`/`spaceId`, inyección en filtros y límites;
- `id` de ruta que no es uuid → `404 NOT_FOUND`, no un 500;
- proyección estable de tenant/space a UUIDv5;
- RLS: otro tenant no ve la fila e `INSERT` con otro `tenant_id` falla con 42501.

**Límite de PGlite:** una sola conexión y un solo proceso. Valida SQL, roles,
grants y políticas, pero no concurrencia real entre conexiones ni el wire protocol.

### PostgreSQL real

```sh
# La base ya la preparó el rol de migración; docker/00-init.sql aplica el
# bootstrap dos veces. El login de runtime no ejecuta DDL.
BOARD_TEST_DATABASE_URL=postgres://mesa_login:mesa_test@127.0.0.1:55432/mesa \
  node --test gateway/board-api.test.mjs
```

Corren las mismas 22 pruebas con un login real que entra a `mesa_app` vía
`SET LOCAL ROLE`. La suite comprueba que las tablas existan y falla con un
mensaje claro si falta aplicar `schema.sql`; no intenta crear el esquema con el
rol de runtime. Cada ejecución usa tenants únicos, así que no borra filas ni
choca con datos de una corrida anterior.

## 12. Activación (no ejecutada)

Según ADR-006, este cambio **no** activa nada: `server.mjs` sigue igual, no hay
flag, no hay despliegue y el SQLite no se toca. La secuencia pendiente es:

1. Aplicar el esquema en una base dedicada con el rol de migración dueño de las
   tablas; el runtime usa un login miembro de `mesa_app` (no superusuario).
2. Montar la ruta detrás del flag de activación, con el resolvedor de sesión real.
3. Migrar en seco y luego en real; contar 460/460 ítems y sus eventos.
4. Modo sombra: leer de PostgreSQL y comparar con SQLite; una divergencia bloquea.
5. Activar `FABERLOOM_BOARD_POSTGRES=1`; SQLite queda de solo lectura.
6. Revertir apagando el flag, con el SQLite intacto.
