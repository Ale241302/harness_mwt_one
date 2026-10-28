import { describe, expect, it } from 'vitest'
import { MemoryMediaPool } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  ACTOR_A,
  COMPANY_A,
  OWNER_A,
  bootBoard,
  rawBoardItem,
  seedProforma,
  seedRawItem,
  seedRawIterationDraft,
  seedSpace,
} from './helpers/harness.ts'
import type { Config as BoardConfig } from '../src/index.ts'

type Harness = Awaited<ReturnType<typeof bootBoard>>

/** One stop of the walk clock every fixture uses for an expired deadline. */
const EXPIRED = '2026-10-20T00:00:00.000Z'

/** A booted board, its space, one seeded proforma, and the item's first attempt. */
async function bootIterating(options: { board?: BoardConfig } = {}) {
  const harness = await bootBoard(options)
  const space = await seedSpace(harness, ACTOR_A, 'Proformas')
  const seeded = await seedProforma(harness.board, OWNER_A, COMPANY_A, space)
  const started = await harness.board.iterate(ACTOR_A, seeded.id, { baseVersion: seeded.version, actorSession: 'tab-a' })
  return { harness, space, seeded, started }
}

/** Submit one prepared artifact of the actor inside one space. */
async function submitInSpace(
  harness: Harness,
  spaceId: string,
  businessKey: string,
  idempotencyKey: string,
) {
  return await harness.board.submit(ACTOR_A, {
    runId: 'run-1',
    idempotencyKey,
    businessKey,
    summary: 'borrador',
    evidence: [`oc:${businessKey}`],
    artifactType: 'proforma',
    spaceId,
  })
}

/** The attempt one item carries, or an empty id when it carries none. */
function attemptOf(item: { iterationId: string | null; iterationLockGeneration: number }) {
  return { iterationId: item.iterationId ?? '', generation: item.iterationLockGeneration }
}

describe('FaberLoomBoard iteration start (W-10, W-31, W-43)', () => {
  it('W-31 · refuses to iterate an item with no space and leaves it untouched', async () => {
    const harness = await bootBoard()
    const item = await seedProforma(harness.board, OWNER_A, COMPANY_A)

    await expect(harness.board.iterate(ACTOR_A, item.id, { baseVersion: 1, actorSession: 'tab-a' }))
      .rejects.toThrow('NO_SPACE')

    expect(await harness.board.get(ACTOR_A, item.id)).toMatchObject({
      state: 'PENDIENTE_CRITERIO', iterationId: null, iterationBaseVersion: null, version: 1, rowVersion: item.rowVersion,
    })
  })

  it('opens an attempt with a fresh id, the next generation, and the base version', async () => {
    const { seeded, started } = await bootIterating()

    expect(started.item).toMatchObject({
      state: 'ITERANDO', column: 'TU_CRITERIO', version: seeded.version, iterationBaseVersion: 1,
      iterationLockGeneration: 1, iterationLockBy: 'tab-a', iterationDraftKey: null,
    })
    expect(started.item.iterationId).not.toBeNull()
    expect(Date.parse(started.item.iterationLockUntil ?? '')).toBeGreaterThan(Date.now())
    expect(started.status).toMatchObject({ phase: 'active', generation: 1, baseVersion: 1, renewalSeconds: 30 })
    expect(started.item.events.at(-1)).toMatchObject({
      command: 'iteration.started', fromState: 'PENDIENTE_CRITERIO', toState: 'ITERANDO',
    })
  })

  it('W-10 · refuses approval, discard, and edits while the attempt is live', async () => {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const seeded = await seedProforma(harness.board, OWNER_A, COMPANY_A, space)
    await harness.board.setSeverity(ACTOR_A, seeded.id, 'MEDIUM', 'HUMAN')
    const started = await harness.board.iterate(ACTOR_A, seeded.id, { baseVersion: 1, actorSession: 'tab-a' })
    const locked = started.item

    await expect(harness.board.approve(ACTOR_A, seeded.id, {
      expectedRowVersion: locked.rowVersion,
      expectedArtifactVersion: 1,
      expectedArtifactHash: locked.artifactHash ?? '',
    })).rejects.toThrow('NO_ACCESS')
    await expect(harness.board.discard(ACTOR_A, seeded.id, {
      expectedRowVersion: locked.rowVersion, reason: 'DUPLICADO',
    })).rejects.toThrow('NO_ACCESS')
    await expect(harness.board.saveEdits(ACTOR_A, seeded.id, {
      expectedRowVersion: locked.rowVersion, baseVersion: 1, changes: { summary: 'tarde' },
    })).rejects.toThrow('NO_ACCESS')
    expect(await harness.board.get(ACTOR_A, seeded.id)).toMatchObject({
      state: 'ITERANDO', version: 1, rowVersion: locked.rowVersion,
    })
  })

  it('refuses a second attempt while one is live, so another tab stays read-only', async () => {
    const { harness, seeded } = await bootIterating()

    await expect(harness.board.iterate(ACTOR_A, seeded.id, { baseVersion: 1, actorSession: 'tab-b' }))
      .rejects.toThrow('LOCK_LOST')
    expect((await harness.board.get(ACTOR_A, seeded.id)).iterationLockBy).toBe('tab-a')
  })

  it('W-43 · refuses a write with the generation of the previous attempt', async () => {
    const { harness, seeded, started } = await bootIterating()
    const first = attemptOf(started.item)
    await harness.board.pauseIteration(ACTOR_A, seeded.id, { ...first, reason: 'guardar-y-salir' })
    const second = await harness.board.iterate(ACTOR_A, seeded.id, { baseVersion: 1, actorSession: 'tab-b' })
    const before = await harness.board.get(ACTOR_A, seeded.id)

    await expect(harness.board.renewIteration(ACTOR_A, seeded.id, attemptOf(started.item)))
      .rejects.toThrow('ITERATION_STALE')
    await expect(harness.board.applyIteration(ACTOR_A, seeded.id, {
      iterationId: second.status.iterationId ?? '', generation: first.generation, baseVersion: 1, scope: 'puntual',
    })).rejects.toThrow('ITERATION_STALE')

    expect(await harness.board.get(ACTOR_A, seeded.id)).toMatchObject({
      state: 'ITERANDO', version: before.version, rowVersion: before.rowVersion,
    })
  })
})

describe('FaberLoomBoard iteration exits (W-41, W-44, W-67, W-97)', () => {
  it('W-67 · Guardar y salir releases the lock and keeps the draft recoverable', async () => {
    const { harness, seeded, started } = await bootIterating()
    const saved = await harness.board.saveIterationDraft(ACTOR_A, seeded.id, {
      ...attemptOf(started.item), baseVersion: 1, summary: 'casi lista', content: { total: 100 },
    })
    expect(saved.linked).toBe(true)
    expect(saved.draft.content).toEqual({ total: 100 })

    const paused = await harness.board.pauseIteration(ACTOR_A, seeded.id, {
      ...attemptOf(started.item), reason: 'guardar-y-salir',
    })

    expect(paused.item).toMatchObject({
      state: 'PENDIENTE_CRITERIO', iterationId: null, iterationLockUntil: null, iterationLockBy: null, version: 1,
    })
    expect(paused.item.iterationDraftKey).toBe(saved.draft.key)
    expect(paused.status).toMatchObject({ phase: 'idle', draftOutdated: false })
    expect(paused.item.events.at(-1)).toMatchObject({ command: 'iteration.paused', reason: 'guardar-y-salir' })
    expect((await harness.board.getIterationDraft(ACTOR_A, seeded.id))?.content).toEqual({ total: 100 })
    await expect(harness.board.renewIteration(ACTOR_A, seeded.id, attemptOf(started.item))).rejects.toThrow('LOCK_LOST')
  })

  it('W-97 · Volver sin resolver keeps the draft and leaves the candidate pending', async () => {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const item = await submitInSpace(harness, space, 'k-return', 'idem-return-1')
    const started = await harness.board.iterate(ACTOR_A, item.id, { baseVersion: 1, actorSession: 'tab-a' })
    await harness.board.saveIterationDraft(ACTOR_A, item.id, {
      ...attemptOf(started.item), baseVersion: 1, content: { total: 7 },
    })
    const withCandidate = await submitInSpace(harness, space, 'k-return', 'idem-return-2')
    expect(withCandidate.pendingCandidate).not.toBeNull()

    const paused = await harness.board.pauseIteration(ACTOR_A, item.id, {
      ...attemptOf(started.item), reason: 'volver-sin-resolver',
    })

    expect(paused.item).toMatchObject({ state: 'PENDIENTE_CRITERIO', version: 1 })
    expect(paused.item.pendingCandidate?.id).toBe(withCandidate.pendingCandidate?.id)
    expect(paused.status.draft?.content).toEqual({ total: 7 })
  })

  it('W-41 · an expired lock leaves the pending candidate untouched', async () => {
    const pool = new MemoryMediaPool()
    const candidate = { id: 'cand-1', hash: 'hash-cand', summary: 'nuevo', evidence: ['oc:9'], at: EXPIRED }
    const expired = await seedRawItem(pool, rawBoardItem({
      state: 'ITERANDO',
      spaceId: 'space-1',
      iterationId: 'att-old',
      iterationBaseVersion: 1,
      iterationLockGeneration: 2,
      iterationLockUntil: EXPIRED,
      pendingCandidate: candidate,
    }))
    const harness = await bootBoard({ pool })

    const item = await harness.board.get(ACTOR_A, expired)
    expect(item).toMatchObject({ state: 'PENDIENTE_CRITERIO', version: 1 })
    expect(item.pendingCandidate?.id).toBe('cand-1')
  })

  it('W-41 · cancel refuses an unresolved candidate and keeps the version on a keep choice', async () => {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const item = await submitInSpace(harness, space, 'k-cancel', 'idem-cancel-1')
    const started = await harness.board.iterate(ACTOR_A, item.id, { baseVersion: 1, actorSession: 'tab-a' })
    const draft = await harness.board.saveIterationDraft(ACTOR_A, item.id, {
      ...attemptOf(started.item), baseVersion: 1, content: { total: 7 },
    })
    const arrived = await submitInSpace(harness, space, 'k-cancel', 'idem-cancel-2')

    await expect(harness.board.cancelIteration(ACTOR_A, item.id, attemptOf(started.item)))
      .rejects.toThrow('CANDIDATE_PENDING')
    expect(await harness.board.get(ACTOR_A, item.id)).toMatchObject({ state: 'ITERANDO', version: 1 })

    const kept = await harness.board.cancelIteration(ACTOR_A, item.id, {
      ...attemptOf(started.item),
      candidate: { id: arrived.pendingCandidate?.id ?? '', hash: arrived.pendingCandidate?.hash ?? '', decision: 'keep' },
    })

    expect(kept.item).toMatchObject({
      state: 'PENDIENTE_CRITERIO', version: 1, pendingCandidate: null, iterationId: null, iterationDraftKey: null,
    })
    expect(kept.item.events.at(-1)?.data).toMatchObject({ choice: 'keep', version: 1 })
    expect(await harness.board.getIterationDraft(ACTOR_A, item.id, draft.draft.iterationId)).toBeUndefined()
  })

  it('W-44 · an expired lock reads as paused and offers the draft for recovery', async () => {
    const pool = new MemoryMediaPool()
    const expired = await seedRawItem(pool, rawBoardItem({
      state: 'ITERANDO',
      spaceId: 'space-1',
      iterationId: 'att-old',
      iterationDraftKey: 'item-expired:att-old',
      iterationBaseVersion: 1,
      iterationLockGeneration: 2,
      iterationLockUntil: EXPIRED,
    }), 'item-expired')
    await seedRawIterationDraft(pool, {
      itemId: expired, iterationId: 'att-old', baseVersion: 1, summary: 'casi lista', evidence: ['oc:1'],
      content: { total: 5 }, archived: false, outdated: false, updatedAt: EXPIRED,
      retainUntil: '2099-01-01T00:00:00.000Z',
    })
    const harness = await bootBoard({ pool })

    const item = await harness.board.get(ACTOR_A, expired)
    expect(item).toMatchObject({ state: 'PENDIENTE_CRITERIO', column: 'TU_CRITERIO', version: 1 })
    const status = await harness.board.iterationStatus(ACTOR_A, expired)
    expect(status).toMatchObject({ phase: 'expired', iterationId: 'att-old', generation: 2 })
    expect(status.draft?.content).toEqual({ total: 5 })

    const resumed = await harness.board.resumeIteration(ACTOR_A, expired, { baseVersion: 1, actorSession: 'tab-b' })
    expect(resumed.status).toBe('started')
    expect(resumed.item).toMatchObject({ state: 'ITERANDO', iterationBaseVersion: 1, iterationLockGeneration: 3 })
    expect(resumed.item.iterationId).not.toBe('att-old')
    expect((await harness.board.getIterationDraft(ACTOR_A, expired))?.content).toEqual({ total: 5 })

    const discarded = await harness.board.cancelIteration(ACTOR_A, expired, attemptOf(resumed.item))
    expect(discarded.item.iterationDraftKey).toBeNull()
    expect(await harness.board.getIterationDraft(ACTOR_A, expired)).toBeUndefined()
  })

  it('W-68 · resume marks an outdated draft and returns the differences instead of overwriting', async () => {
    const { harness, seeded, started } = await bootIterating()
    const draft = await harness.board.saveIterationDraft(ACTOR_A, seeded.id, {
      ...attemptOf(started.item), baseVersion: 1, content: { total: 10, terms: 'A' },
    })
    await harness.board.pauseIteration(ACTOR_A, seeded.id, { ...attemptOf(started.item), reason: 'guardar-y-salir' })
    const edited = await harness.board.saveEdits(ACTOR_A, seeded.id, {
      expectedRowVersion: (await harness.board.get(ACTOR_A, seeded.id)).rowVersion,
      baseVersion: 1,
      changes: { total: 20 },
    })

    const resumed = await harness.board.resumeIteration(ACTOR_A, seeded.id, { baseVersion: 1 })

    expect(resumed.status).toBe('outdated')
    if (resumed.status !== 'outdated') return
    const differences = new Map(resumed.differences.map(entry => [entry.field, entry]))
    expect(differences.get('total')).toEqual({ field: 'total', draftValue: 10, currentValue: 20 })
    expect(differences.get('terms')).toEqual({ field: 'terms', draftValue: 'A', currentValue: undefined })
    expect(resumed.item).toMatchObject({ state: 'PENDIENTE_CRITERIO', version: edited.version, content: { total: 20 } })
    expect((await harness.board.getIterationDraft(ACTOR_A, seeded.id, draft.draft.iterationId))?.outdated).toBe(true)
  })

  it('archives the retained draft when a fresh attempt starts over the item', async () => {
    const { harness, seeded, started } = await bootIterating()
    const first = await harness.board.saveIterationDraft(ACTOR_A, seeded.id, {
      ...attemptOf(started.item), baseVersion: 1, content: { total: 3 },
    })
    await harness.board.pauseIteration(ACTOR_A, seeded.id, { ...attemptOf(started.item), reason: 'guardar-y-salir' })

    const second = await harness.board.iterate(ACTOR_A, seeded.id, { baseVersion: 1, actorSession: 'tab-b' })

    expect(second.item.iterationDraftKey).toBeNull()
    expect(await harness.board.getIterationDraft(ACTOR_A, seeded.id)).toBeUndefined()
    expect((await harness.board.getIterationDraft(ACTOR_A, seeded.id, first.draft.iterationId))?.archived).toBe(true)
  })

  it('refuses a live draft write made against another artifact version', async () => {
    const { harness, seeded, started } = await bootIterating()

    await expect(harness.board.saveIterationDraft(ACTOR_A, seeded.id, {
      ...attemptOf(started.item), baseVersion: 7, content: { total: 3 },
    })).rejects.toThrow('ITERATION_STALE')

    expect(await harness.board.getIterationDraft(ACTOR_A, seeded.id, started.item.iterationId ?? '')).toBeUndefined()
    expect(await harness.board.get(ACTOR_A, seeded.id)).toMatchObject({ state: 'ITERANDO', version: 1 })
  })

  it('refines the retained draft with a late answer after Guardar y salir', async () => {
    const { harness, seeded, started } = await bootIterating()
    await harness.board.saveIterationDraft(ACTOR_A, seeded.id, {
      ...attemptOf(started.item), baseVersion: 1, content: { total: 4 },
    })
    await harness.board.pauseIteration(ACTOR_A, seeded.id, { ...attemptOf(started.item), reason: 'guardar-y-salir' })
    const before = await harness.board.get(ACTOR_A, seeded.id)

    const outcome = await harness.board.saveIterationDraft(ACTOR_A, seeded.id, {
      ...attemptOf(started.item), baseVersion: 1, content: { terms: 'B' },
    })

    expect(outcome).toMatchObject({ linked: false, code: 'LOCK_LOST' })
    expect(outcome.draft.archived).toBe(false)
    expect(await harness.board.get(ACTOR_A, seeded.id)).toMatchObject({ rowVersion: before.rowVersion })
    expect((await harness.board.getIterationDraft(ACTOR_A, seeded.id))?.content).toEqual({ total: 4, terms: 'B' })
  })

  it('W-57 · a late answer for a dead attempt is stored as a draft of that attempt', async () => {
    const { harness, seeded, started } = await bootIterating()
    const dead = attemptOf(started.item)
    await harness.board.pauseIteration(ACTOR_A, seeded.id, { ...dead, reason: 'guardar-y-salir' })
    const before = await harness.board.get(ACTOR_A, seeded.id)

    const outcome = await harness.board.saveIterationDraft(ACTOR_A, seeded.id, {
      ...dead, baseVersion: 1, content: { total: 99 },
    })

    expect(outcome).toMatchObject({ linked: false, code: 'LOCK_LOST' })
    expect(outcome.draft.archived).toBe(true)
    expect(await harness.board.get(ACTOR_A, seeded.id)).toMatchObject({
      state: before.state, version: before.version, rowVersion: before.rowVersion, iterationDraftKey: before.iterationDraftKey,
    })
    expect((await harness.board.getIterationDraft(ACTOR_A, seeded.id, dead.iterationId))?.content).toEqual({ total: 99 })
    expect(await harness.board.getIterationDraft(ACTOR_A, seeded.id)).toBeUndefined()
  })
})

describe('FaberLoomBoard iteration apply and rounds (W-40, W-69, D-10)', () => {
  it('W-40 · an artifact arriving during the attempt stays a candidate of the same item', async () => {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const item = await submitInSpace(harness, space, 'k-arrives', 'idem-arrives-1')
    await harness.board.iterate(ACTOR_A, item.id, { baseVersion: 1, actorSession: 'tab-a' })

    const arrived = await submitInSpace(harness, space, 'k-arrives', 'idem-arrives-2')

    expect(arrived.id).toBe(item.id)
    expect(arrived).toMatchObject({ state: 'ITERANDO', version: 1 })
    expect(arrived.pendingCandidate).not.toBeNull()
    expect(await harness.board.list(ACTOR_A)).toHaveLength(1)
  })

  it('W-69 · iterateWithEdits writes the version and starts the attempt in one commit', async () => {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const item = await seedProforma(harness.board, OWNER_A, COMPANY_A, space)

    const started = await harness.board.iterateWithEdits(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion, baseVersion: 1, changes: { summary: 'corregido' }, actorSession: 'tab-a',
    })

    expect(started.item).toMatchObject({
      state: 'ITERANDO', version: 2, iterationBaseVersion: 2, iterationLockGeneration: 1,
    })
    expect(started.item.artifactHash).not.toBe(item.artifactHash)
    expect(started.item.events.at(-1)?.command).toBe('iterate_with_edits')
  })

  it('W-69 · a conflicting iterateWithEdits applies neither the edits nor the attempt', async () => {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const item = await seedProforma(harness.board, OWNER_A, COMPANY_A, space)
    const edited = await harness.board.saveEdits(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion, baseVersion: 1, changes: { summary: 'v2' },
    })

    await expect(harness.board.iterateWithEdits(ACTOR_A, item.id, {
      expectedRowVersion: edited.rowVersion, baseVersion: 1, changes: { summary: 'a medias' }, actorSession: 'tab-a',
    })).rejects.toThrow('STALE_REVISION')

    const after = await harness.board.get(ACTOR_A, item.id)
    expect(after).toMatchObject({
      state: 'PENDIENTE_CRITERIO', version: 2, rowVersion: edited.rowVersion, iterationId: null,
    })
    expect(after.events.at(-1)?.command).toBe('save_edits')
  })

  it('applies the attempt as a new version, records the scope, and consumes the draft', async () => {
    const { harness, seeded, started } = await bootIterating()
    const saved = await harness.board.saveIterationDraft(ACTOR_A, seeded.id, {
      ...attemptOf(started.item), baseVersion: 1, summary: 'lista', content: { total: 42 },
    })

    const applied = await harness.board.applyIteration(ACTOR_A, seeded.id, {
      ...attemptOf(started.item), baseVersion: 1, scope: 'cuenta',
    })

    expect(applied.item).toMatchObject({
      state: 'PENDIENTE_CRITERIO', version: 2, iterationId: null, iterationDraftKey: null, iterationRoundCount: 1,
    })
    expect(applied.item.artifactHash).not.toBe(seeded.artifactHash)
    expect(applied.item.content).toMatchObject({ total: 42 })
    expect(applied.item.events.at(-1)).toMatchObject({
      command: 'iteration.applied', data: { scope: 'cuenta', choice: null, rounds: 1 },
    })
    expect(await harness.board.getIterationDraft(ACTOR_A, seeded.id, saved.draft.iterationId)).toBeUndefined()
  })

  it('apply refuses a pending candidate until the caller names which version wins', async () => {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const item = await submitInSpace(harness, space, 'k-wins', 'idem-wins-1')
    const started = await harness.board.iterate(ACTOR_A, item.id, { baseVersion: 1, actorSession: 'tab-a' })
    const arrived = await submitInSpace(harness, space, 'k-wins', 'idem-wins-2')

    await expect(harness.board.applyIteration(ACTOR_A, item.id, {
      ...attemptOf(started.item), baseVersion: 1, scope: 'puntual',
    })).rejects.toThrow('CANDIDATE_PENDING')

    const adopted = await harness.board.applyIteration(ACTOR_A, item.id, {
      ...attemptOf(started.item),
      baseVersion: 1,
      scope: 'puntual',
      candidate: { id: arrived.pendingCandidate?.id ?? '', hash: arrived.pendingCandidate?.hash ?? '', decision: 'adopt' },
    })
    expect(adopted.item).toMatchObject({ state: 'PENDIENTE_CRITERIO', version: 2, pendingCandidate: null })
    expect(adopted.item.artifactHash).toBe(arrived.pendingCandidate?.hash)
  })

  it('D-10 · the fifth applied round only suggests rewriting or discarding', async () => {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const seeded = await seedProforma(harness.board, OWNER_A, COMPANY_A, space)
    const suggestions: boolean[] = []
    for (let round = 1; round <= 5; round += 1) {
      const current = await harness.board.get(ACTOR_A, seeded.id)
      const attempt = await harness.board.iterate(ACTOR_A, seeded.id, {
        baseVersion: current.version, actorSession: `tab-${round}`,
      })
      const applied = await harness.board.applyIteration(ACTOR_A, seeded.id, {
        ...attemptOf(attempt.item), baseVersion: current.version, scope: 'puntual',
      })
      suggestions.push(applied.status.suggestRewrite)
      expect(applied.item.state).toBe('PENDIENTE_CRITERIO')
    }

    expect(suggestions).toEqual([false, false, false, false, true])
    expect(harness.board.iterationPolicy()).toMatchObject({ roundLimit: 5, renewalSeconds: 30, lockSeconds: 900 })
  })

  it('renews the lock of the live attempt and refuses once the deadline passed', async () => {
    const pool = new MemoryMediaPool()
    const soon = new Date(Date.now() + 60_000).toISOString()
    const live = await seedRawItem(pool, rawBoardItem({
      state: 'ITERANDO',
      iterationId: 'att-live',
      iterationBaseVersion: 1,
      iterationLockGeneration: 3,
      iterationLockUntil: soon,
    }))
    const stopped = await seedRawItem(pool, rawBoardItem({
      state: 'ITERANDO',
      iterationId: 'att-dead',
      iterationBaseVersion: 1,
      iterationLockGeneration: 4,
      iterationLockUntil: EXPIRED,
    }))
    const harness = await bootBoard({ pool })

    const renewed = await harness.board.renewIteration(ACTOR_A, live, { iterationId: 'att-live', generation: 3 })
    expect(Date.parse(renewed.item.iterationLockUntil ?? '')).toBeGreaterThan(Date.parse(soon))
    expect(renewed.item.events.at(-1)?.command).toBe('iteration.renewed')

    await expect(harness.board.renewIteration(ACTOR_A, stopped, { iterationId: 'att-dead', generation: 4 }))
      .rejects.toThrow('LOCK_LOST')
    expect(await harness.board.get(ACTOR_A, stopped)).toMatchObject({ state: 'PENDIENTE_CRITERIO', version: 1 })
  })

  it('reads the lock, retention, renewal, and round limit from the config', async () => {
    const harness = await bootBoard({
      board: {
        iterationRenewalSeconds: 10, iterationLockSeconds: 60, iterationDraftRetentionDays: 2, iterationRoundLimit: 1,
      },
    })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const seeded = await seedProforma(harness.board, OWNER_A, COMPANY_A, space)
    const started = await harness.board.iterate(ACTOR_A, seeded.id, { baseVersion: 1, actorSession: 'tab-a' })

    expect(harness.board.iterationPolicy()).toEqual({
      renewalSeconds: 10, lockSeconds: 60, retentionDays: 2, roundLimit: 1,
    })
    expect(started.status.renewalSeconds).toBe(10)
    const remaining = Date.parse(started.item.iterationLockUntil ?? '') - Date.now()
    expect(remaining).toBeGreaterThan(55_000)
    expect(remaining).toBeLessThan(61_000)
  })

  it('does not offer a draft past its retention window', async () => {
    const pool = new MemoryMediaPool()
    const pending = await seedRawItem(pool, rawBoardItem({
      iterationId: 'att-old',
      iterationDraftKey: 'item-retained:att-old',
    }), 'item-retained')
    await seedRawIterationDraft(pool, {
      itemId: pending, iterationId: 'att-old', baseVersion: 1, summary: 'viejo', evidence: ['oc:1'],
      content: { total: 1 }, archived: false, outdated: false, updatedAt: '2026-01-01T00:00:00.000Z',
      retainUntil: '2026-01-31T00:00:00.000Z',
    })
    const harness = await bootBoard({ pool })

    expect(await harness.board.getIterationDraft(ACTOR_A, pending, 'att-old')).toBeUndefined()
    expect(await harness.board.getIterationDraft(ACTOR_A, pending)).toBeUndefined()
    await expect(harness.board.resumeIteration(ACTOR_A, pending, { baseVersion: 1 })).rejects.toThrow('NO_DRAFT')
  })

  it('refuses an apply or resume whose base version is not the current one', async () => {
    const { harness, seeded, started } = await bootIterating()

    await expect(harness.board.applyIteration(ACTOR_A, seeded.id, {
      ...attemptOf(started.item), baseVersion: 2, scope: 'puntual',
    })).rejects.toThrow('ITERATION_STALE')
    await expect(harness.board.resumeIteration(ACTOR_A, seeded.id, { baseVersion: 1 })).rejects.toThrow('LOCK_LOST')
    expect(await harness.board.get(ACTOR_A, seeded.id)).toMatchObject({ state: 'ITERANDO', version: 1 })
  })
})
