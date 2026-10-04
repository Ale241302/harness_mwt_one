import { describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'

interface CapturedTool {
  readonly name: string
  readonly execute: (args: never, exec?: never) => Promise<unknown>
  readonly output: { render: (args: never, value: never) => readonly { type: string; text?: string }[] }
  readonly presentCall: (args: never) => unknown
}

/** Boot the product tools over a stub registry and capture the definitions. */
function harness(config: Config, services: Record<string, unknown> = {}): Map<string, CapturedTool> {
  const registered = new Map<string, CapturedTool>()
  const ctx = {
    tools: { register: (definition: CapturedTool) => { registered.set(definition.name, definition); return () => {} } },
    get: (name: string) => services[name],
    effect: (callback: () => unknown) => { callback(); return () => {} },
  }
  apply(ctx as never, config)
  return registered
}

const CONFIG: Config = { ownerId: 'compras2@sondelsa.com', role: 'client_b2b', companyId: 'co-sondel', readOnly: false, workflowTools: true }

/** A WorkFlow-shaped object with the requested node and edge counts. */
function fakeFlow(nodes = 0, edges = 0) {
  return {
    id: 'wf1',
    name: 'flujo',
    status: 'draft',
    version: 1,
    definition: {
      intent: '',
      nodes: Array.from({ length: nodes }, (_, index) => ({ id: `n${String(index)}` })),
      edges: Array.from({ length: edges }, (_, index) => ({ id: `e${String(index)}` })),
      permissions: [],
      failurePolicy: 'stop',
    },
  }
}

/** A fake workflows service exposing the methods the tools call. */
function fakeWorkflows() {
  return {
    list: vi.fn(async () => [fakeFlow(2, 1)]),
    get: vi.fn(async () => fakeFlow(2, 1)),
    create: vi.fn(async () => fakeFlow()),
    addNode: vi.fn(async () => fakeFlow(3, 1)),
    updateNode: vi.fn(async () => fakeFlow(2, 1)),
    removeNode: vi.fn(async () => fakeFlow(1, 0)),
    connect: vi.fn(async () => fakeFlow(2, 2)),
    disconnect: vi.fn(async () => fakeFlow(2, 0)),
    setTrigger: vi.fn(async () => fakeFlow(3, 2)),
    validate: vi.fn(async (): Promise<{ ok: boolean; problems: readonly string[] }> => ({ ok: true, problems: [] })),
    setStatus: vi.fn(async () => fakeFlow(2, 1)),
    runNow: vi.fn(async () => ({ executionId: 'ex1', deduped: false })),
    runs: vi.fn(async () => [{ id: 'ex1', status: 'completed', routineVersion: 1 }]),
    templates: vi.fn(() => [{
      id: 'anti-spam',
      name: 'Anti-spam',
      description: 'clasifica',
      definition: { intent: '', nodes: [{}, {}, {}, {}, {}], edges: [{}, {}, {}, {}, {}], permissions: [], failurePolicy: 'review' },
    }]),
    createFromTemplate: vi.fn(async () => fakeFlow(5, 5)),
    exportFlow: vi.fn(async () => '{"format":"faberloom-workflow","version":1,"name":"flujo","definition":{"intent":"","nodes":[],"edges":[],"permissions":[],"failurePolicy":"stop"}}'),
    importFlow: vi.fn(async () => fakeFlow(2, 1)),
  }
}

const render = (tool: CapturedTool, value: Record<string, unknown>): string =>
  tool.output.render({} as never, value as never)[0]?.text ?? ''

describe('faberloom workflow tools', () => {
  it('does not register the workflow tools unless workflowTools is enabled', () => {
    const tools = harness(Object.assign({}, CONFIG, { workflowTools: false }), { faberloomWorkflows: fakeWorkflows() })
    expect(tools.get('faberloom_workflows_list')).toBeUndefined()
    expect(tools.get('faberloom_workflows_activate')).toBeUndefined()
  })

  it('lists and reads flows', async () => {
    const service = fakeWorkflows()
    const tools = harness(CONFIG, { faberloomWorkflows: service })
    const listed = await tools.get('faberloom_workflows_list')!.execute({} as never)
    expect(listed).toMatchObject({ runs: [{ id: 'wf1', name: 'flujo', nodes: 2, edges: 1 }] })
    expect(render(tools.get('faberloom_workflows_list')!, listed as Record<string, unknown>)).toContain('1 run(s)')

    const got = await tools.get('faberloom_workflows_get')!.execute({ workflowId: 'wf1' } as never)
    expect(service.get).toHaveBeenCalledWith(expect.objectContaining({ id: 'compras2@sondelsa.com' }), 'wf1')
    expect(render(tools.get('faberloom_workflows_get')!, got as Record<string, unknown>)).toContain('"flujo" draft v1 (2 nodes, 1 edges)')
  })

  it('lists templates, creates from one, and exports or imports portable JSON', async () => {
    const service = fakeWorkflows()
    const tools = harness(CONFIG, { faberloomWorkflows: service })
    const listed = await tools.get('faberloom_workflows_templates')!.execute({} as never)
    expect(listed).toMatchObject({ templates: [{ id: 'anti-spam', name: 'Anti-spam', nodes: 5, edges: 5 }] })

    await tools.get('faberloom_workflows_from_template')!.execute({ templateId: 'anti-spam', name: 'Mío' } as never)
    expect(service.createFromTemplate).toHaveBeenCalledWith(expect.anything(), 'anti-spam', 'Mío')
    await tools.get('faberloom_workflows_from_template')!.execute({ templateId: 'anti-spam' } as never)
    expect(service.createFromTemplate).toHaveBeenLastCalledWith(expect.anything(), 'anti-spam', undefined)

    const exported = await tools.get('faberloom_workflows_export')!.execute({ workflowId: 'wf1' } as never)
    expect(exported).toMatchObject({ format: 'faberloom-workflow' })
    await tools.get('faberloom_workflows_import')!.execute({ json: '{"format":"faberloom-workflow"}' } as never)
    expect(service.importFlow).toHaveBeenCalledWith(expect.anything(), '{"format":"faberloom-workflow"}', undefined)
  })

  it('creates a personal or space-scoped flow', async () => {
    const service = fakeWorkflows()
    const tools = harness(CONFIG, { faberloomWorkflows: service })
    await tools.get('faberloom_workflows_create')!.execute({ name: 'Anti-spam' } as never)
    expect(service.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'Anti-spam' }))
    await tools.get('faberloom_workflows_create')!.execute({ name: 'Anti-spam', scope: 'space', spaceId: 'sp-1' } as never)
    expect(service.create).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ scope: { kind: 'space', spaceId: 'sp-1' } }))
    await tools.get('faberloom_workflows_create')!.execute({ name: 'Anti-spam', scope: 'space' } as never)
    expect(service.create).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ scope: { kind: 'space', spaceId: '' } }))
    expect(tools.get('faberloom_workflows_create')!.presentCall({ name: 'x' } as never)).toMatchObject({ card: 'generic' })
  })

  it('adds, updates, and removes nodes', async () => {
    const service = fakeWorkflows()
    const tools = harness(CONFIG, { faberloomWorkflows: service })
    await tools.get('faberloom_workflows_add_node')!.execute({ workflowId: 'wf1', kind: 'agent', title: 'clasifica', config: { agentId: 'a' }, id: 'n1' } as never)
    expect(service.addNode).toHaveBeenLastCalledWith(expect.anything(), 'wf1', { kind: 'agent', title: 'clasifica', id: 'n1', config: { agentId: 'a' } })
    await tools.get('faberloom_workflows_add_node')!.execute({ workflowId: 'wf1', kind: 'deadletter', title: 'revisa' } as never)
    expect(service.addNode).toHaveBeenLastCalledWith(expect.anything(), 'wf1', { kind: 'deadletter', title: 'revisa' })

    await tools.get('faberloom_workflows_update_node')!.execute({ workflowId: 'wf1', nodeId: 'n1', title: 'nuevo', kind: 'notify', config: { kind: 'board' } } as never)
    expect(service.updateNode).toHaveBeenLastCalledWith(expect.anything(), 'wf1', 'n1', { title: 'nuevo', kind: 'notify', config: { kind: 'board' } })
    await tools.get('faberloom_workflows_update_node')!.execute({ workflowId: 'wf1', nodeId: 'n1' } as never)
    expect(service.updateNode).toHaveBeenLastCalledWith(expect.anything(), 'wf1', 'n1', {})

    expect(await tools.get('faberloom_workflows_remove_node')!.execute({ workflowId: 'wf1', nodeId: 'n1' } as never)).toMatchObject({ nodes: 1, edges: 0 })
  })

  it('connects and disconnects edges', async () => {
    const service = fakeWorkflows()
    const tools = harness(CONFIG, { faberloomWorkflows: service })
    await tools.get('faberloom_workflows_connect')!.execute({ workflowId: 'wf1', from: 'a', to: 'b', condition: 'spam == true' } as never)
    expect(service.connect).toHaveBeenLastCalledWith(expect.anything(), 'wf1', { from: 'a', to: 'b', condition: 'spam == true' })
    await tools.get('faberloom_workflows_connect')!.execute({ workflowId: 'wf1', from: 'a', to: 'b' } as never)
    expect(service.connect).toHaveBeenLastCalledWith(expect.anything(), 'wf1', { from: 'a', to: 'b' })
    expect(await tools.get('faberloom_workflows_disconnect')!.execute({ workflowId: 'wf1', edgeId: 'e1' } as never)).toMatchObject({ edges: 0 })
  })

  it('sets the trigger and validates the graph', async () => {
    const service = fakeWorkflows()
    const tools = harness(CONFIG, { faberloomWorkflows: service })
    await tools.get('faberloom_workflows_set_trigger')!.execute({ workflowId: 'wf1', kind: 'trigger.email', config: { match: 'Antispam' } } as never)
    expect(service.setTrigger).toHaveBeenLastCalledWith(expect.anything(), 'wf1', { kind: 'trigger.email', config: { match: 'Antispam' } })
    await tools.get('faberloom_workflows_set_trigger')!.execute({ workflowId: 'wf1', kind: 'trigger.manual' } as never)
    expect(service.setTrigger).toHaveBeenLastCalledWith(expect.anything(), 'wf1', { kind: 'trigger.manual' })

    const valid = await tools.get('faberloom_workflows_validate')!.execute({ workflowId: 'wf1' } as never)
    expect(valid).toEqual({ id: 'wf1', valid: true, problems: [] })
    expect(render(tools.get('faberloom_workflows_validate')!, valid as Record<string, unknown>)).toContain('is valid')
    service.validate.mockResolvedValueOnce({ ok: false, problems: ['graph has a cycle'] })
    const invalid = await tools.get('faberloom_workflows_validate')!.execute({ workflowId: 'wf1' } as never)
    expect(render(tools.get('faberloom_workflows_validate')!, invalid as Record<string, unknown>)).toContain('graph has a cycle')
  })

  it('activates, pauses, runs now, and lists runs', async () => {
    const service = fakeWorkflows()
    const tools = harness(CONFIG, { faberloomWorkflows: service })
    await tools.get('faberloom_workflows_activate')!.execute({ workflowId: 'wf1' } as never)
    expect(service.setStatus).toHaveBeenLastCalledWith(expect.anything(), 'wf1', 'active')
    await tools.get('faberloom_workflows_pause')!.execute({ workflowId: 'wf1' } as never)
    expect(service.setStatus).toHaveBeenLastCalledWith(expect.anything(), 'wf1', 'paused')

    const started = await tools.get('faberloom_workflows_run_now')!.execute({ workflowId: 'wf1' } as never)
    expect(render(tools.get('faberloom_workflows_run_now')!, started as Record<string, unknown>)).toContain('Started ex1.')
    service.runNow.mockResolvedValueOnce({ executionId: 'ex2', deduped: true })
    const deduped = await tools.get('faberloom_workflows_run_now')!.execute({ workflowId: 'wf1' } as never)
    expect(render(tools.get('faberloom_workflows_run_now')!, deduped as Record<string, unknown>)).toContain('(deduped)')

    const runs = await tools.get('faberloom_workflows_runs')!.execute({ workflowId: 'wf1' } as never)
    expect(runs).toMatchObject({ runs: [{ id: 'ex1', status: 'completed' }] })
    expect(render(tools.get('faberloom_workflows_runs')!, runs as Record<string, unknown>)).toContain('1 run(s)')
  })

  it('fails loud when the workflows service is not mounted', async () => {
    const tools = harness(CONFIG, {})
    await expect(tools.get('faberloom_workflows_list')!.execute({} as never)).rejects.toThrow('workflows service is not mounted')
  })
})
