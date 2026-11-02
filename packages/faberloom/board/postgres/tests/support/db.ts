import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { withTenant, type TenantClient, type TenantContextOptions } from '../../src/tenant.ts'

export const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export const OWNER_A = 'ana@tenant-a.test'
export const OWNER_A2 = 'alvaro@tenant-a.test'
export const OWNER_B = 'bruno@tenant-b.test'
export const ADMIN_A = 'admin@tenant-a.test'

// A real Postgres database is reused across runs (and test files run in
// parallel processes), so every business key carries a per-process suffix.
export const RUN_ID = randomUUID()

/** Namespace a business key so concurrent files and repeated runs cannot collide. */
export function key(name: string): string {
  return `${name}-${RUN_ID}`
}

/** A live connection plus catalog access for assertions. */
export interface TestBackend {
  readonly kind: 'pglite' | 'postgres'
  readonly client: TenantClient
  /** Run a multi-statement script (test bootstrap only). */
  exec(sql: string): Promise<void>
  /** Raw query on the same connection, used for catalog assertions. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  close(): Promise<void>
}

interface PgliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  exec(sql: string): Promise<unknown>
  close(): Promise<void>
}

interface PgClientLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  release(): void
}

interface PgPoolLike {
  connect(): Promise<PgClientLike>
  end(): Promise<void>
}

export const schemaSql = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')

/**
 * Use a real PostgreSQL when the caller points at one; otherwise run the same
 * SQL against PGlite (PostgreSQL compiled to WASM, in this process).
 *
 * `MESA_TEST_DATABASE_URL` wins over `DATABASE_URL`. A non-local host is
 * refused unless `MESA_TEST_ALLOW_REMOTE=1`, so a stray production URL cannot
 * run the destructive isolation cases by accident.
 */
export async function createBackend(): Promise<TestBackend> {
  const url = process.env.MESA_TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (url !== undefined && url !== '') return createPostgresBackend(url)
  return createPgliteBackend()
}

function assertLocalHost(url: string): void {
  const { hostname } = new URL(url)
  const local = hostname === '' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  if (!local && process.env.MESA_TEST_ALLOW_REMOTE !== '1') {
    throw new Error(
      `refusing to run destructive Mesa tests against non-local host ${JSON.stringify(hostname)}; `
      + 'set MESA_TEST_ALLOW_REMOTE=1 only if this database is disposable',
    )
  }
}

async function createPgliteBackend(): Promise<TestBackend> {
  const db = new PGlite() as unknown as PgliteLike
  await db.exec(schemaSql)
  return {
    kind: 'pglite',
    client: {
      query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => db.query<T>(sql, params),
    },
    exec: async (sql) => { await db.exec(sql) },
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => db.query<T>(sql, params),
    close: () => db.close(),
  }
}

async function createPostgresBackend(url: string): Promise<TestBackend> {
  assertLocalHost(url)
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: url, max: 1 }) as unknown as PgPoolLike
  const pgClient = await pool.connect()
  const client: TenantClient = {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      const result = await pgClient.query<T>(sql, params)
      return { rows: result.rows }
    },
  }

  const present = await client.query<{ table: string | null }>(
    "SELECT to_regclass('public.mesa_items')::text AS table",
  )
  if (present.rows[0]?.table === null) {
    pgClient.release()
    await pool.end()
    throw new Error('schema.sql has not been applied to this database; see README.md')
  }

  return {
    kind: 'postgres',
    client,
    exec: async () => {
      throw new Error('DDL is not run through the application role; apply schema.sql as the migration role')
    },
    query: (sql, params) => client.query(sql, params),
    close: async () => {
      pgClient.release()
      await pool.end()
    },
  }
}

export interface InsertItemInput {
  id?: string
  ownerId: string
  businessKey: string
  state?: string
  spaceId?: string | null
  rowVersion?: number
  payload?: unknown
}

export interface ItemRow {
  tenant_id: string
  id: string
  owner_id: string
  space_id: string | null
  business_key: string
  state: string
  row_version: string | number
  payload: Record<string, unknown>
  created_at: string | Date
  updated_at: string | Date
}

function contextFor(ownerId: string, options: TenantContextOptions): TenantContextOptions {
  const context: TenantContextOptions = {
    actorId: options.actorId ?? ownerId,
    appRole: options.appRole ?? 'client_b2b',
  }
  if (options.dbRole !== undefined) context.dbRole = options.dbRole
  return context
}

export async function insertItem(
  client: TenantClient,
  tenantId: string,
  input: InsertItemInput,
  options: TenantContextOptions = {},
): Promise<ItemRow> {
  return withTenant(client, tenantId, async (tx) => {
    const result = await tx.query<ItemRow>(
      `INSERT INTO public.mesa_items
         (tenant_id, id, owner_id, space_id, business_key, state, row_version, payload)
       VALUES ($1, COALESCE($2::uuid, gen_random_uuid()), $3, $4::uuid, $5, $6, $7, $8::jsonb)
       RETURNING *`,
      [
        tenantId,
        input.id ?? null,
        input.ownerId,
        input.spaceId ?? null,
        input.businessKey,
        input.state ?? 'PENDIENTE_CRITERIO',
        input.rowVersion ?? 1,
        JSON.stringify(input.payload ?? {}),
      ],
    )
    return result.rows[0]!
  }, contextFor(input.ownerId, options))
}

export interface InsertEventInput {
  itemId: string
  seq: number
  actor: string
  command: string
  fromState?: string | null
  toState: string
  payload?: Record<string, unknown>
}

export interface EventRow {
  tenant_id: string
  item_id: string
  seq: string | number
  actor: string
  command: string
  from_state: string | null
  to_state: string
  payload: Record<string, unknown>
  at: string | Date
}

export async function insertEvent(
  client: TenantClient,
  tenantId: string,
  input: InsertEventInput,
  options: TenantContextOptions = {},
): Promise<EventRow> {
  return withTenant(client, tenantId, async (tx) => {
    const result = await tx.query<EventRow>(
      `INSERT INTO public.mesa_events
         (tenant_id, item_id, seq, actor, command, from_state, to_state, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING *`,
      [
        tenantId,
        input.itemId,
        input.seq,
        input.actor,
        input.command,
        input.fromState ?? null,
        input.toState,
        JSON.stringify(input.payload ?? {}),
      ],
    )
    return result.rows[0]!
  }, contextFor(input.actor, options))
}

/** Assert a SQLSTATE without hiding an unexpected success. */
export async function expectPgError(
  promise: Promise<unknown>,
  code: string,
  message?: RegExp,
): Promise<Error & { code?: string }> {
  try {
    await promise
  } catch (error) {
    const pgError = error as Error & { code?: string }
    assert.equal(
      pgError.code,
      code,
      `expected SQLSTATE ${code}, got ${pgError.code ?? '(none)'}: ${pgError.message}`,
    )
    if (message !== undefined) assert.match(pgError.message, message)
    return pgError
  }
  assert.fail(`expected SQLSTATE ${code}, but the statement succeeded`)
}

export function asInt(value: string | number): number {
  return Number(value)
}
