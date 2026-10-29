import { describe, expect, it } from 'vitest'
import { MemoryMediaPool } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  ACTOR_A,
  ACTOR_A2,
  ACTOR_B,
  COMPANY_A,
  OWNER_A,
  bootBoard,
  durableRows,
  rawBoardItem,
  seedRawItem,
  seedRawIterationDraft,
  seedSpace,
} from './helpers/harness.ts'
import { businessKeyOf, type FaberLoomBoardItem } from '../src/index.ts'

/** One prepared artifact the candidate suites submit. */
const ARTIFACT = { summary: 'borrador', evidence: ['oc:505288'], artifactType: 'proforma' } as const

const TERMINAL_STATES = ['APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO']

/** Submit one prepared artifact under one business key. */
async function submitArtifact(
  board: Awaited<ReturnType<typeof bootBoard>>['board'],
  idempotencyKey: string,
  businessKey: string,
  accountRef = 'Eguisa',
): Promise<FaberLoomBoardItem> {
  return await board.submit(ACTOR_A, {
    runId: 'run-1',
    idempotencyKey,
    businessKey,
    ...ARTIFACT,
    accountRef,
  })
}

describe('FaberLoomBoard assignWorkspace (W-45, W-59, W-87, W-88)', () => {
  it('refuses a destination space outside the actor scope', async () => {
    const harness = await bootBoard()
    const foreign = await seedSpace(harness, ACTOR_B, 'Ajeno')
    const item = await submitArtifact(harness.board, 'idem-scope', 'k-scope')

    await expect(harness.board.assignWorkspace(ACTOR_A, item.id, foreign)).rejects.toThrow('NO_ACCESS')
    expect((await harness.board.get(ACTOR_A, item.id)).spaceId).toBeNull()
  })

  it('refuses an account the destination space does not serve', async () => {
    const harness = await bootBoard()
    const eguisa = await seedSpace(harness, ACTOR_A, 'Eguisa', ['Eguisa'])
    const item = await submitArtifact(harness.board, 'idem-acc', 'k-acc', 'Sonepar')

    await expect(harness.board.assignWorkspace(ACTOR_A, item.id, eguisa)).rejects.toThrow('ACCOUNT_MISMATCH')
    expect((await harness.board.get(ACTOR_A, item.id)).spaceId).toBeNull()
  })

  it('W-45 · keeps the business key, supersedes a substitutable peer, and returns the live item', async () => {
    const pool = new MemoryMediaPool()
    const harness = await bootBoard({ pool })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    // The peer was migrated before this assignment: it already carries the
    // canonical key of the destination space.
    const key = businessKeyOf({
      companyId: COMPANY_A, spaceId: space, accountRef: null, sourceRef: 'k-shared', artifactType: 'proforma',
    })
    const first = await seedRawItem(pool, rawBoardItem({ businessKey: key, sourceRef: 'k-shared', title: 'A' }))
    const second = await seedRawItem(pool, rawBoardItem({ businessKey: key, sourceRef: 'k-shared', title: 'B' }))

    const assigned = await harness.board.assignWorkspace(ACTOR_A, first, space)

    expect(assigned.transferredDrafts).toEqual([])
    expect(assigned.item.id).toBe(first)
    expect(assigned.item.spaceId).toBe(space)
    expect(assigned.item.businessKey).toBe(key)
    expect(assigned.item.supersedesItemId).toBe(String(second))
    expect((await harness.board.get(ACTOR_A, second)).state).toBe('SUSTITUIDO')
  })

  it('W-87 · transfers the artifact as a candidate to a non-substitutable peer and opens that peer', async () => {
    const pool = new MemoryMediaPool()
    const harness = await bootBoard({ pool })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const key = businessKeyOf({
      companyId: COMPANY_A, spaceId: space, accountRef: null, sourceRef: 'k-iter', artifactType: 'proforma',
    })
    const source = await seedRawItem(pool, rawBoardItem({ businessKey: key, sourceRef: 'k-iter', title: 'A' }))
    const iterating = await seedRawItem(pool, rawBoardItem({ businessKey: key, sourceRef: 'k-iter', title: 'B', state: 'ITERANDO' }))

    const live = await harness.board.assignWorkspace(ACTOR_A, source, space)

    expect(live.item.id).toBe(iterating)
    expect(live.item.state).toBe('ITERANDO')
    expect(live.item.pendingCandidate).toMatchObject({ summary: 'borrador', evidence: ['oc:505288'] })
    expect(live.transferredDrafts).toEqual([])
    const closed = await harness.board.get(ACTOR_A, source)
    expect(closed.state).toBe('SUSTITUIDO')
    expect(closed.events.at(-1)).toMatchObject({ command: 'superseded', reason: 'transferred-as-candidate' })
  })

  it('W-88 · leaves one non-terminal item and one key claim when two assignments race', async () => {
    const pool = new MemoryMediaPool()
    const harness = await bootBoard({ pool })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const key = businessKeyOf({
      companyId: COMPANY_A, spaceId: space, accountRef: null, sourceRef: 'k-race-ws', artifactType: 'proforma',
    })
    const left = await seedRawItem(pool, rawBoardItem({ businessKey: key, sourceRef: 'k-race-ws', title: 'A' }))
    const right = await seedRawItem(pool, rawBoardItem({ businessKey: key, sourceRef: 'k-race-ws', title: 'B' }))

    await Promise.allSettled([
      harness.board.assignWorkspace(ACTOR_A, left, space),
      harness.board.assignWorkspace(ACTOR_A, right, space),
    ])

    const all = await harness.board.list(ACTOR_A)
    const live = all.filter(item => !TERMINAL_STATES.includes(item.state))
    expect(live).toHaveLength(1)
    const claims = [...durableRows(pool, 'keys').entries()].filter(([rowKey]) => rowKey.endsWith(`:bkey:${key}`))
    expect(claims).toHaveLength(1)
    expect(claims[0]?.[1]).toMatchObject({ itemId: String(live[0]?.id) })
    expect(live[0]?.spaceId).toBe(space)
  })

  it('refuses to assign a closed item', async () => {
    const pool = new MemoryMediaPool()
    const closed = await seedRawItem(pool, rawBoardItem({ businessKey: 'k-closed', state: 'DESCARTADO' }))
    const harness = await bootBoard({ pool })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')

    await expect(harness.board.assignWorkspace(ACTOR_A, closed, space)).rejects.toThrow('NO_ACCESS')
  })

  it('W-59 · refuses an assignment from another owner or another tenant', async () => {
    const harness = await bootBoard()
    const item = await submitArtifact(harness.board, 'idem-own', 'k-own')
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')

    await expect(harness.board.assignWorkspace(ACTOR_A2, item.id, space)).rejects.toThrow('NO_ACCESS')
    await expect(harness.board.assignWorkspace(ACTOR_B, item.id, space)).rejects.toThrow('NO_ACCESS')
    expect((await harness.board.get(ACTOR_A, item.id)).spaceId).toBeNull()
  })
})

describe('FaberLoomBoard assignment draft transfer (W-98)', () => {
  /** One retained iteration draft row of a fixture item. */
  function iterationDraftRow(itemId: string, iterationId: string) {
    return {
      itemId,
      iterationId,
      baseVersion: 1,
      summary: 'casi lista',
      evidence: ['oc:1'],
      content: { total: 9 },
      archived: false,
      superseded: false,
      outdated: false,
      updatedAt: '2026-10-01T00:00:00.000Z',
      retainUntil: '2099-01-01T00:00:00.000Z',
      transferredFrom: null,
    }
  }

  it('transfers the iteration and edit drafts to the peer that received the candidate', async () => {
    const pool = new MemoryMediaPool()
    const harness = await bootBoard({ pool })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const key = businessKeyOf({
      companyId: COMPANY_A, spaceId: space, accountRef: null, sourceRef: 'k-drafts', artifactType: 'proforma',
    })
    const source = await seedRawItem(pool, rawBoardItem({
      businessKey: key, sourceRef: 'k-drafts', title: 'A',
      iterationDraftKey: 'item-source:att-a', iterationBaseVersion: 1,
    }), 'item-source')
    await seedRawIterationDraft(pool, iterationDraftRow('item-source', 'att-a'))
    const iterating = await seedRawItem(pool, rawBoardItem({
      businessKey: key,
      sourceRef: 'k-drafts',
      title: 'B',
      state: 'ITERANDO',
      iterationId: 'att-b',
      iterationBaseVersion: 1,
      iterationLockGeneration: 1,
      iterationLockUntil: '2099-01-01T00:00:00.000Z',
      iterationLockBy: 'tab-b',
    }), 'item-iterating')
    await harness.board.saveEditDraft(ACTOR_A, source, {
      baseVersion: 1, revision: 0, writerSession: 'tab-a', changes: { total: '9' },
    })

    const assigned = await harness.board.assignWorkspace(ACTOR_A, source, space)

    expect(assigned.item.id).toBe(iterating)
    expect(assigned.transferredDrafts.map(draft => draft.kind)).toEqual(['iteration', 'edit'])
    expect(assigned.transferredDrafts.every(draft => draft.transferredFrom === source)).toBe(true)
    expect(assigned.transferredDrafts.every(draft => draft.baseVersion === 1)).toBe(true)

    const listed = await harness.board.transferredDrafts(ACTOR_A, iterating)
    expect(listed.map(draft => draft.kind)).toEqual(['iteration', 'edit'])
    expect(await harness.board.getIterationDraft(ACTOR_A, iterating, 'att-a')).toMatchObject({
      content: { total: 9 }, baseVersion: 1, transferredFrom: source,
    })
    expect(await harness.board.getEditDraft(ACTOR_A, iterating)).toMatchObject({
      changes: { total: '9' }, baseVersion: 1, transferredFrom: source,
    })

    expect(await harness.board.getIterationDraft(ACTOR_A, source, 'att-a')).toBeUndefined()
    expect(await harness.board.getEditDraft(ACTOR_A, source)).toBeUndefined()
    expect(await harness.board.transferredDrafts(ACTOR_A, source)).toEqual([])
    expect(durableRows(pool, 'iteration_drafts').has('item-source:att-a')).toBe(false)
    expect(durableRows(pool, 'drafts').has(`item-source:${OWNER_A}`)).toBe(false)
  })

  it('transfers the closed substitutable peer’s drafts to the assigned item', async () => {
    const pool = new MemoryMediaPool()
    const harness = await bootBoard({ pool })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const key = businessKeyOf({
      companyId: COMPANY_A, spaceId: space, accountRef: null, sourceRef: 'k-sub', artifactType: 'proforma',
    })
    const live = await seedRawItem(pool, rawBoardItem({ businessKey: key, sourceRef: 'k-sub', title: 'A' }), 'item-live')
    const peer = await seedRawItem(pool, rawBoardItem({
      businessKey: key, sourceRef: 'k-sub', title: 'B',
      iterationDraftKey: 'item-peer:att-p', iterationBaseVersion: 1,
    }), 'item-peer')
    await seedRawIterationDraft(pool, iterationDraftRow('item-peer', 'att-p'))
    await harness.board.saveEditDraft(ACTOR_A, peer, {
      baseVersion: 1, revision: 0, writerSession: 'tab-b', changes: { total: '3' },
    })

    const assigned = await harness.board.assignWorkspace(ACTOR_A, live, space)

    expect(assigned.item.id).toBe(live)
    expect(assigned.transferredDrafts.map(draft => draft.kind)).toEqual(['iteration', 'edit'])
    expect(await harness.board.getIterationDraft(ACTOR_A, live, 'att-p'))
      .toMatchObject({ baseVersion: 1, transferredFrom: peer })
    expect(await harness.board.getEditDraft(ACTOR_A, live)).toMatchObject({ transferredFrom: peer })
    expect(await harness.board.getEditDraft(ACTOR_A, peer)).toBeUndefined()
    expect(await harness.board.transferredDrafts(ACTOR_A, peer)).toEqual([])
    expect((await harness.board.get(ACTOR_A, peer)).state).toBe('SUSTITUIDO')
  })

  it('transfers nothing when the closed item had no drafts', async () => {
    const pool = new MemoryMediaPool()
    const source = await seedRawItem(pool, rawBoardItem({ businessKey: 'k-empty', title: 'A' }), 'item-empty')
    await seedRawItem(pool, rawBoardItem({ businessKey: 'k-empty', title: 'B', state: 'ITERANDO' }), 'item-peer')
    const harness = await bootBoard({ pool })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')

    const assigned = await harness.board.assignWorkspace(ACTOR_A, source, space)

    expect(assigned.transferredDrafts).toEqual([])
    expect(await harness.board.transferredDrafts(ACTOR_A, assigned.item.id)).toEqual([])
  })

  it('leaves a draft the source cannot attribute on the closed item', async () => {
    const pool = new MemoryMediaPool()
    const harness = await bootBoard({ pool })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const key = businessKeyOf({
      companyId: COMPANY_A, spaceId: space, accountRef: null, sourceRef: 'k-orphan', artifactType: 'proforma',
    })
    const source = await seedRawItem(pool, rawBoardItem({
      businessKey: key, sourceRef: 'k-orphan', title: 'A',
      iterationDraftKey: 'item-source:att-x', iterationBaseVersion: 1,
    }), 'item-source')
    await seedRawIterationDraft(pool, iterationDraftRow('item-elsewhere', 'att-x'))
    const peer = await seedRawItem(pool, rawBoardItem({ businessKey: key, sourceRef: 'k-orphan', title: 'B', state: 'ITERANDO' }), 'item-peer')

    const assigned = await harness.board.assignWorkspace(ACTOR_A, source, space)

    expect(assigned.item.id).toBe(peer)
    expect(assigned.transferredDrafts).toEqual([])
    expect(await harness.board.transferredDrafts(ACTOR_A, peer)).toEqual([])
    expect(durableRows(pool, 'iteration_drafts').has('item-elsewhere:att-x')).toBe(true)
  })
})

describe('FaberLoomBoard transferred draft recovery (W-68, W-98)', () => {
  /**
   * One pending item that received the iteration draft of the peer a collision
   * closed. The draft is written on version 1; the item carries `liveVersion`,
   * so a higher value proves the outdated branch.
   */
  async function received(options: {
    liveVersion?: number
    retainUntil?: string
    foreignDrafts?: readonly { readonly itemId: string; readonly iterationId: string; readonly transferredFrom: string | null }[]
  } = {}) {
    const pool = new MemoryMediaPool()
    const harness = await bootBoard({ pool })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const key = businessKeyOf({
      companyId: COMPANY_A, spaceId: space, accountRef: null, sourceRef: 'k-recover', artifactType: 'proforma',
    })
    const live = await seedRawItem(pool, rawBoardItem({
      businessKey: key, sourceRef: 'k-recover', title: 'Vigente', version: options.liveVersion ?? 1,
    }), 'item-live')
    await seedRawItem(pool, rawBoardItem({
      businessKey: key, sourceRef: 'k-recover', title: 'Cerrado',
      iterationDraftKey: 'item-peer:att-p', iterationBaseVersion: 1,
    }), 'item-peer')
    await seedRawIterationDraft(pool, {
      itemId: 'item-peer',
      iterationId: 'att-p',
      baseVersion: 1,
      summary: 'casi lista',
      evidence: ['oc:1'],
      content: { total: 9 },
      archived: false,
      superseded: false,
      outdated: false,
      updatedAt: '2026-10-01T00:00:00.000Z',
      retainUntil: options.retainUntil ?? '2099-01-01T00:00:00.000Z',
      transferredFrom: null,
    })
    for (const draft of options.foreignDrafts ?? []) {
      await seedRawIterationDraft(pool, {
        itemId: draft.itemId,
        iterationId: draft.iterationId,
        baseVersion: 1,
        summary: 'otro',
        evidence: ['oc:2'],
        content: { total: 1 },
        archived: false,
        superseded: false,
        outdated: false,
        updatedAt: '2026-10-01T00:00:00.000Z',
        retainUntil: '2099-01-01T00:00:00.000Z',
        transferredFrom: draft.transferredFrom,
      })
    }
    await harness.board.assignWorkspace(ACTOR_A, live, space)
    const listed = await harness.board.transferredDrafts(ACTOR_A, live)
    return { harness, live, listed }
  }
  it('W-98 · recovers a transferred draft as the live draft without applying it', async () => {
    const { harness, live, listed } = await received()
    const entry = listed.find(draft => draft.kind === 'iteration')
    expect(entry).toMatchObject({ iterationId: 'att-p', baseVersion: 1, transferredFrom: 'item-peer' })
    const before = await harness.board.get(ACTOR_A, live)

    const recovered = await harness.board.recoverTransferredDraft(ACTOR_A, live, {
      draftKey: entry?.key ?? '', actorSession: 'tab-r',
    })

    expect(recovered.status).toBe('started')
    // The attempt starts and links the work; the artifact only moves on apply.
    expect(recovered.item).toMatchObject({
      state: 'ITERANDO', version: 1, iterationBaseVersion: 1, iterationLockBy: 'tab-r', iterationRoundCount: 0,
    })
    expect(recovered.item.iterationDraftKey).not.toBe(entry?.key)
    expect(recovered.item.artifactHash).toBe(before.artifactHash)
    expect(recovered.item.revisions).toHaveLength(before.revisions.length)
    expect(recovered.item.events.at(-1)).toMatchObject({
      command: 'iteration.recovered',
      data: { transferredFrom: 'item-peer', transferredKey: entry?.key, session: 'tab-r' },
    })
    // The recovered row is the attempt's draft, not transferred work any more.
    expect(await harness.board.transferredDrafts(ACTOR_A, live)).toEqual([])
    expect(await harness.board.getIterationDraft(ACTOR_A, live)).toMatchObject({
      content: { total: 9 }, transferredFrom: null, baseVersion: 1,
    })

    const applied = await harness.board.applyIteration(ACTOR_A, live, {
      iterationId: recovered.item.iterationId ?? '',
      generation: recovered.item.iterationLockGeneration,
      actorSession: 'tab-r',
      baseVersion: 1,
      scope: 'puntual',
    })
    expect(applied.item).toMatchObject({ version: 2, content: { total: 9 }, iterationRoundCount: 1 })
  })

  it('refuses a key that is not transferred to this item', async () => {
    const { harness, live } = await received({
      foreignDrafts: [
        { itemId: 'item-other', iterationId: 'att-x', transferredFrom: 'item-peer' },
        { itemId: 'item-live', iterationId: 'att-local', transferredFrom: null },
      ],
    })

    await expect(harness.board.recoverTransferredDraft(ACTOR_A, live, {
      draftKey: 'item-other:att-x', actorSession: 'tab-r',
    })).rejects.toThrow('NO_DRAFT')
    await expect(harness.board.recoverTransferredDraft(ACTOR_A, live, {
      draftKey: 'item-live:att-local', actorSession: 'tab-r',
    })).rejects.toThrow('NO_DRAFT')
    expect(await harness.board.get(ACTOR_A, live)).toMatchObject({ state: 'PENDIENTE_CRITERIO', version: 1 })
  })

  it('refuses a transferred draft past its retention window', async () => {
    const { harness, live } = await received({ retainUntil: '2026-01-31T00:00:00.000Z' })

    await expect(harness.board.recoverTransferredDraft(ACTOR_A, live, {
      draftKey: 'item-live:att-p', actorSession: 'tab-r',
    })).rejects.toThrow('DRAFT_EXPIRED')
    expect(await harness.board.get(ACTOR_A, live)).toMatchObject({ state: 'PENDIENTE_CRITERIO', version: 1 })
  })

  it('W-68 · marks an outdated transferred draft and returns its differences without writing the item', async () => {
    const { harness, live, listed } = await received({ liveVersion: 2 })
    const entry = listed.find(draft => draft.kind === 'iteration')
    const before = await harness.board.get(ACTOR_A, live)

    const recovered = await harness.board.recoverTransferredDraft(ACTOR_A, live, {
      draftKey: entry?.key ?? '', actorSession: 'tab-r',
    })

    expect(recovered.status).toBe('outdated')
    if (recovered.status !== 'outdated') return
    expect(recovered.differences).toEqual([
      { field: 'summary', draftValue: undefined, currentValue: 'borrador' },
      { field: 'total', draftValue: 9, currentValue: undefined },
    ])
    expect(await harness.board.get(ACTOR_A, live)).toMatchObject({
      state: before.state, version: before.version, rowVersion: before.rowVersion, iterationDraftKey: before.iterationDraftKey,
    })
    expect((await harness.board.getIterationDraft(ACTOR_A, live, 'att-p'))?.outdated).toBe(true)
    expect(await harness.board.transferredDrafts(ACTOR_A, live)).toHaveLength(1)
  })
})

describe('FaberLoomBoard DESCONOCIDO and candidates (W-22, W-42, W-66, W-76)', () => {
  it('W-55 · stores a new artifact for an unknown result as a candidate instead of a new item', async () => {
    const harness = await bootBoard()
    const item = await submitArtifact(harness.board, 'idem-unknown', 'k-unknown')
    const unknown = await harness.board.fail(ACTOR_A, item.id, 'DESCONOCIDO')
    expect(unknown).toMatchObject({ state: 'DESCONOCIDO', column: 'ERROR_ACCIONABLE' })

    const candidate = await harness.board.submit(ACTOR_A, {
      runId: 'run-1', idempotencyKey: 'idem-unknown-2', businessKey: 'k-unknown', ...ARTIFACT, accountRef: 'Eguisa',
    })

    expect(candidate.id).toBe(item.id)
    expect(candidate.state).toBe('DESCONOCIDO')
    expect(candidate.pendingCandidate).not.toBeNull()
    expect(await harness.board.list(ACTOR_A)).toHaveLength(1)
  })

  it('W-76 · refuses discard of an unknown result and leaves it in DESCONOCIDO', async () => {
    const harness = await bootBoard()
    const item = await submitArtifact(harness.board, 'idem-u2', 'k-u2')
    const unknown = await harness.board.fail(ACTOR_A, item.id, 'DESCONOCIDO')

    await expect(harness.board.discard(ACTOR_A, item.id, {
      expectedRowVersion: unknown.rowVersion, reason: 'DUPLICADO',
    })).rejects.toThrow('NO_ACCESS')
    await expect(harness.board.submitRevision(ACTOR_A, item.id, {
      summary: 'corregido', evidence: ['oc:2'],
    })).rejects.toThrow('NO_ACCESS')
    expect((await harness.board.get(ACTOR_A, item.id)).state).toBe('DESCONOCIDO')
  })

  it('W-42 · refuses approval and discard while a candidate is pending', async () => {
    const harness = await bootBoard()
    const item = await submitArtifact(harness.board, 'idem-pend', 'k-pend')
    await harness.board.fail(ACTOR_A, item.id, 'DESCONOCIDO')
    await harness.board.submit(ACTOR_A, {
      runId: 'run-1', idempotencyKey: 'idem-pend-2', businessKey: 'k-pend', ...ARTIFACT, accountRef: 'Eguisa',
    })
    const waiting = await harness.board.reopen(ACTOR_A, item.id)
    const withSeverity = await harness.board.setSeverity(ACTOR_A, item.id, 'HIGH', 'HUMAN')

    await expect(harness.board.approve(ACTOR_A, item.id, {
      expectedRowVersion: withSeverity.rowVersion,
      expectedArtifactVersion: waiting.version,
      expectedArtifactHash: withSeverity.artifactHash ?? '',
    })).rejects.toThrow('CANDIDATE_PENDING')
    await expect(harness.board.discard(ACTOR_A, item.id, {
      expectedRowVersion: withSeverity.rowVersion, reason: 'DUPLICADO',
    })).rejects.toThrow('CANDIDATE_PENDING')
  })

  it('W-66 · rejects a choice over a candidate that is no longer the last one', async () => {
    const harness = await bootBoard()
    const item = await submitArtifact(harness.board, 'idem-stale', 'k-stale')
    await harness.board.fail(ACTOR_A, item.id, 'DESCONOCIDO')
    const first = await harness.board.submit(ACTOR_A, {
      runId: 'run-1', idempotencyKey: 'idem-stale-2', businessKey: 'k-stale', ...ARTIFACT, accountRef: 'Eguisa',
    })
    const shown = first.pendingCandidate
    expect(shown).not.toBeNull()

    const second = await harness.board.submit(ACTOR_A, {
      runId: 'run-1', idempotencyKey: 'idem-stale-3', businessKey: 'k-stale', summary: 'segundo', evidence: ['oc:2'],
      artifactType: 'proforma', accountRef: 'Eguisa',
    })
    expect(second.pendingCandidate?.id).not.toBe(shown?.id)

    await expect(harness.board.resolveCandidate(ACTOR_A, item.id, shown?.id ?? '', shown?.hash ?? '', 'adopt'))
      .rejects.toThrow('CANDIDATE_STALE')
    const adopted = await harness.board.resolveCandidate(
      ACTOR_A, item.id, second.pendingCandidate?.id ?? '', second.pendingCandidate?.hash ?? '', 'adopt',
    )
    expect(adopted).toMatchObject({ pendingCandidate: null, version: 2 })
  })
})
