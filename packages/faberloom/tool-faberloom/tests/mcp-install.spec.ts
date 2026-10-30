/**
 * The documentation-driven MCP install tool: it reads a server's documentation,
 * asks for the values only the user can give, proves the connection, and saves
 * the server for the user. Nothing is saved when a value is missing, wrong, or
 * when the documentation describes no reachable server.
 */
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
    name: 'docs',
    transport: { transport: 'stdio', command: 'npx', args: ['-y', '@acme/docs-mcp'], cwd: '' },
    env: [], headers: [], enabled: true, mounted: true, createdAt: 'c', updatedAt: 'u',
    ...overrides,
  }
}

/** A fake MCP registry exposing the methods the install tool calls. */
function fakeRegistry(overrides: Record<string, unknown> = {}) {
  return {
    probe: vi.fn(async () => ({ ok: true, tools: ['mcp__docs__search'] })),
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

/** Realistic standard input documentation: a local program with an environment variable. */
const STDIO_DOCS = [
  '# Acme Docs MCP',
  '',
  'Run the server with:',
  '',
  '    npx -y @acme/docs-mcp',
  '',
  'Set the environment variable ACME_API_KEY to your API key before starting.',
].join('\n')

/** Realistic remote documentation: a URL with a bearer token header. */
const HTTP_DOCS = [
  '## Acme Remote MCP',
  '',
  'Server URL: https://mcp.example.com/mcp',
  '',
  'Send the request header:',
  '',
  '    Authorization: Bearer YOUR_TOKEN',
].join('\n')

describe('faberloom_mcp_install', () => {
  it('registers the documentation-driven install tool', () => {
    const tools = harness()
    expect(tools.has('faberloom_mcp_install')).toBe(true)
    const description = tools.get('faberloom_mcp_install')!.description
    expect(description).toContain('documentation the user handed over')
    expect(description).toContain('never invents a value')
  })

  it('reads a stdio document and reports the environment value as missing when nobody supplies it', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_install')!

    const result = await tool.execute({ documentation: STDIO_DOCS } as never) as Record<string, unknown>

    expect(result).toMatchObject({
      saved: false,
      name: 'docs-mcp',
      transport: 'stdio',
      missing: [{ name: 'ACME_API_KEY', kind: 'environment' }],
    })
    expect(registry.probe).not.toHaveBeenCalled()
    expect(registry.save).not.toHaveBeenCalled()
    const text = render(tool, result)
    expect(text).toContain('Nothing was installed')
    expect(text).toContain('ACME_API_KEY (environment)')
    expect(text).toContain('call this tool again with those values')
  })

  it('installs a stdio server once the supplied value proves the connection', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_install')!

    const result = await tool.execute({
      documentation: STDIO_DOCS,
      values: { ACME_API_KEY: 'user-key-1' },
    } as never) as Record<string, unknown>

    expect(registry.probe).toHaveBeenCalledWith({
      name: 'docs-mcp',
      transport: { transport: 'stdio', command: 'npx', args: ['-y', '@acme/docs-mcp'], cwd: '' },
      env: { ACME_API_KEY: 'user-key-1' },
    })
    expect(registry.save).toHaveBeenCalledWith(OWNER, {
      name: 'docs-mcp',
      transport: { transport: 'stdio', command: 'npx', args: ['-y', '@acme/docs-mcp'], cwd: '' },
      env: { ACME_API_KEY: 'user-key-1' },
    })
    expect(result).toMatchObject({ saved: true, name: 'docs-mcp', scope: 'user', transport: 'stdio', tools: ['mcp__docs__search'] })
    expect(render(tool, result)).toBe(
      'Installed and tested the MCP server "docs-mcp" for this user only; every workspace and Space of yours can use its tools. It offers: mcp__docs__search.',
    )
  })

  it('installs an http server from its URL and bearer token header', async () => {
    const registry = fakeRegistry({ probe: vi.fn(async () => ({ ok: true, tools: [] })) })
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_install')!

    const result = await tool.execute({
      documentation: HTTP_DOCS,
      values: { Authorization: 'Bearer user-token' },
    } as never) as Record<string, unknown>

    expect(registry.probe).toHaveBeenCalledWith({
      name: 'acme-remote-mcp',
      transport: { transport: 'streamable-http', url: 'https://mcp.example.com/mcp' },
      headers: { Authorization: 'Bearer user-token' },
    })
    expect(result).toMatchObject({ saved: true, scope: 'user', transport: 'streamable-http', tools: [] })
    expect(render(tool, result)).toBe(
      'Installed and tested the MCP server "acme-remote-mcp" for this user only; every workspace and Space of yours can use its tools. It offers no tools.',
    )
  })

  it('lets the caller override the derived name and refuses an unusable one', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_install')!

    const result = await tool.execute({
      documentation: STDIO_DOCS, name: 'acme', values: { ACME_API_KEY: 'k' },
    } as never) as Record<string, unknown>
    expect(result).toMatchObject({ saved: true, name: 'acme' })

    registry.probe.mockClear()
    await expect(tool.execute({ documentation: STDIO_DOCS, name: 'bad name' } as never))
      .rejects.toThrow('the server name must be 1 to 32 letters, digits, dashes, or underscores')
    expect(registry.probe).not.toHaveBeenCalled()
  })

  it('asks the user through the question surface for a missing value and installs with the answer', async () => {
    const registry = fakeRegistry()
    const ask = vi.fn(async (_request: unknown) => ({ answers: [{ id: 'ACME_API_KEY', selected: [], custom: 'typed-key' }] }))
    const tools = harness({ faberloomMcpRegistry: registry, userQuestions: { ask } })
    const tool = tools.get('faberloom_mcp_install')!

    const result = await tool.execute({ documentation: STDIO_DOCS } as never) as Record<string, unknown>

    expect(ask).toHaveBeenCalledOnce()
    expect(ask.mock.calls[0]?.[0]).toMatchObject({
      questions: [{ id: 'ACME_API_KEY', question: 'What value should "ACME_API_KEY" have?' }],
    })
    expect(registry.probe).toHaveBeenCalledWith(expect.objectContaining({ env: { ACME_API_KEY: 'typed-key' } }))
    expect(result).toMatchObject({ saved: true, name: 'docs-mcp' })
  })

  it('leaves the value missing when the question surface answers nothing', async () => {
    const registry = fakeRegistry()
    const ask = vi.fn(async () => ({ answers: [{ id: 'ACME_API_KEY', selected: [] }] }))
    const tools = harness({ faberloomMcpRegistry: registry, userQuestions: { ask } })
    const tool = tools.get('faberloom_mcp_install')!

    const result = await tool.execute({ documentation: STDIO_DOCS } as never) as Record<string, unknown>

    expect(result).toMatchObject({ saved: false, missing: [{ name: 'ACME_API_KEY' }] })
    expect(registry.probe).not.toHaveBeenCalled()
  })

  it('leaves the value missing when no answerer accepted the question', async () => {
    const registry = fakeRegistry()
    const ask = vi.fn(async () => { throw new Error('no user-questions answerer accepted the request') })
    const tools = harness({ faberloomMcpRegistry: registry, userQuestions: { ask } })
    const tool = tools.get('faberloom_mcp_install')!

    const result = await tool.execute({ documentation: STDIO_DOCS } as never) as Record<string, unknown>

    expect(result).toMatchObject({ saved: false, missing: [{ name: 'ACME_API_KEY' }] })
    expect(registry.probe).not.toHaveBeenCalled()
  })

  it('reports a rejected value and saves nothing', async () => {
    const registry = fakeRegistry({
      probe: vi.fn(async () => ({ ok: false, failure: 'bad-credential', detail: 'HTTP 401 with [redacted]' })),
    })
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_install')!

    const result = await tool.execute({
      documentation: HTTP_DOCS, values: { Authorization: 'Bearer wrong' },
    } as never) as Record<string, unknown>

    expect(registry.save).not.toHaveBeenCalled()
    expect(result).toMatchObject({ saved: false, failure: 'bad-credential' })
    const text = render(tool, result)
    expect(text).toContain('the server rejected the credentials it was given')
    expect(text).toContain('Nothing was saved.')
    expect(text).not.toContain('Bearer wrong')
  })

  it('refuses documentation that describes no reachable server', async () => {
    const tools = harness({ faberloomMcpRegistry: fakeRegistry() })
    const tool = tools.get('faberloom_mcp_install')!

    const empty = await tool.execute({ documentation: '   ' } as never) as Record<string, unknown>
    expect(empty).toMatchObject({ saved: false, refusal: 'empty' })
    expect(render(tool, empty)).toContain('the documentation is empty')

    const prose = await tool.execute({ documentation: 'Acme is a lovely company.' } as never) as Record<string, unknown>
    expect(prose).toMatchObject({ saved: false, refusal: 'no-transport' })

    const both = await tool.execute({
      documentation: 'Run `npx -y @acme/mcp`\nServer URL: https://mcp.example.com/mcp',
    } as never) as Record<string, unknown>
    expect(both).toMatchObject({ saved: false, refusal: 'ambiguous-transport' })
    expect(render(tool, both)).toContain('names both a local command and a URL')
  })

  it('rejects a supplied value that is not text', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry })
    await expect(tools.get('faberloom_mcp_install')!.execute({
      documentation: STDIO_DOCS, values: { ACME_API_KEY: 5 },
    } as never)).rejects.toThrow('every supplied value must be text; "ACME_API_KEY" is not')
    expect(registry.probe).not.toHaveBeenCalled()
  })

  it('reads the standard mcpServers JSON block', async () => {
    const registry = fakeRegistry()
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_install')!
    const json = JSON.stringify({
      mcpServers: { acme: { command: 'npx', args: ['-y', '@acme/mcp'], env: { ACME_API_KEY: '<your-key>' } } },
    })

    const result = await tool.execute({ documentation: json, values: { ACME_API_KEY: 'k' } } as never) as Record<string, unknown>

    expect(registry.probe).toHaveBeenCalledWith({
      name: 'acme',
      transport: { transport: 'stdio', command: 'npx', args: ['-y', '@acme/mcp'], cwd: '' },
      env: { ACME_API_KEY: 'k' },
    })
    expect(result).toMatchObject({ saved: true, name: 'acme', scope: 'user' })
    expect(tool.presentCall({ documentation: 'x' } as never)).toEqual({
      card: 'generic', title: 'Install MCP server from documentation', kind: 'other', rawInput: {},
    })
  })

  it('refuses to overwrite an installed server unless replace is set, and reinstalls when it is', async () => {
    const registry = fakeRegistry({
      list: vi.fn(async () => [savedServer({ name: 'docs-mcp', transport: { transport: 'stdio', command: 'npx' }, mounted: true })]),
    })
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_install')!

    const refused = await tool.execute({ documentation: STDIO_DOCS, values: { ACME_API_KEY: 'k' } } as never) as Record<string, unknown>
    expect(registry.probe).not.toHaveBeenCalled()
    expect(registry.save).not.toHaveBeenCalled()
    expect(refused).toMatchObject({ saved: false, name: 'docs-mcp', collision: { transport: 'stdio', enabled: true, mounted: true } })
    const text = render(tool, refused)
    expect(text).toContain('a server named "docs-mcp" is already installed')
    expect(text).toContain('already working')
    expect(text).toContain('set replace=true')

    const replaced = await tool.execute({
      documentation: STDIO_DOCS, values: { ACME_API_KEY: 'k' }, replace: true,
    } as never) as Record<string, unknown>
    expect(registry.probe).toHaveBeenCalledOnce()
    expect(registry.save).toHaveBeenCalledOnce()
    expect(replaced).toMatchObject({ saved: true, name: 'docs-mcp' })
  })

  it('installs a second server under a different name and leaves the first alone', async () => {
    const existing = savedServer({ name: 'docs-mcp', mounted: true })
    const registry = fakeRegistry({ list: vi.fn(async () => [existing]) })
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_install')!

    const result = await tool.execute({
      documentation: HTTP_DOCS, name: 'acme-remote', values: { Authorization: 'Bearer t' },
    } as never) as Record<string, unknown>

    expect(result).toMatchObject({ saved: true, name: 'acme-remote' })
    expect(registry.save).toHaveBeenCalledWith(OWNER, {
      name: 'acme-remote',
      transport: { transport: 'streamable-http', url: 'https://mcp.example.com/mcp' },
      headers: { Authorization: 'Bearer t' },
    })
    expect(registry.save).not.toHaveBeenCalledWith(OWNER, expect.objectContaining({ name: 'docs-mcp' }))
  })

  it('reports a collision as unproven when the existing server is installed but not mounted', async () => {
    const registry = fakeRegistry({
      list: vi.fn(async () => [savedServer({ name: 'docs-mcp', mounted: false })]),
    })
    const tools = harness({ faberloomMcpRegistry: registry })
    const tool = tools.get('faberloom_mcp_install')!

    const result = await tool.execute({ documentation: STDIO_DOCS, values: { ACME_API_KEY: 'k' } } as never) as Record<string, unknown>
    expect(render(tool, result)).toContain('installed but not proven')
  })
})
