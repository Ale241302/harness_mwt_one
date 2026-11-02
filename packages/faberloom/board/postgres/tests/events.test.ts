import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { withTenant } from '../src/tenant.ts'
import {
  OWNER_A,
  OWNER_B,
  TENANT_A,
  TENANT_B,
  asInt,
  createBackend,
  expectPgError,
  insertEvent,
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

describe('mesa_events append-only audit trail', () => {
  it('inserts and reads events of the same tenant in sequence order', async () => {
    const item = await insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A,
      businessKey: key('events-read'),
    })

    await insertEvent(backend.client, TENANT_A, {
      itemId: item.id,
      seq: 1,
      actor: OWNER_A,
      command: 'submit',
      toState: 'PENDIENTE_CRITERIO',
      payload: { source: 'test' },
    })
    await insertEvent(backend.client, TENANT_A, {
      itemId: item.id,
      seq: 2,
      actor: OWNER_A,
      command: 'approve',
      fromState: 'PENDIENTE_CRITERIO',
      toState: 'APROBADO',
    })

    const events = await withTenant(backend.client, TENANT_A, tx => tx.query<{
      seq: string | number
      from_state: string | null
      to_state: string
      payload: Record<string, unknown>
    }>(
      `SELECT seq, from_state, to_state, payload
         FROM public.mesa_events
        WHERE tenant_id = $1 AND item_id = $2
        ORDER BY seq`,
      [TENANT_A, item.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' })

    assert.deepEqual(events.rows.map(row => asInt(row.seq)), [1, 2])
    assert.equal(events.rows[0]?.from_state, null)
    assert.equal(events.rows[0]?.to_state, 'PENDIENTE_CRITERIO')
    assert.deepEqual(events.rows[0]?.payload, { source: 'test' })
  })

  it('hides another tenant events and refuses a cross-tenant insert', async () => {
    const itemA = await insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A,
      businessKey: key('events-a'),
    })
    const itemB = await insertItem(backend.client, TENANT_B, {
      ownerId: OWNER_B,
      businessKey: key('events-b'),
    })
    await insertEvent(backend.client, TENANT_B, {
      itemId: itemB.id,
      seq: 1,
      actor: OWNER_B,
      command: 'submit',
      toState: 'PENDIENTE_CRITERIO',
    })

    const visibleToA = await withTenant(backend.client, TENANT_A, tx => tx.query<{ item_id: string }>(
      'SELECT item_id FROM public.mesa_events WHERE item_id = $1',
      [itemB.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' })
    assert.deepEqual(visibleToA.rows, [])

    await expectPgError(withTenant(backend.client, TENANT_A, tx => tx.query(
      `INSERT INTO public.mesa_events (tenant_id, item_id, seq, actor, command, to_state)
       VALUES ($1, $2, 2, $3, 'submit', 'PENDIENTE_CRITERIO')`,
      [TENANT_B, itemB.id, OWNER_A],
    ), { actorId: OWNER_A, appRole: 'client_b2b' }), '42501', /row-level security/u)

    // Same app tenant, foreign item: the composite foreign key refuses it.
    await expectPgError(insertEvent(backend.client, TENANT_A, {
      itemId: itemB.id,
      seq: 1,
      actor: OWNER_A,
      command: 'submit',
      toState: 'PENDIENTE_CRITERIO',
    }), '23503', /mesa_events_item_fk|foreign key/u)

    assert.ok(itemA.id)
  })

  it('does not grant UPDATE or DELETE on events', async () => {
    const item = await insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A,
      businessKey: key('events-immutable'),
    })
    await insertEvent(backend.client, TENANT_A, {
      itemId: item.id,
      seq: 1,
      actor: OWNER_A,
      command: 'submit',
      toState: 'PENDIENTE_CRITERIO',
    })

    await expectPgError(withTenant(backend.client, TENANT_A, tx => tx.query(
      `UPDATE public.mesa_events SET command = 'tampered' WHERE item_id = $1`,
      [item.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' }), '42501', /permission denied/u)

    await expectPgError(withTenant(backend.client, TENANT_A, tx => tx.query(
      'DELETE FROM public.mesa_events WHERE item_id = $1',
      [item.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' }), '42501', /permission denied/u)
  })

  it('rejects a replayed sequence number for the same item', async () => {
    const item = await insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A,
      businessKey: key('events-replay'),
    })
    const event = {
      itemId: item.id,
      seq: 7,
      actor: OWNER_A,
      command: 'submit',
      toState: 'PENDIENTE_CRITERIO',
    }
    await insertEvent(backend.client, TENANT_A, event)

    await expectPgError(insertEvent(backend.client, TENANT_A, event), '23505', /mesa_events_pkey/u)
  })

  it('keeps an item with events undeletable (ON DELETE RESTRICT)', async () => {
    const item = await insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A,
      businessKey: key('events-restrict'),
    })
    await insertEvent(backend.client, TENANT_A, {
      itemId: item.id,
      seq: 1,
      actor: OWNER_A,
      command: 'submit',
      toState: 'PENDIENTE_CRITERIO',
    })

    await expectPgError(withTenant(backend.client, TENANT_A, tx => tx.query(
      'DELETE FROM public.mesa_items WHERE id = $1',
      [item.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' }), '23001', /mesa_events_item_fk|foreign key/u)
  })

  it('rejects blank actor, blank from_state, and seq below 1', async () => {
    const item = await insertItem(backend.client, TENANT_A, {
      ownerId: OWNER_A,
      businessKey: key('events-checks'),
    })

    await expectPgError(withTenant(backend.client, TENANT_A, tx => tx.query(
      `INSERT INTO public.mesa_events (tenant_id, item_id, seq, actor, command, to_state)
       VALUES ($1, $2, 1, ' ', 'submit', 'PENDIENTE_CRITERIO')`,
      [TENANT_A, item.id],
    ), { actorId: OWNER_A, appRole: 'client_b2b' }), '23514', /actor/u)

    await expectPgError(withTenant(backend.client, TENANT_A, tx => tx.query(
      `INSERT INTO public.mesa_events (tenant_id, item_id, seq, actor, command, from_state, to_state)
       VALUES ($1, $2, 2, $3, 'submit', ' ', 'PENDIENTE_CRITERIO')`,
      [TENANT_A, item.id, OWNER_A],
    ), { actorId: OWNER_A, appRole: 'client_b2b' }), '23514', /from_state/u)

    await expectPgError(withTenant(backend.client, TENANT_A, tx => tx.query(
      `INSERT INTO public.mesa_events (tenant_id, item_id, seq, actor, command, to_state)
       VALUES ($1, $2, 0, $3, 'submit', 'PENDIENTE_CRITERIO')`,
      [TENANT_A, item.id, OWNER_A],
    ), { actorId: OWNER_A, appRole: 'client_b2b' }), '23514', /seq/u)
  })
})
