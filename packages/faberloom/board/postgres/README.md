# Mesa central — esquema PostgreSQL y RLS (Opción A)

English | [中文](README.zh.md)

Bootstrap del almacenamiento central de la Mesa: un único esquema PostgreSQL con
`tenant_id` en cada fila y aislamiento obligatorio por Row Level Security (RLS).
Este `schema.sql` es **el único DDL** del sistema: el gateway
(`gateway/board-api.mjs`) lo lee y lo aplica, y no conserva un esquema embebido.
El motor de estados sigue en `packages/faberloom/board/src` y no se toca desde
aquí.

Se ubica en `packages/faberloom/board/postgres/` —tres niveles bajo `packages/`—
para quedar fuera de `packages/*/*`, del workspace pnpm y del gate de cobertura
(`packages/*/*/src/**`). Es un artefacto de diseño y verificación, no un paquete
publicable.

## Modelo

Opción A: una Mesa central compartida, con el tenant como frontera de
aislamiento. No hay una base por cliente ni un `search_path` por tenant.

```
mesa_items  ──1:N──  mesa_events
   │ tenant_id          │ tenant_id + item_id
   └ PK (tenant_id,id)  └ PK (tenant_id,item_id,seq)
```

- `tenant_id` es el `companyId` del board proyectado a UUID. Nunca es nullable y
  forma parte de todas las claves. Si el `companyId` ya es UUID se usa tal cual;
  si no, el gateway lo proyecta a un UUIDv5 determinista
  (`mesaTenantUuid()`) y guarda la clave original en `tenant_key`.
- `owner_id` es el principal autenticado (`BoardActor.id`); el tenant no se
  deduce de él.
- `space_id` es una referencia opaca a Spaces. El gateway la proyecta a UUID
  igual que el tenant (`mesaSpaceUuid()`) y conserva el valor original en
  `space_key`. La pertenencia al Space no se valida aquí; eso sigue siendo
  responsabilidad del servicio de Spaces.
- `business_key` es la identidad derivada por el servidor. Su unicidad es por
  tenant y solo entre filas **no terminales**.
- `row_version` es el token de concurrencia optimista. Lo escribe la aplicación;
  la base no lo incrementa.
- `payload` guarda el documento del board. Debe ser un objeto JSON.

### `mesa_items`

| Columna | Tipo | Restricción |
|---|---|---|
| `tenant_id` | `uuid` | `NOT NULL`, parte de la PK |
| `id` | `uuid` | `NOT NULL DEFAULT gen_random_uuid()` |
| `owner_id` | `text` | `NOT NULL`, no vacío |
| `tenant_key` | `text` | nullable; `companyId` original cuando no era UUID |
| `space_id` | `uuid` | nullable |
| `space_key` | `text` | nullable; `spaceId` original cuando no era UUID |
| `business_key` | `text` | `NOT NULL`, no vacío |
| `state` | `text` | `NOT NULL`, no vacío |
| `row_version` | `bigint` | `NOT NULL DEFAULT 1`, `>= 1` |
| `title` | `text` | nullable; obligatorio en el POST de la API |
| `evidence` | `jsonb` | `NOT NULL DEFAULT '[]'`, arreglo JSON |
| `payload` | `jsonb` | `NOT NULL`, objeto JSON |
| `run_id` | `text` | nullable; run que produjo el ítem |
| `idempotency_key` | `text` | nullable; única por tenant |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()`, trigger en `UPDATE` |

PK: `(tenant_id, id)`.

Las seis columnas de API (`title`, `evidence`, `run_id`, `idempotency_key`,
`tenant_key`, `space_key`) se añaden con `ADD COLUMN IF NOT EXISTS` y checks
idempotentes; su tipo se declara una sola vez, aquí. `evidence` debe ser un
arreglo y las claves no vacías cuando existen.

Índice único parcial:

```sql
CREATE UNIQUE INDEX mesa_items_live_business_key_uniq
  ON public.mesa_items (tenant_id, business_key)
  WHERE state NOT IN ('APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO');
```

Los cuatro estados terminales replican `TERMINAL_STATES` del board. Si el board
agrega otro, hay que actualizar el predicado en una migración; se usan literales
(y no una función) porque el predicado de un índice debe ser inmutable.

Índice único parcial de idempotencia:

```sql
CREATE UNIQUE INDEX mesa_items_tenant_idempotency_key_uniq
  ON public.mesa_items (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

Índices de consulta:

- `(tenant_id, state, created_at)`
- `(tenant_id, space_id)`
- `(tenant_id, owner_id)`
- `(tenant_id, lower(owner_id))` — la lista de un `client_b2b` compara en
  minúsculas para tolerar filas migradas.

### `mesa_events`

| Columna | Tipo | Restricción |
|---|---|---|
| `tenant_id` | `uuid` | `NOT NULL` |
| `item_id` | `uuid` | `NOT NULL` |
| `seq` | `bigint` | `NOT NULL`, `>= 1` |
| `actor` | `text` | `NOT NULL`, no vacío |
| `command` | `text` | `NOT NULL`, no vacío |
| `from_state` | `text` | nullable; si existe, no vacío |
| `to_state` | `text` | `NOT NULL`, no vacío |
| `payload` | `jsonb` | `NOT NULL DEFAULT '{}'`, objeto JSON |
| `at` | `timestamptz` | `NOT NULL DEFAULT now()` |

PK: `(tenant_id, item_id, seq)`. FK compuesta
`(tenant_id, item_id) → mesa_items(tenant_id, id) ON DELETE RESTRICT`.

La FK compuesta impide que un evento de un tenant apunte a un item de otro. El
`RESTRICT` es deliberado: un item con historia de auditoría no se puede borrar
sin borrar primero sus eventos, y los eventos no se pueden borrar. La tabla es
append-only.

## RLS

Ambas tablas tienen `ENABLE ROW LEVEL SECURITY` y `FORCE ROW LEVEL SECURITY`.
`FORCE` alcanza también al dueño de las tablas; solo un superusuario o un rol
con `BYPASSRLS` queda fuera. Por eso el dueño de las tablas tampoco ve filas sin
entrar en `mesa_app` o sin un rol de operación explícito: las consultas de
soporte deben fijar el contexto o usar una conexión administrativa deliberada.

### Variables de sesión

`withTenant()` fija estas variables con `set_config(..., true)` (equivalente
transaccional a `SET LOCAL`):

| Variable | Tipo | Uso |
|---|---|---|
| `app.tenant_id` | `uuid` | frontera de aislamiento; obligatoria |
| `app.actor_id` | `text` | principal autenticado; autorización de `owner_id` |
| `app.role` | `text` | `client_b2b` o rol de consola |

Si `app.tenant_id` falta o está vacío,
`mesa_current_tenant_id()` devuelve `NULL`; ninguna fila coincide y los
`WITH CHECK` de escritura se rechazan. El sistema falla cerrado.

`withTenant()` **siempre** reescribe `app.actor_id` y `app.role`, aunque el
llamador no los pase (los deja vacíos). Así un `SET app.role = 'admin'` a nivel
de sesión no se filtra a una transacción que no lo pidió.

### Rol de aplicación

`mesa_app` se crea `NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, sin `CREATEDB` ni
`CREATEROLE`. No es dueño de las tablas. El login de runtime se crea aparte, no
hereda privilegios y entra al rol con `SET LOCAL ROLE mesa_app`:

```sql
CREATE ROLE mesa_login LOGIN NOINHERIT NOBYPASSRLS;
GRANT mesa_app TO mesa_login;
```

### Matriz de políticas

| Tabla | Operación | Condición |
|---|---|---|
| `mesa_items` | `SELECT` | `tenant_id = app.tenant_id` |
| `mesa_items` | `INSERT` | tenant **y** (`owner_id = app.actor_id` o rol de consola) |
| `mesa_items` | `UPDATE` | `USING` y `WITH CHECK` con tenant **y** owner/rol |
| `mesa_items` | `DELETE` | tenant **y** owner/rol |
| `mesa_events` | `SELECT` | `tenant_id = app.tenant_id` |
| `mesa_events` | `INSERT` | `tenant_id = app.tenant_id` |
| `mesa_events` | `UPDATE` / `DELETE` | sin política y sin privilegio de tabla |

Los roles de consola son `admin`, `superadmin` y `ceo` (A-58). Un
`client_b2b` solo escribe filas cuyo `owner_id` es su `app.actor_id`. Un rol
desconocido o ausente se trata como no privilegiado.

El `SELECT` de `mesa_items` es de alcance tenant, no de owner: la visibilidad
fina (miembro de Space, shares, admin) la aplica la API del board. La base
garantiza que ningún tenant vea filas de otro.

`mesa_events` no tiene `UPDATE` ni `DELETE`, y `mesa_app` tampoco tiene esos
privilegios. Aunque una política futura se agregara por error, el `GRANT` sigue
negando la escritura.

## `withTenant()`

```ts
import { withTenant } from './src/tenant.ts'

const rows = await withTenant(client, tenantId, async (tx) => {
  const result = await tx.query(
    `SELECT id, state FROM public.mesa_items ORDER BY created_at`,
  )
  return result.rows
}, { actorId, appRole: 'client_b2b' })
```

Contrato:

1. `BEGIN`.
2. `SET LOCAL ROLE mesa_app` (configurable con `dbRole`; `false` lo omite).
3. `set_config('app.tenant_id', $1, true)` y limpieza de actor/rol.
4. Ejecuta `fn(tx)`.
5. `COMMIT`; ante cualquier error, `ROLLBACK` y relanza el error original.

`client` debe ser **una conexión reservada** (`pg.PoolClient`). No pases un
`pg.Pool`: `pool.query()` puede usar una conexión distinta por sentencia y el
`SET LOCAL` se aplicaría a otra sesión. La conexión no debe tener una transacción
abierta, y `fn` no debe hacer `COMMIT`, `ROLLBACK` ni abrir otra transacción:
`withTenant` es el dueño del límite transaccional. El helper rechaza llamadas
reentrantes sobre el mismo cliente para no commitear una transacción externa.

PostgreSQL no acepta parámetros en `SET`, por eso se usa
`set_config('app.tenant_id', $1, true)`. El nombre de `dbRole` se valida contra
`/^[A-Za-z_][A-Za-z0-9_]*$/` antes de interpolarlo; no se puede parametrizar un
identificador de rol.

## `DATABASE_URL`

Runtime:

```sh
DATABASE_URL=postgres://mesa_login:********@db.internal:5432/mesa
```

El login debe:

- no ser dueño de `mesa_items` ni `mesa_events`;
- no tener `BYPASSRLS` ni `SUPERUSER`;
- ser miembro de `mesa_app` y entrar con `SET LOCAL ROLE` (lo hace `withTenant`);
- usar una conexión reservada por transacción.

El archivo `schema.sql` lo ejecuta el rol de migración (dueño de las tablas),
no el login de runtime. Ese rol necesita crear objetos en `public`, ser dueño de
las tablas y poder crear/alterar `mesa_app` (`CREATEROLE`; para fijar
`NOBYPASSRLS` hace falta un superusuario). En producción, aplica el esquema con
un job de migración y luego entrega `DATABASE_URL` al proceso de la Mesa.

## Pruebas

### Por defecto: PGlite (PostgreSQL 17.5 en WASM)

No requiere servidor, Docker ni red:

```sh
cd packages/faberloom/board/postgres
npm install
npm test
```

PGlite ejecuta el mismo `schema.sql`, crea roles, aplica RLS y respeta
`FORCE ROW LEVEL SECURITY`. Resultado: **41/41 pasan**. Las pruebas cubren:

- idempotencia del bootstrap (se aplica tres veces en total);
- columnas del board y de la API, PK, FK compuesta, checks, índices y trigger;
- índice único parcial de `(tenant_id, idempotency_key)`;
- `mesa_app` sin login/superuser/BYPASSRLS;
- cuatro políticas de items y dos de events;
- aislamiento A/B en `SELECT`, `INSERT`, `UPDATE` y `DELETE`;
- autorización de `owner_id` para `client_b2b`, admin y actor ausente;
- unicidad parcial de `business_key` (live vs terminal, por tenant);
- eventos append-only: sin `UPDATE`/`DELETE`, FK compuesta, replay de `seq`;
- `withTenant`: commit, rollback, reset de contexto, reentrancia y validación.

### PostgreSQL 16 real con Docker

```sh
cd packages/faberloom/board/postgres
docker compose -f docker-compose.test.yml up -d --wait

# PowerShell
$env:MESA_TEST_DATABASE_URL = "postgres://mesa_login:mesa_test@localhost:55432/mesa"
npm test

docker compose -f docker-compose.test.yml down -v
```

```sh
# bash
MESA_TEST_DATABASE_URL=postgres://mesa_login:mesa_test@localhost:55432/mesa npm test
```

El init de Docker aplica `schema.sql` **dos veces** y crea `mesa_login` sin
privilegios heredados. Las pruebas usan esa URL como login real, no como
superusuario, así que también verifican los `GRANT`/`REVOKE`. La contraseña
`mesa_test` es solo para este compose desechable; no se reutiliza fuera de él.

Selección de backend en las pruebas:

1. `MESA_TEST_DATABASE_URL` si existe;
2. si no, `DATABASE_URL`;
3. si no hay URL, PGlite en memoria.

Una URL con host no local se rechaza salvo `MESA_TEST_ALLOW_REMOTE=1`, para que
un `DATABASE_URL` de producción mal exportado no ejecute las pruebas
destructivas.

### Límite de PGlite

PGlite es PostgreSQL real compilado a WASM, en un solo proceso y una sola
conexión. Valida el SQL, los roles, los `GRANT` y las políticas RLS, pero **no**
valida:

- concurrencia real entre conexiones (carreras de `business_key`, bloqueos,
  `SERIALIZABLE`);
- autenticación del wire protocol, TLS, `pg_hba.conf` ni pooling;
- extensiones, réplicas, backups ni PITR;
- diferencias específicas de la versión 16 frente a la 17.5 de PGlite.

El lane Docker con `postgres:16-alpine` es la referencia para esos puntos.
Ambos lanes comparten el mismo `schema.sql` y las mismas aserciones.

## Operación y evolución

- **Migraciones**: `schema.sql` es el bootstrap v1 e idempotente; no altera
  columnas existentes. Cualquier cambio posterior va en una migración
  expand/contract (columna nueva nullable → backfill → constraint → limpieza),
  con reconciliación y rollback documentados.
- **`updated_at`**: lo mantiene el trigger; la aplicación no debe confiar en un
  valor enviado por el cliente.
- **`row_version`**: lo controla la aplicación. Un `UPDATE` debe incluir
  `WHERE tenant_id = ... AND id = ... AND row_version = $n` y verificar que
  afectó una fila; la base no lo incrementa sola.
- **Borrado**: `DELETE` existe para retención operativa, pero un item con
  eventos no se puede borrar (`ON DELETE RESTRICT`). Para archivar, se prefiere
  un estado terminal y una política de retención separada.
- **Auditoría**: `mesa_events` no se actualiza ni se borra desde `mesa_app`. Si
  se necesita retención, se hace con un rol administrativo y un job explícito,
  nunca desde la aplicación.
- **Roles de consola**: `admin`/`superadmin`/`ceo` pueden escribir cualquier
  owner **dentro del tenant**. Un rol de consola que deba cruzar tenants
  necesita un mecanismo distinto (conexión administrativa o impersonación
  explícita), que este esquema no concede.

## Lo que la base no decide

- La derivación de `business_key` y su rekey.
- La máquina de estados del board y qué transiciones son válidas.
- La pertenencia a Spaces y los shares.
- La autorización de acciones de efecto y firmas.
- La clasificación de datos y el enmascaramiento de `payload`.
- La correspondencia entre `mesa_events.actor` y `app.actor_id`: la API escribe
  el actor de cada evento; la base solo garantiza que el evento pertenezca al
  tenant del item.

Todo eso sigue en la API y en los servicios del board. La base garantiza
aislamiento por tenant, autorización de owner en escrituras, unicidad de la
clave viva e inmutabilidad del audit trail.

## Integración con el gateway

`gateway/board-api.mjs` **no tiene DDL**. Lee este archivo y lo aplica con
`applyMesaSchema(target)`, que resuelve la ruta en este orden:

1. `options.schemaFile`;
2. `MESA_SCHEMA_FILE`;
3. `schema.sql` junto a `board-api.mjs` (la imagen lo copia ahí);
4. `../packages/faberloom/board/postgres/schema.sql` (repo).

El gateway adapta sus consultas a este modelo:

- `id`, `tenant_id`, `space_id` e `item_id` son `uuid`; `crypto.randomUUID()`
  genera el id del ítem;
- un tenant o Space que no es UUID se proyecta a UUIDv5 determinista y su valor
  original queda en `tenant_key` / `space_key`;
- `title`, `evidence`, `run_id` e `idempotency_key` son columnas de este esquema,
  no de un DDL paralelo;
- cada transacción hace `SET LOCAL ROLE mesa_app` y fija `app.tenant_id`,
  `app.actor_id` y `app.role`;
- el PATCH y el append de eventos leen con la política de SELECT, autorizan y
  bloquean después con `FOR UPDATE`, porque la política de UPDATE es de dueño.

Una base creada por el DDL antiguo del gateway tiene `tenant_id`/`id` `text`. El
bootstrap la detecta y falla con un mensaje explícito: se recrea o se migra a
`uuid` antes de activar la API. `CREATE TABLE IF NOT EXISTS` no convierte tipos.

## Archivos

```
packages/faberloom/board/postgres/
├── schema.sql                  bootstrap idempotente + RLS + grants
├── src/tenant.ts               withTenant(): transacción con contexto
├── src/index.ts                re-export
├── tests/support/db.ts         backend PGlite/Postgres y helpers
├── tests/schema.test.ts        contrato, idempotencia, catálogo
├── tests/tenant.test.ts        contexto, commit, rollback, reentrancia
├── tests/isolation.test.ts     aislamiento A/B y autorización de owner
├── tests/events.test.ts        append-only, FK, replay
├── docker/00-init.sql          init de PG16: schema x2 + login sin herencia
└── docker-compose.test.yml     PostgreSQL 16 para el lane real
```
