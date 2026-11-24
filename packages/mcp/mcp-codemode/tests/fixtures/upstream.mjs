/**
 * Deterministic upstream MCP server for the facade tests. It speaks real stdio
 * MCP through the official server SDK; nothing in this fixture is a mock of the
 * facade's transport.
 *
 * Tools:
 * - `add(a, b)`      text result, exercises the canonical `{ content }` projection
 * - `greet(name)`    text result
 * - `bulk()`         a large payload whose canary must never reach the client
 * - `structured()`   structured content beside text
 * - `fail()`         a tool-level error the program can catch
 * - `slow(ms)`       an upstream delay for deadline tests
 */

import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

/** Marker embedded in `bulk()`; a leaking intermediate value would expose it. */
export const BULK_CANARY = 'INTERMEDIATE-CANARY-9f3a'

function createServer() {
  const server = new McpServer({ name: 'fixture-upstream', version: '1.0.0' }, { capabilities: { tools: {} } })

  server.registerTool('add', {
    description: 'Adds two numbers.',
    inputSchema: z.object({ a: z.number(), b: z.number() }),
  }, async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }))

  server.registerTool('greet', {
    description: 'Greets one person by name.',
    inputSchema: z.object({ name: z.string() }),
  }, async ({ name }) => ({ content: [{ type: 'text', text: `Hello, ${name}!` }] }))

  server.registerTool('bulk', {
    description: 'Returns a large intermediate payload.',
    inputSchema: z.object({}),
  }, async () => ({
    content: [{ type: 'text', text: JSON.stringify({ secret: BULK_CANARY, blob: 'x'.repeat(4096) }) }],
  }))

  server.registerTool('structured', {
    description: 'Returns structured content beside text.',
    inputSchema: z.object({}),
  }, async () => ({
    content: [{ type: 'text', text: '{"total":3}' }],
    structuredContent: { total: 3 },
  }))

  server.registerTool('image', {
    description: 'Returns one image block beside text.',
    inputSchema: z.object({}),
  }, async () => ({
    content: [
      { type: 'text', text: 'an image follows' },
      { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', mimeType: 'image/png' },
    ],
  }))

  server.registerTool('fail', {
    description: 'Always reports a tool-level error.',
    inputSchema: z.object({}),
  }, async () => ({ content: [{ type: 'text', text: 'boom: upstream refused the request' }], isError: true }))

  server.registerTool('slow', {
    description: 'Sleeps for the requested number of milliseconds.',
    inputSchema: z.object({ ms: z.number() }),
  }, async ({ ms }) => {
    await new Promise(resolve => setTimeout(resolve, ms))
    return { content: [{ type: 'text', text: 'slept' }] }
  })

  return server
}

serveStdio(createServer)
