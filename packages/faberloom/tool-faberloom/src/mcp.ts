/**
 * Model-facing MCP server tools (`faberloom_mcp_*`): install a server the user
 * hands over (from its documentation, or from the facts spelled out), list the
 * installed servers, and remove one. Installation connects once to prove the
 * server works before saving it, so a server that cannot be reached is never
 * recorded, and every supplied secret is stored outside the durable record. A
 * server is saved for the user, so every workspace and Space of theirs can use
 * it.
 * @module @deepseek-ai/dsh-tool-faberloom/src/mcp
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
// Type-only: resolves the ctx.userQuestions declaration used through ctx.get.
import type {} from '@deepseek-ai/dsh-user-questions'
import { extractMcpDocumentation } from './mcp-extract.ts'
import type { McpExtractionRefusal, McpRequiredValue } from './mcp-extract.ts'
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
  /** The redacted reason the server's last mount attempt failed, or absent when it is mounted or untried. */
  readonly error?: string
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
    ...server.error === null ? {} : { error: server.error },
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

/** What one named documentation refusal means, in the model's terms. */
function describeRefusal(refusal: string): string {
  switch (refusal) {
    case 'empty': return 'the documentation is empty'
    case 'no-transport': return 'it names neither a local command to run nor a URL to call'
    case 'ambiguous-transport': return 'it names both a local command and a URL, so which one to run is unclear'
    default: return 'it does not describe how to reach the server'
  }
}

/** One already-installed server a new name collides with, as the tool reports it. */
interface McpCollision {
  /** The existing server's transport. */
  readonly transport: string
  /** Whether the existing server is enabled. */
  readonly enabled: boolean
  /** Whether the existing server is mounted right now. */
  readonly mounted: boolean
}

/** The saved server whose name a new install would replace, or null when the name is free. */
function collisionOf(servers: readonly FaberLoomMcpServer[], name: string): McpCollision | null {
  const existing = servers.find(server => server.name === name)
  if (existing === undefined) return null
  return { transport: existing.transport.transport, enabled: existing.enabled, mounted: existing.mounted }
}

/** Render how one colliding server stands, so its owner can decide. */
function describeCollisionState(collision: McpCollision): string {
  if (!collision.enabled) return 'disabled'
  return collision.mounted ? 'already working' : 'installed but not proven'
}

/** Require a map whose values are all text, or fail with a model-facing message. */
function textValues(values: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== 'string') throw new Error(`faberloom_mcp_install: every supplied value must be text; "${name}" is not`)
    result[name] = value
  }
  return result
}

/**
 * Ask the user for the values only they can supply, through the product's
 * question seam. An absent seam, or one where no answerer accepts the request,
 * yields no values: the caller then reports what is still missing instead of
 * installing with a guess.
 * @param ctx - context that may carry `userQuestions`.
 * @param serverName - the server the values belong to, for the question header.
 * @param missing - the values the documentation asks for and nobody supplied.
 * @returns the values the user gave, keyed by their exact name.
 */
async function askRequiredValues(
  ctx: Context,
  serverName: string,
  missing: readonly McpRequiredValue[],
): Promise<Record<string, string>> {
  const questions = ctx.get('userQuestions')
  if (questions === undefined) return {}
  try {
    const answer = await questions.ask({
      questions: missing.map(value => ({
        id: value.name,
        header: value.kind === 'environment' ? `Value for ${serverName}` : `Request header for ${serverName}`,
        question: `What value should "${value.name}" have?`,
        detail: value.meaning,
      })),
    })
    const values: Record<string, string> = {}
    for (const item of answer.answers) {
      const typed = item.custom === undefined ? '' : item.custom.trim()
      const chosen = item.selected[0] === undefined ? '' : item.selected[0].trim()
      const value = typed.length > 0 ? typed : chosen
      if (value.length > 0) values[item.id] = value
    }
    return values
  } catch (_unanswered) {
    return {}
  }
}

/** Render one installed server as a list line. */
function serverLine(server: McpServerRow): string {
  // An enabled server is available only once its client mounted, which is when
  // the connection was proven; an enabled server that did not mount is saved
  // but unproven, and the line says so instead of implying it works.
  const availability = server.enabled
    ? server.mounted ? 'enabled, proven, and available' : 'saved but not proven yet'
    : 'disabled'
  const credentials = server.credentials.length === 0
    ? 'no saved credentials'
    : `credentials: ${server.credentials.map(entry => `${entry.name} (${entry.kind}) ${entry.present ? 'present' : 'missing'}`).join(', ')}`
  const reason = server.error === undefined ? '' : `; last mount error: ${server.error}`
  return `- ${server.name} (${server.transport}: ${server.target}), ${availability}; ${credentials}${reason}`
}

/** Render the whole installed-server list. */
function serversText(servers: readonly McpServerRow[]): string {
  if (servers.length === 0) return 'No MCP servers are installed.'
  const heading = `${servers.length} MCP server${servers.length === 1 ? '' : 's'} for this user, available in every workspace and Space:`
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
    description: 'Install one MCP server the user asked for when you already know how it is reached: give it a local name and how to reach it, plus any value it authenticates with. The user may have many servers; this adds or replaces exactly one and leaves the others untouched. When the user hands you the server\'s documentation rather than its facts, use faberloom_mcp_install instead. The harness connects once to prove the server works before saving it. The stdio branch runs a local program; the streamable-http branch calls a network address. The user\'s own key or token belongs in env (environment variables) or headers (request headers) as a value, and is stored as their secret and never returned. A name that is already installed is reported with the existing server\'s state and nothing is saved unless replace is true, so a working server is never overwritten silently. If the server cannot be reached or rejects the credentials, nothing is saved and the reason is reported.',
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
      enabled: { type: 'boolean', description: 'Whether the server becomes available in every workspace and Space as soon as it is saved; defaults to true. Set false to save it without turning it on.' },
      replace: { type: 'boolean', description: 'Whether to replace an already-installed server of the same name. Defaults to false: a name already in use is reported and nothing is saved, so a working server is never overwritten silently. Set true only after the user chooses to reinstall, and pass a different name instead to keep both.' },
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
          collision: {
            type: 'object',
            additionalProperties: false,
            properties: {
              transport: { type: 'string', required: true },
              enabled: { type: 'boolean', required: true },
              mounted: { type: 'boolean', required: true },
            },
          },
          failure: { type: 'string' },
          detail: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.collision !== undefined) {
          return [{
            type: 'text' as const,
            text: `Nothing was installed: a server named "${value.name}" is already installed (${value.collision.transport}, ${describeCollisionState(value.collision)}). Pass a different name to keep both, or set replace=true to reinstall it.`,
          }]
        }
        if (value.saved) {
          return [{
            type: 'text' as const,
            text: value.tools.length === 0
              ? `Installed the MCP server "${value.name}". It offers no tools.`
              : `Installed the MCP server "${value.name}". It offers: ${value.tools.join(', ')}. Every workspace and Space of this user can use them now.`,
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
      const collision = collisionOf(await service.list(owner), name)
      if (collision !== null && args.replace !== true) {
        return { saved: false, name, transport: transport.transport, tools: [], collision }
      }
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
                error: { type: 'string' },
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
    description: 'Remove one installed MCP server by name and forget its saved credentials, so it stops being available in every workspace and Space. Removing a name that is not installed changes nothing.',
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

  ctx.tools.register(defineTool({
    name: 'faberloom_mcp_install',
    description: 'Install ONE more MCP server from the documentation the user handed over: paste the page (the text they gave you, including any `mcpServers` JSON block) and the harness reads how the server is reached and which values it needs. The user may have many servers, one per purpose; this adds exactly one and leaves the others working as before. It never invents a value: a value the documentation asks for but does not supply is asked of the user through the product question surface, and if that surface is unavailable you receive the list of missing values to ask the user for and then call this tool again with them. It connects once to prove the server works before saving; a server that cannot be reached or rejects a value is not saved, and the reason is reported. A name that is already installed is reported with the existing server\'s state and nothing is saved unless replace is true, so a working server is never overwritten silently. The server is saved for the user, so every workspace and Space of theirs can use it.',
    parameters: {
      documentation: { type: 'string', required: true, description: 'The MCP server documentation text, exactly as the user handed it over: prose, a fenced command, a server URL, or a `mcpServers` JSON block. Do not summarize it; paste it whole so no required value is dropped.' },
      name: { type: 'string', description: 'Local name for the server when you want to override the one the documentation suggests: 1 to 32 letters, digits, dashes, or underscores. Pass a different name when the suggested one is already installed and the user wants to keep both.' },
      values: { type: 'object', additionalProperties: true, description: 'Values the user supplied for the inputs the documentation asks for, keyed by their exact name (for example {"GITHUB_TOKEN": "..."}). Each value is stored as the user\'s secret and never returned. Never guess a value; omit anything the user has not given.' },
      enabled: { type: 'boolean', description: 'Whether the server becomes available in every workspace and Space as soon as it is saved; defaults to true.' },
      replace: { type: 'boolean', description: 'Whether to replace an already-installed server of the same name. Defaults to false: a name already in use is reported and nothing is saved, so a working server is never overwritten silently. Set true only after the user chooses to reinstall, and pass a different name instead to keep both.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          saved: { type: 'boolean', required: true },
          name: { type: 'string', required: true },
          scope: { type: 'string', required: true },
          transport: { type: 'string', required: true },
          tools: { type: 'array', required: true, items: { type: 'string' } },
          missing: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                meaning: { type: 'string', required: true },
              },
            },
          },
          collision: {
            type: 'object',
            additionalProperties: false,
            properties: {
              transport: { type: 'string', required: true },
              enabled: { type: 'boolean', required: true },
              mounted: { type: 'boolean', required: true },
            },
          },
          failure: { type: 'string' },
          detail: { type: 'string' },
          refusal: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.refusal !== undefined && value.refusal.length > 0) {
          return [{
            type: 'text' as const,
            text: `Nothing was installed: the documentation does not describe a server I can reach (${describeRefusal(value.refusal)}). It must name a local command to run or an absolute http(s) URL, with the credentials it needs.`,
          }]
        }
        if (value.collision !== undefined) {
          return [{
            type: 'text' as const,
            text: `Nothing was installed: a server named "${value.name}" is already installed (${value.collision.transport}, ${describeCollisionState(value.collision)}). Pass a different name to keep both, or set replace=true to reinstall it.`,
          }]
        }
        if (value.missing.length > 0) {
          const list = value.missing.map(entry => `${entry.name} (${entry.kind}) — ${entry.meaning}`).join('; ')
          return [{
            type: 'text' as const,
            text: `Nothing was installed: "${value.name}" needs ${value.missing.length === 1 ? 'a value' : 'values'} only you can give: ${list}. Ask the user for ${value.missing.length === 1 ? 'it' : 'them'}, then call this tool again with those values.`,
          }]
        }
        if (!value.saved) {
          const detail = value.detail === undefined || value.detail.length === 0 ? '' : ` The server said: ${value.detail}`
          return [{
            type: 'text' as const,
            text: `The MCP server "${value.name}" was not installed: ${describeFailure(value.failure)}.${detail} Nothing was saved.`,
          }]
        }
        const tools = value.tools.length === 0 ? 'It offers no tools.' : `It offers: ${value.tools.join(', ')}.`
        return [{
          type: 'text' as const,
          text: `Installed and tested the MCP server "${value.name}" for this user only; every workspace and Space of yours can use its tools. ${tools}`,
        }]
      },
    },
    execute: async (args) => {
      const service = mcpRegistry(ctx)
      const owner = ownerId()
      const plan = extractMcpDocumentation(args.documentation)
      const override = args.name === undefined ? '' : args.name.trim()
      const suggested = override.length > 0 ? override : plan.serverName
      if (plan.refusal !== null) {
        return {
          saved: false, name: suggested ?? '', scope: '', transport: '', tools: [], missing: [], refusal: plan.refusal,
        }
      }
      const name = serverName(suggested ?? '')
      const transport = plan.transport
      // `extractMcpDocumentation` returns a transport whenever it refuses
      // nothing, so this is unreachable; it keeps the branch total.
      if (transport === null) {
        return { saved: false, name, scope: '', transport: '', tools: [], missing: [], refusal: 'no-transport' satisfies McpExtractionRefusal }
      }
      const collision = collisionOf(await service.list(owner), name)
      if (collision !== null && args.replace !== true) {
        return { saved: false, name, scope: '', transport: transport.transport, tools: [], missing: [], collision }
      }
      const supplied = args.values === undefined ? {} : textValues(args.values)
      const provided: Record<string, string> = {}
      for (const [key, value] of Object.entries(supplied)) if (value.length > 0) provided[key] = value
      let missing = plan.required.filter(value => provided[value.name] === undefined)
      if (missing.length > 0) {
        const asked = await askRequiredValues(ctx, name, missing)
        for (const [key, value] of Object.entries(asked)) if (provided[key] === undefined) provided[key] = value
        missing = plan.required.filter(value => provided[value.name] === undefined)
      }
      if (missing.length > 0) {
        return {
          saved: false,
          name,
          scope: '',
          transport: transport.transport,
          tools: [],
          missing: missing.map(value => ({ name: value.name, kind: value.kind, meaning: value.meaning })),
        }
      }
      const env: Record<string, string> = {}
      const headers: Record<string, string> = {}
      for (const value of plan.required) {
        const text = provided[value.name]
        if (text === undefined) continue
        if (value.kind === 'environment') env[value.name] = text
        else headers[value.name] = text
      }
      const input: McpServerInput = {
        name,
        transport,
        ...Object.keys(env).length === 0 ? {} : { env },
        ...Object.keys(headers).length === 0 ? {} : { headers },
        ...args.enabled === undefined ? {} : { enabled: args.enabled },
      }
      const verdict = await service.probe(input)
      if (!verdict.ok) {
        return {
          saved: false, name, scope: '', transport: transport.transport, tools: [], missing: [],
          failure: verdict.failure, detail: verdict.detail,
        }
      }
      const saved = await service.save(owner, input)
      return {
        saved: true, name: saved.name, scope: 'user', transport: saved.transport.transport,
        tools: [...verdict.tools], missing: [],
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Install MCP server from documentation',
      kind: 'other',
      rawInput: args.name === undefined ? {} : { name: args.name },
    }),
  }))
}
