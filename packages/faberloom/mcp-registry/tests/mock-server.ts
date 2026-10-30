/**
 * Local HTTP fixtures for the MCP-registry specs: a real Streamable HTTP MCP
 * endpoint built from the SDK (optionally gated on a bearer value), and a raw
 * endpoint that answers whatever the spec scripts, including never answering.
 */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import { toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node'
import { z } from 'zod'

/** A running fixture endpoint. */
export interface Fixture {
  /** Endpoint URL to point a server at. */
  readonly url: string
}

/** A running MCP endpoint and the authorization headers it observed. */
export interface McpFixture extends Fixture {
  /** Authorization header values observed, in order. */
  readonly authorization: Array<string | undefined>
}

const closers: Array<() => Promise<void>> = []

/** Stop every fixture opened since the last call; run from a spec's afterEach. */
export async function closeFixtures(): Promise<void> {
  for (const close of closers.splice(0)) await close()
}

/** Bind one HTTP server to an ephemeral port and register its teardown. */
async function listen(server: Server, close: () => Promise<void>): Promise<string> {
  closers.push(close)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the fixture has no TCP address')
  return `http://127.0.0.1:${String(address.port)}/mcp`
}

/** Stop one fixture's sockets and server exactly once. */
function stopServer(server: Server): () => Promise<void> {
  let stopping: Promise<void> | undefined
  return () => (stopping ??= new Promise<void>((resolve) => {
    server.closeAllConnections()
    server.close(() => { resolve() })
  }))
}

/**
 * Start a stateless MCP endpoint exposing one `ping` tool.
 * @param requiredAuthorization - when set, a request whose `authorization` header differs is answered 401.
 * @returns the endpoint URL and the observed authorization headers.
 */
export async function startMcpFixture(requiredAuthorization?: string): Promise<McpFixture> {
  const authorization: Array<string | undefined> = []
  const handler = createMcpHandler(() => {
    const mcp = new McpServer(
      { name: 'mcp-registry-fixture', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )
    mcp.registerTool('ping', { description: 'Replies pong.', inputSchema: z.object({}) }, async (): Promise<CallToolResult> => ({
      content: [{ type: 'text', text: 'pong' }],
    }))
    return mcp
  })
  const handle = toNodeHandler(handler)
  const server = createServer((request, response) => {
    authorization.push(request.headers.authorization)
    if (requiredAuthorization !== undefined && request.headers.authorization !== requiredAuthorization) {
      response.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}')
      return
    }
    void handle(request as NodeIncomingMessageLike, response).catch((error: unknown) => {
      response.writeHead(500).end(String(error))
    })
  })
  const stop = stopServer(server)
  const url = await listen(server, async () => {
    await handler.close()
    await stop()
  })
  return { url, authorization }
}

/**
 * Start a raw HTTP endpoint that answers with whatever the caller scripts, or
 * with nothing at all so the caller's own timeout is the only way out.
 * @param respond - called with each request; not calling `response.end` leaves it hanging.
 * @returns the endpoint URL.
 */
export async function startRawFixture(
  respond?: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<Fixture> {
  const server = createServer((request, response) => {
    request.resume()
    respond?.(request, response)
  })
  const url = await listen(server, stopServer(server))
  return { url }
}

/**
 * Reserve an ephemeral port and release it, yielding a URL nothing is listening on.
 * @returns the URL of a closed endpoint.
 */
export async function closedEndpoint(): Promise<string> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the fixture has no TCP address')
  const port = address.port
  await new Promise<void>(resolve => server.close(() => { resolve() }))
  return `http://127.0.0.1:${String(port)}/mcp`
}
