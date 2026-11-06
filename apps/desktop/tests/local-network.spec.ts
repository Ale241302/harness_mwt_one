/**
 * Wave 2.2 network observer: a fake MWT endpoint counts every request the MCP
 * client makes. Local mode renders no MWT/FaberLoom client, so the counter stays
 * at zero across start, wait, and restart; the remote control mounts the same
 * generated row and proves the observer sees it.
 */

import { createServer, type Server } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '../../../packages/core/system-prompt/src/index.ts'
import ToolRuntime from '../../../packages/core/tools/src/index.ts'
import * as McpClient from '../../../packages/mcp/mcp-client/src/index.ts'
import { renderProductMcpEntries, resolveProductMcpServers } from '../src/product-mcp.ts'

const contexts: Context[] = []
const servers: Server[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolveClose) => { server.close(() => { resolveClose() }) })
  }
  delete process.env.MWT_MCP_AUTHORIZATION
})

interface FakeMcp {
  readonly url: string
  readonly requests: string[]
  readonly server: Server
}

/** A minimal streamable-HTTP MCP endpoint that records each request. */
async function fakeMcp(): Promise<FakeMcp> {
  const requests: string[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push(body)
      let id: unknown = 1
      try {
        id = (JSON.parse(body) as { id?: unknown }).id ?? 1
      } catch {
        // A malformed probe still counts as a request.
      }
      if (body.includes('"initialize"')) {
        response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fake-session' })
        response.end(JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } },
        }))
        return
      }
      if (body.includes('"tools/list"')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [] } }))
        return
      }
      response.writeHead(202).end()
    })
  })
  servers.push(server)
  await new Promise<void>((resolveListen) => { server.listen(0, '127.0.0.1', () => { resolveListen() }) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { url: `http://127.0.0.1:${String(port)}/mcp`, requests, server }
}

/** Boot the base tools and the MCP client for one generated product row. */
async function bootClient(server: {
  readonly serverName: string
  readonly url: string
  readonly headers: Readonly<Record<string, { readonly literal?: string; readonly environment?: string }>>
}): Promise<Context> {
  const headers = Object.fromEntries(Object.entries(server.headers).map(([name, value]) => [
    name,
    value.literal ?? (value.environment === undefined ? '' : process.env[value.environment] ?? ''),
  ]))
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.plugin(McpClient, {
    transport: 'streamable-http',
    serverName: server.serverName,
    url: server.url,
    headers,
    toolCallTimeoutMs: 5_000,
    failOnStartupError: false,
    reconnect: { enabled: false },
  })
  return ctx
}

/** Wait until the observer sees at least one request. */
async function waitForRequest(fake: FakeMcp): Promise<void> {
  const deadline = Date.now() + 5_000
  while (fake.requests.length === 0 && Date.now() < deadline) {
    await new Promise((resolveWait) => { setTimeout(resolveWait, 25) })
  }
}

it('renders no MWT client in local mode even with remote variables, and observes zero requests across restart', async () => {
  const fake = await fakeMcp()
  const environment = {
    MWT_MCP_URL: fake.url,
    MWT_MCP_AUTHORIZATION: 'DeviceToken synthetic',
    SICOP_MCP_URL: '',
  }
  expect(renderProductMcpEntries(environment, 'owner@example.test', 'local')).toEqual([])

  const first = new Context()
  contexts.push(first)
  await first.plugin(SystemPrompt)
  await first.plugin(ToolRuntime)
  await new Promise((resolveWait) => { setTimeout(resolveWait, 500) })
  expect(fake.requests).toEqual([])
  await first.fiber.dispose()

  const second = new Context()
  contexts.push(second)
  await second.plugin(SystemPrompt)
  await second.plugin(ToolRuntime)
  await new Promise((resolveWait) => { setTimeout(resolveWait, 500) })
  expect(fake.requests).toEqual([])
  await second.fiber.dispose()
})

it('observes the remote MWT client when the generated row is mounted', async () => {
  const fake = await fakeMcp()
  const remote = resolveProductMcpServers({
    MWT_MCP_URL: fake.url,
    MWT_MCP_AUTHORIZATION: 'DeviceToken synthetic',
    SICOP_MCP_URL: '',
  }, 'owner@example.test')
  expect(remote.map(server => server.serverName)).toEqual(['mwt'])
  process.env.MWT_MCP_AUTHORIZATION = 'DeviceToken synthetic'

  await bootClient(remote[0]!)
  await waitForRequest(fake)
  expect(fake.requests.length).toBeGreaterThan(0)
}, 10_000)
