/**
 * Minimal MCP server over stdio for the MCP-registry specs: it publishes one
 * `ping` tool and refuses to start unless its environment carries the expected
 * token, so a spec can prove both a real connection and a real rejection.
 *
 * Run: node stdio-fixture-server.ts
 */

import { McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

/** Token the fixture requires in its environment; the specs pass it explicitly. */
const FIXTURE_TOKEN = 'expected-token'

if (process.env['FIXTURE_TOKEN'] !== FIXTURE_TOKEN) process.exit(3)

function createFixtureServer(): McpServer {
  const server = new McpServer(
    { name: 'mcp-registry-stdio-fixture', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  server.registerTool('ping', {
    description: 'Replies pong.',
    inputSchema: z.object({}),
  }, async (): Promise<CallToolResult> => ({ content: [{ type: 'text', text: 'pong' }] }))
  return server
}

serveStdio(createFixtureServer)
