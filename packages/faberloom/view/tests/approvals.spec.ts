import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

/** One staged work-flow revision the fake workflows service returns. */
const change = {
  workflowId: 'wf1',
  ownerId: 'owner@muitowork.com',
  proposerId: 'invitado@x',
  name: 'propuesta',
  scope: { kind: 'personal' },
  baseVersion: 1,
  createdAt: 'c',
  base: {
    intent: '',
    nodes: [{ id: 't', title: 'inicio', kind: 'trigger.manual', position: { x: 0, y: 0 }, config: {} }],
    edges: [],
    permissions: [],
    failurePolicy: 'stop',
  },
  proposed: {
    intent: '',
    nodes: [
      { id: 't', title: 'inicio', kind: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
      { id: 'a', title: 'paso', kind: 'agent', position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [{ id: 'e1', from: 't', to: 'a' }],
    permissions: [],
    failurePolicy: 'stop',
  },
}

/** One context entry the fake context service returns. */
const contextEntry = {
  id: 'c1', spaceId: 'sp-1', title: 'Regla', body: 'x', version: 1, visibility: 'shared',
  authorId: 'a@x', ownerId: 'owner@muitowork.com', createdAt: 'c', updatedAt: 'u',
}

/** Boot the view over fake workflows, context, board, and publication services. */
function harness(extra: { board?: unknown; publication?: unknown } = {}) {
  const workflows = {
    pendingChanges: vi.fn(async () => [change]),
    acceptPending: vi.fn(async () => {}),
    rejectPending: vi.fn(async () => {}),
  }
  const context = {
    sync: vi.fn(async () => undefined),
    list: vi.fn(async () => [contextEntry]),
  }
  const logger = { warn: vi.fn(), info: vi.fn() }
  const ctx = {
    provide: () => {},
    reflect: { provide: () => {} },
    on: vi.fn(() => () => {}),
    effect: (run: () => unknown) => { run(); return () => {} },
    logger,
    faberloomBoard: extra.board,
    get: (name: string) => {
      if (name === 'faberloomWorkflows') return workflows
      if (name === 'faberloomContext') return context
      if (name === 'faberloomBoard') return extra.board
      if (name === 'faberloomPublication') return extra.publication
      return undefined
    },
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
  return { view, workflows, context, logger }
}

describe('FaberLoomViewService approvals', () => {
  it('F11 · maps staged work-flow revisions with their base and proposed graphs', async () => {
    const { view, workflows } = harness()
    const rows = await view.workflowPendingChanges()
    expect(workflows.pendingChanges).toHaveBeenCalledWith(expect.objectContaining({ id: 'owner@muitowork.com' }))
    expect(rows).toEqual([{
      workflowId: 'wf1', ownerId: 'owner@muitowork.com', proposerId: 'invitado@x', name: 'propuesta',
      baseVersion: 1, createdAt: 'c',
      base: { nodes: [{ id: 't', title: 'inicio', kind: 'trigger.manual' }], edges: [] },
      proposed: { nodes: [{ id: 't', title: 'inicio', kind: 'trigger.manual' }, { id: 'a', title: 'paso', kind: 'agent' }], edges: [{ id: 'e1', from: 't', to: 'a' }] },
    }])
  })

  it('F11 · accepts and rejects one staged revision', async () => {
    const accepted = harness()
    expect(await accepted.view.acceptWorkflowChange('wf1')).toEqual([expect.objectContaining({ workflowId: 'wf1' })])
    expect(accepted.workflows.acceptPending).toHaveBeenCalledWith(expect.anything(), 'wf1')
    const rejected = harness()
    await rejected.view.rejectWorkflowChange('wf1')
    expect(rejected.workflows.rejectPending).toHaveBeenCalledWith(expect.anything(), 'wf1')
  })

  it('F11 · syncs the console context and returns the refreshed entries', async () => {
    const { view, context } = harness()
    const rows = await view.syncContext()
    expect(context.sync).toHaveBeenCalledWith('owner@muitowork.com')
    expect(rows).toEqual([expect.objectContaining({ id: 'c1', visibility: 'shared' })])
  })
})

/** One approved knowledge proposal as the durable board item reports it. */
const approvedProposal = {
  id: 'prop-1',
  state: 'APROBADO',
  artifactType: 'propuesta-conocimiento',
  approvedRevision: 3,
  dataClass: 'N2',
  artifactHash: 'h1',
  content: {
    versionBase: 'a'.repeat(40),
    archivo: 'knowledge/a.md',
    cambio: 'diff --git a/knowledge/a.md b/knowledge/a.md\n--- a/knowledge/a.md\n+++ b/knowledge/a.md\n',
    motivo: 'motivo aprobado',
    evidencia: ['oc:505288'],
  },
}

/** The approval expectations the view forwards to the board. */
const approvalInput = {
  expectedRowVersion: 2,
  expectedArtifactVersion: 3,
  expectedArtifactHash: 'h1',
}

describe('FaberLoomViewService board-to-applier link', () => {
  it('3A.1 · applies the approved proposal with its durable diff and identity', async () => {
    const board = {
      approve: vi.fn(async () => undefined),
      get: vi.fn(async () => approvedProposal),
    }
    const publication = {
      applicationReadiness: vi.fn(() => ({ available: true, reason: null })),
      readiness: vi.fn(() => ({ available: true, reason: null })),
      apply: vi.fn(async () => ({ state: 'applied' })),
      publish: vi.fn(async () => ({ state: 'activated' })),
    }
    const { view } = harness({ board, publication })
    view.boardDetail = vi.fn(async () => undefined)

    await view.boardApprove('prop-1', approvalInput)

    expect(board.approve).toHaveBeenCalledTimes(1)
    expect(publication.apply).toHaveBeenCalledWith({
      itemId: 'prop-1',
      revision: 'a'.repeat(40),
      diff: approvedProposal.content.cambio,
      artifactHash: 'h1',
      motivo: 'motivo aprobado',
      evidence: ['oc:505288'],
    })
    expect(publication.publish).toHaveBeenCalledWith({
      itemId: 'prop-1',
      revision: 'a'.repeat(40),
      path: 'knowledge/a.md',
      diff: approvedProposal.content.cambio,
      artifactHash: 'h1',
      motivo: 'motivo aprobado',
      evidence: ['oc:505288'],
    })
  })

  it('3A.3 · keeps the approval when publication fails after the commit', async () => {
    const board = {
      approve: vi.fn(async () => undefined),
      get: vi.fn(async () => approvedProposal),
    }
    const publication = {
      applicationReadiness: vi.fn(() => ({ available: true, reason: null })),
      readiness: vi.fn(() => ({ available: true, reason: null })),
      apply: vi.fn(async () => ({ state: 'applied' })),
      publish: vi.fn(async () => {
        throw new Error('faberloom: PUBLICATION_STORE_UNAVAILABLE — source down')
      }),
    }
    const { view, logger } = harness({ board, publication })
    view.boardDetail = vi.fn(async () => undefined)

    await expect(view.boardApprove('prop-1', approvalInput)).resolves.toBeUndefined()
    expect(board.approve).toHaveBeenCalledTimes(1)
    expect(publication.apply).toHaveBeenCalledTimes(1)
    expect(publication.publish).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('PUBLICATION_STORE_UNAVAILABLE'))
  })

  it('3A.1 · keeps the approval when the applier reports a conflict', async () => {
    const board = {
      approve: vi.fn(async () => undefined),
      get: vi.fn(async () => approvedProposal),
    }
    const publication = {
      applicationReadiness: vi.fn(() => ({ available: true, reason: null })),
      apply: vi.fn(async () => {
        throw new Error('faberloom: PUBLICATION_WORKTREE_DIRTY — foreign change')
      }),
    }
    const { view, logger } = harness({ board, publication })
    view.boardDetail = vi.fn(async () => undefined)

    await expect(view.boardApprove('prop-1', approvalInput)).resolves.toBeUndefined()
    expect(board.approve).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('PUBLICATION_WORKTREE_DIRTY'))
  })

  it('3A.1 · never sends a restricted or non-proposal item to the applier', async () => {
    const board = {
      approve: vi.fn(async () => undefined),
      get: vi.fn(async () => ({ ...approvedProposal, dataClass: 'N3' })),
    }
    const publication = { applicationReadiness: vi.fn(() => ({ available: true, reason: null })), apply: vi.fn() }
    const { view } = harness({ board, publication })
    view.boardDetail = vi.fn(async () => undefined)

    await view.boardApprove('prop-1', approvalInput)
    expect(publication.apply).not.toHaveBeenCalled()
  })
})
