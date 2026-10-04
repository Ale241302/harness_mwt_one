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
    routineId: undefined,
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
    setConcurrency: vi.fn(async () => {}),
    runs: vi.fn(async () => [{ id: 'ex1', status: 'completed', routineVersion: 1, createdAt: 'c', updatedAt: 'u' }]),
  }
}

/** Boot the view service over a minimal hand-built context. */
function harness(detail = flow([], [])) {
  const workflows = fakeWorkflows(detail)
  const routines = { listRoutines: vi.fn(async () => [] as unknown[]) }
  const shares = {
    list: vi.fn(async () => ({ outgoing: [] as unknown[], incoming: [] as unknown[] })),
    create: vi.fn(async () => ({})),
    revoke: vi.fn(async () => ({})),
    can: vi.fn(async () => false),
  }
  const ctx = {
    faberloomSpaces: { list: vi.fn(async () => []), get: vi.fn(async () => ({ id: 'sp-1', title: 'Marluvas', ownerId: 'owner@muitowork.com' })) },
    faberloomAgents: { listAgents: vi.fn(async () => []) },
    faberloomRoutines: routines,
    faberloomShares: shares,
    get: (name: string) => name === 'faberloomWorkflows' ? workflows : name === 'faberloomShares' ? shares : undefined,
    provide: () => {},
    reflect: { provide: () => {} },
    on: vi.fn(() => () => {}),
    effect: (run: () => unknown) => { run(); return () => {} },
    logger: { warn: vi.fn(), info: vi.fn() },
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
  return { view, workflows, routines, shares }
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

  it('sets and clears one flow concurrency cap', async () => {
    const { view, workflows } = harness()
    await view.setWorkflowConcurrency('wf1', 3)
    expect(workflows.setConcurrency).toHaveBeenCalledWith(expect.objectContaining({ id: 'owner@muitowork.com' }), 'wf1', 3)
    await view.setWorkflowConcurrency('wf1', null)
    expect(workflows.setConcurrency).toHaveBeenLastCalledWith(expect.anything(), 'wf1', null)
  })

  it('reports the concurrency cap in the flow detail', async () => {
    const detail = flow([], [], {
      routineId: 'r1',
      definition: { intent: '', nodes: [], edges: [], permissions: [], failurePolicy: 'stop', maxConcurrency: 4 },
    })
    const { view } = harness(detail)
    expect((await view.workflowDetail('wf1')).maxConcurrency).toBe(4)
  })

  it('maps a routine schedule trigger into its detail', async () => {
    const { view, routines } = harness()
    routines.listRoutines.mockResolvedValue([
      {
        id: 'r1', name: 'Correo 12h', status: 'active', version: 1, versions: [1],
        definition: {
          intent: 'revisar correo', expectedResult: '', permissions: [], failurePolicy: 'stop', maxConcurrency: 2,
          triggers: [{ kind: 'recurrence', match: 'every:12h', timezone: 'Europe/Madrid', days: [1, 2], windowFrom: 8, windowTo: 18, businessDays: true }],
          steps: [{ id: 's1', instruction: 'hazlo', handler: 'workflow', dependsOn: [], waitFor: null, effect: false, config: { workflowId: 'wf2' } }],
        },
      },
    ])
    expect(await view.routineDetail('r1')).toMatchObject({
      triggerKind: 'recurrence',
      triggerMatch: 'every:12h',
      triggerTimezone: 'Europe/Madrid',
      triggerDays: [1, 2],
      triggerWindowFrom: 8,
      triggerWindowTo: 18,
      triggerBusinessDays: true,
      maxConcurrency: 2,
    })
  })

  it('lists routine ↔ flow links in both directions', async () => {
    const { view, workflows, routines } = harness()
    workflows.list.mockResolvedValue([
      flow([], [], { id: 'wf1', name: 'Anti-spam', routineId: 'r1' }),
      flow([], [], { id: 'wf2', name: 'Informe' }),
    ])
    routines.listRoutines.mockResolvedValue([
      {
        id: 'r1', name: 'Vigía', status: 'active', version: 1, versions: [1],
        definition: {
          intent: '', expectedResult: '', permissions: [], failurePolicy: 'stop', maxConcurrency: null,
          triggers: [],
          steps: [
            { id: 's1', instruction: 'invoca', handler: 'workflow', dependsOn: [], waitFor: null, effect: false, config: { workflowId: 'wf2' } },
            { id: 's2', instruction: 'nada', handler: 'step', dependsOn: [], waitFor: null, effect: false, config: {} },
          ],
        },
      },
    ])
    expect(await view.routineWorkflowLinks()).toEqual([
      { routineId: 'r1', routineName: 'Vigía', workflowId: 'wf2', workflowName: 'Informe', direction: 'routine-to-workflow' },
      { routineId: 'r1', routineName: 'Vigía', workflowId: 'wf1', workflowName: 'Anti-spam', direction: 'workflow-to-routine' },
    ])
  })

  it('shares a flow and a space, lists the grants, and revokes one', async () => {
    const { view, shares } = harness()
    const grant = {
      id: 'g1',
      resource: { kind: 'workflow', id: 'wf1' },
      resourceName: 'Anti-spam',
      ownerId: 'owner@muitowork.com',
      granteeEmail: 'guest@x',
      permissions: ['view', 'run'],
      status: 'pending',
      createdAt: 'c',
      acceptedAt: null,
    }
    shares.list.mockResolvedValue({ outgoing: [grant], incoming: [] })
    expect(await view.resourceShares('workflow', 'wf1')).toEqual([{
      id: 'g1',
      resourceKind: 'workflow',
      resourceId: 'wf1',
      resourceName: 'Anti-spam',
      ownerId: 'owner@muitowork.com',
      granteeEmail: 'guest@x',
      permissions: ['view', 'run'],
      permissionLabel: 'view, run',
      status: 'pending',
      createdAt: 'c',
      acceptedAt: null,
    }])

    await view.revokeShareGrant('g1')
    expect(shares.revoke).toHaveBeenCalledWith('owner@muitowork.com', 'g1')

    await view.shareWorkflow('wf1', ['guest@x'], ['view', 'run'])
    expect(shares.create).toHaveBeenCalledWith('owner@muitowork.com', expect.objectContaining({
      resource: { kind: 'workflow', id: 'wf1' },
      granteeEmail: 'guest@x',
      permissions: ['view', 'run'],
    }))

    await view.shareSpace('sp-1', ['guest@x'], ['view'])
    expect(shares.create).toHaveBeenLastCalledWith('owner@muitowork.com', expect.objectContaining({
      resource: { kind: 'space', id: 'sp-1' },
      resourceName: 'Marluvas',
    }))
  })
})
