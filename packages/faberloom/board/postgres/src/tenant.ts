/**
 * Tenant-scoped transactions for the Mesa central Postgres store (Opción A).
 *
 * The database enforces isolation through row level security. RLS reads the
 * tenant from `app.tenant_id`, which must be set transaction-locally and with
 * the constrained `mesa_app` role active. `withTenant()` is the only supported
 * way to open such a transaction.
 *
 *     import { withTenant } from './tenant.ts'
 *
 *     const items = await withTenant(client, tenantId, tx =>
 *       tx.query('SELECT id, state FROM public.mesa_items ORDER BY created_at'))
 *
 * `client` must be a single checked-out connection (`pg.PoolClient`). Do not
 * pass a `pg.Pool`: pool.query() may use a different backend for each
 * statement, and `SET LOCAL` would then apply to the wrong session.
 */

/** The subset of `pg.PoolClient` / PGlite this module needs. */
export interface TenantQueryResult<T> {
  rows: T[]
}

/** A single connection that can run statements inside a transaction. */
export interface TenantClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<TenantQueryResult<T>>
}

/** Identity and database role for one tenant-scoped transaction. */
export interface TenantContextOptions {
  /** Authenticated principal. Required for owner-scoped writes. */
  actorId?: string
  /** Board role: `client_b2b`, `admin`, `superadmin`, or `ceo`. */
  appRole?: string
  /**
   * Database role entered with `SET LOCAL ROLE`. Defaults to `mesa_app`.
   * Pass `false` when the connection already uses the constrained role and
   * the caller cannot (or should not) switch roles.
   */
  dbRole?: string | false
}

const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const ROLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u

// Guard against a nested call committing the outer transaction.
const activeClients = new WeakSet<TenantClient>()

function assertTenantId(tenantId: string): void {
  if (!TENANT_ID.test(tenantId)) {
    throw new TypeError(`withTenant: tenantId must be a UUID, received ${JSON.stringify(tenantId)}`)
  }
}

function assertRoleName(role: string): void {
  if (!ROLE_NAME.test(role)) {
    throw new TypeError(`withTenant: dbRole must be a plain SQL identifier, received ${JSON.stringify(role)}`)
  }
}

/**
 * Run `fn` in a transaction whose tenant, actor, and role are pinned.
 *
 * The tenant is applied with `set_config(..., true)`, the parameterized
 * equivalent of `SET LOCAL app.tenant_id = ...` (PostgreSQL rejects bind
 * parameters in `SET`). The context resets when the transaction ends.
 *
 * A thrown error rolls the transaction back and is re-thrown unchanged.
 * `fn` must not COMMIT, ROLLBACK, or open its own transaction; `withTenant`
 * owns the transaction boundary.
 *
 * @param client single checked-out connection with no open transaction, never a pool
 * @param tenantId tenant UUID written to `app.tenant_id`
 * @param fn statements to run inside the tenant transaction
 * @param options actor, board role, and database role for the transaction
 * @returns the value `fn` resolves with, after COMMIT
 */
export async function withTenant<T>(
  client: TenantClient,
  tenantId: string,
  fn: (tx: TenantClient) => Promise<T>,
  options: TenantContextOptions = {},
): Promise<T> {
  assertTenantId(tenantId)

  const dbRole = options.dbRole === undefined ? 'mesa_app' : options.dbRole
  if (typeof dbRole === 'string') assertRoleName(dbRole)
  if (options.actorId !== undefined && options.actorId.trim() === '') {
    throw new TypeError('withTenant: actorId must not be empty when provided')
  }
  if (options.appRole !== undefined && options.appRole.trim() === '') {
    throw new TypeError('withTenant: appRole must not be empty when provided')
  }

  if (activeClients.has(client)) {
    throw new Error('withTenant: reentrant call on the same client is not supported')
  }
  activeClients.add(client)

  try {
    await client.query('BEGIN')

    try {
      if (dbRole !== false) await client.query(`SET LOCAL ROLE ${dbRole}`)

      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId])
      // Always overwrite actor and role, including with an empty value. A stale
      // session-level setting must never leak console privileges into a call
      // that did not ask for them.
      await client.query('SELECT set_config($1, $2, true)', ['app.actor_id', options.actorId ?? ''])
      await client.query('SELECT set_config($1, $2, true)', ['app.role', options.appRole ?? ''])

      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // The transaction may already be gone; the original error is the one
        // the caller can act on.
      }
      throw error
    }
  } finally {
    activeClients.delete(client)
  }
}
