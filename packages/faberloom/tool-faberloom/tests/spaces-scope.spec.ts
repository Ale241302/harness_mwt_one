import { describe, expect, it, vi } from 'vitest'
import type { SpaceScopeNode } from '@deepseek-ai/dsh-faberloom-session-agent'
import { apply, type Config } from '../src/index.ts'

interface CapturedTool {
  readonly name: string
  readonly execute: (args: never, exec?: never) => Promise<unknown>
  readonly output: { render: (args: never, value: never) => readonly { type: string; text?: string }[] }
  readonly presentCall: (args: never) => unknown
}

const CONFIG: Config = { ownerId: 'owner@test', role: 'client_b2b', companyId: 'co-1', readOnly: false }

/** The Space the session reads after a grant. */
const SONDEL: SpaceScopeNode = {
  id: 'sp-sondel',
  title: 'Sondel',
  parentId: 'sp-costa',
  path: '/home/SD',
  current: false,
  directive: 'Usar el formato mensual.',
  memory: ['usar encabezado institucional'],
  context: [{ key: 'tono', value: 'formal' }],
  entries: [],
  agents: [{ name: 'Sondel', responsibility: 'Reportes', skills: ['docx'] }],
  skills: ['docx'],
  harness: ['AGENTS.md', '.agents/ (README.md)'],
  files: ['AGENTS.md', 'documentos/'],
  instructions: 'Reglas del Space Sondel.',
  children: [],
}

/** The current Space node returned by the scope tool. */
const COSTA: SpaceScopeNode = {
  ...SONDEL,
  id: 'sp-costa',
  title: 'Costa Rica',
  parentId: 'sp-marluvas',
  path: '/home/CR',
  current: true,
  children: [SONDEL],
}

const AGENT = { session: { id: 'session-1' } }
const EXEC = { agent: AGENT, callId: 'call-1', signal: new AbortController().signal }

/** Boot the product tools over a stub registry and capture the definitions. */
function harness(services: Record<string, unknown>, config: Config = CONFIG): Map<string, CapturedTool> {
  const registered = new Map<string, CapturedTool>()
  const ctx = {
    tools: { register: (definition: CapturedTool) => { registered.set(definition.name, definition); return () => {} } },
    get: (name: string) => services[name],
    effect: (callback: () => unknown) => { callback(); return () => {} },
  }
  apply(ctx as never, config)
  return registered
}

/** A fake session-composition service with the scope the test expects. */
function sessionAgent(overrides: Record<string, unknown> = {}) {
  return {
    scopeFor: () => ({ space: COSTA, granted: [], others: [{ id: 'sp-colombia', title: 'Colombia' }], foreign: [], text: 'ÁMBITO COSTA RICA' }),
    coversSpace: () => false,
    describeSpace: async () => SONDEL,
    grantRead: vi.fn(async () => undefined),
    ...overrides,
  }
}

/** The spaces service the read grant validates against. */
const SPACES = { get: vi.fn(async () => ({ id: 'sp-sondel', title: 'Sondel' })) }

describe('faberloom_spaces_scope', () => {
  it('returns the readable tree and the scope text', async () => {
    const tools = harness({ faberloomSessionAgent: sessionAgent() })
    const tool = tools.get('faberloom_spaces_scope')!
    const result = await tool.execute({} as never, EXEC as never) as {
      text: string
      spaces: { id: string; current: boolean; granted: boolean }[]
    }
    expect(result.text).toBe('ÁMBITO COSTA RICA')
    expect(result.spaces).toEqual([
      { id: 'sp-costa', title: 'Costa Rica', parentId: 'sp-marluvas', path: '/home/CR', current: true, granted: false },
      { id: 'sp-sondel', title: 'Sondel', parentId: 'sp-costa', path: '/home/SD', current: false, granted: false },
    ])
    expect(tool.output.render({} as never, result as never)[0]?.text).toBe('ÁMBITO COSTA RICA')
  })

  it('marks granted subtrees and reports a session without a Space', async () => {
    const granted = {
      ...SONDEL,
      id: 'sp-colombia',
      title: 'Colombia',
      path: '/home/CO',
      children: [],
    }
    const tools = harness({
      faberloomSessionAgent: sessionAgent({
        scopeFor: () => ({ space: COSTA, granted: [granted], others: [], foreign: [], text: 'CON COLOMBIA' }),
      }),
    })
    const result = await tools.get('faberloom_spaces_scope')!.execute({} as never, EXEC as never) as {
      spaces: { id: string; granted: boolean }[]
    }
    expect(result.spaces.find(space => space.id === 'sp-colombia')?.granted).toBe(true)

    const empty = harness({ faberloomSessionAgent: sessionAgent({ scopeFor: () => undefined }) })
    const none = await empty.get('faberloom_spaces_scope')!.execute({} as never, EXEC as never) as { text: string; spaces: unknown[] }
    expect(none.text).toContain('no pertenece a ningún Space')
    expect(none.spaces).toEqual([])
  })

  it('fails loud when the session service is not mounted', async () => {
    const tools = harness({})
    await expect(tools.get('faberloom_spaces_scope')!.execute({} as never, EXEC as never))
      .rejects.toThrow('the session agent service is not mounted')
  })
})

describe('faberloom_spaces_open_read', () => {
  it('opens a Space inside the session subtree without asking for approval', async () => {
    const service = sessionAgent({ coversSpace: () => true })
    const approval = { request: vi.fn(async () => 'allowed-once') }
    const tools = harness({
      faberloomSessionAgent: service,
      faberloomSpaces: SPACES,
      approval,
    })
    const result = await tools.get('faberloom_spaces_open_read')!.execute({ id: 'sp-sondel' } as never, EXEC as never) as {
      id: string
      title: string
      path: string
      granted: boolean
      text: string
    }
    expect(approval.request).not.toHaveBeenCalled()
    expect(service.grantRead).not.toHaveBeenCalled()
    expect(result).toMatchObject({ id: 'sp-sondel', title: 'Sondel', path: '/home/SD', granted: false })
    expect(result.text).toContain('Sub Space: Sondel')
    expect(result.text).toContain('usar encabezado institucional')
    expect(result.text).toContain('Reglas del Space Sondel.')
  })

  it('asks the user once and records a read-only grant for a Space outside the subtree', async () => {
    const service = sessionAgent()
    const approval = { request: vi.fn(async (_request: unknown) => 'allowed-once') }
    const tools = harness({
      faberloomSessionAgent: service,
      faberloomSpaces: SPACES,
      approval,
    })
    const result = await tools.get('faberloom_spaces_open_read')!.execute({ id: 'sp-sondel' } as never, EXEC as never) as {
      granted: boolean
    }
    expect(approval.request).toHaveBeenCalledTimes(1)
    const requested = approval.request.mock.calls[0]?.[0] as {
      agent: unknown
      toolName: string
      callId: string
      reason: string
    }
    expect(requested.agent).toBe(AGENT)
    expect(requested.toolName).toBe('faberloom_spaces_open_read')
    expect(requested.callId).toBe('call-1')
    expect(requested.reason).toContain('solo lectura')
    expect(service.grantRead).toHaveBeenCalledWith(AGENT, 'sp-sondel')
    expect(result.granted).toBe(true)
  })

  it('refuses the read when the user rejects the grant', async () => {
    const service = sessionAgent()
    const tools = harness({
      faberloomSessionAgent: service,
      faberloomSpaces: SPACES,
      approval: { request: vi.fn(async () => 'rejected') },
    })
    await expect(tools.get('faberloom_spaces_open_read')!.execute({ id: 'sp-sondel' } as never, EXEC as never))
      .rejects.toThrow('no autorizó la lectura')
    expect(service.grantRead).not.toHaveBeenCalled()
  })

  it('refuses an outside read in a session that does not belong to a Space', async () => {
    const approval = { request: vi.fn(async () => 'allowed-once') }
    const tools = harness({
      faberloomSessionAgent: sessionAgent({ scopeFor: () => undefined }),
      faberloomSpaces: SPACES,
      approval,
    })
    await expect(tools.get('faberloom_spaces_open_read')!.execute({ id: 'sp-sondel' } as never, EXEC as never))
      .rejects.toThrow('no pertenece a un Space')
    expect(approval.request).not.toHaveBeenCalled()
  })

  it('fails closed without an approval channel', async () => {
    const tools = harness({
      faberloomSessionAgent: sessionAgent(),
      faberloomSpaces: SPACES,
    })
    await expect(tools.get('faberloom_spaces_open_read')!.execute({ id: 'sp-sondel' } as never, EXEC as never))
      .rejects.toThrow('no approval channel is mounted')
  })

  it('surfaces the product access denial from the spaces service', async () => {
    const tools = harness({
      faberloomSessionAgent: sessionAgent(),
      faberloomSpaces: { get: vi.fn(async () => { throw new Error('faberloom: space access denied') }) },
      approval: { request: vi.fn(async () => 'allowed-once') },
    })
    await expect(tools.get('faberloom_spaces_open_read')!.execute({ id: 'sp-x' } as never, EXEC as never))
      .rejects.toThrow('space access denied')
  })
})
