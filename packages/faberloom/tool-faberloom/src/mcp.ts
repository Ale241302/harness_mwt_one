/**
 * Model-facing MCP server tools (`faberloom_mcp_*`): install a server the user
 * hands over, list the installed servers, and remove one. Installation connects
 * once to prove the server works before saving it, so a server that cannot be
 * reached is never recorded, and every supplied secret is stored outside the
 * durable record.
 * @module @deepseek-ai/dsh-tool-faberloom/src/mcp
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
// Type-only: resolves the ctx.faberloomMcpRegistry declaration used through ctx.get.
import type {
  FaberLoomMcpRegistry,
  FaberLoomMcpServer,
  McpServerInput,
  McpStdioTransportInput,
  McpHttpTransportInput,
  McpTransportInput,
  McpTransport,
} from '@deepseek-ai/dsh-faberloom-mcp-registry'

/** Local server names the MCP tool namespace accepts. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/** One credential entry of an installed server; its name and presence, never its value. */
interface McpCredentialRow {
  readonly name: string
  readonly kind: string
  readonly present: boolean
}

/** One installed server as `faberloom_mcp_list` returns it; no field carries a secret value. */
interface McpServerRow {
  readonly name: string
  readonly transport: string
  readonly target: string
  readonly enabled: boolean
  readonly mounted: boolean
  readonly credentials: McpCredentialRow[]
}

/** One transport argument an install call carries. */
type TransportArgument = McpStdioTransportInput | McpHttpTransportInput

/** Resolve the mounted MCP registry at call time, or fail loud. */
function mcpRegistry(ctx: Context): FaberLoomMcpRegistry {
  const service = ctx.get('faberloomMcpRegistry')
  if (service === undefined) throw new Error('faberloom: the MCP registry service is not mounted')
  return service
}

/** Require a name that can label the server, or fail with a model-facing message. */
function serverName(name: string): string {
  if (!SERVER_NAME.test(name)) {
    throw new Error('faberloom_mcp_add: the server name must be 1 to 32 letters, digits, dashes, or underscores')
  }
  return name
}

/** Require a transport the harness can connect with, or fail with a model-facing message. */
function transportOf(transport: TransportArgument): McpTransportInput {
  if (transport.transport === 'stdio') {
    if (transport.command.length === 0) throw new Error('faberloom_mcp_add: the program to run must not be empty')
    return transport
  }
  try {
    const parsed = new URL(transport.url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol')
  } catch (_invalidAddress) {
    throw new Error('faberloom_mcp_add: the address must be a full http or https URL')
  }
  return transport
}

/** Require a map whose values are all text, or fail with a model-facing message. */
function secretValues(values: Record<string, unknown>, label: 'env' | 'headers'): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== 'string') throw new Error(`faberloom_mcp_add: every ${label} value must be text; "${name}" is not`)
    result[name] = value
  }
  return result
}

/** A one-line rendering of how one saved server is reached. */
function transportTarget(transport: McpTransport): string {
  if (transport.transport === 'stdio') return [transport.command, ...transport.args].join(' ')
  return transport.url
}

/** One saved server's credential entries, without the reference behind them. */
function credentialRows(server: FaberLoomMcpServer): McpCredentialRow[] {
  return [
    ...server.env.map(entry => ({ name: entry.name, kind: 'environment', present: entry.present })),
    ...server.headers.map(entry => ({ name: entry.name, kind: 'header', present: entry.present })),
  ]
}

/** Project one saved server into the list tool's row. */
function serverRow(server: FaberLoomMcpServer): McpServerRow {
  return {
    name: server.name,
    transport: server.transport.transport,
    target: transportTarget(server.transport),
    enabled: server.enabled,
    mounted: server.mounted,
    credentials: credentialRows(server),
  }
}

/** What one named probe failure means, in the model's terms. */
function describeFailure(failure: string | undefined): string {
  switch (failure) {
    case 'unreachable': return 'the server could not be reached'
    case 'bad-credential': return 'the server rejected the credentials it was given'
    case 'protocol': return 'the server did not answer as an MCP server'
    default: return 'the connection failed'
  }
}

/** Render one installed server as a list line. */
function serverLine(server: McpServerRow): string {
  const availability = server.enabled
    ? server.mounted ? 'enabled and available' : 'enabled but not available yet'
    : 'disabled'
  const credentials = server.credentials.length === 0
    ? 'no saved credentials'
    : `credentials: ${server.credentials.map(entry => `${entry.name} (${entry.kind}) ${entry.present ? 'present' : 'missing'}`).join(', ')}`
  return `- ${server.name} (${server.transport}: ${server.target}), ${availability}; ${credentials}`
}

/** Render the whole installed-server list. */
function serversText(servers: readonly McpServerRow[]): string {
  if (servers.length === 0) return 'No MCP servers are installed.'
  const heading = `${servers.length} MCP server${servers.length === 1 ? '' : 's'}:`
  return [heading, ...servers.map(serverLine)].join('\n')
}

/**
 * Register the MCP server tools on the calling agent's tool registry.
 * @param ctx - context carrying `tools` and the `faberloomMcpRegistry` service.
 * @param ownerId - resolves the acting identity when a call runs, so the tool schemas register even where no identity is injected.
 */
export function registerMcpTools(ctx: Context, ownerId: () => string): void {
  ctx.tools.register(defineTool({
    name: 'faberloom_mcp_add',
    description: 'Install an MCP server the user asked for, from the documentation they handed over: give it a local name and how to reach it, plus any value it authenticates with. The harness connects once to prove the server works before saving it. The stdio branch runs a local program; the streamable-http branch calls a network address. The user\'s own key or token belongs in env (environment variables) or headers (request headers) as a value, and is stored as their secret and never returned. Installing a name that already exists replaces it. If the server cannot be reached or rejects the credentials, nothing is saved and the reason is reported.',
    parameters: {
      name: { type: 'string', required: true, description: 'Local name for the server: 1 to 32 letters, digits, dashes, or underscores. It is how the user names the server later, and it labels every tool the server adds.' },
      transport: {
        required: true,
        description: 'How the harness reaches the server. Pick the branch that matches the documentation: the server is a local program to run, or a network address to call.',
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              transport: { type: 'string', required: true, const: 'stdio', description: 'Marks a server the harness runs as a local program.' },
              command: { type: 'string', required: true, description: 'Program to run, for example `npx` or an installed executable.' },
              args: { type: 'array', items: { type: 'string' }, description: 'Arguments passed to the program, one entry each; omit when it takes none.' },
              cwd: { type: 'string', description: 'Directory the program runs in; omit for the default.' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              transport: { type: 'string', required: true, const: 'streamable-http', description: 'Marks a server reached over the network.' },
              url: { type: 'string', required: true, description: 'Full HTTP or HTTPS address of the server.' },
            },
          },
        ],
      },
      env: { type: 'object', additionalProperties: true, description: 'Values the server reads from its environment, keyed by variable name, for example the user\'s API key. Supply the values this server needs: the harness proves the connection before saving, and that test only sees the values given here. Each value is stored as the user\'s secret and never returned.' },
      headers: { type: 'object', additionalProperties: true, description: 'Values sent as request headers, keyed by header name, for example an authorization token. Supply the values this server needs: the harness proves the connection before saving, and that test only sees the values given here. Each value is stored as the user\'s secret and never returned.' },
      enabled: { type: 'boolean', description: 'Whether the server becomes available in every chat as soon as it is saved; defaults to true. Set false to save it without turning it on.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          saved: { type: 'boolean', required: true },
          name: { type: 'string', required: true },
          transport: { type: 'string', required: true },
          tools: { type: 'array', required: true, items: { type: 'string' } },
          failure: { type: 'string' },
          detail: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.saved) {
          return [{
            type: 'text' as const,
            text: value.tools.length === 0
              ? `Installed the MCP server "${value.name}". It offers no tools.`
              : `Installed the MCP server "${value.name}". It offers: ${value.tools.join(', ')}. Every chat can use them now.`,
          }]
        }
        const detail = value.detail === undefined || value.detail.length === 0 ? '' : ` The server said: ${value.detail}`
        return [{
          type: 'text' as const,
          text: `The MCP server "${value.name}" was not installed: ${describeFailure(value.failure)}.${detail} Nothing was saved.`,
        }]
      },
    },
    execute: async (args) => {
      const service = mcpRegistry(ctx)
      const owner = ownerId()
      const name = serverName(args.name)
      const transport = transportOf(args.transport)
      const input: McpServerInput = {
        name,
        transport,
        ...args.env === undefined ? {} : { env: secretValues(args.env, 'env') },
        ...args.headers === undefined ? {} : { headers: secretValues(args.headers, 'headers') },
        ...args.enabled === undefined ? {} : { enabled: args.enabled },
      }
      const verdict = await service.probe(input)
      if (!verdict.ok) {
        return { saved: false, name, transport: transport.transport, tools: [], failure: verdict.failure, detail: verdict.detail }
      }
      const saved = await service.save(owner, input)
      return { saved: true, name: saved.name, transport: saved.transport.transport, tools: [...verdict.tools] }
    },
    presentCall: args => ({ card: 'generic', title: `Install MCP server ${args.name}`, kind: 'other', rawInput: { name: args.name } }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_mcp_list',
    description: 'List the MCP servers installed for this user: each server\'s name, how it is reached, whether it is turned on and available right now, and which of the credentials it needs are present. No credential value is ever returned. Use it before installing a name again, or when the user asks what is installed.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          servers: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                transport: { type: 'string', required: true },
                target: { type: 'string', required: true },
                enabled: { type: 'boolean', required: true },
                mounted: { type: 'boolean', required: true },
                credentials: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      name: { type: 'string', required: true },
                      kind: { type: 'string', required: true },
                      present: { type: 'boolean', required: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text' as const, text: serversText(value.servers) }],
    },
    execute: async () => {
      const owner = ownerId()
      const servers = await mcpRegistry(ctx).list(owner)
      return { servers: servers.map(serverRow) }
    },
    presentCall: () => ({ card: 'generic', title: 'List MCP servers', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_mcp_remove',
    description: 'Remove one installed MCP server by name and forget its saved credentials, so it stops being available in every chat. Removing a name that is not installed changes nothing.',
    parameters: {
      name: { type: 'string', required: true, description: 'Name of the installed server to remove, as faberloom_mcp_list reports it.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          removed: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text' as const,
        text: value.removed
          ? `Removed the MCP server "${value.name}" and forgot its saved credentials.`
          : `No MCP server named "${value.name}" is installed.`,
      }],
    },
    execute: async (args) => {
      const owner = ownerId()
      return { name: args.name, removed: await mcpRegistry(ctx).remove(owner, args.name) }
    },
    presentCall: args => ({ card: 'generic', title: `Remove MCP server ${args.name}`, kind: 'other', rawInput: { name: args.name } }),
  }))
}
