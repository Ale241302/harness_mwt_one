# ADR-006 · Mesa central con PostgreSQL y RLS

**Estado:** en implementación · **Fecha:** 2/11/2026 · **Decisión:** A-58/D-5
**Relacionado:** `ADR-001` (atomicidad del agregado), `ADR-002` (tenant), `ADR-005` (proceso por tenant)

## Contexto

La Mesa vive en un `DSH_HOME` por usuario. Alejandro tiene 460 ítems en
`/data/users/5072fce2…/storages/faberloom_board.json` (2,2 MB); Álvaro tiene su propio
almacén. El rol admin/CEO ya es cross-tenant, pero no puede ver los ítems de otro
almacén. El mirror sincroniza el mismo owner, no owners distintos.

## Decisión

La Mesa pasa a un servicio central en el gateway con PostgreSQL:

- Tablas `mesa_items` y `mesa_events` con `tenant_id`, `owner_id`, `space_id`,
  `business_key`, `state`, `row_version`, `payload jsonb`.
- RLS por `tenant_id` con `app.tenant_id` fijado por transacción; el rol de la
  aplicación no tiene `BYPASSRLS`.
- La API `/board/*` recibe el actor de la sesión en cada request; no acepta
  `tenantId` del cuerpo.
- El board local queda como cliente del servicio; los comandos de estado siguen en
  el board hasta que la API los cubra.
- Migración idempotente de los 460 ítems y sus eventos con
  `scripts/migrate-board-postgres.mjs`.
- Activación por flag, primero en sombra (lee de PostgreSQL y compara contra SQLite)
  y luego real.

## Alternativas

| Alternativa | Por qué no |
|---|---|
| SQLite compartido entre procesos | Viola ADR-001 (un escritor por owner); riesgo de bloqueo y corrupción |
| Proceso y `DSH_HOME` por tenant (ADR-005) | Comparte sesiones y credenciales; el rol y `ownerId` quedan fijados al primer usuario; sin RLS |
| Servicio central sin RLS, filtrado en la aplicación | Una query olvidada filtra entre tenants; D-5 exige la segunda barrera |

## Consecuencias

- Dos usuarios del mismo tenant leen y escriben el mismo ítem; otro tenant no lo ve;
  un `client_b2b` no escribe lo ajeno.
- La migración no borra el SQLite: queda como respaldo y para la reversión.
- La API debe mantener la paridad de comandos del board (aprobar, iterar, candidato,
  efectos) antes de retirar el almacén local.
- Coste estimado: 2–3 semanas; no se activa hasta que las pruebas de dos usuarios y
  de aislamiento pasen contra PostgreSQL real.

## Estado de implementación (2/11/2026)

| Pieza | Estado | Evidencia |
|---|---|---|
| Schema `mesa_items` / `mesa_events` + RLS | Implementado en `gateway/board-api.mjs` | `node --test gateway/board-api.test.mjs`: 18/19 con `pg-mem` (RLS omitida) |
| API `/board/*` con identidad por request | Implementado en `gateway/board-api.mjs` + `gateway/BOARD-API.md` | 19/19 contra PostgreSQL 18.3 real con rol `mesa_app` `NOBYPASSRLS` |
| Migración de los 460 ítems y 2 413 eventos | Script listo y `--dry-run` verificado | `scripts/migrate-board-postgres.mjs` |
| Opción B (home por tenant) | Módulo y ADR-005 listos, no activos | `gateway/tenant-home.test.mjs`: 13/13 |
| Integración del board local con la API | **Pendiente**: el board sigue leyendo su SQLite | Es el paso que habilita la Mesa compartida |

La API todavía no está montada en `server.mjs` ni existe la base `faberloom_mesa` en el
VPS. No se declara la Mesa compartida hasta completar la integración del board y correr
la prueba de dos usuarios contra PostgreSQL real desde la aplicación.

## Activación

1. `schema.sql` aplicado en una base dedicada y rol `mesa_app`.
2. Backend y API con pruebas contra PostgreSQL 16.
3. Migración en seco, luego real, con conteo 460/460 y eventos.
4. Sombra: el board lee de PostgreSQL y compara con SQLite; cualquier divergencia
   bloquea.
5. Activo: `FABERLOOM_BOARD_POSTGRES=1`; el SQLite queda de solo lectura.
6. Reversión: apagar el flag y volver al SQLite intacto.
