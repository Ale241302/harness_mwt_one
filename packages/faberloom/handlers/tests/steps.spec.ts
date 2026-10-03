import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { StepContext } from '@deepseek-ai/dsh-faberloom-routines'
import { agentRuntimeFor, stepPrompt } from '../src/index.ts'
import { createWorkflowHandlers, evaluateCondition, MAX_DELAY_SECONDS, renderTemplate, resolvePath, stringValue } from '../src/steps.ts'

const OWNER = 'compras2@sondelsa.com'

/** A context with the named services provided and readable through `ctx.get`. */
function context(provides: Record<string, unknown> = {}): Context {
  const ctx = new Context()
  for (const [name, value] of Object.entries(provides)) ctx.provide(name, value as never)
  return ctx
}

/** A step context with the fields a handler reads. */
function step(config: Record<string, unknown>, overrides: Partial<StepContext> = {}): StepContext {
  return {
    executionId: 'e1',
    routineId: 'r1' as StepContext['routineId'],
    stepId: 's1',
    input: undefined,
    event: undefined,
    config,
    results: {},
    events: [],
    ...overrides,
  }
}

/** The routines mock every owner lookup and subroutine invocation uses. */
function routines(overrides: Record<string, unknown> = {}) {
  return {
    getExecution: vi.fn(async () => ({ ownerId: OWNER })),
    startExecution: vi.fn(async () => ({ execution: { id: 'child-1' }, deduped: false })),
    ...overrides,
  }
}

describe('steps helpers', () => {
  it('renders values as text', () => {
    expect(stringValue(undefined)).toBe('')
    expect(stringValue(null)).toBe('')
    expect(stringValue('hola')).toBe('hola')
    expect(stringValue({ a: 1 })).toBe('{"a":1}')
    expect(stringValue(3)).toBe('3')
    expect(stringValue(Symbol('s'))).toBe('')
  })

  it('resolves dotted paths against the step context', () => {
    const context1 = step({}, { event: { key: 'k', type: 'email', data: { uid: 7 } }, input: { name: 'pedido' }, results: { s0: { text: 'ok' } } })
    expect(resolvePath('event.data.uid', context1)).toBe(7)
    expect(resolvePath('input.name', context1)).toBe('pedido')
    expect(resolvePath('result.s0.text', context1)).toBe('ok')
    expect(resolvePath('result', context1)).toBeUndefined()
    expect(resolvePath('result.missing.text', context1)).toBeUndefined()
    expect(resolvePath('ghost.thing', context1)).toBeUndefined()
    expect(resolvePath('input.name.deeper', context1)).toBeUndefined()
  })

  it('renders templates and ignores unknown placeholders', () => {
    const context1 = step({}, { event: { key: 'k', type: 'email', data: { subject: 'OC 4711' } } })
    expect(renderTemplate('Asunto: {{event.data.subject}} / {{ghost}}', context1)).toBe('Asunto: OC 4711 / ')
  })

  it('evaluates the condition grammar', () => {
    const context1 = step({}, { event: { key: 'k', type: 'email', data: { spam: 'true', n: '3' } }, results: { s0: { passed: true } } })
    expect(evaluateCondition('event.data.spam == true', context1)).toBe(true)
    expect(evaluateCondition('event.data.spam != false', context1)).toBe(true)
    expect(evaluateCondition('event.data.spam contains ru', context1)).toBe(true)
    expect(evaluateCondition('result.s0 exists', context1)).toBe(true)
    expect(evaluateCondition('result.ghost exists', context1)).toBe(false)
    expect(evaluateCondition('event.data.n > 2', context1)).toBe(true)
    expect(evaluateCondition('event.data.n < 2', context1)).toBe(false)
    expect(() => evaluateCondition('onlyapath', context1)).toThrow('must be')
    expect(() => evaluateCondition('', context1)).toThrow('must be')
    expect(() => evaluateCondition('event.data.n like 2', context1)).toThrow('unknown condition operator')
  })

  it('adds the Space context to an agent prompt only when provided', () => {
    const base = step({})
    expect(stepPrompt('agent', base, 'hazlo')).not.toContain('Contexto del Space')
    expect(stepPrompt('agent', base, 'hazlo', 'catalog: eguisa')).toContain('Contexto del Space:\ncatalog: eguisa')
  })

  it('resolves the Space, agent, and skill context an agent step carries', async () => {
    const spaces = {
      reference: vi.fn(async () => ({ context: { resolved: { catalog: 'eguisa' } }, memory: [{ text: 'recuerda X' }], workspaceId: 'ws-1' })),
    }
    const agents = { getAgent: vi.fn(async () => ({ name: 'Formatos', responsibility: 'redacta', skills: ['docx'], provider: 'deepseek', model: 'v4-pro' })) }
    const skills = { get: vi.fn(async () => ({ name: 'docx', content: 'cuerpo de la skill' })) }
    const registry = { get: vi.fn(() => ({ id: 'ws-1', path: 'C:/work/sicop', title: 'SICOP' })) }
    const ctx = context({
      faberloomRoutines: routines(),
      faberloomSpaces: spaces,
      faberloomAgents: agents,
      skills,
      workspaceRegistry: registry,
    })
    const runtime = await agentRuntimeFor(ctx, step({ spaceId: 'sp-1', agentId: 'ag-1', skillName: 'docx' }))
    expect(runtime.block).toContain('Contexto del Space:\n- catalog: eguisa')
    expect(runtime.block).toContain('Memoria del Space:\n- recuerda X')
    expect(runtime.block).toContain('Agente: Formatos — redacta')
    expect(runtime.block).toContain('Skills del agente: docx')
    expect(runtime.block).toContain('Skill "docx":\ncuerpo de la skill')
    expect(runtime.block).toContain('faberloom_spaces_ask')
    expect(runtime.cwd).toBe('C:/work/sicop')
    expect(runtime.agentOptions).toEqual({ provider: 'deepseek', model: 'v4-pro' })
  })

  it('degrades cleanly when the Space, agent, and skill services are absent or empty', async () => {
    const bare = await agentRuntimeFor(context({ faberloomRoutines: routines() }), step({ spaceId: 'sp', agentId: 'a', skillName: 's' }))
    expect(bare.cwd).toBeUndefined()
    expect(bare.block).not.toContain('Contexto del Space')
    const empty = {
      reference: vi.fn(async () => ({ context: { resolved: {} }, memory: [], workspaceId: undefined })),
    }
    const sparse = await agentRuntimeFor(
      context({ faberloomRoutines: routines(), faberloomSpaces: empty, faberloomAgents: { getAgent: vi.fn(async () => ({ name: 'A', responsibility: 'r', skills: [] })) }, skills: { get: vi.fn(async () => undefined) } }),
      step({ spaceId: 'sp', agentId: 'a', skillName: 's' }),
    )
    expect(sparse.cwd).toBeUndefined()
    expect(sparse.block).toContain('Agente: A — r')
    expect(sparse.block).not.toContain('Skill "')
  })
})

describe('workflow handlers', () => {
  it('condition and transform read their expression config', () => {
    const handlers = createWorkflowHandlers(context())
    expect(handlers['condition']?.(step({ expression: 'event exists' }, { event: { key: 'k', type: 'event' } }))).toMatchObject({ handler: 'condition', passed: true })
    expect(handlers['transform']?.(step({ expression: '{{input.name}}' }, { input: { name: 'x' } }))).toMatchObject({ handler: 'transform', value: 'x' })
    expect(() => handlers['condition']?.(step({}))).toThrow('must be')
    expect(handlers['transform']?.(step({}))).toMatchObject({ value: '' })
  })

  it('delay waits for a matching event or a bounded interval', async () => {
    const handlers = createWorkflowHandlers(context())
    expect(await handlers['delay']?.(step({ waitFor: 'reply' }, { event: { key: 'reply', type: 'email' } }))).toMatchObject({ handler: 'delay', matched: 'reply' })
    expect(await handlers['delay']?.(step({ waitFor: 'never' }))).toMatchObject({ handler: 'delay', matched: null })
    vi.useFakeTimers()
    try {
      expect(await handlers['delay']?.(step({}))).toMatchObject({ handler: 'delay', waitedSeconds: 0 })
      expect(await handlers['delay']?.(step({ seconds: -5 }))).toMatchObject({ handler: 'delay', waitedSeconds: 0 })
      const small = handlers['delay']?.(step({ seconds: 0.001 }))
      await vi.advanceTimersByTimeAsync(1)
      expect(await small).toMatchObject({ handler: 'delay', waitedSeconds: 0.001 })
      const big = handlers['delay']?.(step({ seconds: MAX_DELAY_SECONDS + 100 }))
      await vi.advanceTimersByTimeAsync(MAX_DELAY_SECONDS * 1000)
      expect(await big).toMatchObject({ handler: 'delay', waitedSeconds: MAX_DELAY_SECONDS })
    } finally {
      vi.useRealTimers()
    }
  })

  it('imap performs the configured mailbox action', async () => {
    const inbound = {
      searchMailbox: vi.fn(async () => [{ uid: 1 }, { uid: 2 }]),
      markSeen: vi.fn(async () => true),
      moveToTrash: vi.fn(async () => 'Trash'),
      readEmail: vi.fn(async () => ({ text: 'cuerpo', html: null, attachments: [] })),
    }
    const handlers = createWorkflowHandlers(context({ faberloomRoutines: routines(), faberloomInbound: inbound }))
    expect(await handlers['imap']?.(step({ op: 'search', query: 'factura' }))).toMatchObject({ op: 'search', count: 2 })
    expect(await handlers['imap']?.(step({ op: 'search' }))).toMatchObject({ op: 'search', count: 2 })
    expect(await handlers['imap']?.(step({ op: 'mark' }, { event: { key: 'k', type: 'email', data: { uid: 7 } } }))).toMatchObject({ op: 'mark', uid: 7, done: true })
    expect(await handlers['imap']?.(step({ op: 'flag' }, { input: { uid: 8 } }))).toMatchObject({ op: 'flag', uid: 8 })
    expect(await handlers['imap']?.(step({ op: 'delete' }, { event: { key: 'k', type: 'email', data: { uid: 9 } } }))).toMatchObject({ op: 'delete', mailbox: 'Trash' })
    expect(await handlers['imap']?.(step({ op: 'read' }, { event: { key: 'k', type: 'email', data: { uid: 10 } } }))).toMatchObject({ op: 'read', text: 'cuerpo' })
    await expect(handlers['imap']?.(step({ op: 'mark' }))).rejects.toThrow('needs a message uid')
    await expect(handlers['imap']?.(step({}))).rejects.toThrow('needs a message uid')
    await expect(handlers['imap']?.(step({ op: 'explode' }, { input: { uid: 1 } }))).rejects.toThrow('unknown imap action')
    await expect(createWorkflowHandlers(context({ faberloomRoutines: routines() }))['imap']?.(step({ op: 'mark' }))).rejects.toThrow('inbound receiver is not mounted')
  })

  it('smtp sends through the owner connection', async () => {
    const sendMail = vi.fn(async () => ({ messageId: '<m@x>' }))
    const handlers = createWorkflowHandlers(context({ faberloomRoutines: routines(), faberloomConnections: { sendMail } }))
    expect(await handlers['smtp']?.(step({ to: ['a@b.c'], subject: 'Hola {{input.name}}', template: 'Cuerpo {{input.name}}', connectionId: 'smtp-1' }, { input: { name: 'Ana' } }))).toMatchObject({ handler: 'smtp', subject: 'Hola Ana', messageId: '<m@x>' })
    expect(sendMail).toHaveBeenCalledWith(OWNER, { to: ['a@b.c'], subject: 'Hola Ana', text: 'Cuerpo Ana' }, 'smtp-1')
    await handlers['smtp']?.(step({ to: ['a@b.c'] }))
    expect(sendMail).toHaveBeenLastCalledWith(OWNER, { to: ['a@b.c'], subject: '', text: '' }, undefined)
    await expect(handlers['smtp']?.(step({ to: [] }))).rejects.toThrow('at least one recipient')
    await expect(handlers['smtp']?.(step({ to: 'not-an-array' }))).rejects.toThrow('at least one recipient')
    await expect(createWorkflowHandlers(context({ faberloomRoutines: routines() }))['smtp']?.(step({ to: ['a@b.c'] }))).rejects.toThrow('connections service is not mounted')
  })

  it('memory.remember attaches a memory entry to a Space', async () => {
    const spaces = { remember: vi.fn(async () => ({ id: 'mem-1' })) }
    const handlers = createWorkflowHandlers(context({ faberloomRoutines: routines(), faberloomSpaces: spaces }))
    expect(await handlers['memory.remember']?.(step({ spaceId: 'sp-1', text: 'visto {{event.data.from}}' }, { event: { key: 'k', type: 'email', data: { from: 'a@b' } } }))).toMatchObject({ handler: 'memory.remember', id: 'mem-1' })
    expect(await handlers['memory.remember']?.(step({ spaceId: 'sp-1' }))).toMatchObject({ handler: 'memory.remember' })
    await expect(handlers['memory.remember']?.(step({ text: 'x' }))).rejects.toThrow('needs a spaceId')
    await expect(createWorkflowHandlers(context({ faberloomRoutines: routines() }))['memory.remember']?.(step({ spaceId: 'sp-1', text: 'x' }))).rejects.toThrow('spaces service is not mounted')
  })

  it('memory.teach records a teaching with optional activation', async () => {
    const createTeaching = vi.fn(async () => ({ id: 't-1' }))
    const handlers = createWorkflowHandlers(context({ faberloomRoutines: routines(), faberloomMemory: { createTeaching } }))
    expect(await handlers['memory.teach']?.(step({ scope: 'space', text: 'regla', source: 'caso', active: true }))).toMatchObject({ handler: 'memory.teach', id: 't-1' })
    expect(createTeaching).toHaveBeenLastCalledWith(OWNER, { scope: 'space', text: 'regla', source: 'caso', author: OWNER, active: true })
    await handlers['memory.teach']?.(step({}))
    expect(createTeaching).toHaveBeenLastCalledWith(OWNER, { scope: 'case', text: '', source: 'workflow', author: OWNER })
    await expect(createWorkflowHandlers(context({ faberloomRoutines: routines() }))['memory.teach']?.(step({}))).rejects.toThrow('memory service is not mounted')
  })

  it('board.create opens a board item', async () => {
    const create = vi.fn(async () => ({ id: 'b-1' }))
    const handlers = createWorkflowHandlers(context({ faberloomRoutines: routines(), faberloomBoard: { create } }))
    expect(await handlers['board.create']?.(step({ title: 'Revisar {{input.id}}', summary: 'resumen', spaceId: 'sp-1' }, { input: { id: '7' } }))).toMatchObject({ handler: 'board.create', id: 'b-1' })
    expect(create).toHaveBeenCalledWith(OWNER, expect.objectContaining({ title: 'Revisar 7', summary: 'resumen', spaceId: 'sp-1', executionId: 'e1' }))
    await handlers['board.create']?.(step({ title: 'Sin espacio' }))
    await handlers['board.create']?.(step({}))
    await expect(createWorkflowHandlers(context({ faberloomRoutines: routines() }))['board.create']?.(step({ title: 'x' }))).rejects.toThrow('board service is not mounted')
  })

  it('reference resolves another Space effective context', async () => {
    const spaces = { effectiveContext: vi.fn(async () => ({ resolved: { c: 'v' }, sources: ['sp-2'] })) }
    const handlers = createWorkflowHandlers(context({ faberloomRoutines: routines(), faberloomSpaces: spaces }))
    expect(await handlers['reference']?.(step({ spaceId: 'sp-2' }))).toMatchObject({ handler: 'reference', spaceId: 'sp-2', resolved: { c: 'v' } })
    await expect(handlers['reference']?.(step({}))).rejects.toThrow('needs a spaceId')
    await expect(createWorkflowHandlers(context({ faberloomRoutines: routines() }))['reference']?.(step({ spaceId: 'sp-2' }))).rejects.toThrow('spaces service is not mounted')
  })

  it('subroutine starts another routine idempotently', async () => {
    const handlers = createWorkflowHandlers(context({ faberloomRoutines: routines() }))
    expect(await handlers['subroutine']?.(step({ routineId: 'other' }))).toMatchObject({ handler: 'subroutine', executionId: 'child-1' })
    await expect(handlers['subroutine']?.(step({}))).rejects.toThrow('needs a routineId')
  })

  it('mcp.call enforces the allowlist and calls the schema-driven tool', async () => {
    const execute = vi.fn(async () => ({ isError: false }))
    const allowed = vi.fn(async () => ({ allowed: true, reason: 'OK' }))
    const handlers = createWorkflowHandlers(context({
      faberloomRoutines: routines(),
      faberloomAccess: { check: allowed },
      tools: { execute },
    }))
    expect(await handlers['mcp.call']?.(step({ server: 'mwt', tool: 'get', arguments: { id: 1 } }))).toMatchObject({ handler: 'mcp.call', server: 'mwt', tool: 'get', isError: false })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'mcp__mwt__get', arguments: { id: 1 } }))
    expect(allowed).toHaveBeenCalledWith(expect.objectContaining({ action: 'mcp:mwt:get', ownerId: OWNER }))

    const denied = createWorkflowHandlers(context({ faberloomRoutines: routines(), faberloomAccess: { check: vi.fn(async () => ({ allowed: false, reason: 'NO_GRANT' })) }, tools: { execute } }))
    await expect(denied['mcp.call']?.(step({ server: 'mwt', tool: 'get' }))).rejects.toThrow('is not allowed (NO_GRANT)')
    await expect(denied['mcp.call']?.(step({}))).rejects.toThrow('needs a server and a tool')

    const open = createWorkflowHandlers(context({ faberloomRoutines: routines(), tools: { execute } }))
    expect(await open['mcp.call']?.(step({ server: 'mwt', tool: 'get', arguments: 'raw' }))).toMatchObject({ isError: false })
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ arguments: {} }))

    await expect(createWorkflowHandlers(context({ faberloomRoutines: routines() }))['mcp.call']?.(step({ server: 'mwt', tool: 'get' }))).rejects.toThrow('tools service is not mounted')
  })

  it('notify reaches the owner by email or the board', async () => {
    const sendMail = vi.fn(async () => ({ messageId: '<n@x>' }))
    const create = vi.fn(async () => ({ id: 'b-2' }))
    const handlers = createWorkflowHandlers(context({
      faberloomRoutines: routines(),
      faberloomConnections: { sendMail },
      faberloomBoard: { create },
    }))
    expect(await handlers['notify']?.(step({ kind: 'email', text: 'aviso' }))).toMatchObject({ channel: 'email', messageId: '<n@x>' })
    expect(await handlers['notify']?.(step({ kind: 'board', text: 'aviso' }))).toMatchObject({ channel: 'board', id: 'b-2' })
    await handlers['notify']?.(step({ kind: 'board' }))
    expect(create).toHaveBeenLastCalledWith(OWNER, expect.objectContaining({ title: 'Work Flow' }))
    await handlers['notify']?.(step({}))
    await expect(createWorkflowHandlers(context({ faberloomRoutines: routines(), faberloomBoard: { create } }))['notify']?.(step({ kind: 'email' }))).rejects.toThrow('connections service is not mounted')
    await expect(createWorkflowHandlers(context({ faberloomRoutines: routines() }))['notify']?.(step({ kind: 'board' }))).rejects.toThrow('board service is not mounted')
  })

  it('deadletter routes the failure to the board', async () => {
    const create = vi.fn(async () => ({ id: 'b-3' }))
    const handlers = createWorkflowHandlers(context({ faberloomRoutines: routines(), faberloomBoard: { create } }))
    expect(await handlers['deadletter']?.(step({ reason: 'no {{event.data.why}}' }, { event: { key: 'k', type: 'event', data: { why: 'clasificable' } } }))).toMatchObject({ handler: 'deadletter', id: 'b-3', reason: 'no clasificable' })
    await handlers['deadletter']?.(step({}))
    expect(create).toHaveBeenLastCalledWith(OWNER, expect.objectContaining({ title: 'Dead letter: s1', summary: 'node failed' }))
    await expect(createWorkflowHandlers(context({ faberloomRoutines: routines() }))['deadletter']?.(step({}))).rejects.toThrow('board service is not mounted')
  })
})
