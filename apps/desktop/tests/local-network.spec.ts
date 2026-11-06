/**
 * Wave 2.2 network observer: a fake MWT endpoint counts every request the MCP
 * client makes. The local composition has no MWT client row, so the counter stays
 * at zero across start, wait, and restart; the remote control proves the observer
 * sees the same endpoint when the row is present.
 */

import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import SystemPrompt from '../../../packages/core/system-prompt/src/index.ts'
import ToolRuntime from '../../../packages/core/tools/src/index.ts'
import * as McpClient from '../../../packages/mcp/mcp-client/src/index.ts'
import { renderProductMcpEntries } from '../src/product-mcp.ts'

const root = resolve(import.meta.dirname, '../../..')
const baseConfig = resolve(root, 'apps/cli/tests/fixtures/memory-mcp-base.cordis.yml')
const homes: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
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
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { url: `http://127.0.0.1:${String(port)}/mcp`, requests, server }
}

/** Load the generated product rows as a patch file the boot accepts. */
function productPatches(home: string, entries: readonly string[]): PatchOptions[] {
  if (entries.length === 0) return []
  const file = join(home, 'product-mcp.patch.yml')
  writeFileSync(file, `- insert:\n${entries.join('\n')}\n`)
  const patches = loadOverlayPatches('wave-2-2', file)
  for (const patch of patches) {
    for (const row of patch.insert ?? []) {
      if (row.name === '@deepseek-ai/dsh-mcp-client') row.name = 'cordis:memory-test-mcp-client'
    }
  }
  return patches
}

/** Boot one composition with the source MCP client builtins. */
async function bootMcp(name: string, patches: PatchOptions[]): Promise<Context> {
  const ctx = await boot(name, baseConfig, patches, (hostCtx) => {
    contexts.push(hostCtx)
    hostCtx.loader.builtins['memory-test-system-prompt'] = SystemPrompt
    hostCtx.loader.builtins['memory-test-tools'] = ToolRuntime
    hostCtx.loader.builtins['memory-test-mcp-client'] = McpClient
  })
  return ctx
}

it('observes no MWT request in the local composition across start, wait, and restart', async () => {
  const fake = await fakeMcp()
  const home = mkdtempSync(join(tmpdir(), 'dsh-local-network-'))
  homes.push(home)
  const environment = {
    MWT_MCP_URL: fake.url,
    MWT_MCP_AUTHORIZATION: 'DeviceToken synthetic',
    SICOP_MCP_URL: '',
  }
  process.env.MWT_MCP_AUTHORIZATION = 'DeviceToken synthetic'
  const local = renderProductMcpEntries(environment, 'owner@example.test', 'local')
  expect(local).toEqual([])

  const first = await bootMcp('wave-2-2-local', productPatches(home, local))
  await new Promise(resolveWait => setTimeout(resolveWait, 500))
  expect(fake.requests).toEqual([])
  await first.fiber.dispose()

  const second = await bootMcp('wave-2-2-local-restart', productPatches(home, local))
  await new Promise(resolveWait => setTimeout(resolveWait, 500))
  expect(fake.requests).toEqual([])
  await second.fiber.dispose()
  fake.server.closeAllConnections()
  await new Promise<void>((resolveClose) => { fake.server.close(() => { resolveClose() }) })
})
