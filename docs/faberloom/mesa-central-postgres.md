# Mesa central en PostgreSQL

English | [中文](mesa-central-postgres.zh.md)

`faberloom_mesa` es la base central de la Mesa (Opción A) en la VPS: el tenant es la frontera de aislamiento y la aplica Row Level Security dentro de PostgreSQL. Esta página registra cómo quedó creada, la carga inicial de los 460 ítems de Alejandro y los tres defectos del repositorio que aparecieron al ejecutarla.

## Resultado

- Base `faberloom_mesa` en el contenedor `consola-mwt-one-postgres` (PostgreSQL 16.15), dueño `mesa_migrator`; la base de la consola (`mwt_one`) no se tocó.
- `schema.sql` aplicado cinco veces sin errores: el bootstrap inicial, la convergencia a la versión actual de 16 columnas y 7 índices, y una última pasada sobre la base ya cargada.
- 460 ítems y 2413 eventos cargados en un solo tenant (`5525986c-3b09-4d13-bf8f-43ccaa2deae3`), sin eventos huérfanos.
- Aislamiento verificado con dos tenants: A devuelve 460 ítems y 2413 eventos, B devuelve cero, y un `INSERT` con tenant ajeno falla por RLS.
- Credencial de runtime en `/opt/mwt-one-harness/.env.mesa`, modo 600 y dueño `root:root`.

## Roles y propietarios

| Rol | Atributos | Función |
|---|---|---|
| `mesa_migrator` | `NOLOGIN`, `CREATEROLE`, sin `BYPASSRLS` | Dueño de la base, de `mesa_items` y de `mesa_events`; ejecuta el esquema |
| `mesa_app` | `NOLOGIN`, sin `BYPASSRLS`, sin `CREATEROLE` | Rol de grupo de la aplicación y destino de todas las políticas RLS |
| `mesa_login` | `LOGIN`, `NOINHERIT`, sin `BYPASSRLS` | Único login de runtime; entra con `SET LOCAL ROLE mesa_app` |

`mesa_app` no tiene login y `mesa_login` no hereda privilegios, así que sin `SET LOCAL ROLE mesa_app` toda sentencia falla con `permission denied`: ese es el fallo cerrado que busca el diseño. `REVOKE ALL ON DATABASE ... FROM PUBLIC` obliga además a conceder `CONNECT` a `mesa_login` de forma explícita.

## Migración de los 460 ítems

```sh
# MESA_URL: login de runtime más options=-c role=mesa_app -c app.role=admin
node scripts/migrate-board-postgres.mjs \
  --file "$BOARD_JSON" \
  --tenant 5525986c-3b09-4d13-bf8f-43ccaa2deae3 \
  --database-url "$MESA_URL"
```

La carga corre como `mesa_login` entrando a `mesa_app` al abrir la conexión, así que las políticas RLS se evalúan de verdad; ejecutarla como superusuario las habría saltado. La URL viaja en un archivo 600 y no en la línea de comandos. Una segunda ejecución deja los conteos iguales: los ítems hacen upsert por `(tenant_id, id)` y los eventos usan `ON CONFLICT DO NOTHING`.

## Verificación de aislamiento

```sql
BEGIN;
SET LOCAL ROLE mesa_app;
SELECT set_config('app.tenant_id', '5525986c-3b09-4d13-bf8f-43ccaa2deae3', true),
       set_config('app.actor_id', 'alejandro@muitowork.com', true),
       set_config('app.role', 'client_b2b', true);
SELECT count(*) FROM mesa_items;
SELECT count(*) FROM mesa_events;
ROLLBACK;
```

Con el tenant B (`00000000-0000-4000-8000-000000000001`) los mismos `SELECT` devuelven cero, incluso filtrando por el `tenant_id` del tenant A. Un `INSERT` con `tenant_id` ajeno falla con `new row violates row-level security policy for table "mesa_items"`; en `mesa_events`, `UPDATE`, `DELETE` y `TRUNCATE` fallan con `permission denied`. Sin `app.tenant_id` el `SELECT` devuelve cero filas y, terminada la transacción, el rol y el contexto desaparecen.

## Hallazgos en el repositorio

1. `schema.sql` no se puede aplicar con el rol de migración que documenta el README: `ALTER ROLE mesa_app ... NOSUPERUSER` exige `SUPERUSER` en PostgreSQL 16 y falla con `permission denied to alter role`. Se aplicó como administrador del clúster y después se transfirió la propiedad de las tablas y las funciones a `mesa_migrator`.
2. `migrate-board-postgres.mjs` convierte un `businessKey` ausente en la cadena vacía, que viola `mesa_items_business_key_not_blank`. En el tablero de Alejandro, 436 de 460 ítems no tienen `businessKey` ni `sourceRef` y `rekeyAll` los trata como «sin identidad». Se cargaron con la clave provisional `legacy:<id del ítem>`, derivada del UUID inmutable, y los 24 restantes conservan su clave real.
3. El script fija `app.actor_id` y `app.role` dentro de su transacción, pero no entra a `mesa_app`: no ejecuta `SET LOCAL ROLE`. Con una URL de `mesa_login` sin `options=-c role=mesa_app` la primera escritura falla con `permission denied for table mesa_items`. Conviene que el script haga el `SET LOCAL ROLE` o que documente esa opción en la URL.

## Operación

```sh
docker exec -i consola-mwt-one-postgres psql -U mwt -d faberloom_mesa -v ON_ERROR_STOP=1
```

- Toda escritura de la aplicación va con `SET LOCAL ROLE mesa_app` y las tres variables de sesión, que es lo que ya hace `withTenant()`.
- El directorio `/opt/mwt-one-harness` está en modo 0777: un usuario local puede reemplazar `.env.mesa` aunque el archivo sea 600. Conviene cerrar el directorio.
- `faberloom_mesa` todavía no tiene respaldo ni recuperación a un punto en el tiempo; falta fijar RPO y RTO y probar una restauración real.

## Activación (2/11/2026)

- El gateway monta `/board` con `FABERLOOM_BOARD_API=1` y `DATABASE_URL` del rol
  `mesa_login`; sin sesión responde `401`, y el token HMAC por usuario que emite
  `startInstance` es aceptado como `Authorization: Bearer`.
- Mesa compartida (A): `FABERLOOM_BOARD_TENANT=5525986c-3b09-4d13-bf8f-43ccaa2deae3`.
  Alejandro y Álvaro reciben el mismo tenant; con su token real el API devuelve
  **460 ítems únicos e idénticos** para ambos (paginados de 200 en 200).
- Cross-tenant por entidad (B): el token lleva `tenantIds` y la request elige con
  `x-board-tenant`; un admin ve su otra entidad y un `client_b2b` recibe
  `403 NO_ACCESS`.
- Escrituras verificadas contra PostgreSQL real en un tenant desechable: crear
  `201`, aprobar con severidad `200`, aprobar sin severidad `422
  SEVERITY_REQUIRED`, transición desde un estado terminal `409 TERMINAL_STATE`,
  iterar con espacio `200 ITERANDO`, y auditoría `created`/`approve`.
- Modo `on`: el board corre la máquina de estados, los controles, el candidato y
  el lock de iteración en el proceso y persiste el registro completo; SQLite queda
  como respaldo y recibe una copia de cada commit. El `dsh` de cada usuario lleva
  `FABERLOOM_BOARD_REMOTE=on`, la URL interna, el tenant y su token.
- `healthz`: `forkSha=ff9e1431e1`, `manifestDrift=false`.

## Pendientes

- Decidir el rekey canónico de las 436 filas con clave provisional, o relajar `business_key` a `NOT NULL` con índice único parcial.
- Corregir el `ALTER ROLE` de `schema.sql` para que un rol `CREATEROLE` pueda aplicar el archivo.
- Rellenar `title`, `run_id` e `idempotency_key` desde el `payload` de las filas importadas, o confirmar que la API cae al `payload` cuando están en `NULL`.
- Programar respaldo verificado y una prueba de restauración antes de que la Mesa central reciba tráfico real.
