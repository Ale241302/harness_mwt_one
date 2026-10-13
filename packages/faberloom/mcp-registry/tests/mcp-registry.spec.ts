/**
 * Behavior of the MCP registry: the durable per-owner round-trip, the
 * credential-seam secret rule, the install probe against real HTTP endpoints,
 * and the process-global mount/unmount that makes a server's tools available
 * without a restart.
 */

import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import * as McpRegistry from '../src/index.ts'
import type { Config, FaberLoomMcpRegistry, McpServerInput } from '../src/index.ts'
const { mcpSecretCredentialRef } = McpRegistry
import type { McpServerRecord } from '../src/spec.ts'
import { closedEndpoint, closeFixtures, startMcpFixture, startRawFixture } from './mock-server.ts'

/** Value every leak assertion looks for; a marker, never a real secret. */
const TOKEN = 'fixture-secret-marker-9c1'

/** Fixed timestamps seeded into boot records. */
const CREATED = '2026-01-01T00:00:00.000Z'
const UPDATED = '2026-01-02T00:00:00.000Z'

/** The real stdio MCP fixture, run as a child process by the installed Node. */
const STDIO_SERVER = fileURLToPath(new URL('./stdio-fixture-server.ts', import.meta.url))

/** The package directory the child runs in, so it resolves the SDK from node_modules. */
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))

/** The token the stdio fixture requires in its environment. */
const STDIO_TOKEN = 'expected-token'

/** One stdio candidate pointed at the real fixture. */
function stdioFixture(name: string, token: string): McpServerInput {
  return {
    name,
    transport: { transport: 'stdio', command: process.execPath, args: [STDIO_SERVER], cwd: PACKAGE_DIR },
    env: { FIXTURE_TOKEN: token },
  }
}

afterEach(closeFixtures)

/** Boot the storage/domain composition, the tool registry, and the MCP registry. */
async function harness(options: {
  credentials?: boolean
  secrets?: Readonly<Record<string, string>>
  config?: Config
  seed?: readonly McpServerRecord[]
} = {}): Promise<{ ctx: Context; registry: FaberLoomMcpRegistry; fiber: Fiber; pool: MemoryMediaPool }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const pool = new MemoryMediaPool()
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (options.credentials !== false) await ctx.plugin(MemoryCredentials, options.secrets ?? {})
  if (options.seed !== undefined) {
    pool.media.set('faberloom_mcp_registry', {
      tables: new Map([['servers', new Map(options.seed.map(record => [`${record.ownerId}\u0000${record.name}`, record]))]]),
      global: null,
    })
  }
  const fiber = await ctx.plugin(McpRegistry, options.config ?? {})
  return { ctx, registry: ctx.faberloomMcpRegistry, fiber, pool }
}

/** Read one raw durable record, asserting it exists. */
function storedRecord(pool: MemoryMediaPool, ownerId: string, name: string): McpServerRecord {
  const record = pool.media.get('faberloom_mcp_registry')?.tables.get('servers')?.get(`${ownerId}\u0000${name}`)
  if (record === undefined) throw new Error(`no stored server ${ownerId}/${name}`)
  return record as McpServerRecord
}

/** The tool names the global registry exposes. */
function globalToolNames(ctx: Context): string[] {
  return ctx.tools.schemas().map(tool => tool.name)
}

/** A stdio input with no secret values. */
function stdioInput(name: string, overrides: Partial<McpServerInput> = {}): McpServerInput {
  return { name, transport: { transport: 'stdio', command: 'npx' }, ...overrides }
}

describe('durable configuration', () => {
  it("round-trips one owner's server and keeps the secret only in the seam", async () => {
    const { ctx, registry, pool } = await harness()
    const saved = await registry.save('a@x', {
      name: 'github',
      transport: { transport: 'stdio', command: 'npx', args: ['-y', 'server-github'], cwd: '/srv' },
      env: { GITHUB_TOKEN: TOKEN },
      headers: { 'X-Trace': 'trace-1' },
      enabled: false,
    })

    expect(saved).toMatchObject({ name: 'github', enabled: false, mounted: false })
    expect(saved.transport).toEqual({ transport: 'stdio', command: 'npx', args: ['-y', 'server-github'], cwd: '/srv' })
    expect(saved.env).toEqual([{
      name: 'GITHUB_TOKEN',
      credentialRef: mcpSecretCredentialRef('a@x', 'github', 'GITHUB_TOKEN'),
      present: true,
    }])
    expect(saved.headers).toEqual([{
      name: 'X-Trace',
      credentialRef: mcpSecretCredentialRef('a@x', 'github', 'X-Trace'),
      present: true,
    }])
    expect(JSON.stringify(saved)).not.toContain(TOKEN)

    const raw = storedRecord(pool, 'a@x', 'github')
    expect(JSON.stringify(raw)).not.toContain(TOKEN)
    expect(raw.env).toEqual([{ name: 'GITHUB_TOKEN', credentialRef: mcpSecretCredentialRef('a@x', 'github', 'GITHUB_TOKEN') }])
    expect(raw.headers).toEqual([{ name: 'X-Trace', credentialRef: mcpSecretCredentialRef('a@x', 'github', 'X-Trace') }])
    expect(await ctx.credentials.resolve(mcpSecretCredentialRef('a@x', 'github', 'GITHUB_TOKEN'))).toMatchObject({ value: TOKEN })

    expect(isCredentialRefName(mcpSecretCredentialRef('a@x', 'github', 'GITHUB_TOKEN'))).toBe(true)
    expect(mcpSecretCredentialRef('a@x', 'github', 'GITHUB_TOKEN')).not.toBe(mcpSecretCredentialRef('a@x', 'github', 'OTHER'))
    expect(mcpSecretCredentialRef('a@x', 'github', 'GITHUB_TOKEN')).not.toBe(mcpSecretCredentialRef('b@x', 'github', 'GITHUB_TOKEN'))
  })

  it('lists per owner and upserts while keeping the creation instant and the omitted entries', async () => {
    const { registry } = await harness()
    const first = await registry.save('a@x', stdioInput('github', { env: { GITHUB_TOKEN: TOKEN }, enabled: false }))
    await registry.save('b@x', stdioInput('gitlab', { enabled: false }))

    expect((await registry.list('a@x')).map(server => server.name)).toEqual(['github'])
    expect((await registry.list('b@x')).map(server => server.name)).toEqual(['gitlab'])
    expect(await registry.list('c@x')).toEqual([])

    const second = await registry.save('a@x', stdioInput('github'))
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.transport).toEqual({ transport: 'stdio', command: 'npx', args: [], cwd: '' })
    expect(second.env).toEqual(first.env)
    expect(second.enabled).toBe(false)
  })

  it("sorts one owner's servers by name", async () => {
    const { registry } = await harness()
    await registry.save('a@x', stdioInput('zeta', { enabled: false }))
    await registry.save('a@x', stdioInput('alpha', { enabled: false }))
    expect((await registry.list('a@x')).map(server => server.name)).toEqual(['alpha', 'zeta'])
  })

  it('drops the stored credential of an entry a save removes, and of every entry on remove', async () => {
    const { ctx, registry } = await harness()
    await registry.save('a@x', stdioInput('gh', { env: { KEEP: 'kept', DROP: 'dropped' }, enabled: false }))
    await registry.save('a@x', stdioInput('gh', { env: { KEEP: 'kept' } }))

    expect(await ctx.credentials.describe(mcpSecretCredentialRef('a@x', 'gh', 'DROP')))
      .toMatchObject({ configured: false })
    expect(await ctx.credentials.resolve(mcpSecretCredentialRef('a@x', 'gh', 'KEEP')))
      .toMatchObject({ value: 'kept' })

    await registry.save('a@x', stdioInput('gh', { env: {} }))
    expect((await registry.list('a@x'))[0]?.env).toEqual([])
    expect(await ctx.credentials.describe(mcpSecretCredentialRef('a@x', 'gh', 'KEEP')))
      .toMatchObject({ configured: false })
  })

  it('removes one server, its record, and its credentials', async () => {
    const { ctx, registry } = await harness()
    await registry.save('a@x', stdioInput('gh', { enabled: false, env: { TOKEN } }))
    expect(await registry.remove('a@x', 'gh')).toBe(true)
    expect(await registry.remove('a@x', 'gh')).toBe(false)
    expect(await registry.list('a@x')).toEqual([])
    expect(await ctx.credentials.describe(mcpSecretCredentialRef('a@x', 'gh', 'TOKEN')))
      .toMatchObject({ configured: false })
  })

  it('reports an entry as absent when the composition mounts no credential seam', async () => {
    const reference = mcpSecretCredentialRef('a@x', 'gh', 'TOKEN')
    const seed: McpServerRecord = {
      ownerId: 'a@x',
      name: 'gh',
      transport: { transport: 'streamable-http', url: 'http://127.0.0.1:9/mcp' },
      env: [{ name: 'TOKEN', credentialRef: reference }],
      headers: [],
      enabled: true,
      createdAt: CREATED,
      updatedAt: UPDATED,
    }
    const { registry } = await harness({ credentials: false, seed: [seed] })
    expect((await registry.list('a@x'))[0]?.env).toEqual([{ name: 'TOKEN', credentialRef: reference, present: false }])
    // Removing the record drops its references without a seam to unset.
    expect(await registry.remove('a@x', 'gh')).toBe(true)
  })

  it('rejects a secret a composition without a credential seam cannot store', async () => {
    const { registry } = await harness({ credentials: false })
    await expect(registry.save('a@x', stdioInput('gh', { env: { TOKEN } }))).rejects
      .toThrow('no credential service is mounted')
    expect(await registry.save('a@x', stdioInput('gh', { enabled: false }))).toMatchObject({ env: [] })
  })

  it('rejects unusable input at the caller boundary', async () => {
    const { registry } = await harness()
    await expect(registry.save('a@x', stdioInput('bad name!'))).rejects.toThrow('must match')
    await expect(registry.save('a@x', { name: 'ok', transport: { transport: 'stdio', command: '' } })).rejects
      .toThrow('non-empty command')
    await expect(registry.save('a@x', { name: 'ok', transport: { transport: 'streamable-http', url: 'not a url' } })).rejects
      .toThrow('absolute HTTP(S) URL')
    await expect(registry.save('a@x', { name: 'ok', transport: { transport: 'streamable-http', url: 'ftp://host/mcp' } })).rejects
      .toThrow('absolute HTTP(S) URL')
    await expect(registry.save('a@x', {
      name: 'ok',
      transport: { transport: 'streamable-http', url: 'https://host/mcp' },
      enabled: false,
    })).resolves.toMatchObject({ transport: { transport: 'streamable-http', url: 'https://host/mcp' } })
    await expect(registry.save('a@x', stdioInput('ok', { env: { 'A=B': 'v' } }))).rejects.toThrow('environment entry')
    await expect(registry.save('a@x', stdioInput('ok', { env: { A: '\0' } }))).rejects.toThrow('environment entry')
    await expect(registry.save('a@x', stdioInput('ok', { headers: { 'bad header': 'v' } }))).rejects.toThrow('header entry')
    await expect(registry.probe({ name: 'bad name!', transport: { transport: 'stdio', command: 'x' } })).rejects
      .toThrow('must match')
  })
})

describe('process-global mounting', () => {
  it('mounts a saved server globally, unmounts it on remove, and reports the disabled one unmounted', async () => {
    const fixture = await startMcpFixture()
    const { ctx, registry } = await harness()

    const saved = await registry.save('a@x', { name: 'mock', transport: { transport: 'streamable-http', url: fixture.url } })
    expect(saved).toMatchObject({ enabled: true, mounted: true })
    expect(globalToolNames(ctx)).toContain('mcp__mock__ping')

    const off = await registry.save('a@x', stdioInput('off', { enabled: false }))
    expect(off.mounted).toBe(false)
    expect(globalToolNames(ctx)).not.toContain('mcp__off__ping')
    expect(await registry.remove('a@x', 'off')).toBe(true)

    expect(await registry.remove('a@x', 'mock')).toBe(true)
    expect(globalToolNames(ctx)).not.toContain('mcp__mock__ping')
  })

  it('mounts a server whose secret resolves from the credential seam', async () => {
    const fixture = await startMcpFixture()
    const reference = mcpSecretCredentialRef('a@x', 'mock', 'TOKEN')
    const { registry } = await harness({ secrets: { [reference]: TOKEN } })
    const saved = await registry.save('a@x', {
      name: 'mock',
      transport: { transport: 'streamable-http', url: fixture.url },
      env: { TOKEN },
    })
    expect(saved).toMatchObject({ mounted: true, enabled: true })
    expect(saved.env).toEqual([{ name: 'TOKEN', credentialRef: reference, present: true }])
  })

  it('mounts every enabled saved server at boot and skips the disabled one', async () => {
    const fixture = await startMcpFixture()
    const reference = mcpSecretCredentialRef('a@x', 'secure', 'TOKEN')
    const records: McpServerRecord[] = [
      {
        ownerId: 'a@x', name: 'boot', transport: { transport: 'streamable-http', url: fixture.url },
        env: [], headers: [], enabled: true, createdAt: CREATED, updatedAt: UPDATED,
      },
      {
        ownerId: 'a@x', name: 'secure', transport: { transport: 'streamable-http', url: fixture.url },
        env: [{ name: 'TOKEN', credentialRef: reference }], headers: [], enabled: true, createdAt: CREATED, updatedAt: UPDATED,
      },
      {
        ownerId: 'a@x', name: 'off', transport: { transport: 'streamable-http', url: fixture.url },
        env: [], headers: [], enabled: false, createdAt: CREATED, updatedAt: UPDATED,
      },
      {
        ownerId: 'a@x', name: 'broken',
        transport: { transport: 'streamable-http', url: fixture.url },
        env: [{ name: 'TOKEN', credentialRef: mcpSecretCredentialRef('a@x', 'broken', 'TOKEN') }],
        headers: [], enabled: true, createdAt: CREATED, updatedAt: UPDATED,
      },
    ]
    const { ctx, registry } = await harness({ seed: records, secrets: { [reference]: TOKEN } })

    const names = globalToolNames(ctx)
    // `broken` declares an unconfigured credential, so its mount fails and is
    // logged; the seam stays the whole truth and the record is reported unmounted.
    expect(names).toContain('mcp__boot__ping')
    expect(names).not.toContain('mcp__off__ping')
    const listed = await registry.list('a@x')
    expect(listed.map(server => [server.name, server.mounted])).toEqual([
      ['boot', true], ['broken', false], ['off', false], ['secure', true],
    ])
    expect(listed.find(server => server.name === 'secure')?.env).toEqual([{ name: 'TOKEN', credentialRef: reference, present: true }])
    expect(listed.find(server => server.name === 'broken')?.env).toEqual([
      { name: 'TOKEN', credentialRef: mcpSecretCredentialRef('a@x', 'broken', 'TOKEN'), present: false },
    ])
  })

  it('fails loud when two owners claim one global server namespace', async () => {
    const fixture = await startMcpFixture()
    const { registry } = await harness()
    const input: McpServerInput = { name: 'dup', transport: { transport: 'streamable-http', url: fixture.url } }
    await registry.save('a@x', input)
    await expect(registry.save('b@x', input)).rejects.toThrow('already in use')
    expect((await registry.list('a@x'))[0]).toMatchObject({ mounted: true })
    expect((await registry.list('b@x'))[0]).toMatchObject({ mounted: false })
  })

  it('disposes a mounted server when the registry fiber unloads', async () => {
    const fixture = await startMcpFixture()
    const { ctx, registry, fiber } = await harness()
    await registry.save('a@x', { name: 'mock', transport: { transport: 'streamable-http', url: fixture.url } })
    expect(globalToolNames(ctx)).toContain('mcp__mock__ping')

    await fiber.dispose()
    expect(globalToolNames(ctx)).not.toContain('mcp__mock__ping')
  })

  it('disposes a registry that mounted nothing', async () => {
    const { registry, fiber } = await harness()
    await registry.save('a@x', stdioInput('off', { enabled: false }))
    await fiber.dispose()
  })
})

describe('probe', () => {
  it('connects to a live server, lists its tools, and leaves no global tool behind', async () => {
    const fixture = await startMcpFixture()
    const { ctx, registry } = await harness()
    expect(await registry.probe({ name: 'mock', transport: { transport: 'streamable-http', url: fixture.url } }))
      .toEqual({ ok: true, tools: ['mcp__mock__ping'] })
    expect(globalToolNames(ctx)).not.toContain('mcp__mock__ping')
  })

  it('reports bad-credential when the server rejects the header, with the secret redacted', async () => {
    const fixture = await startMcpFixture('Bearer good')
    const { registry } = await harness()
    const result = await registry.probe({
      name: 'mock',
      transport: { transport: 'streamable-http', url: fixture.url },
      env: { AUX: 'aux-1' },
      headers: { Authorization: 'Bearer bad' },
    })
    expect(result).toMatchObject({ ok: false, failure: 'bad-credential' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.detail).not.toContain('Bearer bad')
      expect(result.detail).toContain('401')
    }
  })

  it('reports unreachable when nothing listens', async () => {
    const { registry } = await harness()
    const result = await registry.probe({ name: 'mock', transport: { transport: 'streamable-http', url: await closedEndpoint() } })
    expect(result).toMatchObject({ ok: false, failure: 'unreachable' })
  })

  it('reports protocol when the endpoint errors or answers a non-MCP body', async () => {
    const failing = await startRawFixture((_request, response) => {
      response.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"boom"}')
    })
    const garbage = await startRawFixture((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end('not a JSON-RPC response')
    })
    const { registry } = await harness()
    expect(await registry.probe({
      name: 'mock',
      transport: { transport: 'streamable-http', url: failing.url },
      headers: { 'X-Empty': '' },
    })).toMatchObject({ ok: false, failure: 'protocol' })
    expect(await registry.probe({ name: 'mock', transport: { transport: 'streamable-http', url: garbage.url } }))
      .toMatchObject({ ok: false, failure: 'protocol' })
  })

  it('reports unreachable when the server never answers within the configured timeout', async () => {
    const hanging = await startRawFixture()
    const { registry } = await harness({ config: { probeTimeoutMs: 200 } })
    const result = await registry.probe({ name: 'mock', transport: { transport: 'streamable-http', url: hanging.url } })
    expect(result).toMatchObject({ ok: false, failure: 'unreachable' })
    if (!result.ok) expect(result.detail).toContain('did not complete within 200ms')
  })

  it('fails a stdio probe whose process cannot answer', async () => {
    const { registry } = await harness({ config: { probeTimeoutMs: 2_000 } })
    const result = await registry.probe({
      name: 'stdio',
      transport: { transport: 'stdio', command: process.execPath, args: ['-e', 'process.exit(1)'] },
    })
    expect(result.ok).toBe(false)
  })
})

describe('stdio servers (real child process)', () => {
  it('probes a real stdio server with the right value and mounts its tools globally', async () => {
    const { ctx, registry, fiber } = await harness()
    const input = stdioFixture('local', STDIO_TOKEN)

    expect(await registry.probe(input)).toEqual({ ok: true, tools: ['mcp__local__ping'] })
    expect(globalToolNames(ctx)).not.toContain('mcp__local__ping')

    const saved = await registry.save('a@x', input)
    expect(saved).toMatchObject({ enabled: true, mounted: true })
    expect(globalToolNames(ctx)).toContain('mcp__local__ping')
    await fiber.dispose()
    expect(globalToolNames(ctx)).not.toContain('mcp__local__ping')
  })

  it('fails a stdio probe when the value is wrong and saves nothing', async () => {
    const { registry } = await harness({ config: { probeTimeoutMs: 4_000 } })
    const result = await registry.probe(stdioFixture('local', 'wrong-token'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.detail).not.toContain('wrong-token')
    expect(await registry.list('a@x')).toEqual([])
  })
})

describe('several servers for one user', () => {
  it('keeps two servers over different transports side by side and removes only the named one', async () => {
    const fixture = await startMcpFixture()
    const { ctx, registry, fiber } = await harness()

    await registry.save('a@x', stdioFixture('local', STDIO_TOKEN))
    await registry.save('a@x', { name: 'remote', transport: { transport: 'streamable-http', url: fixture.url } })

    const listed = await registry.list('a@x')
    expect(listed.map(server => [server.name, server.mounted, server.error])).toEqual([
      ['local', true, null], ['remote', true, null],
    ])
    const before = globalToolNames(ctx)
    expect(before).toContain('mcp__local__ping')
    expect(before).toContain('mcp__remote__ping')

    expect(await registry.remove('a@x', 'local')).toBe(true)
    const after = globalToolNames(ctx)
    expect(after).not.toContain('mcp__local__ping')
    expect(after).toContain('mcp__remote__ping')
    expect((await registry.list('a@x')).map(server => server.name)).toEqual(['remote'])
    await fiber.dispose()
  })

  it('reports one server whose mount failed without disturbing the other', async () => {
    const fixture = await startMcpFixture()
    const records: McpServerRecord[] = [
      {
        ownerId: 'a@x', name: 'good', transport: { transport: 'streamable-http', url: fixture.url },
        env: [], headers: [], enabled: true, createdAt: CREATED, updatedAt: UPDATED,
      },
      {
        ownerId: 'a@x', name: 'bad', transport: { transport: 'streamable-http', url: fixture.url },
        env: [{ name: 'TOKEN', credentialRef: mcpSecretCredentialRef('a@x', 'bad', 'TOKEN') }],
        headers: [], enabled: true, createdAt: CREATED, updatedAt: UPDATED,
      },
    ]
    const { ctx, registry } = await harness({ seed: records })

    const listed = await registry.list('a@x')
    expect(listed.map(server => [server.name, server.mounted, server.error === null])).toEqual([
      ['bad', false, false], ['good', true, true],
    ])
    // The failing server's reason is its own; the other server keeps its tools.
    expect(listed[0]?.error).toContain('not configured')
    expect(globalToolNames(ctx)).toContain('mcp__good__ping')
    expect(globalToolNames(ctx)).not.toContain('mcp__bad__ping')
  })

  it('replaces only the named server on a re-save and leaves the other mounted', async () => {
    const fixture = await startMcpFixture()
    const { ctx, registry } = await harness()

    await registry.save('a@x', { name: 'one', transport: { transport: 'streamable-http', url: fixture.url } })
    await registry.save('a@x', { name: 'two', transport: { transport: 'streamable-http', url: fixture.url } })
    await registry.save('a@x', { name: 'one', transport: { transport: 'streamable-http', url: fixture.url }, enabled: false })

    const listed = await registry.list('a@x')
    expect(listed.map(server => [server.name, server.enabled, server.mounted])).toEqual([
      ['one', false, false], ['two', true, true],
    ])
    expect(globalToolNames(ctx)).not.toContain('mcp__one__ping')
    expect(globalToolNames(ctx)).toContain('mcp__two__ping')
  })

  it('leaves the mounted servers untouched when one candidate probe fails', async () => {
    const fixture = await startMcpFixture()
    const { ctx, registry } = await harness()
    await registry.save('a@x', { name: 'local', transport: { transport: 'streamable-http', url: fixture.url } })
    await registry.save('a@x', { name: 'remote', transport: { transport: 'streamable-http', url: fixture.url } })

    const verdict = await registry.probe({
      name: 'candidate',
      transport: { transport: 'streamable-http', url: await closedEndpoint() },
    })

    expect(verdict.ok).toBe(false)
    expect(globalToolNames(ctx)).toContain('mcp__local__ping')
    expect(globalToolNames(ctx)).toContain('mcp__remote__ping')
    expect((await registry.list('a@x')).map(server => server.mounted)).toEqual([true, true])
  })
})
