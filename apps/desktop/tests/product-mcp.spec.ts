import { expect, it } from 'vitest'
import {
  DEFAULT_SICOP_MCP_URL,
  renderProductMcpEntries,
  resolveProductMcpServers,
} from '../src/product-mcp.ts'

it('mounts the public SICOP server by default', () => {
  expect(resolveProductMcpServers({}, 'owner@example.test')).toEqual([
    { id: 'mcp-sicop', serverName: 'sicop', url: DEFAULT_SICOP_MCP_URL, headers: {} },
  ])
})

it('lets the operator blank, replace, or keep the SICOP URL', () => {
  expect(resolveProductMcpServers({ SICOP_MCP_URL: '' }, 'owner@example.test')).toEqual([])
  expect(resolveProductMcpServers({ SICOP_MCP_URL: 'https://sicop.example.test/mcp' }, 'owner@example.test'))
    .toEqual([{ id: 'mcp-sicop', serverName: 'sicop', url: 'https://sicop.example.test/mcp', headers: {} }])
})

it('mounts the MWT.ONE server with the signed-in owner and the key reference', () => {
  const servers = resolveProductMcpServers({
    MWT_MCP_URL: 'https://harness.mwt.one/mwt/mcp',
    MWT_MCP_GATEWAY_KEY: 'secret',
  }, 'owner@example.test')
  expect(servers.map(server => server.id)).toEqual(['mcp-mwt', 'mcp-sicop'])
  expect(servers[0]).toEqual({
    id: 'mcp-mwt',
    serverName: 'mwt',
    url: 'https://harness.mwt.one/mwt/mcp',
    headers: {
      'X-Forwarded-User-Email': { literal: 'owner@example.test' },
      'X-MWT-Gateway-Key': { environment: 'MWT_MCP_GATEWAY_KEY' },
      Authorization: { literal: 'Bearer dsh-gateway' },
    },
  })
  expect(JSON.stringify(servers)).not.toContain('secret')
})

it('omits a deployment server that lacks its URL or its key', () => {
  expect(resolveProductMcpServers({ MWT_MCP_URL: 'https://x.test/mcp' }, 'o@e.test').map(server => server.id))
    .toEqual(['mcp-sicop'])
  expect(resolveProductMcpServers({ MWT_MCP_GATEWAY_KEY: 'secret' }, 'o@e.test').map(server => server.id))
    .toEqual(['mcp-sicop'])
  expect(resolveProductMcpServers({ MWT_MCP_URL: '', MWT_MCP_GATEWAY_KEY: 'secret' }, 'o@e.test').map(server => server.id))
    .toEqual(['mcp-sicop'])
  expect(resolveProductMcpServers({ FABERLOOM_MCP_URL: 'https://f.test/mcp', FABERLOOM_GATEWAY_KEY: '' }, 'o@e.test')
    .map(server => server.id)).toEqual(['mcp-sicop'])
})

it('mounts the FaberLoom server with the owner and the key reference', () => {
  const servers = resolveProductMcpServers({
    FABERLOOM_MCP_URL: 'https://harness.mwt.one/faberloom/mcp',
    FABERLOOM_GATEWAY_KEY: 'secret',
  }, 'owner@example.test')
  expect(servers).toEqual([
    { id: 'mcp-sicop', serverName: 'sicop', url: DEFAULT_SICOP_MCP_URL, headers: {} },
    {
      id: 'mcp-faberloom',
      serverName: 'faberloom',
      url: 'https://harness.mwt.one/faberloom/mcp',
      headers: {
        'X-Faberloom-User-Id': { literal: 'owner@example.test' },
        'X-Faberloom-Gateway-Key': { environment: 'FABERLOOM_GATEWAY_KEY' },
      },
    },
  ])
})

it('renders the rows with the reconnect and timeout behavior the gateway mounts', () => {
  const [entry] = renderProductMcpEntries({}, 'owner@example.test')
  expect(entry).toMatchInlineSnapshot(`
    "    - id: mcp-sicop
          name: '@deepseek-ai/dsh-mcp-client'
          config:
            serverName: sicop
            transport: streamable-http
            url: 'https://sicop.vlinte.work/mcp'
            failOnStartupError: false
            reconnect:
              enabled: true
              maxAttempts: 30
            toolCallTimeoutMs: 120000"
  `)
})

it('escapes a quoted owner in the identity headers', () => {
  const mwt = renderProductMcpEntries({
    MWT_MCP_URL: 'https://x.test/mcp',
    MWT_MCP_GATEWAY_KEY: 'k',
  }, "o'brien@example.test")[0]!
  expect(mwt).toContain("X-Forwarded-User-Email: 'o''brien@example.test'")
  expect(mwt).toContain("url: 'https://x.test/mcp'")
})
