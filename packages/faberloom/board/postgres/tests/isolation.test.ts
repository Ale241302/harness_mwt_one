import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { withTenant } from '../src/tenant.ts'
import {
  ADMIN_A,
  OWNER_A,
  OWNER_A2,
  OWNER_B,
  TENANT_A,
  TENANT_B,
  createBackend,
  expectPgError,
  insertItem,
  key,
  type TestBackend,
} from './support/db.ts'

let backend: TestBackend

before(async () => {
  backend = await createBackend()
})

after(async () => {
  await backend.close()
})

describe('mesa_items tenant isolation', () => {
  it('shows tenant A only its own rows, both by filter and by id', async () => {
    const a = await insertItem(backend.client, TENANT_A, { ownerId: OWNER_A, businessKey: key('iso-read-a') })
    const b = await insertItem(backend.client, TENANT_B, { ownerId: OWNER_B, businessKey: key('iso-read-b') })

    const visible = await withTenant(backend.client, TENANT_A, tx => tx.query<{ id: string }>(
      'SELECT id FROM public.mesa_items WHERE id = ANY ($1::uuid[])',
      [[a.id, b.id]],
    ), { actorId: OWNER_A, appRole: 'client_b2b' })

    assert.deepEqual(visible.rows.map(row => row.id), [a.id])

    const foreign = await withTenant(backend.client, TENANT_A, tx => tx.query<{ id: string }>(
      'SELECT id FROM public.mesa_items WHERE id = $1',
      [b.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' })
    assert.deepEqual(foreign.rows, [])
  })

  it('cannot update or delete a row of another tenant', async () => {
    const b = await insertItem(backend.client, TENANT_B, {
      ownerId: OWNER_B,
      businessKey: key('iso-write-b'),
      state: 'PENDIENTE_CRITERIO',
    })

    const updated = await withTenant(backend.client, TENANT_A, tx => tx.query<{ id: string }>(
      `UPDATE public.mesa_items SET state = 'APROBADO' WHERE id = $1 RETURNING id`,
      [b.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' })
    assert.deepEqual(updated.rows, [])

    const deleted = await withTenant(backend.client, TENANT_A, tx => tx.query<{ id: string }>(
      'DELETE FROM public.mesa_items WHERE id = $1 RETURNING id',
      [b.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' })
    assert.deepEqual(deleted.rows, [])

    const stillThere = await withTenant(backend.client, TENANT_B, tx => tx.query<{ state: string }>(
      'SELECT state FROM public.mesa_items WHERE id = $1',
      [b.id],
    ), { actorId: OWNER_B, appRole: 'client_b2b' })
    assert.equal(stillThere.rows[0]?.state, 'PENDIENTE_CRITERIO')
  })

  it('cannot insert a row that claims another tenant', async () => {
    const businessKey = key('iso-cross-insert')
    await expectPgError(withTenant(backend.client, TENANT_A, tx => tx.query(
      `INSERT INTO public.mesa_items (tenant_id, owner_id, business_key, state, payload)
       VALUES ($1, $2, $3, 'PENDIENTE_CRITERIO', '{}'::jsonb)`,
      [TENANT_B, OWNER_B, businessKey],
    ), { actorId: OWNER_A, appRole: 'client_b2b' }), '42501', /row-level security/u)

    const found = await withTenant(backend.client, TENANT_B, tx => tx.query<{ id: string }>(
      `SELECT id FROM public.mesa_items WHERE business_key = $1`,
      [businessKey],
    ), { actorId: OWNER_B, appRole: 'client_b2b' })
    assert.deepEqual(found.rows, [])
  })

  it('can delete its own row and leaves the other tenant untouched', async () => {
    const a = await insertItem(backend.client, TENANT_A, { ownerId: OWNER_A, businessKey: key('iso-delete-a') })
    const b = await insertItem(backend.client, TENANT_B, { ownerId: OWNER_B, businessKey: key('iso-delete-b') })

    const deleted = await withTenant(backend.client, TENANT_A, tx => tx.query<{ id: string }>(
      'DELETE FROM public.mesa_items WHERE id = $1 RETURNING id',
      [a.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' })
    assert.deepEqual(deleted.rows.map(row => row.id), [a.id])

    const bStillThere = await withTenant(backend.client, TENANT_B, tx => tx.query<{ id: string }>(
      'SELECT id FROM public.mesa_items WHERE id = $1',
      [b.id],
    ), { actorId: OWNER_B, appRole: 'client_b2b' })
    assert.deepEqual(bStillThere.rows.map(row => row.id), [b.id])
  })

  it('fails closed when no tenant context is set', async () => {
    await backend.query('BEGIN')
    try {
      await backend.query('SET LOCAL ROLE mesa_app')

      const selected = await backend.query<{ id: string }>('SELECT id FROM public.mesa_items')
      assert.deepEqual(selected.rows, [])

      await expectPgError(backend.query(
        `INSERT INTO public.mesa_items (tenant_id, owner_id, business_key, state, payload)
         VALUES ($1, $2, $3, 'PENDIENTE_CRITERIO', '{}'::jsonb)`,
        [TENANT_A, OWNER_A, key('iso-no-context')],
      ), '42501', /row-level security/u)
    } finally {
      await backend.query('ROLLBACK')
    }
  })
})

describe('mesa_items owner authorization', () => {
  it('lets a client_b2b write only a row it owns', async () => {
    const own = await insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A,
      businessKey: key('owner-own'),
    })

    await expectPgError(insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A2,
      businessKey: key('owner-foreign-client'),
    }, { actorId: OWNER_A, appRole: 'client_b2b' }), '42501', /row-level security/u)

    const updated = await withTenant(backend.client, TENANT_A, tx => tx.query<{ id: string }>(
      `UPDATE public.mesa_items SET state = 'APROBADO' WHERE id = $1 RETURNING id`,
      [own.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' })
    assert.deepEqual(updated.rows.map(row => row.id), [own.id])
  })

  it('cannot update or delete another owner row or reassign its own row', async () => {
    const foreign = await insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A2,
      businessKey: key('owner-foreign-ops'),
    })

    const updated = await withTenant(backend.client, TENANT_A, tx => tx.query<{ id: string }>(
      `UPDATE public.mesa_items SET state = 'APROBADO' WHERE id = $1 RETURNING id`,
      [foreign.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' })
    assert.deepEqual(updated.rows, [])

    const deleted = await withTenant(backend.client, TENANT_A, tx => tx.query<{ id: string }>(
      'DELETE FROM public.mesa_items WHERE id = $1 RETURNING id',
      [foreign.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' })
    assert.deepEqual(deleted.rows, [])

    await expectPgError(withTenant(backend.client, TENANT_A, tx => tx.query(
      `UPDATE public.mesa_items SET owner_id = $2 WHERE id = $1`,
      [foreign.id, OWNER_A],
    ), { actorId: OWNER_A2, appRole: 'client_b2b' }), '42501', /row-level security/u)
  })

  it('lets admin write across owners inside the tenant, never across tenants', async () => {
    const item = await insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A2,
      businessKey: key('owner-admin'),
    })

    const updated = await withTenant(backend.client, TENANT_A, tx => tx.query<{ id: string }>(
      `UPDATE public.mesa_items SET state = 'APROBADO' WHERE id = $1 RETURNING id`,
      [item.id],
    ), { actorId: ADMIN_A, appRole: 'admin' })
    assert.deepEqual(updated.rows.map(row => row.id), [item.id])

    const inserted = await insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A2,
      businessKey: key('owner-admin-insert'),
    }, { actorId: ADMIN_A, appRole: 'admin' })
    assert.equal(inserted.owner_id, OWNER_A2)

    const deleted = await withTenant(backend.client, TENANT_A, tx => tx.query<{ id: string }>(
      'DELETE FROM public.mesa_items WHERE id = $1 RETURNING id',
      [item.id],
    ), { actorId: ADMIN_A, appRole: 'admin' })
    assert.deepEqual(deleted.rows.map(row => row.id), [item.id])

    await expectPgError(withTenant(backend.client, TENANT_A, tx => tx.query(
      `INSERT INTO public.mesa_items (tenant_id, owner_id, business_key, state, payload)
       VALUES ($1, $2, $3, 'PENDIENTE_CRITERIO', '{}'::jsonb)`,
      [TENANT_B, OWNER_A2, key('owner-admin-cross')],
    ), { actorId: ADMIN_A, appRole: 'admin' }), '42501', /row-level security/u)
  })

  it('fails closed when the actor is missing or the role is unknown', async () => {
    await expectPgError(withTenant(backend.client, TENANT_A, tx => tx.query(
      `INSERT INTO public.mesa_items (tenant_id, owner_id, business_key, state, payload)
       VALUES ($1, $2, $3, 'PENDIENTE_CRITERIO', '{}'::jsonb)`,
      [TENANT_A, OWNER_A, key('owner-no-actor')],
    ), { appRole: 'client_b2b' }), '42501', /row-level security/u)

    await expectPgError(insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A2,
      businessKey: key('owner-unknown-role'),
    }, { actorId: OWNER_A, appRole: 'superuser' }), '42501', /row-level security/u)
  })
})

describe('mesa_items live business-key uniqueness', () => {
  it('rejects a second live row with the same tenant and key', async () => {
    const businessKey = key('unique-live')
    await insertItem(backend.client, TENANT_A, { ownerId: OWNER_A, businessKey })

    await expectPgError(insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A,
      businessKey,
    }), '23505', /mesa_items_live_business_key_uniq/u)
  })

  it('allows a new live row once the previous one is terminal', async () => {
    const businessKey = key('unique-terminal')
    const first = await insertItem(backend.client, TENANT_A, { ownerId: OWNER_A, businessKey })

    await withTenant(backend.client, TENANT_A, tx => tx.query(
      `UPDATE public.mesa_items SET state = 'APROBADO' WHERE id = $1`,
      [first.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' })

    const second = await insertItem(backend.client, TENANT_A, { ownerId: OWNER_A, businessKey })
    assert.notEqual(second.id, first.id)
  })

  it('scopes uniqueness per tenant and exempts terminal rows', async () => {
    const businessKey = key('unique-tenant-scope')
    await insertItem(backend.client, TENANT_A, { ownerId: OWNER_A, businessKey })
    const otherTenant = await insertItem(backend.client, TENANT_B, { ownerId: OWNER_B, businessKey })
    assert.ok(otherTenant.id)

    const terminalKey = key('unique-terminal-twice')
    await insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A,
      businessKey: terminalKey,
      state: 'DESCARTADO',
    })
    const secondTerminal = await insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A,
      businessKey: terminalKey,
      state: 'SUSTITUIDO',
    })
    assert.ok(secondTerminal.id)
  })
})
