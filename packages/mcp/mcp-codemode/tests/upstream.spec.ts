import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { connectUpstreams } from '../src/upstream.ts'
import type { FacadeConfig } from '../src/types.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/rpc.mjs', import.meta.url))
const EXIT = fileURLToPath(new URL('./fixtures/exit.cjs', import.meta.url))
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

function stdio(mode: string, overrides: Partial<FacadeConfig> = {}): FacadeConfig {
  return {
    upstreams: [{
      serverName: 'quirk',
      transport: 'stdio',
      command: process.execPath,
      args: [FIXTURE],
      env: { QUIRKY_MODE: mode },
      cwd: PACKAGE_ROOT,
    }],
    ...overrides,
  }
}

/** Run one HTTP endpoint for the duration of a probe. */
async function withHttpEndpoint(
  handler: Parameters<typeof createServer>[1],
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo
  try {
    await run(`http://127.0.0.1:${String(port)}/mcp`)
  } finally {
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }
}

describe('upstream connections', () => {
  it('discovers tools, applies defaults, and dispatches calls', async () => {
    const set = await connectUpstreams(stdio('quirky'))
    try {
      const server = set.servers[0]
      expect(server?.serverName).toBe('quirk')
      expect(server?.tools).toEqual([
        { serverName: 'quirk', rawName: 'plain', binding: 'mcp__quirk__plain', inputSchema: { type: 'object' } },
        {
          serverName: 'quirk',
          rawName: 'empty-desc',
          binding: 'mcp__quirk__empty-desc',
          inputSchema: { type: 'object' },
        },
        {
          serverName: 'quirk',
          rawName: 'no-text-error',
          binding: 'mcp__quirk__no-text-error',
          inputSchema: { type: 'object' },
        },
      ])
      const plain = set.bindings.get('mcp__quirk__plain')
      await expect(plain?.({})).resolves.toEqual({ content: [] })
      await expect(server?.call('mcp__quirk__plain', 'not-an-object')).rejects
        .toThrow('arguments for tools.mcp__quirk__plain must be an object')
      await expect(server?.call('mcp__quirk__absent', {})).rejects.toThrow('tools.mcp__quirk__absent is not available')
    } finally {
      await set.close()
    }
  })

  it('turns a tool-level error into a catchable rejection, even without a text block', async () => {
    const set = await connectUpstreams(stdio('quirky'))
    try {
      const server = set.servers[0]
      await expect(server?.call('mcp__quirk__no-text-error', {})).rejects
        .toThrow('MCP tool "no-text-error" reported an error')
    } finally {
      await set.close()
    }
  })

  it('refuses a nameless tool, duplicate bindings, and a failed tool list', async () => {
    await expect(connectUpstreams(stdio('empty-name'))).rejects.toThrow('advertised a tool without a name')
    await expect(connectUpstreams(stdio('duplicate'))).rejects.toThrow('both use the binding "mcp__quirk__dup"')
    await expect(connectUpstreams(stdio('list-error'))).rejects.toThrow('did not list its tools: list exploded')
  })

  it('reports a stdio upstream configured without arguments', async () => {
    await expect(connectUpstreams({
      upstreams: [{
        serverName: 'noargs',
        transport: 'stdio',
        command: process.execPath,
        env: { NODE_OPTIONS: `--require=${EXIT}` },
      }],
    })).rejects.toThrow('upstream "noargs" did not connect')
  })

  it('reports an HTTP upstream that cannot connect', async () => {
    await withHttpEndpoint(
      (_request, response) => { response.writeHead(404).end() },
      async (url) => {
        await expect(connectUpstreams({
          upstreams: [{ serverName: 'remote', transport: 'http', url, headers: { Authorization: 'Bearer t' } }],
        })).rejects.toThrow('upstream "remote" did not connect')
      },
    )
  })
})
