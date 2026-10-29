import { describe, expect, it } from 'vitest'
import { MemoryMediaPool } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { businessKeyOf, sourceRefOf } from '../src/keys.ts'
import {
  ACTOR_A,
  ACTOR_A2,
  ACTOR_B,
  COMPANY_A,
  OWNER_A2,
  bootBoard,
  rawBoardItem,
  seedRawItem,
  seedSpace,
} from './helpers/harness.ts'

describe('business identity (§2.1)', () => {
  it('binds tenant, space, account, source, and artifact type with reserved nulls', () => {
    const base = {
      companyId: 'co-1', spaceId: 'sp-1', accountRef: 'Eguisa', sourceRef: 'OC-1', artifactType: 'proforma',
    }
    expect(businessKeyOf(base)).toMatch(/^[0-9a-f]{64}$/u)
    expect(businessKeyOf(base)).toBe(businessKeyOf({ ...base }))
    for (const field of ['companyId', 'spaceId', 'accountRef', 'sourceRef', 'artifactType'] as const) {
      expect(businessKeyOf({ ...base, [field]: field === 'sourceRef' ? 'OC-2' : 'otro' }))
        .not.toBe(businessKeyOf(base))
    }
    // Two nulls in one slot are equal, and never equal to a real value.
    expect(businessKeyOf({ ...base, spaceId: null })).toBe(businessKeyOf({ ...base, spaceId: null }))
    // A single-tenant deployment binds a reserved tenant value, not an empty one.
    expect(businessKeyOf({ ...base, companyId: null })).toMatch(/^[0-9a-f]{64}$/u)
    expect(() => businessKeyOf({ ...base, sourceRef: '  ' })).toThrow('SOURCE_REQUIRED')
    expect(sourceRefOf({ sourceRef: null, businessKey: null, evidence: [] })).toBe('')
    expect(sourceRefOf({ sourceRef: '  ', businessKey: 'OC-7', evidence: ['oc:1'] })).toBe('OC-7')
    expect(sourceRefOf({ sourceRef: null, businessKey: null, evidence: ['oc:9'] })).toBe('oc:9')
    expect(sourceRefOf({
      sourceRef: null,
      businessKey: null,
      revisions: [{ evidence: ['oc:rev'] }],
    })).toBe('oc:rev')
  })

  it('derives the key on submit and ignores a producer-supplied key as identity', async () => {
    const harness = await bootBoard()
    const first = await harness.board.submit(ACTOR_A, {
      runId: 'run-1', idempotencyKey: 'idem-1', sourceRef: 'OC-100', summary: 's', evidence: ['oc:100'],
      artifactType: 'proforma', accountRef: 'Eguisa', businessKey: 'lo-que-diga-el-productor',
    })
    expect(first.sourceRef).toBe('OC-100')
    expect(first.businessKey).toBe(businessKeyOf({
      companyId: COMPANY_A, spaceId: null, accountRef: 'Eguisa', sourceRef: 'OC-100', artifactType: 'proforma',
    }))
    // The same source is the same identity: the new artifact supersedes it.
    const again = await harness.board.submit(ACTOR_A, {
      runId: 'run-2', idempotencyKey: 'idem-2', sourceRef: 'OC-100', summary: 's', evidence: ['oc:100'],
      artifactType: 'proforma', accountRef: 'Eguisa', businessKey: 'otro-nombre',
    })
    expect(again.supersedesItemId).toBe(first.id)
    // A different account is a different identity.
    const other = await harness.board.submit(ACTOR_A, {
      runId: 'run-3', idempotencyKey: 'idem-3', sourceRef: 'OC-100', summary: 's', evidence: ['oc:100'],
      artifactType: 'proforma', accountRef: 'Otra',
    })
    expect(other.id).not.toBe(first.id)
  })

  it('recomputes the key when a space is assigned', async () => {
    const harness = await bootBoard()
    const item = await harness.board.submit(ACTOR_A, {
      runId: 'run-1', idempotencyKey: 'idem-1', sourceRef: 'OC-200', summary: 's', evidence: ['oc:200'],
      artifactType: 'proforma', accountRef: 'Eguisa',
    })
    const space = await seedSpace(harness, ACTOR_A, 'Eguisa', ['Eguisa'])
    const assigned = await harness.board.assignWorkspace(ACTOR_A, item.id, space)
    expect(assigned.item.businessKey).toBe(businessKeyOf({
      companyId: COMPANY_A, spaceId: space, accountRef: 'Eguisa', sourceRef: 'OC-200', artifactType: 'proforma',
    }))
    expect(assigned.item.businessKey).not.toBe(item.businessKey)
  })
})

describe('space ACL on reads (W-23)', () => {
  /** Add ACTOR_A2 as a member of one Space. */
  async function withMember(harness: Awaited<ReturnType<typeof bootBoard>>, space: string) {
    await harness.spaces.update(
      { id: ACTOR_A.id, companyId: COMPANY_A, role: 'client_b2b', readOnly: false },
      space as never,
      { members: [ACTOR_A2.id] },
    )
  }

  it('lets a member of the space read and list its items', async () => {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Eguisa')
    await withMember(harness, space)
    const item = await harness.board.create(ACTOR_A, {
      title: 'Compartida', summary: 's', evidence: ['oc:1'], artifactType: 'tarea', spaceId: space,
    })

    expect((await harness.board.get(ACTOR_A2, item.id)).id).toBe(item.id)
    expect((await harness.board.list(ACTOR_A2)).map(row => row.id)).toContain(item.id)
  })

  it('denies an identity with no scope, and keeps an unassigned item owner-only', async () => {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Eguisa')
    const shared = await harness.board.create(ACTOR_A, {
      title: 'Compartida', summary: 's', evidence: ['oc:1'], artifactType: 'tarea', spaceId: space,
    })
    const unassigned = await harness.board.create(ACTOR_A, {
      title: 'Sin espacio', summary: 's', evidence: ['oc:2'], artifactType: 'tarea',
    })
    const outsider = { id: OWNER_A2, companyId: COMPANY_A }

    await expect(harness.board.get(outsider, shared.id)).rejects.toThrow('NO_ACCESS')
    await expect(harness.board.get(outsider, unassigned.id)).rejects.toThrow('NO_ACCESS')
    expect(await harness.board.list(outsider)).toEqual([])
    // Another tenant is denied even when the space id is guessed.
    await expect(harness.board.get(ACTOR_B, shared.id)).rejects.toThrow('NO_ACCESS')
  })

  it('keeps writes owner-only for a space member', async () => {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Eguisa')
    await withMember(harness, space)
    const item = await harness.board.create(ACTOR_A, {
      title: 'Compartida', summary: 's', evidence: ['oc:1'], artifactType: 'tarea', spaceId: space,
    })
    await expect(harness.board.setSeverity(ACTOR_A2, item.id, 'LOW', 'HUMAN')).rejects.toThrow('NO_ACCESS')
    await expect(harness.board.assignWorkspace(ACTOR_A2, item.id, space)).rejects.toThrow('NO_ACCESS')
  })


})

describe('business-key migration (§2.1)', () => {
  it('reports a dry run, rewrites legacy keys, and keeps the dedup identity', async () => {
    const pool = new MemoryMediaPool()
    const legacy = await seedRawItem(pool, rawBoardItem({ businessKey: 'PF 9001-2026', sourceRef: null }), 'item-legacy')
    const harness = await bootBoard({ pool })

    const preview = await harness.board.rekeyAll(ACTOR_A, { dryRun: true })
    expect(preview).toMatchObject({ scanned: 1, rekeyed: 1, unchanged: 0 })
    expect((await harness.board.get(ACTOR_A, legacy)).businessKey).toBe('PF 9001-2026')

    const applied = await harness.board.rekeyAll(ACTOR_A)
    expect(applied).toMatchObject({ scanned: 1, rekeyed: 1, skipped: 0, collisions: 0 })
    const migrated = await harness.board.get(ACTOR_A, legacy)
    expect(migrated.sourceRef).toBe('PF 9001-2026')
    expect(migrated.businessKey).toBe(businessKeyOf({
      companyId: COMPANY_A, spaceId: null, accountRef: null, sourceRef: 'PF 9001-2026', artifactType: 'proforma',
    }))
    // Idempotent: a second pass rewrites nothing.
    expect(await harness.board.rekeyAll(ACTOR_A)).toMatchObject({ rekeyed: 0, unchanged: 1 })
    // The producer can now submit by source; the migrated row is the same
    // identity and the new artifact supersedes it.
    await expect(harness.board.submit(ACTOR_A, {
      runId: 'run-1', idempotencyKey: 'idem-1', sourceRef: 'PF 9001-2026', summary: 's',
      evidence: ['oc:1'], artifactType: 'proforma',
    })).resolves.toMatchObject({ supersedesItemId: legacy })
  })

  it('runs tenant-wide for any identity of the company and refuses another company', async () => {
    const pool = new MemoryMediaPool()
    const legacy = await seedRawItem(pool, rawBoardItem({ businessKey: 'legacy-key', sourceRef: null }), 'item-legacy')
    const harness = await bootBoard({ pool })
    // A same-company identity may migrate the tenant's rows, including another owner's.
    await expect(harness.board.rekeyAll(ACTOR_A2)).resolves.toMatchObject({ scanned: 1, rekeyed: 1 })
    expect((await harness.board.get(ACTOR_A, legacy)).businessKey).toMatch(/^[0-9a-f]{64}$/u)
    // Another company's row is reported, never migrated across the boundary.
    await expect(harness.board.rekeyAll(ACTOR_B)).resolves.toMatchObject({ skipped: 1, rekeyed: 0 })
  })

  it('skips a row with no source instead of collapsing it by its evidence', async () => {
    const pool = new MemoryMediaPool()
    const first = await seedRawItem(pool, rawBoardItem({ businessKey: null, sourceRef: null, title: 'A' }), 'item-a')
    const second = await seedRawItem(pool, rawBoardItem({ businessKey: null, sourceRef: null, title: 'B' }), 'item-b')
    const harness = await bootBoard({ pool })

    const report = await harness.board.rekeyAll(ACTOR_A)
    expect(report).toMatchObject({ scanned: 2, rekeyed: 0, skipped: 2, collisions: 0 })
    expect((await harness.board.get(ACTOR_A, first)).state).toBe('PENDIENTE_CRITERIO')
    expect((await harness.board.get(ACTOR_A, second)).state).toBe('PENDIENTE_CRITERIO')
  })

  it('restores the items a collision closed and counts the restoration', async () => {
    const pool = new MemoryMediaPool()
    const first = await seedRawItem(pool, rawBoardItem({ businessKey: 'viejo-1', sourceRef: 'OC-9', title: 'A' }), 'item-a')
    await seedRawItem(pool, rawBoardItem({ businessKey: 'viejo-2', sourceRef: 'OC-9', title: 'B' }), 'item-b')
    const harness = await bootBoard({ pool })
    expect(await harness.board.rekeyAll(ACTOR_A)).toMatchObject({ collisions: 1 })

    const restored = await harness.board.restoreRekeyCollisions(ACTOR_A)
    expect(restored).toEqual({ restored: 1 })
    expect((await harness.board.get(ACTOR_A, first)).state).toBe('PENDIENTE_CRITERIO')
    // Idempotent: a second pass finds nothing left to restore.
    expect(await harness.board.restoreRekeyCollisions(ACTOR_A)).toEqual({ restored: 0 })
  })

  it('resolves a canonical collision through §2.3 and leaves one live item', async () => {
    const pool = new MemoryMediaPool()
    const first = await seedRawItem(pool, rawBoardItem({
      businessKey: 'viejo-1', sourceRef: 'OC-9', title: 'A', updatedAt: '2026-10-01T00:00:00.000Z',
    }), 'item-a')
    const second = await seedRawItem(pool, rawBoardItem({
      businessKey: 'viejo-2', sourceRef: 'OC-9', title: 'B', updatedAt: '2026-10-02T00:00:00.000Z',
    }), 'item-b')
    const harness = await bootBoard({ pool })

    const report = await harness.board.rekeyAll(ACTOR_A)
    expect(report.collisions).toBe(1)
    const live = (await harness.board.list(ACTOR_A)).filter(item => item.state !== 'SUSTITUIDO')
    expect(live).toHaveLength(1)
    const states = [await harness.board.get(ACTOR_A, first), await harness.board.get(ACTOR_A, second)]
    expect(states.filter(item => item.state === 'SUSTITUIDO')).toHaveLength(1)
    expect(live[0]?.businessKey).toBe(businessKeyOf({
      companyId: COMPANY_A, spaceId: null, accountRef: null, sourceRef: 'OC-9', artifactType: 'proforma',
    }))
  })
})
