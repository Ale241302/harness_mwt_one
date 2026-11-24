/**
 * Upstream connections owned by the facade's parent process. Each upstream is a
 * real MCP client over stdio or Streamable HTTP; request headers configured for
 * an HTTP upstream are applied here and never reach a program process.
 * @module @deepseek-ai/dsh-mcp-codemode/src/upstream
 */

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { Transport } from '@modelcontextprotocol/client'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { messageOf } from './errors.ts'
import { bindingName } from './sdk.ts'
import type { FacadeConfig, UpstreamConfig, UpstreamSummary, UpstreamTool } from './types.ts'

/** Client identity this facade advertises to upstream servers. */
const CLIENT_INFO = { name: 'dsh-mcp-codemode', version: '0.1.8' } as const

/** One connected upstream, callable by binding name. */
export interface UpstreamServer extends UpstreamSummary {
  /** Dispatch one tool call; rejects with the upstream's error message. */
  readonly call: (binding: string, args: unknown) => Promise<JsonValue>
  /** Close the MCP client and its transport. */
  readonly close: () => Promise<void>
}

/** The connected upstream set and the bindings a program can call. */
export interface UpstreamSet {
  readonly servers: readonly UpstreamServer[]
  readonly bindings: ReadonlyMap<string, (args: unknown) => Promise<unknown>>
  /** Close every upstream; earlier failures are collected, not thrown. */
  readonly close: () => Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createTransport(upstream: UpstreamConfig): Transport {
  switch (upstream.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: upstream.command,
        ...upstream.args === undefined ? {} : { args: [...upstream.args] },
        ...upstream.env === undefined ? {} : { env: { ...upstream.env } },
        ...upstream.cwd === undefined ? {} : { cwd: upstream.cwd },
      })
    case 'http':
      return new StreamableHTTPClientTransport(new URL(upstream.url), {
        requestInit: { headers: { ...upstream.headers } },
      })
  }
}

/** The text an MCP tool error carries; the canonical projection is what a program receives. */
function errorText(content: readonly unknown[], rawName: string): string {
  const parts: string[] = []
  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.length > 0 ? parts.join('\n') : `MCP tool "${rawName}" reported an error`
}

/**
 * Project one `tools/call` result onto the canonical value a harness program
 * receives: `{ content, structuredContent? }`. A tool-level error rejects so the
 * program can catch it and continue.
 */
function projectResult(
  result: { content: readonly unknown[]; structuredContent?: unknown; isError?: boolean },
  rawName: string,
  maxBytes: number,
): JsonValue {
  const content = result.content
  if (result.isError === true) throw new Error(errorText(content, rawName))
  /* v8 ignore start -- parsed JSON cannot fail snapshotJsonValue, so these guards are unreachable. */
  let projected: unknown
  try {
    projected = snapshotJsonValue(content)
  } catch (error: unknown) {
    throw new Error(`MCP tool "${rawName}" returned non-JSON content: ${messageOf(error)}`)
  }
  if (projected === undefined) throw new Error(`MCP tool "${rawName}" returned non-JSON content`)
  /* v8 ignore stop */
  const value: Record<string, JsonValue> = { content: projected as JsonValue }
  if (result.structuredContent !== undefined) {
    const structured = snapshotJsonValue(result.structuredContent)
    /* v8 ignore next -- parsed JSON content cannot fail the lossless-JSON check. */
    if (structured === undefined) throw new Error(`MCP tool "${rawName}" returned non-JSON structured content`)
    value.structuredContent = structured as JsonValue
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) {
    throw new Error(`MCP tool "${rawName}" returned more than ${String(maxBytes)} bytes; narrow the request`)
  }
  return value
}

/**
 * Connect every configured upstream, discover its tools, and index the bindings
 * a program may call.
 *
 * A connection or discovery failure rejects with the server name and closes the
 * servers already connected. Two tools that collide on one binding name are a
 * configuration error and are refused before the facade serves.
 * @param config - Upstream list plus dispatch deadline and per-result bound.
 * @returns Connected servers, the binding index, and one closer.
 */
export async function connectUpstreams(config: FacadeConfig): Promise<UpstreamSet> {
  const timeoutMs = config.timeoutMs ?? 60_000
  const maxUpstreamResultBytes = config.maxUpstreamResultBytes ?? 16 * 1024 * 1024
  const servers: UpstreamServer[] = []
  const bindings = new Map<string, (args: unknown) => Promise<unknown>>()
  const seenServerNames = new Set<string>()
  const seenBindings = new Map<string, string>()
  try {
    for (const upstream of config.upstreams) {
      if (seenServerNames.has(upstream.serverName)) {
        throw new Error(`upstream serverName "${upstream.serverName}" is configured twice`)
      }
      seenServerNames.add(upstream.serverName)
      const client = new Client({ ...CLIENT_INFO }, { capabilities: {} })
      try {
        await client.connect(createTransport(upstream))
      } catch (error: unknown) {
        throw new Error(`upstream "${upstream.serverName}" did not connect: ${messageOf(error)}`)
      }
      let tools: UpstreamTool[]
      let index: Map<string, string>
      try {
        const listed = await client.listTools()
        index = new Map()
        tools = listed.tools.map((tool) => {
          const rawName = tool.name
          if (rawName.length === 0) throw new Error('the upstream advertised a tool without a name')
          const binding = bindingName(upstream.serverName, rawName)
          const owner = seenBindings.get(binding)
          if (owner !== undefined) {
            throw new Error(`tools "${owner}" and "${upstream.serverName}/${rawName}" both use the binding "${binding}"`)
          }
          seenBindings.set(binding, `${upstream.serverName}/${rawName}`)
          index.set(binding, rawName)
          return {
            serverName: upstream.serverName,
            rawName,
            binding,
            inputSchema: tool.inputSchema,
            ...typeof tool.description === 'string' && tool.description.length > 0 ? { description: tool.description } : {},
          }
        })
      } catch (error: unknown) {
        await client.close()
        throw new Error(`upstream "${upstream.serverName}" did not list its tools: ${messageOf(error)}`)
      }
      const server: UpstreamServer = {
        serverName: upstream.serverName,
        tools,
        async call(binding: string, args: unknown): Promise<JsonValue> {
          const rawName = index.get(binding)
          if (rawName === undefined) throw new Error(`tools.${binding} is not available`)
          if (!isRecord(args)) throw new Error(`arguments for tools.${binding} must be an object`)
          const result = await client.callTool({ name: rawName, arguments: args }, { timeout: timeoutMs })
          return projectResult(
            result as { content: readonly unknown[]; structuredContent?: unknown; isError?: boolean },
            rawName,
            maxUpstreamResultBytes,
          )
        },
        async close(): Promise<void> {
          await client.close()
        },
      }
      servers.push(server)
      for (const binding of index.keys()) {
        bindings.set(binding, args => server.call(binding, args))
      }
    }
  } catch (error: unknown) {
    await Promise.allSettled(servers.map(server => server.close()))
    throw error
  }
  return {
    servers,
    bindings,
    async close(): Promise<void> {
      await Promise.allSettled(servers.map(server => server.close()))
    },
  }
}
