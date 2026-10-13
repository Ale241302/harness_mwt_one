import { describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'

interface CapturedTool {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly execute: (args: never, exec?: never) => Promise<unknown>
  readonly output: { render: (args: never, value: never) => readonly { type: string; text?: string }[] }
  readonly presentCall: (args: never) => unknown
}

/** Boot the product tools over a stub registry and capture the definitions. */
function harness(services: Record<string, unknown> = {}, config: Config = CONFIG): Map<string, CapturedTool> {
  const registered = new Map<string, CapturedTool>()
  const ctx = {
    tools: { register: (definition: CapturedTool) => { registered.set(definition.name, definition); return () => {} } },
    get: (name: string) => services[name],
    effect: (callback: () => unknown) => { callback(); return () => {} },
  }
  apply(ctx as never, config)
  return registered
}

const OWNER = 'compras2@sondelsa.com'
const CONFIG: Config = { ownerId: OWNER, role: 'client_b2b', companyId: 'co-sondel', readOnly: false }

const render = (tool: CapturedTool, value: Record<string, unknown>): string =>
  tool.output.render({} as never, value as never)[0]?.text ?? ''

/** One server as the registry reads it back; no field carries a secret value. */
function savedServer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'github',
    transport: { transport: 'stdio', command: 'npx', args: ['-y', 'server-github'], cwd: '' },
    env: [], headers: [], enabled: true, mounted: true, error: null, createdAt: 'c', updatedAt: 'u',
    ...overrides,
  }
}

/** A fake MCP registry exposing the methods the tools call. */
function fakeRegistry(overrides: Record<string, unknown> = {}) {
  return {
    probe: vi.fn(async () => ({ ok: true, tools: ['mcp__github__list_repos'] })),
    save: vi.fn(async (_owner: string, input: Record<string, unknown>) => savedServer({
      name: input['name'],
      transport: input['transport'],
      enabled: input['enabled'] ?? true,
    })),
    list: vi.fn(async () => [] as unknown[]),
    remove: vi.fn(async () => true),
    ...overrides,
  }
}

const STDIO = { name: 'github', transport: { transport: 'stdio', command: 'npx', args: ['-y', 'server-github'] } }
const HTTP = { name: 'x', transport: { transport: 'streamable-http', url: 'https://api.example.com/mcp' } }

describe('faberloom mcp tools', () => {
  it('registers the add, list, and remove tools', () => {
    const tools = harness()
    expect([...tools.keys()]).toEqual(expect.arrayContaining(['faberloom_mcp_add', 'faberloom_mcp_list', 'faberloom_mcp_remove']))
    expect(tools.get('faberloom_mcp_add')!.description).toContain('prove the server works')
    expect(tools.get('faberloom_mcp_list')!.description).toContain('No credential value is ever returned')
    expect(tools.get('faberloom_mcp_remove')!.description).toContain('forget its saved credentials')
  })

  it('probes a candidate before saving it and reports the tools it found', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_add')!

    const result = await tool.execute(STDIO as never) as Record<string, unknown>

    expect(registry.probe).toHaveBeenCalledWith(STDIO)
    expect(registry.save).toHaveBeenCalledWith(OWNER, STDIO)
    expect(registry.probe.mock.invocationCallOrder[0]).toBeLessThan(registry.save.mock.invocationCallOrder[0]!)
    expect(result).toEqual({ saved: true, name: 'github', transport: 'stdio', tools: ['mcp__github__list_repos'] })
    expect(render(tool, result)).toBe('Installed the MCP server "github". It offers: mcp__github__list_repos. Every workspace and Space of this user can use them now.')
  })

  it('reports an installed server that offers no tools', async () => {
    const registry = fakeRegistry({ probe: vi.fn(async () => ({ ok: true, tools: [] })) })
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_add')!

    const result = await tool.execute(STDIO as never) as Record<string, unknown>

    expect(render(tool, result)).toBe('Installed the MCP server "github". It offers no tools.')
  })

  it('reports a failed probe and saves nothing', async () => {
    const registry = fakeRegistry({ probe: vi.fn(async () => ({ ok: false, failure: 'unreachable', detail: 'connect ECONNREFUSED 127.0.0.1:3000' })) })
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_add')!

    const result = await tool.execute(STDIO as never) as Record<string, unknown>

    expect(registry.save).not.toHaveBeenCalled()
    expect(result).toMatchObject({ saved: false, failure: 'unreachable', detail: 'connect ECONNREFUSED 127.0.0.1:3000', tools: [] })
    const text = render(tool, result)
    expect(text).toContain('The MCP server "github" was not installed: the server could not be reached.')
    expect(text).toContain('The server said: connect ECONNREFUSED 127.0.0.1:3000')
    expect(text).toContain('Nothing was saved.')
  })

  it('names the credential and protocol probe failures', async () => {
    for (const [failure, phrase] of [['bad-credential', 'rejected the credentials it was given'], ['protocol', 'did not answer as an MCP server']] as const) {
      const registry = fakeRegistry({ probe: vi.fn(async () => ({ ok: false, failure, detail: 'no' })) })
      const tools = harness({ faberloomMcpRegistry: registry })
      const tool = tools.get('faberloom_mcp_add')!

      const result = await tool.execute(HTTP as never) as Record<string, unknown>

      expect(registry.save).not.toHaveBeenCalled()
      expect(render(tool, result)).toContain(phrase)
    }
  })

  it('passes environment values, headers, and the enabled flag through and redacts the call card', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_add')!
    const input = {
      name: 'weather',
      transport: { transport: 'streamable-http', url: 'https://api.example.com/mcp' },
      env: { WEATHER_KEY: 'env-secret' },
      headers: { Authorization: 'Bearer header-secret' },
      enabled: false,
    }

    const result = await tool.execute(input as never) as Record<string, unknown>

    expect(registry.probe).toHaveBeenCalledWith(input)
    expect(registry.save).toHaveBeenCalledWith(OWNER, input)
    expect(result).toMatchObject({ saved: true, name: 'weather', transport: 'streamable-http' })
    expect(tool.presentCall(input as never)).toEqual({ card: 'generic', title: 'Install MCP server weather', kind: 'other', rawInput: { name: 'weather' } })
  })

  it('refuses a name that cannot label a server before connecting', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry })

    await expect(tools.get('faberloom_mcp_add')!.execute({ ...HTTP, name: 'bad name' } as never))
      .rejects.toThrow('the server name must be 1 to 32 letters, digits, dashes, or underscores')
    expect(registry.probe).not.toHaveBeenCalled()
    expect(registry.save).not.toHaveBeenCalled()
  })

  it('rejects a transport that matches no accepted branch', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_add')!

    await expect(tool.execute({ name: 'x', transport: { transport: 'stdio' } } as never)).rejects.toThrow('invalid arguments')
    await expect(tool.execute({ name: 'x', transport: { transport: 'websocket', url: 'https://x/mcp' } } as never)).rejects.toThrow('invalid arguments')
    await expect(tool.execute({ name: 'x' } as never)).rejects.toThrow('invalid arguments')
    expect(registry.probe).not.toHaveBeenCalled()
  })

  it('refuses a local program with no command', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry })

    await expect(tools.get('faberloom_mcp_add')!.execute({ name: 'x', transport: { transport: 'stdio', command: '' } } as never))
      .rejects.toThrow('the program to run must not be empty')
    expect(registry.probe).not.toHaveBeenCalled()
  })

  it('refuses an address that is not a full http or https URL', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_add')!

    await expect(tool.execute({ name: 'x', transport: { transport: 'streamable-http', url: 'ftp://x/mcp' } } as never))
      .rejects.toThrow('the address must be a full http or https URL')
    await expect(tool.execute({ name: 'x', transport: { transport: 'streamable-http', url: 'not-a-url' } } as never))
      .rejects.toThrow('the address must be a full http or https URL')
    expect(registry.probe).not.toHaveBeenCalled()
  })

  it('refuses a secret value that is not text', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry })

    await expect(tools.get('faberloom_mcp_add')!.execute({ ...HTTP, env: { TOKEN: 5 } } as never))
      .rejects.toThrow('every env value must be text; "TOKEN" is not')
    expect(registry.probe).not.toHaveBeenCalled()
    expect(registry.save).not.toHaveBeenCalled()
  })

  it('renders a failure with no server detail', () => {
    const tools = harness()
    const tool = tools.get('faberloom_mcp_add')!

    expect(render(tool, { saved: false, name: 'x', transport: 'stdio', tools: [], failure: 'unreachable' }))
      .toBe('The MCP server "x" was not installed: the server could not be reached. Nothing was saved.')
  })

  it('renders an unnamed failure with an empty detail', () => {
    const tools = harness()
    const tool = tools.get('faberloom_mcp_add')!

    expect(render(tool, { saved: false, name: 'x', transport: 'stdio', tools: [], failure: 'other', detail: '' }))
      .toBe('The MCP server "x" was not installed: the connection failed. Nothing was saved.')
  })

  it('lists every server with its transport, availability, and credential presence only', async () => {
    const servers = [
      savedServer({
        name: 'github',
        env: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', credentialRef: 'ref-a', present: true }],
      }),
      savedServer({
        name: 'weather',
        transport: { transport: 'streamable-http', url: 'https://api.example.com/mcp' },
        headers: [{ name: 'Authorization', credentialRef: 'ref-b', present: false }],
        enabled: false,
        mounted: false,
      }),
      savedServer({
        name: 'notes',
        transport: { transport: 'stdio', command: 'notes-mcp', args: [], cwd: '/tmp' },
        mounted: false,
      }),
    ]
    const registry = fakeRegistry({ list: vi.fn(async () => servers) })
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_list')!

    const result = await tool.execute({} as never) as { servers: Record<string, unknown>[] }

    expect(registry.list).toHaveBeenCalledWith(OWNER)
    expect(result.servers).toEqual([
      { name: 'github', transport: 'stdio', target: 'npx -y server-github', enabled: true, mounted: true, credentials: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', kind: 'environment', present: true }] },
      { name: 'weather', transport: 'streamable-http', target: 'https://api.example.com/mcp', enabled: false, mounted: false, credentials: [{ name: 'Authorization', kind: 'header', present: false }] },
      { name: 'notes', transport: 'stdio', target: 'notes-mcp', enabled: true, mounted: false, credentials: [] },
    ])
    expect(JSON.stringify(result)).not.toContain('credentialRef')
    const text = render(tool, result)
    expect(text).toContain('3 MCP servers for this user, available in every workspace and Space:')
    expect(text).toContain('- github (stdio: npx -y server-github), enabled, proven, and available; credentials: GITHUB_PERSONAL_ACCESS_TOKEN (environment) present')
    expect(text).toContain('- weather (streamable-http: https://api.example.com/mcp), disabled; credentials: Authorization (header) missing')
    expect(text).toContain('- notes (stdio: notes-mcp), saved but not proven yet; no saved credentials')
    expect(tool.presentCall({} as never)).toEqual({ card: 'generic', title: 'List MCP servers', kind: 'other' })
  })

  it('reports no installed servers', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_list')!

    const result = await tool.execute({} as never) as Record<string, unknown>

    expect(render(tool, result)).toBe('No MCP servers are installed.')
  })

  it('renders a single installed server with a singular heading', async () => {
    const registry = fakeRegistry({ list: vi.fn(async () => [savedServer()]) })
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_list')!

    const result = await tool.execute({} as never) as Record<string, unknown>

    expect(render(tool, result)).toContain('1 MCP server for this user, available in every workspace and Space:')
  })

  it('carries one server\'s failure reason without hiding the others', async () => {
    const registry = fakeRegistry({
      list: vi.fn(async () => [
        savedServer({ name: 'broken', mounted: false, error: 'the credential is not configured' }),
        savedServer({ name: 'fine' }),
      ]),
    })
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_list')!

    const result = await tool.execute({} as never) as { servers: readonly Record<string, unknown>[] }

    expect(result.servers.map(server => server['error'])).toEqual(['the credential is not configured', undefined])
    const text = render(tool, result)
    expect(text).toContain('- broken (stdio: npx -y server-github), saved but not proven yet;')
    expect(text).toContain('last mount error: the credential is not configured')
    expect(text).toContain('- fine (stdio: npx -y server-github), enabled, proven, and available;')
  })

  it('removes an installed server and reports a missing one', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_remove')!

    const removed = await tool.execute({ name: 'github' } as never) as Record<string, unknown>
    expect(registry.remove).toHaveBeenCalledWith(OWNER, 'github')
    expect(removed).toEqual({ name: 'github', removed: true })
    expect(render(tool, removed)).toBe('Removed the MCP server "github" and forgot its saved credentials.')
    expect(tool.presentCall({ name: 'github' } as never)).toMatchObject({ title: 'Remove MCP server github' })

    registry.remove.mockResolvedValueOnce(false)
    const missing = await tool.execute({ name: 'ghost' } as never) as Record<string, unknown>
    expect(render(tool, missing)).toBe('No MCP server named "ghost" is installed.')
  })

  it('fails loud when the MCP registry is not mounted', async () => {
    const tools = harness()
    await expect(tools.get('faberloom_mcp_add')!.execute(STDIO as never)).rejects.toThrow('the MCP registry service is not mounted')
    await expect(tools.get('faberloom_mcp_list')!.execute({} as never)).rejects.toThrow('the MCP registry service is not mounted')
    await expect(tools.get('faberloom_mcp_remove')!.execute({ name: 'x' } as never)).rejects.toThrow('the MCP registry service is not mounted')
  })

  it('registers the schemas without an injected identity and refuses a call that runs without one', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry }, {})

    expect(tools.get('faberloom_mcp_add')).toBeDefined()
    expect(tools.get('faberloom_mcp_list')).toBeDefined()
    expect(tools.get('faberloom_mcp_remove')).toBeDefined()
    await expect(tools.get('faberloom_mcp_add')!.execute(STDIO as never)).rejects.toThrow('no authenticated identity')
    expect(registry.probe).not.toHaveBeenCalled()
  })
})
