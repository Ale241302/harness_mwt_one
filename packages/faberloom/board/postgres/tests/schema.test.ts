import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { withTenant } from '../src/tenant.ts'
import {
  OWNER_A,
  TENANT_A,
  asInt,
  createBackend,
  expectPgError,
  insertItem,
  key,
  schemaSql,
  type TestBackend,
} from './support/db.ts'

let backend: TestBackend

before(async () => {
  backend = await createBackend()
})

after(async () => {
  await backend.close()
})

describe('schema contract', () => {
  it('re-applies the bootstrap without error (idempotent)', async (t) => {
    if (backend.kind !== 'pglite') {
      // docker-compose.test.yml applies schema.sql twice during initdb.
      t.skip('the Postgres lane proves idempotency in docker/00-init.sql')
      return
    }
    await backend.exec(schemaSql)
    await backend.exec(schemaSql)
  })

  it('creates the required mesa_items columns with the right nullability', async () => {
    const { rows } = await backend.query<{
      column_name: string
      data_type: string
      attnotnull: boolean
    }>(
      `SELECT a.attname AS column_name,
              format_type(a.atttypid, a.atttypmod) AS data_type,
              a.attnotnull
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'mesa_items'
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
    )
    const columns = new Map(rows.map(row => [row.column_name, row]))

    assert.deepEqual(columns.get('tenant_id'), {
      column_name: 'tenant_id', data_type: 'uuid', attnotnull: true,
    })
    assert.deepEqual(columns.get('id'), {
      column_name: 'id', data_type: 'uuid', attnotnull: true,
    })
    assert.deepEqual(columns.get('owner_id'), {
      column_name: 'owner_id', data_type: 'text', attnotnull: true,
    })
    assert.deepEqual(columns.get('space_id'), {
      column_name: 'space_id', data_type: 'uuid', attnotnull: false,
    })
    assert.deepEqual(columns.get('business_key'), {
      column_name: 'business_key', data_type: 'text', attnotnull: true,
    })
    assert.deepEqual(columns.get('state'), {
      column_name: 'state', data_type: 'text', attnotnull: true,
    })
    assert.deepEqual(columns.get('row_version'), {
      column_name: 'row_version', data_type: 'bigint', attnotnull: true,
    })
    assert.deepEqual(columns.get('payload'), {
      column_name: 'payload', data_type: 'jsonb', attnotnull: true,
    })
    assert.deepEqual(columns.get('created_at'), {
      column_name: 'created_at', data_type: 'timestamp with time zone', attnotnull: true,
    })
    assert.deepEqual(columns.get('updated_at'), {
      column_name: 'updated_at', data_type: 'timestamp with time zone', attnotnull: true,
    })
  })

  it('adds the HTTP API columns without changing the board columns', async () => {
    const { rows } = await backend.query<{
      column_name: string
      data_type: string
      attnotnull: boolean
    }>(
      `SELECT a.attname AS column_name,
              format_type(a.atttypid, a.atttypmod) AS data_type,
              a.attnotnull
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'mesa_items'
          AND a.attnum > 0 AND NOT a.attisdropped`,
    )
    const columns = new Map(rows.map(row => [row.column_name, row]))

    assert.deepEqual(columns.get('title'), {
      column_name: 'title', data_type: 'text', attnotnull: false,
    })
    assert.deepEqual(columns.get('evidence'), {
      column_name: 'evidence', data_type: 'jsonb', attnotnull: true,
    })
    assert.deepEqual(columns.get('run_id'), {
      column_name: 'run_id', data_type: 'text', attnotnull: false,
    })
    assert.deepEqual(columns.get('idempotency_key'), {
      column_name: 'idempotency_key', data_type: 'text', attnotnull: false,
    })
    assert.deepEqual(columns.get('tenant_key'), {
      column_name: 'tenant_key', data_type: 'text', attnotnull: false,
    })
    assert.deepEqual(columns.get('space_key'), {
      column_name: 'space_key', data_type: 'text', attnotnull: false,
    })
  })

  it('creates the required mesa_events columns', async () => {
    const { rows } = await backend.query<{
      column_name: string
      data_type: string
    }>(
      `SELECT a.attname AS column_name,
              format_type(a.atttypid, a.atttypmod) AS data_type
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'mesa_events'
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
    )
    const columns = new Map(rows.map(row => [row.column_name, row.data_type]))

    assert.equal(columns.get('tenant_id'), 'uuid')
    assert.equal(columns.get('item_id'), 'uuid')
    assert.equal(columns.get('seq'), 'bigint')
    assert.equal(columns.get('actor'), 'text')
    assert.equal(columns.get('command'), 'text')
    assert.equal(columns.get('from_state'), 'text')
    assert.equal(columns.get('to_state'), 'text')
    assert.equal(columns.get('payload'), 'jsonb')
    assert.equal(columns.get('at'), 'timestamp with time zone')
  })

  it('uses (tenant_id, id) and (tenant_id, item_id, seq) as primary keys', async () => {
    const { rows } = await backend.query<{ table_name: string; column_name: string }>(
      `SELECT c.relname AS table_name, a.attname AS column_name
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indisprimary
          AND i.indrelid IN ('public.mesa_items'::regclass, 'public.mesa_events'::regclass)
        ORDER BY c.relname, a.attnum`,
    )

    assert.deepEqual(
      rows.filter(row => row.table_name === 'mesa_items').map(row => row.column_name),
      ['tenant_id', 'id'],
    )
    assert.deepEqual(
      rows.filter(row => row.table_name === 'mesa_events').map(row => row.column_name),
      ['tenant_id', 'item_id', 'seq'],
    )
  })

  it('declares the composite event foreign key with ON DELETE RESTRICT', async () => {
    const { rows } = await backend.query<{ conname: string; definition: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'public.mesa_events'::regclass AND contype = 'f'`,
    )

    assert.equal(rows.length, 1)
    assert.match(rows[0]!.definition, /FOREIGN KEY \(tenant_id, item_id\)/u)
    assert.match(rows[0]!.definition, /REFERENCES (?:public\.)?mesa_items\(tenant_id, id\)/u)
    assert.match(rows[0]!.definition, /ON DELETE RESTRICT/u)
  })

  it('enables and forces row level security on both tables', async () => {
    const { rows } = await backend.query<{
      relname: string
      relrowsecurity: boolean
      relforcerowsecurity: boolean
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('mesa_items', 'mesa_events')
        ORDER BY c.relname`,
    )

    assert.deepEqual(rows, [
      { relname: 'mesa_events', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'mesa_items', relrowsecurity: true, relforcerowsecurity: true },
    ])
  })

  it('creates mesa_app without login, superuser, or BYPASSRLS', async () => {
    const { rows } = await backend.query<{
      rolcanlogin: boolean
      rolsuper: boolean
      rolbypassrls: boolean
      rolcreatedb: boolean
      rolcreaterole: boolean
    }>(
      `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
         FROM pg_roles WHERE rolname = 'mesa_app'`,
    )

    assert.deepEqual(rows, [{
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    }])
  })

  it('defines four item policies and two event policies, all scoped to mesa_app', async () => {
    const { rows } = await backend.query<{
      tablename: string
      policyname: string
      cmd: string
      roles: string[]
    }>(
      `SELECT tablename, policyname, cmd, roles
         FROM pg_policies
        WHERE schemaname = 'public' AND tablename IN ('mesa_items', 'mesa_events')
        ORDER BY tablename, policyname`,
    )

    const itemCommands = rows.filter(row => row.tablename === 'mesa_items').map(row => row.cmd).sort()
    const eventCommands = rows.filter(row => row.tablename === 'mesa_events').map(row => row.cmd).sort()
    assert.deepEqual(itemCommands, ['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
    assert.deepEqual(eventCommands, ['INSERT', 'SELECT'])
    assert.ok(rows.every(row => row.roles.includes('mesa_app')), 'every policy targets mesa_app only')
  })

  it('creates the partial unique index for live business keys', async () => {
    const { rows } = await backend.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'mesa_items'`,
    )
    const live = rows.find(row => row.indexname === 'mesa_items_live_business_key_uniq')

    assert.ok(live, 'the live business-key index exists')
    assert.match(live.indexdef, /CREATE UNIQUE INDEX/u)
    assert.match(live.indexdef, /\(tenant_id, business_key\)/u)
    assert.match(live.indexdef, /WHERE/u)
  })

  it('creates the required tenant-first indexes', async () => {
    const { rows } = await backend.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'mesa_items'`,
    )
    const definitions = rows.map(row => row.indexdef).join('\n')

    assert.match(definitions, /\(tenant_id, state, created_at\)/u)
    assert.match(definitions, /\(tenant_id, space_id\)/u)
    assert.match(definitions, /\(tenant_id, owner_id\)/u)
    assert.match(definitions, /\(tenant_id, lower\(owner_id\)\)/u)
  })

  it('creates the partial unique index for idempotency keys', async () => {
    const { rows } = await backend.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'mesa_items'
          AND indexname = 'mesa_items_tenant_idempotency_key_uniq'`,
    )

    assert.equal(rows.length, 1)
    assert.match(rows[0]!.indexdef, /CREATE UNIQUE INDEX/u)
    assert.match(rows[0]!.indexdef, /\(tenant_id, idempotency_key\)/u)
    assert.match(rows[0]!.indexdef, /WHERE \(idempotency_key IS NOT NULL\)/u)
  })

  it('rejects row_version below 1 and non-object payloads', async () => {
    await expectPgError(insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A,
      businessKey: key('schema-row-version'),
      rowVersion: 0,
    }), '23514', /row_version/u)

    await expectPgError(insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A,
      businessKey: key('schema-payload-array'),
      payload: [],
    }), '23514', /payload/u)
  })

  it('keeps updated_at server-owned and row_version application-owned', async () => {
    const item = await insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A,
      businessKey: key('schema-touch'),
      payload: { summary: 'borrador' },
    })

    const result = await withTenant(backend.client, TENANT_A, tx => tx.query<{
      state: string
      row_version: string | number
      updated_at: string | Date
    }>(
      `UPDATE public.mesa_items
          SET state = 'APROBADO', updated_at = '2000-01-01T00:00:00Z'
        WHERE tenant_id = $1 AND id = $2
        RETURNING state, row_version, updated_at`,
      [TENANT_A, item.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' })

    assert.equal(result.rows[0]?.state, 'APROBADO')
    assert.equal(asInt(result.rows[0]!.row_version), 1)
    assert.ok(new Date(result.rows[0]!.updated_at).getUTCFullYear() > 2000)
  })
})
