/**
 * Model-facing product tools over the native product services. The gateway
 * injects the authenticated user as `ownerId` in this plugin's config; every
 * call acts as that identity. The tool set grows with the domain slices.
 * @module @deepseek-ai/dsh-tool-faberloom
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
// Type-only: resolves the ctx.faberloomSpaces declaration used through ctx.get.
import type { FaberLoomSpaceId, FaberLoomSpaces, SpaceActor, SpaceContext, SpaceSource } from '@deepseek-ai/dsh-faberloom-spaces'
// Type-only: the agents service, read through ctx.get like the spaces service.
import type { FaberLoomAgentId, FaberLoomAgents, FaberLoomModelId, PolicyPatch } from '@deepseek-ai/dsh-faberloom-agents'
// Type-only: the board service and its vocabulary, read through ctx.get.
import type { BoardStatus, FaberLoomBoard, FaberLoomBoardItemId } from '@deepseek-ai/dsh-faberloom-board'
import type {} from '@deepseek-ai/dsh-faberloom-access'
// Type-only: the mail services (outgoing through connections, incoming search through inbound).
import type { FaberLoomConnections } from '@deepseek-ai/dsh-faberloom-connections'
import type { FaberLoomInbound } from '@deepseek-ai/dsh-faberloom-inbound'
// Type-only: the system prompt registry, read through ctx.get like the product services.
import type { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
// Type-only: the routines service and its vocabulary, also read through ctx.get.
import type {
  ExecutionStatus,
  FaberLoomExecutionId,
  FaberLoomRoutineId,
  FaberLoomRoutines,
  IngestEvent,
  RoutineDefinitionInput,
} from '@deepseek-ai/dsh-faberloom-routines'

export const name = 'tool-faberloom'
// `faberloomSpaces` is read through `ctx.get` when a call runs, not injected:
// the tool schemas must register even where the space service is not mounted
// (schema harvesters and compositions without the product modules).
export const inject = ['tools']

/** Deployment-supplied identity: the authenticated user this process acts for. */
export interface Config {
  /** The gateway injects the logged-in user's email here, per dsh process. */
  ownerId?: string
  /** The console role from the login response. */
  role?: string
  /** The user's single company id, when they have exactly one. */
  companyId?: string
  /** Every company the user belongs to (console `legal_entity_ids`); the tenant router queries them. */
  companyIds?: string[]
  /** Whether the console role is read-only. */
  readOnly?: boolean
  /** Internal MWT MCP URL, injected by the gateway so tools can validate sources. */
  mcpUrl?: string
  /** Shared gateway key for the internal MWT MCP, injected by the gateway. */
  mcpGatewayKey?: string
}

/** Schemastery configuration for the product tools. */
export const Config: z<Config> = z.object({
  ownerId: z.string(),
  role: z.string(),
  companyId: z.string(),
  companyIds: z.array(z.string()).default([]),
  readOnly: z.boolean(),
  mcpUrl: z.string(),
  mcpGatewayKey: z.string(),
})

/** Resolve the mounted board service at call time, or fail loud. */
function board(ctx: Context): FaberLoomBoard {
  const service = ctx.get('faberloomBoard')
  if (service === undefined) throw new Error('faberloom: the board service is not mounted')
  return service
}

/** Resolve the mounted routines service at call time, or fail loud. */
function routines(ctx: Context): FaberLoomRoutines {
  const service = ctx.get('faberloomRoutines')
  if (service === undefined) throw new Error('faberloom: the routines service is not mounted')
  return service
}

/** Resolve the mounted agents service at call time, or fail loud. */
function agents(ctx: Context): FaberLoomAgents {
  const service = ctx.get('faberloomAgents')
  if (service === undefined) throw new Error('faberloom: the agents service is not mounted')
  return service
}

/** Resolve the mounted connections service at call time, or fail loud. */
function connections(ctx: Context): FaberLoomConnections {
  const service = ctx.get('faberloomConnections')
  if (service === undefined) throw new Error('faberloom: the connections service is not mounted')
  return service
}

/** Resolve the mounted inbound receiver at call time, or fail loud. */
function inbound(ctx: Context): FaberLoomInbound {
  const service = ctx.get('faberloomInbound')
  if (service === undefined) throw new Error('faberloom: the inbound receiver is not mounted')
  return service
}

/**
 * Refuse an operation that acts for the owner unless a grant allows it.
 *
 * This is the soft guard: the engine's hard guard stops an effectful step, and
 * this one stops the model from taking the decision itself. It explains which
 * action is missing instead of failing with a bare denial, so a reader can go to
 * Conexiones and grant exactly that action.
 * @param ctx - context carrying the access service.
 * @param config - deployment identity.
 * @param action - the action about to run.
 * @param context - the object the grant may be scoped to, when any.
 */
async function authorize(ctx: Context, config: Config, action: string, context?: string): Promise<void> {
  const access = ctx.get('faberloomAccess')
  if (access === undefined) throw new Error('faberloom: the access service is not mounted, so this action cannot be authorised')
  const decision = await access.check({
    ownerId: actor(config).id,
    action,
    ...context === undefined ? {} : { context },
  })
  if (!decision.allowed) {
    throw new Error(`faberloom: ${action} needs a grant (${decision.reason}); the owner grants it in Conexiones, Permisos y autonomia`)
  }
}

/** Build a model-policy patch from the flat tool parameters, when any is present. */
function policyFromArgs(args: {
  primary?: string
  exclusive?: boolean
  fallbacks?: readonly string[]
  escalationAuthorized?: readonly string[]
  escalationConditions?: readonly string[]
  escalationMode?: string
  budgetPerExecution?: number
  budgetCurrency?: string
  budgetMaxAttempts?: number
  budgetMaxEscalations?: number
}): PolicyPatch | undefined {
  const patch: {
    primary?: FaberLoomModelId | null
    exclusive?: boolean
    fallbacks?: readonly FaberLoomModelId[]
    escalation?: { authorized: readonly FaberLoomModelId[]; conditions: readonly string[]; mode: 'auto' | 'manual' }
    budget?: { perExecution: number; currency: string; maxAttempts: number; maxEscalations: number }
  } = {}
  let present = false
  if (args.primary !== undefined) { patch.primary = args.primary === '' ? null : args.primary as FaberLoomModelId; present = true }
  if (args.exclusive !== undefined) { patch.exclusive = args.exclusive; present = true }
  if (args.fallbacks !== undefined) { patch.fallbacks = args.fallbacks as readonly FaberLoomModelId[]; present = true }
  if (args.escalationAuthorized !== undefined || args.escalationConditions !== undefined || args.escalationMode !== undefined) {
    patch.escalation = {
      authorized: (args.escalationAuthorized ?? []) as readonly FaberLoomModelId[],
      conditions: args.escalationConditions ?? [],
      mode: args.escalationMode === 'auto' ? 'auto' : 'manual',
    }
    present = true
  }
  if (args.budgetPerExecution !== undefined) {
    patch.budget = {
      perExecution: args.budgetPerExecution,
      currency: args.budgetCurrency ?? 'USD',
      maxAttempts: args.budgetMaxAttempts ?? 3,
      maxEscalations: args.budgetMaxEscalations ?? 1,
    }
    present = true
  }
  return present ? patch : undefined
}

/** The flat policy parameters shared by agent create and update. */
const POLICY_PARAMS = {
  primary: { type: 'string' as const, description: 'Primary model id; empty string clears it.' },
  exclusive: { type: 'boolean' as const, description: 'Use this model exclusively: never substitute.' },
  fallbacks: { type: 'array' as const, description: 'Ordered fallback model ids.', items: { type: 'string' as const } },
  escalationAuthorized: { type: 'array' as const, description: 'Model ids authorized for escalation.', items: { type: 'string' as const } },
  escalationConditions: { type: 'array' as const, description: 'Conditions that justify escalating.', items: { type: 'string' as const } },
  escalationMode: { type: 'string' as const, enum: ['auto', 'manual'], description: 'auto proceeds within limits; manual asks first.' },
  budgetPerExecution: { type: 'number' as const, description: 'Maximum estimated cost for the whole execution.' },
  budgetCurrency: { type: 'string' as const, description: 'Budget currency.' },
  budgetMaxAttempts: { type: 'integer' as const, description: 'Maximum provider attempts.' },
  budgetMaxEscalations: { type: 'integer' as const, description: 'Maximum escalations.' },
}

/** Resolve the mounted spaces service at call time, or fail loud. */
function spaces(ctx: Context): FaberLoomSpaces {
  const service = ctx.get('faberloomSpaces')
  if (service === undefined) throw new Error('faberloom: the spaces service is not mounted')
  return service
}

/** Build the acting identity from the injected config, or fail loud. */
function actor(config: Config): SpaceActor {
  const ownerId = config.ownerId
  if (ownerId === undefined || ownerId.length === 0) {
    throw new Error('faberloom: no authenticated identity (the gateway must inject tool-faberloom ownerId)')
  }
  const companyId = config.companyId
  return {
    id: ownerId,
    role: config.role ?? 'client_b2b',
    companyId: companyId === undefined || companyId.length === 0 ? undefined : companyId,
    readOnly: config.readOnly === true,
  }
}

/** Facts needed to query MWT.ONE as the acting identity. */
interface McpFacts {
  readonly url: string
  readonly gatewayKey: string
  readonly email: string
  readonly role: string
  readonly companyId: string | undefined
  /** Every company the identity belongs to; the tenant router may address each one. */
  readonly companyIds: readonly string[]
}

/** Build the MCP connection facts, or fail loud when the gateway did not inject them. */
function mcpFacts(config: Config, identity: SpaceActor): McpFacts {
  const url = config.mcpUrl
  const gatewayKey = config.mcpGatewayKey
  if (url === undefined || url.length === 0 || gatewayKey === undefined || gatewayKey.length === 0) {
    throw new Error('faberloom: MWT connection facts are not injected; cannot validate commercial sources')
  }
  return { url, gatewayKey, email: identity.id, role: identity.role, companyId: identity.companyId, companyIds: config.companyIds ?? [] }
}

/** One JSON-RPC tools/call against the MWT MCP as the acting identity. */
async function mcpCall(facts: McpFacts, name: string, args: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'X-Forwarded-User-Email': facts.email,
    'X-MWT-Gateway-Key': facts.gatewayKey,
    Authorization: 'Bearer dsh-gateway',
  }
  if (facts.companyId !== undefined) headers['X-MWT-Client-ID'] = facts.companyId
  const post = async (body: unknown, sessionId?: string) => {
    const response = await fetch(facts.url, {
      method: 'POST',
      headers: sessionId === undefined ? headers : { ...headers, 'mcp-session-id': sessionId },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
    const sid = response.headers.get('mcp-session-id') ?? sessionId
    const text = await response.text()
    let json: unknown
    try {
      if (text.trim().startsWith('{')) json = JSON.parse(text)
      else {
        const dataLine = text.split('\n').find(line => line.startsWith('data:'))
        json = dataLine === undefined ? undefined : JSON.parse(dataLine.slice(5).trim())
      }
    } catch {
      json = undefined
    }
    return { sid, json }
  }
  const init = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'faberloom', version: '1' } },
  })
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, init.sid)
  const call = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, init.sid)
  const content = (call.json as { result?: { content?: { type?: string; text?: string }[] } } | undefined)?.result?.content
  const textPart = Array.isArray(content) ? content.find(part => part.type === 'text') : undefined
  if (textPart?.text === undefined) return call.json
  try {
    return JSON.parse(textPart.text)
  } catch {
    return textPart.text
  }
}

/**
 * Resolve the tenant one call should address. An omitted company keeps the
 * session's active one; an explicit one must belong to the identity — the
 * router never lets a call leave the user's own `legal_entity_ids`.
 * @param facts - the identity's MCP connection facts.
 * @param company - the requested company id, or undefined for the active one.
 * @returns the tenant to send as `X-MWT-Client-ID`, or undefined for tenantless.
 */
function tenant(facts: McpFacts, company: string | undefined): string | undefined {
  if (company === undefined || company.trim().length === 0) return facts.companyId
  const wanted = company.trim().toLowerCase()
  const match = facts.companyIds.find(id => id.toLowerCase() === wanted)
  if (match === undefined) {
    throw new Error(`faberloom: ${company} no es una empresa de este usuario; las suyas: ${facts.companyIds.join(', ') || '(ninguna)'}`)
  }
  return match.toLowerCase()
}

/** Whether one MWT result carries data, for the fan-out "which company has it" answer. */
function hasData(data: unknown): boolean {
  if (data === null || data === undefined) return false
  if (Array.isArray(data)) return data.length > 0
  if (typeof data === 'object') return Object.keys(data).length > 0
  if (typeof data === 'string') return data.trim().length > 0
  return true
}

/** Validate one commercial source against MWT.ONE, as the acting identity. */
async function validateSource(facts: McpFacts, source: SpaceSource): Promise<{ valid: boolean; detail: string }> {
  if (source.kind === 'mwt-company') {
    const inScope = facts.role === 'admin' || facts.companyId === undefined || facts.companyId === source.id
    return inScope
      ? { valid: true, detail: `company ${source.id} is within the identity scope` }
      : { valid: false, detail: `company ${source.id} is outside the identity scope` }
  }
  if (source.kind === 'mwt-product') {
    try {
      const data = await mcpCall(facts, 'producto_buscar', { q: source.id }) as { productos?: { sku?: string }[] }
      const productos = Array.isArray(data?.productos) ? data.productos : []
      const found = productos.some(product => String(product.sku ?? '').toLowerCase() === source.id.toLowerCase())
      return found
        ? { valid: true, detail: `SKU ${source.id} exists in MWT.ONE` }
        : { valid: false, detail: `SKU ${source.id} not found in MWT.ONE` }
    } catch (error) {
      return { valid: false, detail: `could not validate SKU ${source.id}: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  try {
    const data = await mcpCall(facts, 'cliente_obtener', { cliente_id: source.id }) as { id?: string; cliente_id?: string } | undefined
    const found = data !== undefined && (data.id !== undefined || data.cliente_id !== undefined)
    return found
      ? { valid: true, detail: `client ${source.id} exists in MWT.ONE` }
      : { valid: false, detail: `client ${source.id} not found in MWT.ONE` }
  } catch (error) {
    return { valid: false, detail: `could not validate client ${source.id}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Convert a `{ key, value }` entry list into the context record. */
function toContext(entries: readonly { key: string; value: string }[] | undefined): SpaceContext | undefined {
  if (entries === undefined) return undefined
  const context: SpaceContext = {}
  for (const entry of entries) context[entry.key] = entry.value
  return context
}

/** A tool parameter list of `{ key, value }` context entries, used by update. */
const CONTEXT_ENTRIES = {
  type: 'array',
  description: 'Context entries to set, replacing the space context.',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      key: { type: 'string', required: true, description: 'Context topic.' },
      value: { type: 'string', required: true, description: 'Context value.' },
    },
  },
} as const

/** The standard `id` parameter shared by the read/mutate tools. */
const ID_PARAM = { type: 'string', required: true, description: 'Target space id.' } as const

/**
 * Register the product tools on the calling agent's tool registry.
 * @param ctx - Cordis context carrying `tools` and the product services.
 * @param config - deployment config; `ownerId` is the acting identity.
 */
export function apply(ctx: Context, config: Config): void {
  // The mention rules the assistant follows when a message opens with @agent
  // or /skill; additive section, never a persona replacement.
  const prompt = ctx.get('systemPrompt') as SystemPrompt | undefined
  if (prompt !== undefined) {
    ctx.effect(() => prompt.section({
      name: 'faberloom:mentions',
      order: prompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 1,
      text: 'Un mensaje que empieza con @Nombre se dirige al agente de ese nombre del catálogo: actúa como ese especialista (su responsabilidad, contexto y política de modelo) usando las tools faberloom_agents_*, en vez de responder como generalista. Un mensaje que empieza con /nombre invoca la skill de ese nombre. Si el nombre no existe, dilo y ofrece los disponibles con faberloom_agents_list.',
    }), 'tool-faberloom: mention prompt')
  }

  ctx.tools.register(defineTool({
    name: 'faberloom_spaces_create',
    description: 'Create a product space: a topic that groups related work, documents, and agents.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short human-readable name for the space.' },
      parentId: { type: 'string', description: 'Existing space id to nest under, when a sub-space is intended.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Created space ${value.title} (${value.id}).` }],
    },
    execute: async (args) => {
      const space = await spaces(ctx).create(actor(config), {
        title: args.title,
        ...args.parentId === undefined ? {} : { parentId: args.parentId as FaberLoomSpaceId },
      })
      return { id: space.id, title: space.title }
    },
    presentCall: args => ({ card: 'generic', title: 'Create product space', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_spaces_list',
    description: 'List the product spaces owned by the current user.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          spaces: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                archived: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Product spaces: ${value.spaces.map(space => space.title).join(', ') || 'none'}.`,
      }],
    },
    execute: async () => {
      const records = await spaces(ctx).list(actor(config))
      return { spaces: records.map(space => ({ id: space.id, title: space.title, archived: space.archived })) }
    },
    presentCall: () => ({ card: 'generic', title: 'List product spaces', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_spaces_get',
    description: 'Read one product space by id.',
    parameters: { id: ID_PARAM },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.found ? `Space ${value.title} (${value.id}).` : `No space ${value.id}.`,
      }],
    },
    execute: async (args) => {
      const space = await spaces(ctx).get(actor(config), args.id as FaberLoomSpaceId)
      return { found: true, id: space.id, title: space.title }
    },
    presentCall: args => ({ card: 'generic', title: 'Read product space', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_spaces_update',
    description: 'Update one product space: title, inheritance, exclusions, members, or context.',
    parameters: {
      id: ID_PARAM,
      title: { type: 'string', description: 'New display title.' },
      inheritContext: { type: 'boolean', description: 'Whether the space inherits ancestors context.' },
      excluded: { type: 'array', description: 'Ancestor space ids whose context must not be inherited.', items: { type: 'string' } },
      members: { type: 'array', description: 'Identities allowed to read the space.', items: { type: 'string' } },
      context: CONTEXT_ENTRIES,
      sources: {
        type: 'array',
        description: 'MWT.ONE commercial sources to consult (directives, not copies).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: ['mwt-company', 'mwt-client', 'mwt-product'], description: 'Source kind.' },
            id: { type: 'string', required: true, description: 'MWT.ONE record id.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          version: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Updated space ${value.id} to version ${String(value.version)}.` }],
    },
    execute: async (args) => {
      const patch: {
        title?: string
        inheritContext?: boolean
        excluded?: FaberLoomSpaceId[]
        members?: string[]
        context?: SpaceContext
        sources?: SpaceSource[]
      } = {}
      if (args.title !== undefined) patch.title = args.title
      if (args.inheritContext !== undefined) patch.inheritContext = args.inheritContext
      if (args.excluded !== undefined) patch.excluded = args.excluded as FaberLoomSpaceId[]
      if (args.members !== undefined) patch.members = args.members
      const context = toContext(args.context)
      if (context !== undefined) patch.context = context
      if (args.sources !== undefined) {
        patch.sources = (args.sources as readonly { kind: SpaceSource['kind']; id: string }[])
          .map(source => ({ kind: source.kind, id: source.id }))
        const facts = mcpFacts(config, actor(config))
        for (const source of patch.sources) {
          const verdict = await validateSource(facts, source)
          if (!verdict.valid) throw new Error(`faberloom: source rejected — ${verdict.detail}`)
        }
      }
      const space = await spaces(ctx).update(actor(config), args.id as FaberLoomSpaceId, patch)
      return { id: space.id, version: space.version }
    },
    presentCall: args => ({ card: 'generic', title: 'Update product space', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_spaces_effective_context',
    description: 'Resolve a space effective context: inherited plus local, minus exclusions, with conflicts surfaced.',
    parameters: { id: ID_PARAM },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resolved: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                key: { type: 'string', required: true },
                value: { type: 'string', required: true },
              },
            },
          },
          conflicts: { type: 'array', required: true, items: { type: 'string' } },
          sources: { type: 'array', required: true, items: { type: 'string' } },
          dataSources: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true },
                id: { type: 'string', required: true },
              },
            },
          },
          directives: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Effective context: ${value.resolved.map(entry => entry.key).join(', ') || 'none'}; conflicts: ${value.conflicts.join(', ') || 'none'}; MWT directives: ${String(value.directives.length)}.`,
      }],
    },
    execute: async (args) => {
      const context = await spaces(ctx).effectiveContext(actor(config), args.id as FaberLoomSpaceId)
      return {
        resolved: Object.entries(context.resolved).map(([key, value]) => ({ key, value })),
        conflicts: context.conflicts.map(conflict => conflict.key),
        sources: [...context.sources],
        dataSources: context.dataSources.map(source => ({ kind: source.kind, id: source.id })),
        directives: [...context.directives],
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Resolve space context', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_spaces_resolve_workdir',
    description: 'Resolve an opaque working-directory reference for a space (never a filesystem path).',
    parameters: { id: ID_PARAM },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ref: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Working-directory reference ${value.ref}.` }],
    },
    execute: async (args) => {
      const reference = await spaces(ctx).resolveWorkdir(actor(config), args.id as FaberLoomSpaceId)
      return { ref: reference.ref }
    },
    presentCall: args => ({ card: 'generic', title: 'Resolve space workdir', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_spaces_preview_link',
    description: 'Preview the audience and shared material before linking private work to a space.',
    parameters: { id: ID_PARAM },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          newlyVisibleTo: { type: 'array', required: true, items: { type: 'string' } },
          sharedContextKeys: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Linking would show material to: ${value.newlyVisibleTo.join(', ') || 'no one'}.`,
      }],
    },
    execute: async (args) => {
      const preview = await spaces(ctx).previewLink(actor(config), args.id as FaberLoomSpaceId)
      return { newlyVisibleTo: [...preview.newlyVisibleTo], sharedContextKeys: [...preview.sharedContextKeys] }
    },
    presentCall: args => ({ card: 'generic', title: 'Preview space link', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_spaces_archive',
    description: 'Archive one product space the current user owns.',
    parameters: { id: ID_PARAM },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          archived: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Archived space ${value.id}.` }],
    },
    execute: async (args) => {
      const space = await spaces(ctx).archive(actor(config), args.id as FaberLoomSpaceId)
      return { id: space.id, archived: space.archived }
    },
    presentCall: args => ({ card: 'generic', title: 'Archive product space', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_spaces_validate_source',
    description: 'Check that a commercial source (company, client, or SKU) exists in MWT.ONE for this user.',
    parameters: {
      kind: { type: 'string', required: true, enum: ['mwt-company', 'mwt-client', 'mwt-product'], description: 'Source kind.' },
      id: { type: 'string', required: true, description: 'MWT.ONE record id or SKU.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          valid: { type: 'boolean', required: true },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.detail }],
    },
    execute: async (args) => {
      const facts = mcpFacts(config, actor(config))
      const verdict = await validateSource(facts, { kind: args.kind as SpaceSource['kind'], id: args.id })
      return { valid: verdict.valid, detail: verdict.detail }
    },
    presentCall: args => ({ card: 'generic', title: 'Validate MWT source', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_spaces_attach_file',
    description: 'Attach a small file (up to 1 MiB) to a product space the user manages.',
    parameters: {
      id: ID_PARAM,
      name: { type: 'string', required: true, description: 'Original file name.' },
      mediaType: { type: 'string', description: 'Media type; defaults to text/plain.' },
      contentBase64: { type: 'string', required: true, description: 'File bytes, base64-encoded.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fileId: { type: 'string', required: true },
          size: { type: 'integer', required: true },
          sha256: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Attached file ${value.fileId} (${String(value.size)} bytes).` }],
    },
    execute: async (args) => {
      const file = await spaces(ctx).attachFile(actor(config), args.id as FaberLoomSpaceId, {
        name: args.name,
        mediaType: args.mediaType ?? 'text/plain',
        contentBase64: args.contentBase64,
      })
      return { fileId: file.id, size: file.size, sha256: file.sha256 }
    },
    presentCall: args => ({ card: 'generic', title: 'Attach file to space', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_spaces_list_files',
    description: 'List the files attached to a product space.',
    parameters: { id: ID_PARAM },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          files: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                size: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Files: ${value.files.map(file => file.name).join(', ') || 'none'}.` }],
    },
    execute: async (args) => {
      const files = await spaces(ctx).listFiles(actor(config), args.id as FaberLoomSpaceId)
      return { files: files.map(file => ({ id: file.id, name: file.name, size: file.size })) }
    },
    presentCall: args => ({ card: 'generic', title: 'List space files', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_spaces_read_file',
    description: 'Read one file attached to a product space.',
    parameters: { fileId: { type: 'string', required: true, description: 'Attached file id.' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          mediaType: { type: 'string', required: true },
          contentBase64: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `File ${value.name} (${value.mediaType}), ${String(Math.floor(value.contentBase64.length * 3 / 4))} bytes.`,
      }],
    },
    execute: async (args) => {
      const file = await spaces(ctx).readFile(actor(config), args.fileId)
      return { name: file.name, mediaType: file.mediaType, contentBase64: file.contentBase64 }
    },
    presentCall: args => ({ card: 'generic', title: 'Read space file', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_models_register',
    description: 'Register an accessible model in the product model pool (provider, model, capabilities, limits, rates).',
    parameters: {
      provider: { type: 'string', required: true, description: 'Provider name.' },
      model: { type: 'string', required: true, description: 'Provider model id.' },
      capabilities: { type: 'array', description: 'Capability tags (text, vision, tools).', items: { type: 'string' } },
      contextWindow: { type: 'integer', description: 'Context window in tokens.' },
      inputPerMillion: { type: 'number', description: 'Input price per million tokens.' },
      outputPerMillion: { type: 'number', description: 'Output price per million tokens.' },
      currency: { type: 'string', description: 'Rate currency.' },
      available: { type: 'boolean', description: 'Whether the provider is reachable now.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', required: true }, provider: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Registered model ${value.id} (${value.provider}).` }],
    },
    execute: async (args) => {
      const model = await agents(ctx).registerModel({
        provider: args.provider,
        model: args.model,
        ...args.capabilities === undefined ? {} : { capabilities: args.capabilities },
        ...args.contextWindow === undefined ? {} : { contextWindow: args.contextWindow },
        ...args.inputPerMillion === undefined ? {} : { inputPerMillion: args.inputPerMillion },
        ...args.outputPerMillion === undefined ? {} : { outputPerMillion: args.outputPerMillion },
        ...args.currency === undefined ? {} : { currency: args.currency },
        ...args.available === undefined ? {} : { available: args.available },
      })
      return { id: model.id, provider: model.provider }
    },
    presentCall: args => ({ card: 'generic', title: 'Register model', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_models_list',
    description: 'List the models in the product pool.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          models: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                provider: { type: 'string', required: true },
                model: { type: 'string', required: true },
                available: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Models: ${value.models.map(model => model.model).join(', ') || 'none'}.` }],
    },
    execute: async () => {
      const models = await agents(ctx).listModels()
      return { models: models.map(model => ({ id: model.id, provider: model.provider, model: model.model, available: model.available })) }
    },
    presentCall: () => ({ card: 'generic', title: 'List models', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_agents_create',
    description: 'Create a product agent from scratch, from the pool, or from a task, with its model policy.',
    parameters: {
      name: { type: 'string', required: true, description: 'Agent name.' },
      responsibility: { type: 'string', required: true, description: 'What the agent is responsible for.' },
      origin: { type: 'string', enum: ['scratch', 'pool', 'task'], description: 'Creation route.' },
      spaceId: { type: 'string', description: 'Owning space id.' },
      skills: { type: 'array', description: 'Skill names.', items: { type: 'string' } },
      tools: { type: 'array', description: 'Tool names the agent may execute.', items: { type: 'string' } },
      ...POLICY_PARAMS,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', required: true }, version: { type: 'integer', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Created agent ${value.id} (v${String(value.version)}).` }],
    },
    execute: async (args) => {
      const policy = policyFromArgs(args)
      const agent = await agents(ctx).createAgent({
        name: args.name,
        responsibility: args.responsibility,
        ...args.origin === undefined ? {} : { origin: args.origin as 'scratch' | 'pool' | 'task' },
        ...args.spaceId === undefined ? {} : { spaceId: args.spaceId },
        ...args.skills === undefined ? {} : { skills: args.skills },
        ...args.tools === undefined ? {} : { tools: args.tools },
        ...policy === undefined ? {} : { policy },
      })
      return { id: agent.id, version: agent.version }
    },
    presentCall: args => ({ card: 'generic', title: 'Create agent', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_agents_list',
    description: 'List the product agent catalog.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agents: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                active: { type: 'boolean', required: true },
                version: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Agents: ${value.agents.map(agent => agent.name).join(', ') || 'none'}.` }],
    },
    execute: async () => {
      const list = await agents(ctx).listAgents()
      return { agents: list.map(agent => ({ id: agent.id, name: agent.name, active: agent.active, version: agent.version })) }
    },
    presentCall: () => ({ card: 'generic', title: 'List agents', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_agents_update',
    description: 'Edit a product agent: responsibility, skills, tools, subagents, lessons, and model policy.',
    parameters: {
      id: ID_PARAM,
      name: { type: 'string', description: 'New name.' },
      responsibility: { type: 'string', description: 'New responsibility.' },
      skills: { type: 'array', description: 'New skill names.', items: { type: 'string' } },
      tools: { type: 'array', description: 'New tool names.', items: { type: 'string' } },
      lessons: { type: 'array', description: 'New portable teachings.', items: { type: 'string' } },
      subagents: {
        type: 'array',
        description: 'Named persistent subagents.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            agentId: { type: 'string', required: true },
          },
        },
      },
      ...POLICY_PARAMS,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', required: true }, version: { type: 'integer', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Updated agent ${value.id} to v${String(value.version)}.` }],
    },
    execute: async (args) => {
      const policy = policyFromArgs(args)
      const agent = await agents(ctx).updateAgent(args.id as FaberLoomAgentId, {
        ...args.name === undefined ? {} : { name: args.name },
        ...args.responsibility === undefined ? {} : { responsibility: args.responsibility },
        ...args.skills === undefined ? {} : { skills: args.skills },
        ...args.tools === undefined ? {} : { tools: args.tools },
        ...args.lessons === undefined ? {} : { lessons: args.lessons },
        ...args.subagents === undefined
          ? {}
          : { subagents: args.subagents.map(entry => ({ name: entry.name, agentId: entry.agentId as FaberLoomAgentId })) },
        ...policy === undefined ? {} : { policy },
      })
      return { id: agent.id, version: agent.version }
    },
    presentCall: args => ({ card: 'generic', title: 'Update agent', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_agents_duplicate',
    description: 'Duplicate a product agent: configuration plus explicitly selected lessons, never its confidence.',
    parameters: {
      id: ID_PARAM,
      name: { type: 'string', required: true, description: 'Name for the copy.' },
      spaceId: { type: 'string', description: 'Owning space id for the copy.' },
      lessons: { type: 'array', description: 'Portable teachings to copy.', items: { type: 'string' } },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Duplicated agent as ${value.id}.` }],
    },
    execute: async (args) => {
      const copy = await agents(ctx).duplicateAgent(args.id as FaberLoomAgentId, {
        name: args.name,
        ...args.spaceId === undefined ? {} : { spaceId: args.spaceId },
        ...args.lessons === undefined ? {} : { lessons: args.lessons },
      })
      return { id: copy.id }
    },
    presentCall: args => ({ card: 'generic', title: 'Duplicate agent', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_agents_deactivate',
    description: 'Deactivate a product agent; the record stays in the catalog.',
    parameters: { id: ID_PARAM },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', required: true }, active: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Agent ${value.id} active=${String(value.active)}.` }],
    },
    execute: async (args) => {
      const agent = await agents(ctx).deactivateAgent(args.id as FaberLoomAgentId)
      return { id: agent.id, active: agent.active }
    },
    presentCall: args => ({ card: 'generic', title: 'Deactivate agent', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_agents_resolve_model',
    description: 'Resolve the effective model for a task under the agent policy and shared budget.',
    parameters: {
      id: ID_PARAM,
      task: { type: 'string', required: true, description: 'Task label.' },
      providerDown: { type: 'boolean', description: 'Whether the primary provider is unavailable.' },
      condition: { type: 'string', description: 'A met escalation condition.' },
      spent: { type: 'number', description: 'Estimated cost already spent in the execution.' },
      attempted: { type: 'integer', description: 'Attempts already made.' },
      escalated: { type: 'integer', description: 'Escalations already used.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          modelId: { type: 'string', required: true },
          reason: { type: 'string', required: true },
          policyVersion: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Resolve: ${value.status} (${value.reason}) model=${value.modelId}.` }],
    },
    execute: async (args) => {
      const result = await agents(ctx).resolveModel(args.id as FaberLoomAgentId, {
        task: args.task,
        ...args.providerDown === undefined ? {} : { providerDown: args.providerDown },
        ...args.condition === undefined ? {} : { condition: args.condition },
        ...args.spent === undefined ? {} : { spent: args.spent },
        ...args.attempted === undefined ? {} : { attempted: args.attempted },
        ...args.escalated === undefined ? {} : { escalated: args.escalated },
      })
      return { status: result.status, modelId: result.modelId ?? '', reason: result.reason, policyVersion: result.policyVersion }
    },
    presentCall: args => ({ card: 'generic', title: 'Resolve model', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_agents_recommend_model',
    description: 'Recommend an accessible model by cost per useful result, with explicit uncertainty.',
    parameters: {
      capabilities: { type: 'array', description: 'Required capability tags.', items: { type: 'string' } },
      minContextWindow: { type: 'integer', description: 'Minimum context window.' },
      task: { type: 'string', description: 'Task label to weight evidence.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          recommended: { type: 'string', required: true },
          uncertainty: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Recommended: ${value.recommended || 'none'}; uncertainty: ${String(value.uncertainty.length)}.`,
      }],
    },
    execute: async (args) => {
      const result = await agents(ctx).recommendModel({
        ...args.capabilities === undefined ? {} : { capabilities: args.capabilities },
        ...args.minContextWindow === undefined ? {} : { minContextWindow: args.minContextWindow },
        ...args.task === undefined ? {} : { task: args.task },
      })
      return { recommended: result.recommended ?? '', uncertainty: [...result.uncertainty] }
    },
    presentCall: args => ({ card: 'generic', title: 'Recommend model', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_agents_record_outcome',
    description: 'Record one human outcome (approved or corrected) for an agent/model/task.',
    parameters: {
      id: ID_PARAM,
      task: { type: 'string', required: true, description: 'Task label.' },
      modelId: { type: 'string', required: true, description: 'Model that produced the result.' },
      outcome: { type: 'string', required: true, enum: ['approved', 'corrected'], description: 'Approved unchanged or corrected.' },
      cost: { type: 'number', description: 'Real cost of the attempt, when known.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Recorded outcome ${value.id}.` }],
    },
    execute: async (args) => {
      const outcome = await agents(ctx).recordOutcome({
        agentId: args.id as FaberLoomAgentId,
        task: args.task,
        modelId: args.modelId as FaberLoomModelId,
        outcome: args.outcome as 'approved' | 'corrected',
        ...args.cost === undefined ? {} : { cost: args.cost },
      })
      return { id: outcome.id }
    },
    presentCall: args => ({ card: 'generic', title: 'Record outcome', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_agents_evidence',
    description: 'Read contextual performance (approvals, corrections, correction rate, cost per useful result).',
    parameters: {
      id: { type: 'string', description: 'Agent id filter.' },
      task: { type: 'string', description: 'Task filter.' },
      modelId: { type: 'string', description: 'Model filter.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          uses: { type: 'integer', required: true },
          approved: { type: 'integer', required: true },
          corrected: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Evidence: ${String(value.approved)} approved, ${String(value.corrected)} corrected of ${String(value.uses)}.`,
      }],
    },
    execute: async (args) => {
      const summary = await agents(ctx).evidence({
        ...args.id === undefined ? {} : { agentId: args.id as FaberLoomAgentId },
        ...args.task === undefined ? {} : { task: args.task },
        ...args.modelId === undefined ? {} : { modelId: args.modelId as FaberLoomModelId },
      })
      return { uses: summary.uses, approved: summary.approved, corrected: summary.corrected }
    },
    presentCall: args => ({ card: 'generic', title: 'Read evidence', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_agents_delegate',
    description: 'Delegate a task to a named subagent inside the parent shared budget.',
    parameters: {
      id: ID_PARAM,
      subagent: { type: 'string', required: true, description: 'Subagent name on the parent agent.' },
      task: { type: 'string', required: true, description: 'Task label.' },
      spent: { type: 'number', description: 'Estimated cost already spent by the execution.' },
      condition: { type: 'string', description: 'A met escalation condition.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          modelId: { type: 'string', required: true },
          reason: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Delegate: ${value.status} (${value.reason}) model=${value.modelId}.` }],
    },
    execute: async (args) => {
      const result = await agents(ctx).delegate(args.id as FaberLoomAgentId, {
        subagent: args.subagent,
        task: args.task,
        ...args.spent === undefined ? {} : { spent: args.spent },
        ...args.condition === undefined ? {} : { condition: args.condition },
      })
      return { status: result.status, modelId: result.modelId ?? '', reason: result.reason }
    },
    presentCall: args => ({ card: 'generic', title: 'Delegate to subagent', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_models_sync_pool',
    description: 'Reconcile pool availability with the live harness provider routes.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { checked: { type: 'integer', required: true }, available: { type: 'integer', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Pool: ${String(value.available)}/${String(value.checked)} available.` }],
    },
    execute: async () => agents(ctx).syncPool(),
    presentCall: () => ({ card: 'generic', title: 'Sync model pool', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_agents_execute_tool',
    description: 'Execute a registered tool for an agent, enforcing its tool allowlist.',
    parameters: {
      id: ID_PARAM,
      tool: { type: 'string', required: true, description: 'Registered tool name.' },
      args: { type: 'json', description: 'Tool arguments.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { toolName: { type: 'string', required: true }, result: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Tool ${value.toolName} -> ${value.result}` }],
    },
    execute: async (args) => {
      const executed = await agents(ctx).executeTool(args.id as FaberLoomAgentId, args.tool, args.args)
      return { toolName: executed.toolName, result: JSON.stringify(executed.result ?? null) }
    },
    presentCall: args => ({ card: 'generic', title: 'Execute agent tool', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_agents_run_subagent',
    description: 'Run a one-shot temporary subagent inside the parent budget and tool allowlist; not stored in the catalog.',
    parameters: {
      id: ID_PARAM,
      name: { type: 'string', required: true, description: 'Temporary subagent name.' },
      responsibility: { type: 'string', required: true, description: 'Responsibility for this run.' },
      primary: { type: 'string', required: true, description: 'Model the temporary subagent uses.' },
      task: { type: 'string', required: true, description: 'Task label.' },
      tool: { type: 'string', description: 'Executable tool to run, when the run performs an action.' },
      args: { type: 'json', description: 'Tool arguments.' },
      spent: { type: 'number', description: 'Estimated cost already spent by the parent execution.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          reason: { type: 'string', required: true },
          modelId: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Temporary subagent: ${value.status} (${value.reason}).` }],
    },
    execute: async (args) => {
      const result = await agents(ctx).runTemporarySubagent(args.id as FaberLoomAgentId, {
        name: args.name,
        responsibility: args.responsibility,
        primary: args.primary as FaberLoomModelId,
        task: args.task,
        ...args.tool === undefined ? {} : { tool: args.tool },
        ...args.args === undefined ? {} : { args: args.args },
        ...args.spent === undefined ? {} : { spent: args.spent },
      })
      return { status: result.status, reason: result.reason, modelId: result.modelId ?? '' }
    },
    presentCall: args => ({ card: 'generic', title: 'Run temporary subagent', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_routines_create',
    description: 'Create a product routine (version 1, draft) from a definition.',
    parameters: {
      name: { type: 'string', required: true, description: 'Routine name.' },
      definition: { type: 'json', required: true, description: 'RoutineDefinition: intent, triggers, steps, expectedResult, permissions, failurePolicy.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, version: { type: 'integer', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Routine ${value.id} v${String(value.version)}.` }],
    },
    execute: async (args) => {
      const routine = await routines(ctx).createRoutine(actor(config).id, {
        name: args.name,
        definition: args.definition as unknown as RoutineDefinitionInput,
      })
      return { id: routine.id, version: routine.version }
    },
    presentCall: args => ({ card: 'generic', title: 'Create routine', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_routines_update',
    description: 'Edit a product routine, producing a new version; running executions keep their version.',
    parameters: {
      id: ID_PARAM,
      name: { type: 'string', required: true, description: 'Routine name.' },
      definition: { type: 'json', required: true, description: 'The new RoutineDefinition.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, version: { type: 'integer', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Routine ${value.id} now v${String(value.version)}.` }],
    },
    execute: async (args) => {
      const routine = await routines(ctx).updateRoutine(actor(config).id, args.id as FaberLoomRoutineId, {
        name: args.name,
        definition: args.definition as unknown as RoutineDefinitionInput,
      })
      return { id: routine.id, version: routine.version }
    },
    presentCall: args => ({ card: 'generic', title: 'Update routine', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_routines_activate',
    description: 'Validate and activate a product routine.',
    parameters: { id: ID_PARAM },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, status: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Routine ${value.id} is ${value.status}.` }],
    },
    execute: async (args) => {
      await authorize(ctx, config, 'faberloom.routine.activate', args.id)
      const routine = await routines(ctx).activateRoutine(actor(config).id, args.id as FaberLoomRoutineId)
      return { id: routine.id, status: routine.status }
    },
    presentCall: args => ({ card: 'generic', title: 'Activate routine', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_routines_pause',
    description: 'Pause a product routine.',
    parameters: { id: ID_PARAM },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, status: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Routine ${value.id} is ${value.status}.` }],
    },
    execute: async (args) => {
      const routine = await routines(ctx).pauseRoutine(actor(config).id, args.id as FaberLoomRoutineId)
      return { id: routine.id, status: routine.status }
    },
    presentCall: args => ({ card: 'generic', title: 'Pause routine', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_routines_list',
    description: 'List the current user product routines.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          routines: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                status: { type: 'string', required: true },
                version: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Routines: ${value.routines.map(routine => routine.name).join(', ') || 'none'}.` }],
    },
    execute: async () => {
      const list = await routines(ctx).listRoutines(actor(config).id)
      return { routines: list.map(routine => ({ id: routine.id, name: routine.name, status: routine.status, version: routine.version })) }
    },
    presentCall: () => ({ card: 'generic', title: 'List routines', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_routines_version',
    description: 'Read one stored routine version definition.',
    parameters: {
      id: ID_PARAM,
      version: { type: 'integer', required: true, description: 'Routine version.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { definition: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.definition.slice(0, 200) }],
    },
    execute: async (args) => {
      const definition = await routines(ctx).getRoutineVersion(args.id as FaberLoomRoutineId, args.version)
      return { definition: JSON.stringify(definition) }
    },
    presentCall: args => ({ card: 'generic', title: 'Read routine version', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_executions_start',
    description: 'Start one execution of an active routine, deduping by idempotency key.',
    parameters: {
      routineId: { type: 'string', required: true, description: 'Active routine id.' },
      idempotencyKey: { type: 'string', required: true, description: 'Key that dedupes repeated starts.' },
      channel: { type: 'string', description: 'Starting channel label.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          deduped: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Execution ${value.id} ${value.status}${value.deduped ? ' (deduped)' : ''}.` }],
    },
    execute: async (args) => {
      await authorize(ctx, config, 'faberloom.routine.start', args.routineId)
      const started = await routines(ctx).startExecution({
        routineId: args.routineId as FaberLoomRoutineId,
        idempotencyKey: args.idempotencyKey,
        channel: args.channel ?? 'mcp',
      })
      return { id: started.execution.id, status: started.execution.status, deduped: started.deduped }
    },
    presentCall: args => ({ card: 'generic', title: 'Start execution', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_executions_tick',
    description: 'Deliver events to waiting executions (persistent dispatcher tick).',
    parameters: { events: { type: 'json', required: true, description: 'Array of IngestEvent.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { resumed: { type: 'array', required: true, items: { type: 'string' } } } },
      render: (_args, value) => [{ type: 'text', text: `Resumed ${String(value.resumed.length)} execution(s).` }],
    },
    execute: async (args) => {
      const result = await routines(ctx).tick({ events: (args.events as unknown as IngestEvent[]) ?? [] })
      return { resumed: result.resumed.map(id => String(id)) }
    },
    presentCall: args => ({ card: 'generic', title: 'Tick dispatcher', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_executions_list',
    description: 'List executions, optionally by routine or status.',
    parameters: {
      routineId: { type: 'string', description: 'Routine filter.' },
      status: { type: 'string', description: 'Status filter.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          executions: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                status: { type: 'string', required: true },
                routineVersion: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Executions: ${String(value.executions.length)}.` }],
    },
    execute: async (args) => {
      const list = await routines(ctx).listExecutions({
        ...args.routineId === undefined ? {} : { routineId: args.routineId as FaberLoomRoutineId },
        ...args.status === undefined ? {} : { status: args.status as ExecutionStatus },
      })
      return {
        executions: list.map(execution => ({ id: execution.id, status: execution.status, routineVersion: execution.routineVersion })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'List executions', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_executions_get',
    description: 'Read one execution with its steps and evidence.',
    parameters: { id: ID_PARAM },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { status: { type: 'string', required: true }, reason: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Execution ${value.status}${value.reason === '' ? '' : ` (${value.reason})`}.` }],
    },
    execute: async (args) => {
      const execution = await routines(ctx).getExecution(args.id as FaberLoomExecutionId)
      return { status: execution.status, reason: execution.reason ?? '' }
    },
    presentCall: args => ({ card: 'generic', title: 'Read execution', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_executions_reconcile',
    description: 'Reconcile an execution whose effect stayed pending.',
    parameters: { id: ID_PARAM },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { status: { type: 'string', required: true }, reason: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Execution ${value.status} (${value.reason || 'ok'}).` }],
    },
    execute: async (args) => {
      const execution = await routines(ctx).reconcile(args.id as FaberLoomExecutionId)
      return { status: execution.status, reason: execution.reason ?? '' }
    },
    presentCall: args => ({ card: 'generic', title: 'Reconcile execution', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_executions_cancel_effect',
    description: 'Cancel a pending effect so an obsolete draft is not applied.',
    parameters: {
      id: ID_PARAM,
      stepId: { type: 'string', required: true, description: 'Step owning the effect.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { cancelled: { type: 'boolean', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Effect cancelled: ${String(value.cancelled)}.` }],
    },
    execute: async args => ({ cancelled: await routines(ctx).cancelEffect(args.id as FaberLoomExecutionId, args.stepId) }),
    presentCall: args => ({ card: 'generic', title: 'Cancel execution effect', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_executions_migrate',
    description: 'Migrate an execution to a newer routine version, preserving completed steps.',
    parameters: {
      id: ID_PARAM,
      version: { type: 'integer', required: true, description: 'Target routine version.' },
      confirm: { type: 'boolean', description: 'Must be true to apply the migration.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          routineVersion: { type: 'integer', required: true },
          preserved: { type: 'array', required: true, items: { type: 'string' } },
          added: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Migrated to v${String(value.routineVersion)} (+${String(value.added.length)} steps).` }],
    },
    execute: async (args) => {
      const plan = await routines(ctx).previewMigration(args.id as FaberLoomExecutionId, args.version)
      if (args.confirm !== true) return { routineVersion: plan.fromVersion, preserved: [...plan.preserved], added: [...plan.added] }
      const execution = await routines(ctx).migrate(args.id as FaberLoomExecutionId, args.version)
      return { routineVersion: execution.routineVersion, preserved: [...plan.preserved], added: [...plan.added] }
    },
    presentCall: args => ({ card: 'generic', title: 'Migrate execution', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_sources_register',
    description: 'Register a per-user event source and return its ingest token.',
    parameters: {
      kind: { type: 'string', required: true, enum: ['email', 'webhook'], description: 'Source kind.' },
      label: { type: 'string', required: true, description: 'Display label.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, token: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Source ${value.id} token issued.` }],
    },
    execute: async (args) => {
      const source = await routines(ctx).registerSource(actor(config).id, args.kind as 'email' | 'webhook', args.label)
      return { id: source.id, token: source.token }
    },
    presentCall: args => ({ card: 'generic', title: 'Register event source', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_sources_list',
    description: 'List the current user event sources (tokens are not returned).',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          sources: {
            type: 'array', required: true,
            items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, kind: { type: 'string', required: true } } },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Sources: ${String(value.sources.length)}.` }],
    },
    execute: async () => {
      const list = await routines(ctx).listSources(actor(config).id)
      return { sources: list.map(source => ({ id: source.id, kind: source.kind })) }
    },
    presentCall: () => ({ card: 'generic', title: 'List event sources', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_events_ingest',
    description: 'Ingest one event for the current user: matching active routines start or dedupe.',
    parameters: { event: { type: 'json', required: true, description: 'An IngestEvent {key,type,subject,data}.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { started: { type: 'integer', required: true }, deduped: { type: 'integer', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Started ${String(value.started)}, deduped ${String(value.deduped)}.` }],
    },
    execute: async (args) => {
      const results = await routines(ctx).ingest(actor(config).id, args.event as unknown as IngestEvent)
      return { started: results.filter(result => !result.deduped).length, deduped: results.filter(result => result.deduped).length }
    },
    presentCall: args => ({ card: 'generic', title: 'Ingest event', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_board_create',
    description: 'Create a prepared board item awaiting review; evidence is required.',
    parameters: {
      title: { type: 'string', required: true, description: 'Item title.' },
      summary: { type: 'string', required: true, description: 'What the prepared result contains.' },
      evidence: { type: 'array', required: true, description: 'Real evidence references.', items: { type: 'string' } },
      spaceId: { type: 'string', description: 'Owning space id.' },
      documentRef: { type: 'string', description: 'Opaque document reference.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, status: { type: 'string', required: true }, version: { type: 'integer', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Board item ${value.id} ${value.status} v${String(value.version)}.` }],
    },
    execute: async (args) => {
      const item = await board(ctx).create(actor(config).id, {
        title: args.title,
        summary: args.summary,
        evidence: args.evidence,
        ...args.spaceId === undefined ? {} : { spaceId: args.spaceId },
        ...args.documentRef === undefined ? {} : { documentRef: args.documentRef },
      })
      return { id: item.id, status: item.status, version: item.version }
    },
    presentCall: args => ({ card: 'generic', title: 'Create board item', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_board_submit_revision',
    description: 'Submit a correction as the next revision, awaiting a fresh review.',
    parameters: {
      id: ID_PARAM,
      summary: { type: 'string', required: true, description: 'What the revision contains.' },
      evidence: { type: 'array', required: true, description: 'Real evidence references.', items: { type: 'string' } },
      documentRef: { type: 'string', description: 'Opaque document reference.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, version: { type: 'integer', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Board item ${value.id} now v${String(value.version)}.` }],
    },
    execute: async (args) => {
      const item = await board(ctx).submitRevision(actor(config).id, args.id as FaberLoomBoardItemId, {
        summary: args.summary,
        evidence: args.evidence,
        ...args.documentRef === undefined ? {} : { documentRef: args.documentRef },
      })
      return { id: item.id, version: item.version }
    },
    presentCall: args => ({ card: 'generic', title: 'Submit board revision', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_board_review',
    description: 'Approve or reject the exact revision. Approval never sends anything.',
    parameters: {
      id: ID_PARAM,
      decision: { type: 'string', required: true, enum: ['approve', 'reject'], description: 'Decision.' },
      version: { type: 'integer', required: true, description: 'The exact revision reviewed.' },
      note: { type: 'string', description: 'Review note.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, status: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Board item ${value.id} ${value.status}.` }],
    },
    execute: async (args) => {
      await authorize(ctx, config, 'faberloom.board.review', args.id)
      const item = await board(ctx).review(actor(config).id, args.id as FaberLoomBoardItemId, {
        decision: args.decision as 'approve' | 'reject',
        version: args.version,
        ...args.note === undefined ? {} : { note: args.note },
      })
      return { id: item.id, status: item.status }
    },
    presentCall: args => ({ card: 'generic', title: 'Review board item', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_board_mark_stale',
    description: 'Invalidate the current approval: the item must be revalidated before approval or effects.',
    parameters: {
      id: ID_PARAM,
      reason: { type: 'string', required: true, description: 'Why the item changed.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, stale: { type: 'boolean', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Board item ${value.id} stale=${String(value.stale)}.` }],
    },
    execute: async (args) => {
      const item = await board(ctx).markStale(actor(config).id, args.id as FaberLoomBoardItemId, args.reason)
      return { id: item.id, stale: item.stale }
    },
    presentCall: args => ({ card: 'generic', title: 'Mark board item stale', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_board_revalidate',
    description: 'Clear staleness after checking the changed condition.',
    parameters: {
      id: ID_PARAM,
      changed: { type: 'boolean', required: true, description: 'Whether the condition actually changed.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, status: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Board item ${value.id} ${value.status}.` }],
    },
    execute: async (args) => {
      const item = await board(ctx).revalidate(actor(config).id, args.id as FaberLoomBoardItemId, args.changed)
      return { id: item.id, status: item.status }
    },
    presentCall: args => ({ card: 'generic', title: 'Revalidate board item', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_board_record_effect',
    description: 'Record an external effect. Approval never sends: an explicit authorization is required.',
    parameters: {
      id: ID_PARAM,
      ref: { type: 'string', required: true, description: 'External reference the effect created.' },
      authorization: { type: 'string', required: true, description: 'Explicit authorization for this effect.' },
      detail: { type: 'string', description: 'Effect detail.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, effects: { type: 'integer', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Board item ${value.id} effects=${String(value.effects)}.` }],
    },
    execute: async (args) => {
      const item = await board(ctx).recordEffect(actor(config).id, args.id as FaberLoomBoardItemId, {
        ref: args.ref,
        authorization: args.authorization,
        ...args.detail === undefined ? {} : { detail: args.detail },
      })
      return { id: item.id, effects: item.effects.length }
    },
    presentCall: args => ({ card: 'generic', title: 'Record board effect', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_board_exception',
    description: 'Move a board item into an exception state: request_data, fail, reopen, or complete.',
    parameters: {
      id: ID_PARAM,
      action: { type: 'string', required: true, enum: ['request_data', 'fail', 'reopen', 'complete'], description: 'Exception action.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, status: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Board item ${value.id} ${value.status}.` }],
    },
    execute: async (args) => {
      const service = board(ctx)
      const id = args.id as FaberLoomBoardItemId
      const owner = actor(config).id
      const item = args.action === 'request_data'
        ? await service.requestData(owner, id)
        : args.action === 'fail'
          ? await service.fail(owner, id)
          : args.action === 'reopen'
            ? await service.reopen(owner, id)
            : await service.complete(owner, id)
      return { id: item.id, status: item.status }
    },
    presentCall: args => ({ card: 'generic', title: 'Board exception', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_board_get',
    description: 'Read one board item.',
    parameters: { id: ID_PARAM },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          version: { type: 'integer', required: true },
          approvedRevision: { type: 'integer', required: true },
          stale: { type: 'boolean', required: true },
          effects: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Board item ${value.status} v${String(value.version)}.` }],
    },
    execute: async (args) => {
      const item = await board(ctx).get(args.id as FaberLoomBoardItemId)
      return {
        status: item.status,
        version: item.version,
        approvedRevision: item.approvedRevision ?? -1,
        stale: item.stale,
        effects: item.effects.length,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Read board item', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_board_list',
    description: 'List board items for the current user, optionally by status.',
    parameters: { status: { type: 'string', description: 'Status filter.' } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          items: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                status: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Board items: ${String(value.items.length)}.` }],
    },
    execute: async (args) => {
      const items = await board(ctx).list({
        ownerId: actor(config).id,
        ...args.status === undefined ? {} : { status: args.status as BoardStatus },
      })
      return { items: items.map(item => ({ id: item.id, title: item.title, status: item.status })) }
    },
    presentCall: args => ({ card: 'generic', title: 'List board items', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_mail_search',
    description: 'Search the owner mailbox (the IMAP connection configured in Conexiones) and return matching message envelopes: from, subject, and date. Read-only: it never marks, moves, or deletes mail. Use it when the user asks to review or find mail.',
    parameters: {
      query: { type: 'string', required: true, description: 'Text to look for in the messages; empty lists the newest mail.' },
      limit: { type: 'integer', description: 'Most envelopes returned (default 10, maximum 50).' },
      connectionId: { type: 'string', description: 'A specific IMAP connection id; the primary mailbox otherwise.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          messages: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                uid: { type: 'integer', required: true },
                from: { type: 'string', required: true },
                subject: { type: 'string', required: true },
                date: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Mailbox matches: ${String(value.messages.length)}.` }],
    },
    execute: async (args) => {
      const messages = await inbound(ctx).searchMailbox(
        actor(config).id,
        args.query,
        typeof args.limit === 'number' ? args.limit : 10,
        args.connectionId,
      )
      return {
        messages: messages.map(message => ({
          uid: message.uid,
          from: message.from ?? '',
          subject: message.subject ?? '',
          date: message.date ?? '',
        })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Search mailbox', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_mail_send',
    description: 'Send a plain-text email through the owner SMTP connection (configured in Conexiones), as the owner. This is an external effect: it requires the mail.send grant, and the message leaves the system once accepted.',
    parameters: {
      to: { type: 'array', required: true, description: 'Recipient addresses, at least one.', items: { type: 'string' } },
      subject: { type: 'string', required: true, description: 'Subject line.' },
      text: { type: 'string', required: true, description: 'Plain-text body.' },
      from: { type: 'string', description: 'Sender address; the connection account otherwise.' },
      connectionId: { type: 'string', description: 'A specific SMTP connection id; the primary one otherwise.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          messageId: { type: 'string', required: true },
          accepted: { type: 'array', required: true, items: { type: 'string' } },
          via: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Sent ${value.messageId} to ${value.accepted.join(', ')} via ${value.via}.` }],
    },
    execute: async (args) => {
      await authorize(ctx, config, 'mail.send')
      const sent = await connections(ctx).sendMail(
        actor(config).id,
        {
          to: args.to,
          subject: args.subject,
          text: args.text,
          ...args.from === undefined ? {} : { from: args.from },
        },
        args.connectionId,
      )
      return { messageId: sent.messageId, accepted: [...sent.accepted], via: sent.via }
    },
    presentCall: args => ({ card: 'generic', title: 'Send mail', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_companies',
    description: 'List the companies (legal entities) the current user belongs to, marking the active one. Query MWT.ONE with the active company first (the mcp__mwt__* tools); when data may live in another company, use faberloom_mwt_find or faberloom_mwt_call with one of these ids.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          companies: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                active: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Companies: ${value.companies.map(company => company.active === true ? `${company.id} (active)` : company.id).join(', ') || 'none'}.` }],
    },
    execute: async () => {
      const identity = actor(config)
      const active = identity.companyId?.toLowerCase()
      const ids = [...(config.companyIds ?? [])]
      if (identity.companyId !== undefined && !ids.some(id => id.toLowerCase() === active)) ids.push(identity.companyId)
      return { companies: ids.map(id => ({ id, active: active !== undefined && id.toLowerCase() === active })) }
    },
    presentCall: () => ({ card: 'generic', title: 'List companies', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_mwt_call',
    description: 'Call one MWT.ONE MCP tool against a specific company of the user, when the active company is not the right tenant. The company must be one of faberloom_companies; the MWT console still enforces the user role and permissions on every call.',
    parameters: {
      company: { type: 'string', required: true, description: 'Company id from faberloom_companies.' },
      tool: { type: 'string', required: true, description: 'MWT.ONE tool name, e.g. expediente_buscar or producto_precio_cliente.' },
      arguments: { type: 'json', description: 'Tool arguments as a JSON object; empty when the tool takes none.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          company: { type: 'string', required: true },
          result: { type: 'json', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `MWT.ONE [${value.company}] answered.` }],
    },
    execute: async (args) => {
      const facts = mcpFacts(config, actor(config))
      const target = tenant(facts, args.company)
      const result = await mcpCall({ ...facts, companyId: target }, args.tool, (args.arguments ?? {}) as Record<string, unknown>)
      return { company: target ?? '', result: result as never }
    },
    presentCall: args => ({ card: 'generic', title: 'MWT.ONE call by company', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_mwt_find',
    description: 'Ask EVERY company of the user the same MWT.ONE query and report which ones returned data — the way to find which tenant holds an expediente, a product, or a client. Read-only fan-out; then use the company that answered with faberloom_mwt_call or the mcp__mwt__* tools.',
    parameters: {
      tool: { type: 'string', required: true, description: 'MWT.ONE read tool name, e.g. expediente_buscar.' },
      arguments: { type: 'json', description: 'Tool arguments as a JSON object; empty when the tool takes none.' },
      companies: { type: 'array', description: 'Subset of company ids to query; all of the user companies otherwise.', items: { type: 'string' } },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          foundIn: { type: 'string', required: true },
          results: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                company: { type: 'string', required: true },
                found: { type: 'boolean', required: true },
                data: { type: 'json', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.foundIn.length === 0 ? 'No company returned data.' : `Data found in: ${value.foundIn}.` }],
    },
    execute: async (args) => {
      const facts = mcpFacts(config, actor(config))
      const wanted = args.companies === undefined || args.companies.length === 0
        ? facts.companyIds.map(id => id.toLowerCase())
        : args.companies.map(id => tenant(facts, id) ?? '')
      if (wanted.length === 0) throw new Error('faberloom: este usuario no tiene empresas asignadas')
      const toolArgs = (args.arguments ?? {}) as Record<string, unknown>
      const results = await Promise.all(wanted.map(async (company) => {
        try {
          const data = await mcpCall({ ...facts, companyId: company }, args.tool, toolArgs)
          return { company, found: hasData(data), data: data as never }
        } catch (error) {
          return { company, found: false, data: (error instanceof Error ? error.message : String(error)) as never }
        }
      }))
      const firstHit = results.find(result => result.found)
      return { foundIn: firstHit?.company ?? '', results }
    },
    presentCall: args => ({ card: 'generic', title: 'Find across companies', kind: 'other', rawInput: args }),
  }))
}
