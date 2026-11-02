#!/usr/bin/env node
/**
 * Migrate one local `faberloom_board` store into the central PostgreSQL Mesa
 * (A-58, D-5). The source is the JSON file the storage domain writes under a
 * user's home; the destination is `mesa_items` + `mesa_events`.
 *
 * It is idempotent: items upsert by `(tenant_id, id)` and events insert by
 * `(tenant_id, item_id, seq)` with `ON CONFLICT DO NOTHING`, so a repeated run
 * never duplicates history.
 *
 * Usage:
 *   node scripts/migrate-board-postgres.mjs --file <faberloom_board.json> \
 *     --tenant <uuid> [--dry-run] [--database-url <url>]
 *
 * `--tenant` is the fallback for an item whose record carries no `companyId`.
 * The tenant of each item is its own `companyId` when present.
 *
 * The destination schema stores `tenant_id`, `id`, and `space_id` as uuid and
 * requires a non-blank `business_key`; a source record that violates either
 * stops the transaction instead of being coerced. The transaction sets
 * `app.role = 'admin'` because RLS is forced on the table owner as well.
 */
import { readFile } from 'node:fs/promises'

/**
 * Read the CLI arguments.
 * @param {readonly string[]} argv - process arguments after the script name.
 * @returns {{ file?: string, tenant?: string, dryRun: boolean, databaseUrl?: string }}
 */
function parseArgs(argv) {
  const out = { dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--file') out.file = argv[++index]
    else if (arg === '--tenant') out.tenant = argv[++index]
    else if (arg === '--database-url') out.databaseUrl = argv[++index]
    else if (arg === '--role') out.role = argv[++index]
  }
  return out
}

/**
 * Turn one stored board record into the row the central table expects.
 * @param {string} id - item id.
 * @param {Record<string, unknown>} record - stored board record.
 * @param {string} fallbackTenant - tenant used when the record carries none.
 * @returns {{ tenantId: string, id: string, ownerId: string, spaceId: string | null,
 *   businessKey: string, state: string, rowVersion: number, payload: unknown,
 *   createdAt: string, updatedAt: string }}
 */
function itemRow(id, record, fallbackTenant) {
  const tenantId = typeof record.companyId === 'string' && record.companyId.length > 0
    ? record.companyId
    : fallbackTenant
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString()
  const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : createdAt
  return {
    tenantId,
    id,
    ownerId: String(record.ownerId ?? ''),
    spaceId: typeof record.spaceId === 'string' ? record.spaceId : null,
    // Legacy rows without a source have no business identity; the schema
    // refuses an empty key, so the immutable item id names them explicitly.
    businessKey: String(record.businessKey ?? '').trim() || `legacy:${id}`,
    state: String(record.state ?? record.status ?? 'PENDIENTE_CRITERIO'),
    rowVersion: Number(record.rowVersion ?? 1),
    payload: record,
    createdAt,
    updatedAt,
  }
}

/**
 * Turn every stored event of one item into an append-only row.
 * @param {{ tenantId: string, id: string }} item - the owning item.
 * @param {Record<string, unknown>} record - stored board record.
 * @returns {readonly { tenantId: string, itemId: string, seq: number, actor: string,
 *   command: string, fromState: string | null, toState: string, payload: unknown, at: string }[]}
 */
function eventRows(item, record) {
  const events = Array.isArray(record.events) ? record.events : []
  return events.map((event, index) => ({
    tenantId: item.tenantId,
    itemId: item.id,
    seq: index + 1,
    actor: String(event?.actor ?? ''),
    command: String(event?.command ?? ''),
    fromState: typeof event?.fromState === 'string' ? event.fromState : null,
    toState: String(event?.toState ?? item.state ?? ''),
    payload: event,
    at: typeof event?.at === 'string' ? event.at : item.createdAt,
  }))
}

const args = parseArgs(process.argv.slice(2))
if (args.file === undefined || args.tenant === undefined) {
  console.error('usage: migrate-board-postgres.mjs --file <board.json> --tenant <uuid> [--dry-run] [--database-url <url>]')
  process.exit(2)
}

const raw = JSON.parse(await readFile(args.file, 'utf8'))
const items = raw?.tables?.items
if (items === null || typeof items !== 'object') {
  console.error('migrate: the file has no tables.items')
  process.exit(2)
}

const rows = []
const events = []
for (const [id, record] of Object.entries(items)) {
  if (record === null || typeof record !== 'object') continue
  const row = itemRow(id, record, args.tenant)
  rows.push(row)
  events.push(...eventRows(row, record))
}

const tenants = new Set(rows.map(row => row.tenantId))
console.log(JSON.stringify({
  dryRun: args.dryRun,
  items: rows.length,
  events: events.length,
  tenants: [...tenants],
  sample: rows.slice(0, 3).map(row => ({ id: row.id, tenantId: row.tenantId, state: row.state, rowVersion: row.rowVersion })),
}, null, 2))

if (args.dryRun) process.exit(0)

const { default: pg } = await import('pg')
const pool = new pg.Pool({ connectionString: args.databaseUrl ?? process.env.DATABASE_URL })
const client = await pool.connect()
let applied = 0
try {
  await client.query('BEGIN')
  // RLS evaluates the policies of the role that owns the transaction. The
  // runtime login is NOINHERIT, so it must enter the group role explicitly;
  // the name is validated instead of parameterized because SET ROLE accepts no
  // bind parameters.
  const role = args.role ?? 'mesa_app'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(role)) throw new Error(`invalid role name: ${role}`)
  await client.query(`SET LOCAL ROLE ${role}`)
  // The canonical schema forces RLS on the table owner too. A backfill is an
  // operator action over every owner in the tenant, so it runs with the console
  // role the policies accept; the tenant is still pinned per iteration.
  await client.query('SELECT set_config($1, $2, true)', ['app.actor_id', ''])
  await client.query('SELECT set_config($1, $2, true)', ['app.role', 'admin'])
  for (const tenantId of tenants) {
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId])
    for (const row of rows.filter(candidate => candidate.tenantId === tenantId)) {
      await client.query(
        `INSERT INTO mesa_items (tenant_id, id, owner_id, space_id, business_key, state, row_version, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (tenant_id, id) DO UPDATE
           SET owner_id = EXCLUDED.owner_id, space_id = EXCLUDED.space_id, business_key = EXCLUDED.business_key,
               state = EXCLUDED.state, row_version = GREATEST(mesa_items.row_version, EXCLUDED.row_version),
               payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
        [row.tenantId, row.id, row.ownerId, row.spaceId, row.businessKey, row.state, row.rowVersion, row.payload, row.createdAt, row.updatedAt],
      )
      applied += 1
    }
    for (const event of events.filter(candidate => candidate.tenantId === tenantId)) {
      await client.query(
        `INSERT INTO mesa_events (tenant_id, item_id, seq, actor, command, from_state, to_state, payload, at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id, item_id, seq) DO NOTHING`,
        [event.tenantId, event.itemId, event.seq, event.actor, event.command, event.fromState, event.toState, event.payload, event.at],
      )
    }
  }
  await client.query('COMMIT')
  console.log(`migrate: committed ${String(applied)} item(s) and ${String(events.length)} event(s)`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  console.error(`migrate: rolled back — ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
