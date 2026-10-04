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

/** Boot the view over fake workflows and context services. */
function harness() {
  const workflows = {
    pendingChanges: vi.fn(async () => [change]),
    acceptPending: vi.fn(async () => {}),
    rejectPending: vi.fn(async () => {}),
  }
  const context = {
    sync: vi.fn(async () => undefined),
    list: vi.fn(async () => [contextEntry]),
  }
  const ctx = {
    provide: () => {},
    reflect: { provide: () => {} },
    on: vi.fn(() => () => {}),
    effect: (run: () => unknown) => { run(); return () => {} },
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => name === 'faberloomWorkflows' ? workflows : name === 'faberloomContext' ? context : undefined,
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
  return { view, workflows, context }
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
