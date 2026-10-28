import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

const ACTOR = { id: 'owner@muitowork.com', companyId: 'mwt', role: 'admin', readOnly: false }

/** One stored draft as the board returns it, with content the panel never receives. */
function draft(overrides: Partial<{
  baseVersion: number
  summary: string | null
  content: Record<string, unknown> | null
  outdated: boolean
  archived: boolean
}> = {}) {
  return {
    key: 'b1:iter-1',
    itemId: 'b1',
    iterationId: 'iter-1',
    baseVersion: overrides.baseVersion ?? 3,
    summary: overrides.summary === undefined ? 'Precio revisado' : overrides.summary,
    evidence: ['oc:505288'],
    content: overrides.content === undefined ? { total: 1200 } : overrides.content,
    archived: overrides.archived ?? false,
    outdated: overrides.outdated ?? false,
    updatedAt: '2026-10-28T10:00:00Z',
    retainUntil: '2026-11-27T10:00:00Z',
  }
}

/** One attempt status as the board projects it. */
function status(overrides: Partial<{
  phase: 'idle' | 'active' | 'expired'
  iterationId: string | null
  baseVersion: number | null
  lockUntil: string | null
  draftValue: ReturnType<typeof draft> | null
  draftOutdated: boolean
  candidatePending: boolean
  rounds: number
}> = {}) {
  return {
    phase: overrides.phase ?? 'active',
    iterationId: overrides.iterationId === undefined ? 'iter-1' : overrides.iterationId,
    generation: 4,
    baseVersion: overrides.baseVersion === undefined ? 3 : overrides.baseVersion,
    lockUntil: overrides.lockUntil === undefined ? '2026-10-28T10:15:00Z' : overrides.lockUntil,
    lockBy: 'tab-1',
    renewalSeconds: 30,
    rounds: overrides.rounds ?? 2,
    roundLimit: 5,
    suggestRewrite: false,
    draft: overrides.draftValue === undefined ? draft() : overrides.draftValue,
    draftOutdated: overrides.draftOutdated ?? false,
    candidatePending: overrides.candidatePending ?? false,
  }
}

/** The item the view reads; content is what the difference comparison needs. */
function item(overrides: Partial<{
  spaceId: string | null
  version: number
  content: Record<string, unknown>
  summary: string
  rounds: number
}> = {}) {
  return {
    id: 'b1',
    ownerId: ACTOR.id,
    companyId: ACTOR.companyId,
    title: 'PF 9001-2026',
    status: 'waiting_approval',
    state: 'ITERANDO',
    column: 'TU_CRITERIO',
    version: overrides.version ?? 3,
    rowVersion: 7,
    artifactType: 'proforma',
    accountRef: 'Cuenta Demo',
    dataClass: 'N2',
    dataClassProvisional: false,
    spaceId: overrides.spaceId === undefined ? 'sp-1' : overrides.spaceId,
    iterationId: 'iter-1',
    iterationDraftKey: 'b1:iter-1',
    iterationLockUntil: '2026-10-28T10:15:00Z',
    iterationLockGeneration: 4,
    iterationBaseVersion: 3,
    iterationLockBy: 'tab-1',
    iterationRoundCount: overrides.rounds ?? 2,
    content: overrides.content ?? { total: 1000, currency: 'USD' },
    guardrails: [],
    revisions: [
      {
        version: overrides.version ?? 3,
        summary: overrides.summary ?? 'Proforma DDP 100 pares',
        evidence: ['oc:505288'],
        content: null,
        documentRef: null,
        at: '2026-10-28T09:00:00Z',
      },
    ],
    events: [],
    effects: [],
    fieldOrigins: [],
    pendingCandidate: null,
  }
}

/** The view's dependency graph, with the board recording every command it receives. */
function harness(options: { readOnly?: boolean } = {}) {
  const records = { iterationStatus: status(), draft: draft() as ReturnType<typeof draft> | undefined }
  const board = {
    list: vi.fn(async () => [item()]),
    get: vi.fn(async () => item()),
    iterationStatus: vi.fn(async () => records.iterationStatus),
    iterate: vi.fn(async () => ({ item: item(), status: records.iterationStatus })),
    saveEdits: vi.fn(async () => item({ version: 4, summary: 'Corregido' })),
    saveIterationDraft: vi.fn(async () => ({ draft: records.draft, linked: true, code: null })),
    getEditDraft: vi.fn(async () => undefined),
    applyIteration: vi.fn(async () => ({ item: item(), status: status({ phase: 'idle', iterationId: null }) })),
    renewIteration: vi.fn(async () => ({ item: item(), status: records.iterationStatus })),
    pauseIteration: vi.fn(async () => ({ item: item(), status: status({ phase: 'idle', iterationId: null }) })),
    cancelIteration: vi.fn(async () => ({ item: item(), status: status({ phase: 'idle', iterationId: null }) })),
    resumeIteration: vi.fn(async () => ({ item: item(), status: 'started' as const })),
    getIterationDraft: vi.fn(async () => records.draft),
  }
  const spaces = {
    get: vi.fn(async () => ({ id: 'sp-1', title: 'Marluvas', parentId: null, agentId: 'agent-1' })),
  }
  const onCorrection = vi.fn(async () => ({ correction: { id: 'c1' }, candidate: undefined }))
  const ctx = {
    faberloomSpaces: spaces,
    faberloomBoard: board,
    faberloomMemory: { onCorrection },
    provide: () => {},
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: () => () => {},
    logger: { warn: vi.fn(), info: vi.fn() },
    get: () => undefined,
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, {
    ownerId: ACTOR.id,
    role: ACTOR.role,
    companyId: ACTOR.companyId,
    readOnly: options.readOnly === true,
  })
  return { view, board, spaces, records, onCorrection }
}

describe('FaberLoomViewService board iteration', () => {
  it('projects the attempt without the draft content the panel never edits', async () => {
    const { view, board } = harness()
    const attempt = await view.boardIteration('b1')
    expect(board.iterationStatus).toHaveBeenCalledWith(ACTOR, 'b1')
    expect(attempt).toMatchObject({ phase: 'active', iterationId: 'iter-1', generation: 4, baseVersion: 3, rounds: 2 })
    expect(attempt?.draft).toEqual({
      baseVersion: 3,
      summary: 'Precio revisado',
      evidence: ['oc:505288'],
      outdated: false,
      archived: false,
      updatedAt: '2026-10-28T10:00:00Z',
    })
  })

  it('answers undefined for an item the actor does not hold', async () => {
    const { view, board } = harness()
    board.list.mockResolvedValue([])
    expect(await view.boardIteration('other')).toBeUndefined()
    expect(board.iterationStatus).not.toHaveBeenCalled()
  })

  it('starts the attempt over the version the panel shows and the tab it names', async () => {
    const { view, board } = harness()
    await view.boardIterationStart('b1', 3, 'tab-9')
    expect(board.iterate).toHaveBeenCalledWith(ACTOR, 'b1', { baseVersion: 3, actorSession: 'tab-9' })
  })

  it('refuses every iteration write from a read-only identity', async () => {
    const { view, board } = harness({ readOnly: true })
    await expect(view.boardIterationStart('b1', 3, 'tab-1')).rejects.toThrow('read-only')
    await expect(view.boardIterationApply('b1', { iterationId: 'iter-1', generation: 4, baseVersion: 3, scope: 'puntual' }))
      .rejects.toThrow('read-only')
    expect(board.iterate).not.toHaveBeenCalled()
    expect(board.applyIteration).not.toHaveBeenCalled()
  })

  it('sends the scope the learning lane expects and no candidate when none is pending', async () => {
    const { view, board } = harness()
    await view.boardIterationApply('b1', {
      iterationId: 'iter-1',
      generation: 4,
      baseVersion: 3,
      scope: 'cuenta',
    })
    expect(board.applyIteration).toHaveBeenCalledWith(ACTOR, 'b1', {
      iterationId: 'iter-1',
      generation: 4,
      baseVersion: 3,
      scope: 'cuenta',
    })
  })

  it('carries the candidate choice that resolves the apply', async () => {
    const { view, board } = harness()
    await view.boardIterationApply('b1', {
      iterationId: 'iter-1',
      generation: 4,
      baseVersion: 3,
      scope: 'espacio',
      candidate: { id: 'c1', hash: 'h1', decision: 'adopt' },
    })
    expect(board.applyIteration).toHaveBeenCalledWith(ACTOR, 'b1', {
      iterationId: 'iter-1',
      generation: 4,
      baseVersion: 3,
      scope: 'espacio',
      candidate: { id: 'c1', hash: 'h1', decision: 'adopt' },
    })
  })

  it('pauses with the exit the user chose and leaves the draft alone', async () => {
    const { view, board } = harness()
    await view.boardIterationPause('b1', { iterationId: 'iter-1', generation: 4, reason: 'guardar-y-salir' })
    expect(board.pauseIteration).toHaveBeenCalledWith(ACTOR, 'b1', {
      iterationId: 'iter-1',
      generation: 4,
      reason: 'guardar-y-salir',
    })
    expect(board.applyIteration).not.toHaveBeenCalled()
    expect(board.cancelIteration).not.toHaveBeenCalled()
  })

  it('cancels the draft with the candidate choice and never applies', async () => {
    const { view, board } = harness()
    await view.boardIterationCancel('b1', {
      iterationId: 'iter-1',
      generation: 4,
      candidate: { id: 'c1', hash: 'h1', decision: 'keep' },
    })
    expect(board.cancelIteration).toHaveBeenCalledWith(ACTOR, 'b1', {
      iterationId: 'iter-1',
      generation: 4,
      candidate: { id: 'c1', hash: 'h1', decision: 'keep' },
    })
    expect(board.applyIteration).not.toHaveBeenCalled()
  })

  it('saves the working draft and reports whether the item still links it', async () => {
    const { view, board } = harness()
    expect(await view.boardIterationSaveDraft('b1', {
      iterationId: 'iter-1',
      generation: 4,
      baseVersion: 3,
      summary: 'Precio revisado',
    })).toEqual({ summary: 'Precio revisado', baseVersion: 3, linked: true })

    board.saveIterationDraft.mockResolvedValue({ draft: draft(), linked: false, code: 'LOCK_LOST' } as never)
    expect(await view.boardIterationSaveDraft('b1', {
      iterationId: 'iter-1',
      generation: 4,
      baseVersion: 3,
      summary: 'Tarde',
    })).toEqual({ summary: 'Precio revisado', baseVersion: 3, linked: false })
  })

  it('reports a resumed attempt and a stale draft with its differences', async () => {
    const { view, board } = harness()
    expect(await view.boardIterationResume('b1', 3, 'tab-9')).toMatchObject({ status: 'started', differences: [] })
    expect(board.resumeIteration).toHaveBeenCalledWith(ACTOR, 'b1', { baseVersion: 3, actorSession: 'tab-9' })

    board.resumeIteration.mockResolvedValue({
      item: item(),
      status: 'outdated' as never,
      differences: [{ field: 'total', draftValue: 1200, currentValue: 1000 }],
    } as never)
    expect(await view.boardIterationResume('b1', 3)).toEqual({
      status: 'outdated',
      iteration: expect.objectContaining({ phase: 'active' }),
      differences: [{ field: 'total', draftValue: '1200', currentValue: '1000' }],
    })
  })

  it('reads the retained draft and compares it only when its base version moved', async () => {
    const { view, records } = harness()
    records.draft = draft({ summary: 'Precio revisado', content: { total: 1200 } })
    expect(await view.boardIterationDraft('b1')).toEqual({
      draft: expect.objectContaining({ baseVersion: 3, summary: 'Precio revisado' }),
      differences: [],
    })

    records.draft = draft({ baseVersion: 2, content: { total: 1200, currency: 'USD' } })
    expect(await view.boardIterationDraft('b1')).toEqual({
      draft: expect.objectContaining({ baseVersion: 2 }),
      differences: [{ field: 'total', draftValue: '1200', currentValue: '1000' }],
    })
  })

  it('answers no draft when the attempt retains none', async () => {
    const { view, records } = harness()
    records.draft = undefined
    expect(await view.boardIterationDraft('b1')).toEqual({ draft: null, differences: [] })
  })

  it('pins the chat context to the item and the space title the actor may read', async () => {
    const { view, spaces } = harness()
    expect(await view.boardIterationContext('b1')).toEqual({
      itemId: 'b1',
      title: 'PF 9001-2026',
      accountRef: 'Cuenta Demo',
      spaceId: 'sp-1',
      spaceTitle: 'Marluvas',
      version: 3,
      summary: 'Proforma DDP 100 pares',
      draftSummary: 'Precio revisado',
      rounds: 2,
    })
    expect(spaces.get).toHaveBeenCalledWith(ACTOR, 'sp-1')
  })

  it('omits the space title the actor may not read and the context of an absent item', async () => {
    const { view, board, spaces } = harness()
    spaces.get.mockRejectedValue(new Error('faberloom: NO_ACCESS — the space belongs to another owner'))
    expect((await view.boardIterationContext('b1'))?.spaceTitle).toBeNull()

    board.list.mockResolvedValue([])
    expect(await view.boardIterationContext('other')).toBeUndefined()
  })

  it('projects the tab session that holds the attempt', async () => {
    const { view } = harness()
    expect((await view.boardIteration('b1'))?.lockBy).toBe('tab-1')
  })

  it('renews the live attempt with the attempt id and generation it was given', async () => {
    const { view, board } = harness()
    const attempt = await view.boardIterationRenew('b1', { iterationId: 'iter-1', generation: 4 })
    expect(board.renewIteration).toHaveBeenCalledWith(ACTOR, 'b1', { iterationId: 'iter-1', generation: 4 })
    expect(attempt).toMatchObject({ phase: 'active', iterationId: 'iter-1', generation: 4 })
  })

  it('refuses a renewal from a read-only identity', async () => {
    const { view, board } = harness({ readOnly: true })
    await expect(view.boardIterationRenew('b1', { iterationId: 'iter-1', generation: 4 })).rejects.toThrow('read-only')
    expect(board.renewIteration).not.toHaveBeenCalled()
  })

  it('records one iterate correction with the scope, the work, and the item lineage', async () => {
    const { view, board, onCorrection } = harness()
    board.applyIteration.mockResolvedValue({
      item: item({ version: 4, rounds: 3, content: { total: 1200, currency: 'USD' }, summary: 'Precio revisado' }),
      status: status({ phase: 'idle', iterationId: null }),
    })

    const answer = await view.boardIterationApply('b1', {
      iterationId: 'iter-1',
      generation: 4,
      baseVersion: 3,
      scope: 'cuenta',
    })

    expect(answer.correctionError).toBeNull()
    expect(answer.iteration).toMatchObject({ phase: 'idle' })
    expect(onCorrection).toHaveBeenCalledWith(
      {
        id: ACTOR.id,
        tenantId: 'mwt',
        spaceIds: ['sp-1'],
        accountRefs: ['Cuenta Demo'],
        agentIds: ['agent-1'],
      },
      {
        itemId: 'b1',
        actor: ACTOR.id,
        tenantId: 'mwt',
        spaceId: 'sp-1',
        accountRef: 'Cuenta Demo',
        agentId: 'agent-1',
        dataClasses: ['N2'],
        fieldsUsed: ['summary', 'total'],
        scope: 'cuenta',
        text: 'Precio revisado',
        detail: {
          origin: 'iterate',
          instructions: 'Precio revisado',
          diffs: ['summary: Proforma DDP 100 pares → Precio revisado', 'total: 1000 → 1200'],
          rounds: 3,
        },
      },
    )
  })

  it('keeps a provisional class out of the learning products of the applied correction', async () => {
    const { view, board, onCorrection } = harness()
    board.applyIteration.mockResolvedValue({
      item: { ...item({ version: 4, rounds: 3 }), dataClassProvisional: true },
      status: status({ phase: 'idle', iterationId: null }),
    })

    await view.boardIterationApply('b1', { iterationId: 'iter-1', generation: 4, baseVersion: 3, scope: 'puntual' })

    expect(onCorrection).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      dataClassProvisional: true,
      scope: 'puntual',
    }))
  })

  it('records one edit correction per changed field with its previous and next value', async () => {
    const { view, onCorrection } = harness()

    const answer = await view.boardSaveEdits('b1', {
      expectedRowVersion: 7,
      baseVersion: 3,
      changes: { summary: 'Corregido', currency: 'USD' },
    })

    expect(answer.detail?.id).toBe('b1')
    expect(answer.correctionError).toBeNull()
    // `currency` was written with the value the item already carried, so it records no correction.
    expect(onCorrection).toHaveBeenCalledTimes(1)
    expect(onCorrection).toHaveBeenCalledWith(expect.anything(), {
      itemId: 'b1',
      actor: ACTOR.id,
      tenantId: 'mwt',
      spaceId: 'sp-1',
      accountRef: 'Cuenta Demo',
      agentId: 'agent-1',
      dataClasses: ['N2'],
      fieldsUsed: ['summary'],
      scope: 'puntual',
      detail: { origin: 'edit', field: 'summary', previous: 'Proforma DDP 100 pares', next: 'Corregido' },
    })
  })

  it('commits the apply and reports the correction it could not record', async () => {
    const { view, board, onCorrection } = harness()
    onCorrection.mockRejectedValue(new Error('faberloom: NO_ACCESS — the correction origin is outside the actor scope'))

    const answer = await view.boardIterationApply('b1', {
      iterationId: 'iter-1',
      generation: 4,
      baseVersion: 3,
      scope: 'puntual',
    })

    expect(board.applyIteration).toHaveBeenCalled()
    expect(answer.correctionError).toBe('faberloom: NO_ACCESS — the correction origin is outside the actor scope')
    expect(answer.iteration).toMatchObject({ phase: 'idle' })
  })

  it('commits the edit and reports the correction it could not record', async () => {
    const { view, onCorrection } = harness()
    onCorrection.mockRejectedValue(new Error('faberloom: NO_DATA_CLASS — a correction carries its data classes'))

    const answer = await view.boardSaveEdits('b1', {
      expectedRowVersion: 7,
      baseVersion: 3,
      changes: { summary: 'Corregido' },
    })

    expect(answer.detail).not.toBeNull()
    expect(answer.correctionError).toBe('faberloom: NO_DATA_CLASS — a correction carries its data classes')
  })

  it('records the applied correction without diffs when the earlier item could not be read', async () => {
    const { view, board, onCorrection } = harness()
    board.get.mockRejectedValue(new Error('faberloom: NOT_FOUND — board item b1 not found'))

    const answer = await view.boardIterationApply('b1', {
      iterationId: 'iter-1',
      generation: 4,
      baseVersion: 3,
      scope: 'puntual',
    })

    expect(answer.correctionError).toBeNull()
    expect(onCorrection).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      fieldsUsed: [],
      detail: { origin: 'iterate', instructions: 'Precio revisado', diffs: [], rounds: 2 },
    }))
  })

  it('records nothing when the earlier item of an edit could not be read', async () => {
    const { view, board, onCorrection } = harness()
    board.get.mockRejectedValue(new Error('faberloom: NOT_FOUND — board item b1 not found'))

    const answer = await view.boardSaveEdits('b1', {
      expectedRowVersion: 7,
      baseVersion: 3,
      changes: { summary: 'Corregido' },
    })

    expect(onCorrection).not.toHaveBeenCalled()
    expect(answer.correctionError).toBe('faberloom: CORRECTION_SKIPPED — the item could not be read before the edit')
  })
})
