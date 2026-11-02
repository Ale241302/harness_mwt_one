import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { withTenant } from '../src/tenant.ts'
import {
  OWNER_A,
  OWNER_A2,
  TENANT_A,
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

describe('withTenant', () => {
  it('pins tenant, actor, and role for the transaction and returns fn result', async () => {
    const value = await withTenant(backend.client, TENANT_A, async (tx) => {
      const { rows } = await tx.query<{
        tenant: string | null
        actor: string | null
        role: string | null
        current_user: string
      }>(
        `SELECT current_setting('app.tenant_id', true) AS tenant,
                current_setting('app.actor_id', true) AS actor,
                current_setting('app.role', true) AS role,
                current_user`,
      )
      assert.deepEqual(rows[0], {
        tenant: TENANT_A,
        actor: OWNER_A,
        role: 'client_b2b',
        current_user: 'mesa_app',
      })
      return 'result'
    }, { actorId: OWNER_A, appRole: 'client_b2b' })

    assert.equal(value, 'result')
  })

  it('resets the role and tenant context when the transaction ends', async () => {
    await withTenant(backend.client, TENANT_A, async () => {}, { actorId: OWNER_A })

    const { rows } = await backend.query<{
      current_user: string
      tenant: string | null
    }>(
      `SELECT current_user, current_setting('app.tenant_id', true) AS tenant`,
    )
    assert.notEqual(rows[0]!.current_user, 'mesa_app')
    assert.notEqual(rows[0]!.tenant, TENANT_A)
  })

  it('rolls back the whole transaction when fn throws, preserving the error', async () => {
    const businessKey = key('tenant-rollback')

    await assert.rejects(
      withTenant(backend.client, TENANT_A, async (tx) => {
        await tx.query(
          `INSERT INTO public.mesa_items (tenant_id, owner_id, business_key, state, payload)
           VALUES ($1, $2, $3, 'PENDIENTE_CRITERIO', '{}'::jsonb)`,
          [TENANT_A, OWNER_A, businessKey],
        )
        throw new Error('boom')
      }, { actorId: OWNER_A, appRole: 'client_b2b' }),
      /boom/u,
    )

    const { rows } = await withTenant(backend.client, TENANT_A, tx => tx.query<{ id: string }>(
      `SELECT id FROM public.mesa_items WHERE tenant_id = $1 AND business_key = $2`,
      [TENANT_A, businessKey],
    ), { actorId: OWNER_A, appRole: 'client_b2b' })

    assert.deepEqual(rows, [])
  })

  it('rejects an invalid tenant id before opening a transaction', async () => {
    await assert.rejects(
      withTenant(backend.client, 'not-a-uuid', async () => {}),
      /tenantId must be a UUID/u,
    )
  })

  it('rejects an unsafe database role before interpolating it', async () => {
    await assert.rejects(
      withTenant(backend.client, TENANT_A, async () => {}, {
        dbRole: 'mesa_app; DROP TABLE public.mesa_items',
      }),
      /dbRole must be a plain SQL identifier/u,
    )
  })

  it('rejects an empty actor or app role', async () => {
    await assert.rejects(
      withTenant(backend.client, TENANT_A, async () => {}, { actorId: '   ' }),
      /actorId must not be empty/u,
    )
    await assert.rejects(
      withTenant(backend.client, TENANT_A, async () => {}, { appRole: '' }),
      /appRole must not be empty/u,
    )
  })

  it('refuses a reentrant call on the same client', async () => {
    await assert.rejects(
      withTenant(backend.client, TENANT_A, async () => {
        await withTenant(backend.client, TENANT_A, async () => {})
      }),
      /reentrant/u,
    )
  })

  it('can skip SET ROLE when the connection already uses the application role', async () => {
    const { rows } = await withTenant(backend.client, TENANT_A, tx => tx.query<{ current_user: string }>(
      'SELECT current_user',
    ), { dbRole: false })

    assert.notEqual(rows[0]!.current_user, 'mesa_app')
  })

  it('clears a stale session-level console role inside the transaction', async () => {
    await backend.query("SELECT set_config('app.role', 'admin', false)")

    try {
      await expectPgError(insertItem(backend.client, TENANT_A, {
        ownerId: OWNER_A2,
        businessKey: key('tenant-stale-role'),
      }, { actorId: OWNER_A, appRole: 'client_b2b' }), '42501', /row-level security/u)
    } finally {
      await backend.query("SELECT set_config('app.role', '', false)")
    }
  })
})
