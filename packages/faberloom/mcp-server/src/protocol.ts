/**
 * The JSON-RPC 2.0 and Model Context Protocol shapes the server speaks, and the
 * pure dispatch that turns one parsed message into one response. Keeping this
 * module free of transport and storage is what makes the protocol testable
 * without a socket.
 * @module @deepseek-ai/dsh-faberloom-mcp-server/protocol
 */

/** Protocol revision this server implements. */
export const PROTOCOL_VERSION = '2025-06-18'

/** One tool the server advertises. */
export interface McpToolDefinition {
  /** Tool name, namespaced so another server cannot collide with it. */
  readonly name: string
  /** Model-facing description. */
  readonly description: string
  /** JSON Schema for the tool's arguments. */
  readonly inputSchema: Record<string, unknown>
}

/** The result of one tool call, as MCP renders it. */
export interface ToolResult {
  /** Ordered content blocks; this server answers with JSON text. */
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  /** Whether the call failed in a way the caller should see as an error. */
  readonly isError?: boolean | undefined
}

/** What the dispatcher needs from the product to answer a call. */
export interface ToolHost {
  /** List the advertised tools. */
  tools(): readonly McpToolDefinition[]
  /** Run one tool by name. */
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>
}

/** One JSON-RPC request or notification. */
interface RpcMessage {
  readonly jsonrpc?: unknown
  readonly id?: unknown
  readonly method?: unknown
  readonly params?: unknown
}

/** A JSON-RPC response body, or null for a notification. */
export interface RpcOutcome {
  /** HTTP status the transport should send. */
  readonly status: number
  /** Response body, or null when the message was a notification. */
  readonly body: unknown | null
}

/** Build a JSON-RPC error response. */
function error(id: unknown, code: number, message: string): RpcOutcome {
  return { status: 200, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message } } }
}

/** Build a JSON-RPC success response. */
function result(id: unknown, value: unknown): RpcOutcome {
  return { status: 200, body: { jsonrpc: '2.0', id: id ?? null, result: value } }
}

/** Render one tool result as JSON text. */
function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/**
 * Render one tool failure the caller can read.
 * @param message - the failure text.
 * @returns the MCP result marked as an error.
 */
export function failure(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * Render one tool value as MCP content.
 * @param content - the value to serialize as JSON text.
 * @returns the MCP result.
 */
export function value(content: unknown): ToolResult {
  return jsonResult(content)
}

/**
 * Handle one parsed JSON-RPC message.
 *
 * Implements the MCP methods an agent platform needs to discover and call this
 * server's tools: `initialize`, `tools/list`, `tools/call`, and `ping`.
 * Notifications (`notifications/*`) answer 202 with no body. Anything else is
 * `-32601`, and a malformed envelope is `-32600`, so a client learns what
 * happened instead of seeing a silent hang.
 * @param host - the product surface the tools are served from.
 * @param message - the parsed request or notification.
 * @returns the HTTP status and response body.
 */
export async function dispatch(host: ToolHost, message: unknown): Promise<RpcOutcome> {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    return error(null, -32600, 'invalid request: expected a JSON-RPC object')
  }
  const rpc = message as RpcMessage
  if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
    return error(rpc.id, -32600, 'invalid request: jsonrpc must be "2.0" and method a string')
  }
  const id = rpc.id
  if (id === undefined) return { status: 202, body: null }

  switch (rpc.method) {
    case 'initialize':
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'faberloom', version: '0.1.6-alpha.1' },
      })
    case 'ping':
      return result(id, {})
    case 'tools/list':
      return result(id, { tools: host.tools() })
    case 'tools/call': {
      const params = rpc.params
      if (params === null || typeof params !== 'object') return error(id, -32602, 'invalid params: expected an object')
      const { name, arguments: args } = params as { name?: unknown; arguments?: unknown }
      if (typeof name !== 'string' || name.length === 0) return error(id, -32602, 'invalid params: name is required')
      if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) {
        return error(id, -32602, 'invalid params: arguments must be an object')
      }
      if (!host.tools().some(tool => tool.name === name)) return error(id, -32602, `unknown tool: ${name}`)
      try {
        return result(id, await host.call(name, (args ?? {}) as Record<string, unknown>))
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : String(cause)
        return result(id, failure(message))
      }
    }
    default:
      return error(id, -32601, `method not found: ${rpc.method}`)
  }
}
