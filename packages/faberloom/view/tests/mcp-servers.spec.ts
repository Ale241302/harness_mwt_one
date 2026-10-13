/** The view's MCP server surface: the owner's saved servers, their install, removal, and the candidate test. */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { FaberLoomViewService } from '../src/index.ts'

/** One saved server as the registry returns it, secrets already reduced to references. */
function savedServer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'docs',
    transport: { transport: 'stdio' as const, command: 'npx', args: ['-y', 'server-docs'], cwd: '/tmp' },
    env: [{ name: 'DOCS_TOKEN', credentialRef: 'FABERLOOM_MCP_SECRET_AA_BB_CC', present: true }],
    headers: [],
    enabled: true,
    mounted: true,
    error: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

/** One registry stub with every operation the view calls. */
type RegistryStub = {
  list: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  probe: ReturnType<typeof vi.fn>
}

/** The view over a stubbed registry, plus the registry stub itself. */
function harness(overrides: { readOnly?: boolean; registry?: Partial<RegistryStub>; ownerId?: string; noRegistry?: boolean } = {}) {
  const registry: RegistryStub = {
    list: vi.fn(async () => [savedServer()]),
    save: vi.fn(async () => savedServer()),
    remove: vi.fn(async () => true),
    probe: vi.fn(async () => ({ ok: true, tools: ['mcp__docs__search'] })),
    ...overrides.registry,
  }
  const ctx = {
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => (name === 'faberloomMcpRegistry' && overrides.noRegistry !== true ? registry : undefined),
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, {
    ownerId: overrides.ownerId ?? 'owner@muitowork.com',
    role: 'admin',
    readOnly: overrides.readOnly === true,
  })
  return { view, registry }
}

describe('FaberLoomViewService MCP servers', () => {
  it('lists the owner servers, keeping only each entry name and whether a value is present', async () => {
    const { view, registry } = harness()

    const rows = await view.mcpServers()

    expect(registry.list).toHaveBeenCalledWith('owner@muitowork.com')
    expect(rows).toEqual([{
      name: 'docs',
      transport: 'stdio',
      target: 'npx -y server-docs',
      command: 'npx',
      args: ['-y', 'server-docs'],
      cwd: '/tmp',
      env: [{ name: 'DOCS_TOKEN', present: true }],
      headers: [],
      enabled: true,
      mounted: true,
      error: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    }])
    // The credential reference and any value never cross the Remote boundary.
    const payload = JSON.stringify(rows)
    expect(payload).not.toContain('FABERLOOM_MCP_SECRET')
    expect(payload).not.toContain('credentialRef')
  })

  it('reports a streamable-http server with the entries the seam does not hold', async () => {
    const registry = {
      list: vi.fn(async () => [savedServer({
        name: 'remote',
        transport: { transport: 'streamable-http', url: 'https://mcp.example.com/sse' },
        env: [],
        headers: [{ name: 'Authorization', credentialRef: 'FABERLOOM_MCP_SECRET_DD_EE_FF', present: false }],
        enabled: false,
        mounted: false,
      })]),
    }
    const { view } = harness({ registry })

    const rows = await view.mcpServers()

    expect(rows[0]).toMatchObject({
      name: 'remote',
      transport: 'streamable-http',
      headers: [{ name: 'Authorization', present: false }],
      enabled: false,
      mounted: false,
    })
  })

  it('installs a stdio server on the owner, carrying its secret values to the registry', async () => {
    const { view, registry } = harness()

    const rows = await view.saveMcpServer({
      name: 'docs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'server-docs'],
      cwd: '/tmp',
      env: { DOCS_TOKEN: 'super-secret' },
      enabled: true,
    })

    expect(registry.save).toHaveBeenCalledWith('owner@muitowork.com', {
      name: 'docs',
      transport: { transport: 'stdio', command: 'npx', args: ['-y', 'server-docs'], cwd: '/tmp' },
      env: { DOCS_TOKEN: 'super-secret' },
      enabled: true,
    })
    expect(registry.list).toHaveBeenCalledWith('owner@muitowork.com')
    expect(rows.map(row => row.name)).toEqual(['docs'])
  })

  it('installs a streamable-http server with only the fields its transport carries', async () => {
    const { view, registry } = harness()

    await view.saveMcpServer({ name: 'remote', transport: 'streamable-http', url: 'https://mcp.example.com/sse', headers: { Authorization: 'Bearer x' }, enabled: true })
    await view.saveMcpServer({ name: 'remote', transport: 'streamable-http', url: 'https://mcp.example.com/sse' })

    expect(registry.save).toHaveBeenNthCalledWith(1, 'owner@muitowork.com', {
      name: 'remote',
      transport: { transport: 'streamable-http', url: 'https://mcp.example.com/sse' },
      headers: { Authorization: 'Bearer x' },
      enabled: true,
    })
    // A candidate that names no credential and no enabled flag carries neither.
    expect(registry.save).toHaveBeenNthCalledWith(2, 'owner@muitowork.com', {
      name: 'remote',
      transport: { transport: 'streamable-http', url: 'https://mcp.example.com/sse' },
    })
  })

  it('refuses a candidate whose transport is missing its required field before the registry sees it', async () => {
    const { view, registry } = harness()

    await expect(view.saveMcpServer({ name: 'docs', transport: 'stdio', command: '' })).rejects.toThrow('needs a command')
    await expect(view.saveMcpServer({ name: 'remote', transport: 'streamable-http' })).rejects.toThrow('needs a url')
    await expect(view.probeMcpServer({ name: 'remote', transport: 'streamable-http' })).rejects.toThrow('needs a url')
    expect(registry.save).not.toHaveBeenCalled()
    expect(registry.probe).not.toHaveBeenCalled()
  })

  it('removes one server and returns the refreshed list', async () => {
    const { view, registry } = harness()

    const rows = await view.removeMcpServer('docs')

    expect(registry.remove).toHaveBeenCalledWith('owner@muitowork.com', 'docs')
    expect(rows.map(row => row.name)).toEqual(['docs'])
  })

  it('tests a candidate and passes the verdict through: the tools it found or its named failure', async () => {
    const probe = vi.fn()
      .mockResolvedValueOnce({ ok: true, tools: ['mcp__docs__search', 'mcp__docs__read'] })
      .mockResolvedValueOnce({ ok: false, failure: 'bad-credential', detail: 'HTTP 401 with [redacted]' })
    const { view } = harness({ registry: { probe } })

    await expect(view.probeMcpServer({ name: 'docs', transport: 'stdio', command: 'npx', env: { DOCS_TOKEN: 'x' } }))
      .resolves.toEqual({ ok: true, tools: ['mcp__docs__search', 'mcp__docs__read'] })
    await expect(view.probeMcpServer({ name: 'docs', transport: 'stdio', command: 'npx' }))
      .resolves.toEqual({ ok: false, failure: 'bad-credential', detail: 'HTTP 401 with [redacted]' })
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('refuses install and removal for a read-only identity', async () => {
    const { view, registry } = harness({ readOnly: true })

    await expect(view.saveMcpServer({ name: 'docs', transport: 'stdio', command: 'npx' })).rejects.toThrow('read-only')
    await expect(view.removeMcpServer('docs')).rejects.toThrow('read-only')
    expect(registry.save).not.toHaveBeenCalled()
    expect(registry.remove).not.toHaveBeenCalled()
  })

  it('fails loud when the deployment mounted no MCP server registry', async () => {
    const { view } = harness({ noRegistry: true })

    await expect(view.mcpServers()).rejects.toThrow('MCP server registry is not mounted')
  })

  it('treats an unnamed owner as the anonymous identity', async () => {
    const { view, registry } = harness({ ownerId: '' })

    await view.mcpServers()

    expect(registry.list).toHaveBeenCalledWith('anonymous')
  })
})
