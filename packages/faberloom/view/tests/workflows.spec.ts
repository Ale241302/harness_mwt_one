import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

/** One WorkFlow-shaped record. */
function flow(nodes: unknown[], edges: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf1',
    name: 'Anti-spam',
    status: 'draft',
    version: 1,
    definition: { intent: '', nodes, edges, permissions: [], failurePolicy: 'stop' },
    routineId: null,
    ...overrides,
  }
}

/** A fake workflows service exposing the methods the Remote delegates to. */
function fakeWorkflows(detail = flow([], [])) {
  return {
    list: vi.fn(async () => [flow([{ id: 'n1', kind: 'trigger.email', title: 'correo', position: { x: 0, y: 0 }, config: {} }], [])]),
    get: vi.fn(async () => detail),
    validate: vi.fn(async () => ({ ok: true, problems: [] })),
    update: vi.fn(async () => {}),
    create: vi.fn(async () => {}),
    addNode: vi.fn(async () => {}),
    updateNode: vi.fn(async () => {}),
    removeNode: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    setStatus: vi.fn(async () => {}),
    runs: vi.fn(async () => [{ id: 'ex1', status: 'completed', routineVersion: 1, createdAt: 'c', updatedAt: 'u' }]),
  }
}

/** Boot the view service over a minimal hand-built context. */
function harness(detail = flow([], [])) {
  const workflows = fakeWorkflows(detail)
  const ctx = {
    faberloomSpaces: { list: vi.fn(async () => []) },
    faberloomAgents: { listAgents: vi.fn(async () => []) },
    get: (name: string) => name === 'faberloomWorkflows' ? workflows : undefined,
    provide: () => {},
    reflect: { provide: () => {} },
    on: vi.fn(() => () => {}),
    effect: (run: () => unknown) => { run(); return () => {} },
    logger: { warn: vi.fn(), info: vi.fn() },
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
  return { view, workflows }
}

describe('FaberLoomViewService workflows', () => {
  it('lists flows and reads one detail with its graph', async () => {
    const detail = flow(
      [
        { id: 'n1', kind: 'trigger.email', title: 'correo', position: { x: 0, y: 0 }, config: { match: 'Antispam' } },
        { id: 'n2', kind: 'imap.action', title: 'borra', position: { x: 200, y: 0 }, config: { op: 'delete' } },
      ],
      [{ id: 'e1', from: 'n1', to: 'n2', condition: 'spam == true' }],
      { routineId: 'r1' },
    )
    const { view } = harness(detail)
    expect(await view.workflowOverview()).toEqual([{ id: 'wf1', name: 'Anti-spam', status: 'draft', version: 1, nodes: 1, edges: 0, routineId: null }])
    const read = await view.workflowDetail('wf1')
    expect(read).toMatchObject({ id: 'wf1', valid: true, routineId: 'r1' })
    expect(read.nodesList).toHaveLength(2)
    expect(read.edgesList).toEqual([{ id: 'e1', from: 'n1', to: 'n2', condition: 'spam == true' }])
  })

  it('saves, adds, updates, removes, connects, disconnects, and sets status through the service', async () => {
    const { view, workflows } = harness()
    await view.createWorkflow('nuevo')
    expect(workflows.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'nuevo' }))
    await view.saveWorkflow('wf1', 'nuevo')
    expect(workflows.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'owner@muitowork.com' }), 'wf1', { name: 'nuevo' })

    await view.addNode('wf1', 'agent', 'clasifica', '{"agentId":"a"}', 'n9')
    expect(workflows.addNode).toHaveBeenLastCalledWith(expect.anything(), 'wf1', { kind: 'agent', title: 'clasifica', config: { agentId: 'a' }, id: 'n9' })
    await view.addNode('wf1', 'agent', 'clasifica', '')
    expect(workflows.addNode).toHaveBeenLastCalledWith(expect.anything(), 'wf1', { kind: 'agent', title: 'clasifica', config: {} })
    await view.addNode('wf1', 'agent', 'clasifica', 'null')
    expect(workflows.addNode).toHaveBeenLastCalledWith(expect.anything(), 'wf1', { kind: 'agent', title: 'clasifica', config: {} })
    await view.addNode('wf1', 'agent', 'clasifica', '[1]')
    expect(workflows.addNode).toHaveBeenLastCalledWith(expect.anything(), 'wf1', { kind: 'agent', title: 'clasifica', config: {} })
    await view.addNode('wf1', 'agent', 'clasifica', '5', '')
    expect(workflows.addNode).toHaveBeenLastCalledWith(expect.anything(), 'wf1', { kind: 'agent', title: 'clasifica', config: {} })

    await view.updateNode('wf1', 'n1', 'nuevo', 'notify', '{"kind":"board"}')
    expect(workflows.updateNode).toHaveBeenLastCalledWith(expect.anything(), 'wf1', 'n1', { title: 'nuevo', kind: 'notify', config: { kind: 'board' } })
    await view.updateNode('wf1', 'n1', '', '', '')
    expect(workflows.updateNode).toHaveBeenLastCalledWith(expect.anything(), 'wf1', 'n1', {})

    await view.removeNode('wf1', 'n1')
    expect(workflows.removeNode).toHaveBeenCalledWith(expect.anything(), 'wf1', 'n1')
    await view.connect('wf1', 'n1', 'n2', 'spam == true')
    expect(workflows.connect).toHaveBeenLastCalledWith(expect.anything(), 'wf1', { from: 'n1', to: 'n2', condition: 'spam == true' })
    await view.connect('wf1', 'n1', 'n2')
    expect(workflows.connect).toHaveBeenLastCalledWith(expect.anything(), 'wf1', { from: 'n1', to: 'n2' })
    await view.disconnect('wf1', 'e1')
    expect(workflows.disconnect).toHaveBeenCalledWith(expect.anything(), 'wf1', 'e1')
    await view.setWorkflowStatus('wf1', 'active')
    expect(workflows.setStatus).toHaveBeenCalledWith(expect.anything(), 'wf1', 'active')
  })

  it('lists runs and exports JSON and Archify HTML', async () => {
    const detail = flow(
      [
        { id: 'n1', kind: 'trigger.email', title: 'A & B', position: { x: 0, y: 0 }, config: {} },
        { id: 'n2', kind: 'imap.action', title: 'borra', position: { x: 200, y: 0 }, config: {} },
      ],
      [{ id: 'e1', from: 'n1', to: 'n2' }, { id: 'e2', from: 'n1', to: 'ghost' }, { id: 'e3', from: 'ghost2', to: 'n1' }],
    )
    const { view } = harness(detail)
    expect(await view.workflowRuns('wf1')).toEqual([{ id: 'ex1', status: 'completed', routineVersion: 1, createdAt: 'c', updatedAt: 'u' }])

    const json = await view.exportWorkflow('wf1', 'json')
    expect(json.format).toBe('json')
    expect(json.content).toContain('"wf1"')
    const archify = await view.exportWorkflow('wf1', 'archify')
    expect(archify.format).toBe('archify')
    expect(archify.content).toContain('<svg')
    expect(archify.content).toContain('A &amp; B')
    expect(archify.content).toContain('<line')
  })

  it('reads the space topology and fails loud without the workflows service', async () => {
    const { view } = harness()
    expect(await view.spaceTopology()).toEqual({ spaces: [], agents: [], connections: [], workspaces: [] })

    const bare = new FaberLoomViewService({
      get: () => undefined,
      provide: () => {},
      reflect: { provide: () => {} },
      on: vi.fn(() => () => {}),
      effect: (run: () => unknown) => { run(); return () => {} },
      logger: { warn: vi.fn(), info: vi.fn() },
    } as unknown as Context, { ownerId: 'owner@x', role: 'admin', readOnly: false })
    await expect(bare.workflowOverview()).rejects.toThrow('Workflows no está montado')
  })
})
