/**
 * The FaberLoom tools the MCP server exposes, and their execution over the
 * owner's own services. Every tool answers with JSON text, and every write goes
 * through the same product operation the panels use, so an external agent sees
 * the same validation, the same identity, and the same autonomy guard an
 * in-product caller does.
 * @module @deepseek-ai/dsh-faberloom-mcp-server/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FaberLoomRoutineId } from '@deepseek-ai/dsh-faberloom-routines'
import type { FaberLoomTeachingId, TeachingScope } from '@deepseek-ai/dsh-faberloom-learning'
import type { FaberLoomSpaceId, SpaceActor, SpaceSource } from '@deepseek-ai/dsh-faberloom-spaces'
import type { AgentPatch, FaberLoomAgentId, FaberLoomModelId } from '@deepseek-ai/dsh-faberloom-agents'
import type { BoardStatus, FaberLoomBoardItemId } from '@deepseek-ai/dsh-faberloom-board'
import type { ConnectionKind } from '@deepseek-ai/dsh-faberloom-connections'
import type {} from '@deepseek-ai/dsh-faberloom-access'
import type {} from '@deepseek-ai/dsh-faberloom-backup'
import type {} from '@deepseek-ai/dsh-faberloom-connections'
import type { McpToolDefinition, ToolHost, ToolResult } from './protocol.ts'
import { value } from './protocol.ts'

/** Longest list a single tool result returns. */
const MAX_ROWS = 50

/** One tool of the catalogue. */
interface CatalogueEntry {
  readonly definition: McpToolDefinition
  readonly run: (context: Context, ownerId: string, args: Record<string, unknown>) => Promise<unknown>
}

/** Read one required string argument. */
function required(args: Record<string, unknown>, name: string): string {
  const raw = args[name]
  if (typeof raw !== 'string' || raw.trim().length === 0) throw new Error(`${name} is required`)
  return raw.trim()
}

/** Read one optional string argument. */
function optional(args: Record<string, unknown>, name: string): string | undefined {
  const raw = args[name]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') throw new Error(`${name} must be a string`)
  return raw.trim().length === 0 ? undefined : raw.trim()
}

/** Read one optional bounded count. */
function limit(args: Record<string, unknown>): number {
  const raw = args['limit']
  if (raw === undefined) return 20
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) throw new Error('limit must be a positive integer')
  return Math.min(raw, MAX_ROWS)
}

/** Read one optional string list. */
function strings(args: Record<string, unknown>, name: string): string[] | undefined {
  const raw = args[name]
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.some(entry => typeof entry !== 'string')) throw new Error(`${name} must be an array of strings`)
  return raw as string[]
}

/** Read one optional string-to-string record. */
function record(args: Record<string, unknown>, name: string): Record<string, string> | undefined {
  const raw = args[name]
  if (raw === undefined) return undefined
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${name} must be an object`)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') throw new Error(`${name}.${key} must be a string`)
    out[key] = value
  }
  return out
}

/** Read one optional object, passed through to the product input. */
function object(args: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  const raw = args[name]
  if (raw === undefined) return undefined
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${name} must be an object`)
  return raw as Record<string, unknown>
}

/** Read one optional boolean. */
function boolean(args: Record<string, unknown>, name: string): boolean | undefined {
  const raw = args[name]
  if (raw === undefined) return undefined
  if (typeof raw !== 'boolean') throw new Error(`${name} must be a boolean`)
  return raw
}

/** Read one optional finite number. */
function num(args: Record<string, unknown>, name: string): number | undefined {
  const raw = args[name]
  if (raw === undefined) return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`${name} must be a number`)
  return raw
}

/** The acting identity every MCP call uses; the deployment injects the owner. */
function actor(id: string): SpaceActor {
  return { id, role: 'client_b2b', companyId: undefined, readOnly: false }
}

/** The catalogue, in the order a client lists it. */
const CATALOGUE: readonly CatalogueEntry[] = [
  {
    definition: {
      name: 'faberloom_overview',
      description: 'Resumen del espacio de trabajo del propietario: espacios, agentes, rutinas, mesa y las últimas ejecuciones.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    },
    run: async (context, ownerId) => {
      const [spaces, agents, routines, board, executions] = await Promise.all([
        context.faberloomSpaces.list(actor(ownerId)),
        context.faberloomAgents.listAgents(),
        context.faberloomRoutines.listRoutines(ownerId),
        context.faberloomBoard.list({ ownerId }),
        context.faberloomRoutines.listExecutions(),
      ])
      return {
        spaces: spaces.map(space => ({ id: String(space.id), title: space.title })),
        agents: agents.map(agent => ({ id: String(agent.id), name: agent.name, active: agent.active })),
        routines: routines.map(routine => ({
          id: String(routine.id), name: routine.name, status: routine.status, version: routine.version,
        })),
        board: board.map(item => ({ id: String(item.id), title: item.title, status: item.status })),
        executions: executions.length,
      }
    },
  },
  // ── Spaces ─────────────────────────────────────────────────────────
  {
    definition: {
      name: 'faberloom_spaces',
      description: 'Lista los espacios del propietario con jerarquía, herencia y audiencia.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { includeArchived: { type: 'boolean', description: 'Incluye espacios archivados.' } },
      },
    },
    run: async (context, ownerId, args) => {
      const includeArchived = boolean(args, 'includeArchived') ?? false
      return (await context.faberloomSpaces.list(actor(ownerId)))
        .filter(space => includeArchived || !space.archived)
        .map(space => ({
          id: String(space.id),
          title: space.title,
          parentId: space.parentId === undefined ? null : String(space.parentId),
          inheritContext: space.inheritContext,
          members: space.members,
          version: space.version,
        }))
    },
  },
  {
    definition: {
      name: 'faberloom_space_get',
      description: 'Lee un espacio con su contexto y sus fuentes comerciales.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string', description: 'Identificador del espacio.' } },
      },
    },
    run: async (context, ownerId, args) => {
      const space = await context.faberloomSpaces.get(actor(ownerId), required(args, 'id') as FaberLoomSpaceId)
      return {
        id: String(space.id),
        title: space.title,
        parentId: space.parentId === undefined ? null : String(space.parentId),
        inheritContext: space.inheritContext,
        excluded: space.excluded.map(String),
        members: space.members,
        context: space.context,
        sources: space.sources,
        archived: space.archived,
        version: space.version,
      }
    },
  },
  {
    definition: {
      name: 'faberloom_space_create',
      description: 'Crea un espacio o subespacio. Puede existir sin conexión con MWT.ONE.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string', description: 'Título visible del espacio.' },
          parentId: { type: 'string', description: 'Identificador del espacio padre.' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const parentId = optional(args, 'parentId')
      const space = await context.faberloomSpaces.create(actor(ownerId), {
        title: required(args, 'title'),
        ...parentId === undefined ? {} : { parentId: parentId as FaberLoomSpaceId },
      })
      return { id: String(space.id), title: space.title, version: space.version }
    },
  },
  {
    definition: {
      name: 'faberloom_space_update',
      description: 'Edita herencia, exclusiones, miembros, contexto o fuentes de un espacio.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Identificador del espacio.' },
          title: { type: 'string' },
          inheritContext: { type: 'boolean' },
          excluded: { type: 'array', items: { type: 'string' } },
          members: { type: 'array', items: { type: 'string' } },
          context: { type: 'object' },
          sources: { type: 'array', items: { type: 'object' } },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const patch: {
        title?: string
        inheritContext?: boolean
        excluded?: readonly FaberLoomSpaceId[]
        members?: readonly string[]
        context?: Record<string, string>
        sources?: readonly SpaceSource[]
      } = {}
      const title = optional(args, 'title')
      if (title !== undefined) patch.title = title
      const inheritContext = boolean(args, 'inheritContext')
      if (inheritContext !== undefined) patch.inheritContext = inheritContext
      const excluded = strings(args, 'excluded')
      if (excluded !== undefined) patch.excluded = excluded as FaberLoomSpaceId[]
      const members = strings(args, 'members')
      if (members !== undefined) patch.members = members
      const contextValue = record(args, 'context')
      if (contextValue !== undefined) patch.context = contextValue
      const sources = args['sources']
      if (sources !== undefined) {
        if (!Array.isArray(sources)) throw new Error('sources must be an array')
        patch.sources = sources as SpaceSource[]
      }
      const space = await context.faberloomSpaces.update(actor(ownerId), required(args, 'id') as FaberLoomSpaceId, patch)
      return { id: String(space.id), version: space.version }
    },
  },
  {
    definition: {
      name: 'faberloom_space_archive',
      description: 'Archiva un espacio conservándolo fuera de la lista activa.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    run: async (context, ownerId, args) => {
      const space = await context.faberloomSpaces.archive(actor(ownerId), required(args, 'id') as FaberLoomSpaceId)
      return { id: String(space.id), archived: space.archived, version: space.version }
    },
  },
  {
    definition: {
      name: 'faberloom_space_context',
      description: 'Resuelve el contexto efectivo de un espacio con fuentes y conflictos.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    run: async (context, ownerId, args) =>
      context.faberloomSpaces.effectiveContext(actor(ownerId), required(args, 'id') as FaberLoomSpaceId),
  },
  {
    definition: {
      name: 'faberloom_space_preview_link',
      description: 'Previsualiza la audiencia y el material que cambiarían al vincular trabajo privado a un espacio.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    run: async (context, ownerId, args) =>
      context.faberloomSpaces.previewLink(actor(ownerId), required(args, 'id') as FaberLoomSpaceId),
  },
  // ── Agents and the model pool ──────────────────────────────────────
  {
    definition: {
      name: 'faberloom_agents',
      description: 'Lista el catálogo de agentes con su política de modelos y su versión.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { spaceId: { type: 'string', description: 'Filtra por espacio.' } },
      },
    },
    run: async (context, _ownerId, args) => {
      const spaceId = optional(args, 'spaceId')
      return (await context.faberloomAgents.listAgents())
        .filter(agent => spaceId === undefined || agent.spaceId === spaceId)
        .map(agent => ({
          id: String(agent.id),
          name: agent.name,
          responsibility: agent.responsibility,
          origin: agent.origin,
          spaceId: agent.spaceId ?? null,
          active: agent.active,
          version: agent.version,
          policy: {
            primary: agent.policy.primary === undefined ? null : String(agent.policy.primary),
            exclusive: agent.policy.exclusive,
            fallbacks: agent.policy.fallbacks.map(String),
          },
        }))
    },
  },
  {
    definition: {
      name: 'faberloom_agent_get',
      description: 'Lee un agente con responsabilidad, skills, herramientas, subagentes y política.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    run: async (context, _ownerId, args) => {
      const agent = await context.faberloomAgents.getAgent(required(args, 'id') as FaberLoomAgentId)
      return {
        id: String(agent.id),
        name: agent.name,
        responsibility: agent.responsibility,
        origin: agent.origin,
        originRef: agent.originRef ?? null,
        baseAgentId: agent.baseAgentId === undefined ? null : String(agent.baseAgentId),
        spaceId: agent.spaceId ?? null,
        skills: agent.skills,
        tools: agent.tools,
        lessons: agent.lessons,
        active: agent.active,
        version: agent.version,
        policy: agent.policy,
      }
    },
  },
  {
    definition: {
      name: 'faberloom_agent_create',
      description: 'Crea un agente desde cero, desde el pool o desde una tarea; conserva el origen declarado.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'responsibility'],
        properties: {
          name: { type: 'string' },
          responsibility: { type: 'string' },
          origin: { type: 'string', description: 'scratch, pool o task.' },
          originRef: { type: 'string', description: 'Referencia del origen (tarea, plantilla, conversación).' },
          spaceId: { type: 'string' },
          skills: { type: 'array', items: { type: 'string' } },
          tools: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    run: async (context, _ownerId, args) => {
      const origin = optional(args, 'origin')
      const originRef = optional(args, 'originRef')
      const spaceId = optional(args, 'spaceId')
      const skills = strings(args, 'skills')
      const tools = strings(args, 'tools')
      const agent = await context.faberloomAgents.createAgent({
        name: required(args, 'name'),
        responsibility: required(args, 'responsibility'),
        ...origin === undefined ? {} : { origin: origin as 'scratch' | 'pool' | 'task' },
        ...originRef === undefined ? {} : { originRef },
        ...spaceId === undefined ? {} : { spaceId },
        ...skills === undefined ? {} : { skills },
        ...tools === undefined ? {} : { tools },
      })
      return { id: String(agent.id), name: agent.name, origin: agent.origin, version: agent.version }
    },
  },
  {
    definition: {
      name: 'faberloom_agent_update',
      description: 'Edita nombre, responsabilidad, skills, herramientas, subagentes o enseñanzas de un agente.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          responsibility: { type: 'string' },
          skills: { type: 'array', items: { type: 'string' } },
          tools: { type: 'array', items: { type: 'string' } },
          lessons: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    run: async (context, _ownerId, args) => {
      const patch: {
        name?: string
        responsibility?: string
        skills?: readonly string[]
        tools?: readonly string[]
        lessons?: readonly string[]
      } = {}
      const name = optional(args, 'name')
      if (name !== undefined) patch.name = name
      const responsibility = optional(args, 'responsibility')
      if (responsibility !== undefined) patch.responsibility = responsibility
      const skills = strings(args, 'skills')
      if (skills !== undefined) patch.skills = skills
      const tools = strings(args, 'tools')
      if (tools !== undefined) patch.tools = tools
      const lessons = strings(args, 'lessons')
      if (lessons !== undefined) patch.lessons = lessons
      const agent = await context.faberloomAgents.updateAgent(required(args, 'id') as FaberLoomAgentId, patch as AgentPatch)
      return { id: String(agent.id), name: agent.name, version: agent.version }
    },
  },
  {
    definition: {
      name: 'faberloom_agent_policy',
      description: 'Fija la política de modelos del agente: principal, exclusividad, alternativas, escalamiento y presupuesto.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string' },
          primary: { type: 'string', description: 'Id de modelo del pool, o cadena vacía para limpiarlo.' },
          exclusive: { type: 'boolean' },
          fallbacks: { type: 'array', items: { type: 'string' } },
          escalation: { type: 'object', description: 'Política de escalamiento completa.' },
          budget: { type: 'object', description: 'Presupuesto de ejecución completo.' },
        },
      },
    },
    run: async (context, _ownerId, args) => {
      const policy: Record<string, unknown> = {}
      const primary = args['primary']
      if (primary !== undefined) policy['primary'] = primary === '' || primary === null ? null : String(primary)
      const exclusive = boolean(args, 'exclusive')
      if (exclusive !== undefined) policy['exclusive'] = exclusive
      const fallbacks = strings(args, 'fallbacks')
      if (fallbacks !== undefined) policy['fallbacks'] = fallbacks
      const escalation = object(args, 'escalation')
      if (escalation !== undefined) policy['escalation'] = escalation
      const budget = object(args, 'budget')
      if (budget !== undefined) policy['budget'] = budget
      const agent = await context.faberloomAgents.updateAgent(required(args, 'id') as FaberLoomAgentId, { policy } as AgentPatch)
      return { id: String(agent.id), version: agent.version, policy: agent.policy }
    },
  },
  {
    definition: {
      name: 'faberloom_agent_duplicate',
      description: 'Duplica un agente con enseñanzas elegidas explícitamente; no copia memoria privada ni confianza.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          spaceId: { type: 'string' },
          lessons: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    run: async (context, _ownerId, args) => {
      const spaceId = optional(args, 'spaceId')
      const lessons = strings(args, 'lessons')
      const agent = await context.faberloomAgents.duplicateAgent(required(args, 'id') as FaberLoomAgentId, {
        name: required(args, 'name'),
        ...spaceId === undefined ? {} : { spaceId },
        ...lessons === undefined ? {} : { lessons },
      })
      return { id: String(agent.id), name: agent.name, origin: agent.origin, version: agent.version }
    },
  },
  {
    definition: {
      name: 'faberloom_agent_deactivate',
      description: 'Desactiva un agente del catálogo.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    run: async (context, _ownerId, args) => {
      const agent = await context.faberloomAgents.deactivateAgent(required(args, 'id') as FaberLoomAgentId)
      return { id: String(agent.id), active: agent.active, version: agent.version }
    },
  },
  {
    definition: {
      name: 'faberloom_models',
      description: 'Lista el pool de modelos accesibles con capacidades, límites y tarifas.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    },
    run: async (context, _ownerId) => (await context.faberloomAgents.listModels()).map(model => ({
      id: String(model.id),
      provider: model.provider,
      model: model.model,
      capabilities: model.capabilities,
      contextWindow: model.contextWindow ?? null,
      maxOutput: model.maxOutput ?? null,
      inputPerMillion: model.inputPerMillion ?? null,
      outputPerMillion: model.outputPerMillion ?? null,
      currency: model.currency ?? null,
      available: model.available,
    })),
  },
  {
    definition: {
      name: 'faberloom_model_register',
      description: 'Registra un modelo del pool con sus capacidades, límites y tarifas.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['provider', 'model'],
        properties: {
          provider: { type: 'string' },
          model: { type: 'string' },
          capabilities: { type: 'array', items: { type: 'string' } },
          contextWindow: { type: 'number' },
          maxOutput: { type: 'number' },
          inputPerMillion: { type: 'number' },
          outputPerMillion: { type: 'number' },
          currency: { type: 'string' },
        },
      },
    },
    run: async (context, _ownerId, args) => {
      const capabilities = strings(args, 'capabilities')
      const contextWindow = num(args, 'contextWindow')
      const maxOutput = num(args, 'maxOutput')
      const inputPerMillion = num(args, 'inputPerMillion')
      const outputPerMillion = num(args, 'outputPerMillion')
      const currency = optional(args, 'currency')
      const model = await context.faberloomAgents.registerModel({
        provider: required(args, 'provider'),
        model: required(args, 'model'),
        ...capabilities === undefined ? {} : { capabilities },
        ...contextWindow === undefined ? {} : { contextWindow },
        ...maxOutput === undefined ? {} : { maxOutput },
        ...inputPerMillion === undefined ? {} : { inputPerMillion },
        ...outputPerMillion === undefined ? {} : { outputPerMillion },
        ...currency === undefined ? {} : { currency },
      })
      return { id: String(model.id), provider: model.provider, model: model.model, available: model.available }
    },
  },
  {
    definition: {
      name: 'faberloom_agent_resolve_model',
      description: 'Resuelve el modelo efectivo de un agente para una tarea, respetando exclusividad, alternativas y presupuesto.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['agentId', 'task'],
        properties: {
          agentId: { type: 'string' },
          task: { type: 'string' },
          providerDown: { type: 'boolean' },
          condition: { type: 'string' },
          spent: { type: 'number' },
          attempted: { type: 'number' },
          escalated: { type: 'number' },
        },
      },
    },
    run: async (context, _ownerId, args) => {
      const providerDown = boolean(args, 'providerDown')
      const condition = optional(args, 'condition')
      const spent = num(args, 'spent')
      const attempted = num(args, 'attempted')
      const escalated = num(args, 'escalated')
      return context.faberloomAgents.resolveModel(required(args, 'agentId') as FaberLoomAgentId, {
        task: required(args, 'task'),
        ...providerDown === undefined ? {} : { providerDown },
        ...condition === undefined ? {} : { condition },
        ...spent === undefined ? {} : { spent },
        ...attempted === undefined ? {} : { attempted },
        ...escalated === undefined ? {} : { escalated },
      })
    },
  },
  {
    definition: {
      name: 'faberloom_agent_recommend_model',
      description: 'Recomienda un modelo de menor costo para una tarea, explicando evidencia e incertidumbre.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          capabilities: { type: 'array', items: { type: 'string' } },
          minContextWindow: { type: 'number' },
          task: { type: 'string' },
        },
      },
    },
    run: async (context, _ownerId, args) => {
      const capabilities = strings(args, 'capabilities')
      const minContextWindow = num(args, 'minContextWindow')
      const task = optional(args, 'task')
      return context.faberloomAgents.recommendModel({
        ...capabilities === undefined ? {} : { capabilities },
        ...minContextWindow === undefined ? {} : { minContextWindow },
        ...task === undefined ? {} : { task },
      })
    },
  },
  {
    definition: {
      name: 'faberloom_agent_record_outcome',
      description: 'Registra el resultado humano (aprobado o corregido) de un agente y modelo para una tarea.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['agentId', 'task', 'modelId', 'outcome'],
        properties: {
          agentId: { type: 'string' },
          task: { type: 'string' },
          modelId: { type: 'string' },
          outcome: { type: 'string', description: 'approved o corrected.' },
          cost: { type: 'number' },
        },
      },
    },
    run: async (context, _ownerId, args) => {
      const cost = num(args, 'cost')
      const outcome = await context.faberloomAgents.recordOutcome({
        agentId: required(args, 'agentId') as FaberLoomAgentId,
        task: required(args, 'task'),
        modelId: required(args, 'modelId') as FaberLoomModelId,
        outcome: required(args, 'outcome') === 'approved' ? 'approved' : 'corrected',
        ...cost === undefined ? {} : { cost },
      })
      return { id: outcome.id, outcome: outcome.outcome }
    },
  },
  // ── Board (mesa de trabajo) ────────────────────────────────────────
  {
    definition: {
      name: 'faberloom_board',
      description: 'Lista la mesa de trabajo: resultados y excepciones que requieren atención.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', description: 'Filtra por estado.' },
          limit: { type: 'integer' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const status = optional(args, 'status')
      const rows = await context.faberloomBoard.list(status === undefined ? { ownerId } : { ownerId, status: status as BoardStatus })
      return rows.slice(-limit(args)).map(item => ({
        id: String(item.id),
        title: item.title,
        status: item.status,
        version: item.version,
        approvedRevision: item.approvedRevision,
        stale: item.stale,
      }))
    },
  },
  {
    definition: {
      name: 'faberloom_board_get',
      description: 'Lee un elemento de la mesa con sus revisiones, revisiones humanas y efectos.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    run: async (context, _ownerId, args) => context.faberloomBoard.get(required(args, 'id') as FaberLoomBoardItemId),
  },
  {
    definition: {
      name: 'faberloom_board_create',
      description: 'Crea un elemento en la mesa con una primera revisión y evidencia real.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'summary', 'evidence'],
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          spaceId: { type: 'string' },
          documentRef: { type: 'string' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const spaceId = optional(args, 'spaceId')
      const documentRef = optional(args, 'documentRef')
      const item = await context.faberloomBoard.create(ownerId, {
        title: required(args, 'title'),
        summary: required(args, 'summary'),
        evidence: strings(args, 'evidence') ?? [],
        ...spaceId === undefined ? {} : { spaceId },
        ...documentRef === undefined ? {} : { documentRef },
      })
      return { id: String(item.id), status: item.status, version: item.version }
    },
  },
  {
    definition: {
      name: 'faberloom_board_submit',
      description: 'Presenta una nueva revisión de un elemento para revisión humana.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'summary', 'evidence'],
        properties: {
          id: { type: 'string' },
          summary: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          documentRef: { type: 'string' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const documentRef = optional(args, 'documentRef')
      const item = await context.faberloomBoard.submitRevision(ownerId, required(args, 'id') as FaberLoomBoardItemId, {
        summary: required(args, 'summary'),
        evidence: strings(args, 'evidence') ?? [],
        ...documentRef === undefined ? {} : { documentRef },
      })
      return { id: String(item.id), status: item.status, version: item.version }
    },
  },
  {
    definition: {
      name: 'faberloom_board_review',
      description: 'Aprueba o rechaza una revisión exacta. Aprobar no envía ni concede autonomía.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'decision', 'version'],
        properties: {
          id: { type: 'string' },
          decision: { type: 'string', description: 'approve o reject.' },
          version: { type: 'number', description: 'Revisión exacta revisada.' },
          note: { type: 'string' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const note = optional(args, 'note')
      const item = await context.faberloomBoard.review(ownerId, required(args, 'id') as FaberLoomBoardItemId, {
        decision: required(args, 'decision') === 'approve' ? 'approve' : 'reject',
        version: num(args, 'version') ?? 0,
        ...note === undefined ? {} : { note },
      })
      return { id: String(item.id), status: item.status, approvedRevision: item.approvedRevision, version: item.version }
    },
  },
  {
    definition: {
      name: 'faberloom_board_reopen',
      description: 'Reabre un elemento para corregirlo conservando su historia.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    run: async (context, ownerId, args) => {
      const item = await context.faberloomBoard.reopen(ownerId, required(args, 'id') as FaberLoomBoardItemId)
      return { id: String(item.id), status: item.status, version: item.version }
    },
  },
  {
    definition: {
      name: 'faberloom_board_effect',
      description: 'Registra un efecto externo con su autorización explícita.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'ref'],
        properties: {
          id: { type: 'string' },
          ref: { type: 'string', description: 'Referencia externa creada.' },
          authorization: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const authorization = optional(args, 'authorization')
      const detail = optional(args, 'detail')
      const item = await context.faberloomBoard.recordEffect(ownerId, required(args, 'id') as FaberLoomBoardItemId, {
        ref: required(args, 'ref'),
        ...authorization === undefined ? {} : { authorization },
        ...detail === undefined ? {} : { detail },
      })
      return { id: String(item.id), effects: item.effects.length, version: item.version }
    },
  },
  {
    definition: {
      name: 'faberloom_board_mark_stale',
      description: 'Marca un elemento como obsoleto y exige revalidación antes del efecto.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'reason'],
        properties: { id: { type: 'string' }, reason: { type: 'string' } },
      },
    },
    run: async (context, ownerId, args) => {
      const item = await context.faberloomBoard.markStale(ownerId, required(args, 'id') as FaberLoomBoardItemId, required(args, 'reason'))
      return { id: String(item.id), stale: item.stale, version: item.version }
    },
  },
  {
    definition: {
      name: 'faberloom_board_revalidate',
      description: 'Revalida un elemento obsoleto indicando si su resultado cambió.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'changed'],
        properties: { id: { type: 'string' }, changed: { type: 'boolean' } },
      },
    },
    run: async (context, ownerId, args) => {
      const item = await context.faberloomBoard.revalidate(
        ownerId,
        required(args, 'id') as FaberLoomBoardItemId,
        boolean(args, 'changed') ?? false,
      )
      return { id: String(item.id), stale: item.stale, version: item.version }
    },
  },
  // ── Grants (autonomía) ─────────────────────────────────────────────
  {
    definition: {
      name: 'faberloom_grants',
      description: 'Lista las concesiones de autonomía del propietario.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { activeOnly: { type: 'boolean' } },
      },
    },
    run: async (context, ownerId, args) => {
      const activeOnly = boolean(args, 'activeOnly') ?? false
      return context.faberloomAccess.listGrants(ownerId, { activeOnly })
    },
  },
  {
    definition: {
      name: 'faberloom_grant',
      description: 'Concede autonomía explícita para una acción, con agente y contexto opcionales.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', description: 'Acción autorizada, p. ej. mail.send.' },
          agentId: { type: 'string' },
          context: { type: 'string' },
          note: { type: 'string' },
          expiresAt: { type: 'string', description: 'Expiración ISO-8601.' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const agentId = optional(args, 'agentId')
      const context2 = optional(args, 'context')
      const note = optional(args, 'note')
      const expiresAt = optional(args, 'expiresAt')
      const grant = await context.faberloomAccess.grant(ownerId, {
        action: required(args, 'action'),
        ...agentId === undefined ? {} : { agentId },
        ...context2 === undefined ? {} : { context: context2 },
        ...note === undefined ? {} : { note },
        ...expiresAt === undefined ? {} : { expiresAt },
      })
      return { id: grant.id, action: grant.action, revoked: grant.revoked }
    },
  },
  {
    definition: {
      name: 'faberloom_grant_revoke',
      description: 'Revoca una concesión; el próximo efecto se deniega.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    run: async (context, ownerId, args) => {
      const grant = await context.faberloomAccess.revokeGrant(ownerId, required(args, 'id'))
      return { id: grant.id, revoked: grant.revoked }
    },
  },
  // ── Backup ─────────────────────────────────────────────────────────
  {
    definition: {
      name: 'faberloom_backup_create',
      description: 'Captura un respaldo íntegro de los dominios de producto del propietario.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { note: { type: 'string' } },
      },
    },
    run: async (context, ownerId, args) => {
      const note = optional(args, 'note')
      return context.faberloomBackup.createBackup(ownerId, note === undefined ? {} : { note })
    },
  },
  {
    definition: {
      name: 'faberloom_backup_list',
      description: 'Lista los respaldos del propietario, del más reciente al más antiguo.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    },
    run: async (context, ownerId) => context.faberloomBackup.listBackups(ownerId),
  },
  {
    definition: {
      name: 'faberloom_backup_verify',
      description: 'Verifica la integridad de un respaldo recalculando sus digests.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    run: async (context, ownerId, args) => context.faberloomBackup.verifyBackup(ownerId, required(args, 'id')),
  },
  {
    definition: {
      name: 'faberloom_backup_restore',
      description: 'Restaura un respaldo íntegro en los dominios abiertos; dryRun cuenta sin escribir.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' }, dryRun: { type: 'boolean' } },
      },
    },
    run: async (context, ownerId, args) =>
      context.faberloomBackup.restoreBackup(ownerId, required(args, 'id'), { dryRun: boolean(args, 'dryRun') ?? false }),
  },
  {
    definition: {
      name: 'faberloom_migrations_list',
      description: 'Lista las migraciones de datos del producto y si el propietario ya las aplicó.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    },
    run: async (context, ownerId) => context.faberloomBackup.listMigrations(ownerId),
  },
  {
    definition: {
      name: 'faberloom_migrations_run',
      description: 'Aplica las migraciones de datos pendientes del propietario; es idempotente.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    },
    run: async (context, ownerId) => context.faberloomBackup.runMigrations(ownerId),
  },
  // ── Connections ────────────────────────────────────────────────────
  {
    definition: {
      name: 'faberloom_connections',
      description: 'Lista las conexiones configuradas (IMAP y respaldo); nunca devuelve secretos.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    },
    run: async (context, ownerId) => context.faberloomConnections.list(ownerId),
  },
  {
    definition: {
      name: 'faberloom_connection_save',
      description: 'Crea o actualiza una conexión IMAP o de respaldo.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'label'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', description: 'imap o backup.' },
          label: { type: 'string' },
          host: { type: 'string' },
          port: { type: 'number' },
          secure: { type: 'boolean' },
          username: { type: 'string' },
          secret: { type: 'string' },
          destination: { type: 'string' },
          retentionDays: { type: 'number' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const kind = required(args, 'kind') as ConnectionKind
      const id = optional(args, 'id')
      const host = optional(args, 'host')
      const port = num(args, 'port')
      const secure = boolean(args, 'secure')
      const username = optional(args, 'username')
      const secret = optional(args, 'secret')
      const destination = optional(args, 'destination')
      const retentionDays = num(args, 'retentionDays')
      const connection = await context.faberloomConnections.save(ownerId, {
        kind,
        label: required(args, 'label'),
        ...id === undefined ? {} : { id },
        ...host === undefined ? {} : { host },
        ...port === undefined ? {} : { port },
        ...secure === undefined ? {} : { secure },
        ...username === undefined ? {} : { username },
        ...secret === undefined ? {} : { secret },
        ...destination === undefined ? {} : { destination },
        ...retentionDays === undefined ? {} : { retentionDays },
      })
      return connection
    },
  },
  {
    definition: {
      name: 'faberloom_connection_remove',
      description: 'Elimina una conexión del propietario.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    run: async (context, ownerId, args) => ({ removed: await context.faberloomConnections.remove(ownerId, required(args, 'id')) }),
  },
  {
    definition: {
      name: 'faberloom_connection_probe',
      description: 'Prueba una conexión y reporta el resultado real.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    run: async (context, ownerId, args) => context.faberloomConnections.probe(ownerId, required(args, 'id')),
  },
  // ── Routines and executions ────────────────────────────────────────
  {
    definition: {
      name: 'faberloom_routines',
      description: 'Lista las rutinas del propietario con su estado, versión y disparadores.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    },
    run: async (context, ownerId) => (await context.faberloomRoutines.listRoutines(ownerId)).map(routine => ({
      id: String(routine.id),
      name: routine.name,
      status: routine.status,
      version: routine.version,
      triggers: routine.definition.triggers.map(trigger => ({ kind: trigger.kind, match: trigger.match })),
      steps: routine.definition.steps.length,
      expectedResult: routine.definition.expectedResult,
    })),
  },
  {
    definition: {
      name: 'faberloom_executions',
      description: 'Lista las ejecuciones recientes: rutina, estado, motivo, espera y plazo.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          routineId: { type: 'string', description: 'Filtra por rutina.' },
          limit: { type: 'integer', description: 'Máximo de filas (por defecto 20).' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const routineId = optional(args, 'routineId')
      const rows = await context.faberloomRoutines.listExecutions(
        routineId === undefined ? {} : { routineId: routineId as FaberLoomRoutineId },
      )
      const names = new Map((await context.faberloomRoutines.listRoutines(ownerId)).map(routine => [String(routine.id), routine.name]))
      return rows.slice(-limit(args)).map(execution => ({
        id: String(execution.id),
        routine: names.get(String(execution.routineId)) ?? String(execution.routineId),
        status: execution.status,
        waitingFor: execution.waitingFor,
        deadlineAt: execution.deadlineAt,
        reason: execution.reason,
        updatedAt: execution.updatedAt,
      }))
    },
  },
  {
    definition: {
      name: 'faberloom_routine_run',
      description: 'Inicia una rutina con una clave de idempotencia. Los pasos con efecto siguen exigiendo una concesión vigente.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['routineId', 'idempotencyKey'],
        properties: {
          routineId: { type: 'string', description: 'Rutina a iniciar.' },
          idempotencyKey: { type: 'string', description: 'Clave estable: repetirla no duplica el caso.' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const started = await context.faberloomRoutines.startExecution({
        routineId: required(args, 'routineId') as FaberLoomRoutineId,
        idempotencyKey: required(args, 'idempotencyKey'),
        channel: `mcp:${ownerId}`,
      })
      return {
        executionId: String(started.execution.id),
        status: started.execution.status,
        reason: started.execution.reason,
        deduped: started.deduped,
      }
    },
  },
  // ── Learning (memoria) ─────────────────────────────────────────────
  {
    definition: {
      name: 'faberloom_teachings',
      description: 'Lista las enseñanzas versionadas del propietario con su alcance, estado y procedencia.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task: { type: 'string', description: 'Filtra por tipo de tarea.' },
          spaceId: { type: 'string', description: 'Filtra por espacio.' },
          agentId: { type: 'string', description: 'Filtra por agente.' },
          status: { type: 'string', description: 'Filtra por estado (candidate, active, superseded, revoked).' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const task = optional(args, 'task')
      const spaceId = optional(args, 'spaceId')
      const agentId = optional(args, 'agentId')
      const status = optional(args, 'status')
      return (await context.faberloomMemory.listTeachings(ownerId, {
        ...task === undefined ? {} : { task },
        ...spaceId === undefined ? {} : { spaceId },
        ...agentId === undefined ? {} : { agentId },
      }))
        .filter(teaching => status === undefined || teaching.status === status)
        .map(teaching => ({
          id: String(teaching.id),
          text: teaching.text,
          scope: teaching.scope,
          spaceId: teaching.spaceId,
          agentId: teaching.agentId,
          task: teaching.task,
          status: teaching.status,
          version: teaching.version,
          source: teaching.source,
          uses: teaching.uses.length,
        }))
    },
  },
  {
    definition: {
      name: 'faberloom_teaching_record',
      description: 'Registra una enseñanza o corrección. Es explícita del usuario: queda activa y puede revocarse después.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string', description: 'La enseñanza.' },
          scope: { type: 'string', description: 'Alcance: case, space, agent, skill o global.' },
          spaceId: { type: 'string', description: 'Espacio al que aplica.' },
          agentId: { type: 'string', description: 'Agente al que aplica.' },
          task: { type: 'string', description: 'Tipo de tarea al que aplica.' },
          source: { type: 'string', description: 'De dónde viene (referencia de caso, documento, usuario).' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const spaceId = optional(args, 'spaceId')
      const agentId = optional(args, 'agentId')
      const task = optional(args, 'task')
      const teaching = await context.faberloomMemory.createTeaching(ownerId, {
        scope: (optional(args, 'scope') ?? 'global') as TeachingScope,
        text: required(args, 'text'),
        source: optional(args, 'source') ?? 'cliente MCP',
        author: ownerId,
        ...spaceId === undefined ? {} : { spaceId },
        ...agentId === undefined ? {} : { agentId },
        ...task === undefined ? {} : { task },
        active: true,
      })
      return { id: String(teaching.id), status: teaching.status, version: teaching.version }
    },
  },
  {
    definition: {
      name: 'faberloom_teaching_edit',
      description: 'Edita una enseñanza produciendo una nueva versión y conservando la anterior.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'reason'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const teaching = await context.faberloomMemory.editTeaching(ownerId, required(args, 'id') as FaberLoomTeachingId, {
        text: required(args, 'text'),
        reason: required(args, 'reason'),
        author: ownerId,
      })
      return { id: String(teaching.id), status: teaching.status, version: teaching.version }
    },
  },
  {
    definition: {
      name: 'faberloom_teaching_revoke',
      description: 'Revoca una enseñanza para que ninguna decisión posterior la recupere.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string', description: 'Identificador de la enseñanza.' } },
      },
    },
    run: async (context, ownerId, args) => {
      const teaching = await context.faberloomMemory.revokeTeaching(ownerId, required(args, 'id') as FaberLoomTeachingId)
      return { id: String(teaching.id), status: teaching.status }
    },
  },
]

/** The product-side host a transport serves MCP calls from. */
export class FaberLoomToolHost implements ToolHost {
  /**
   * @param context - context carrying the owner's product services.
   * @param ownerId - the identity every call acts as.
   * @param scopes - tool names this client may use, or null for the full surface.
   */
  constructor(
    private readonly context: Context,
    private readonly ownerId: string,
    private readonly scopes: readonly string[] | null = null,
  ) {}

  /** @returns the advertised tools the client's scopes allow. */
  tools(): readonly McpToolDefinition[] {
    return CATALOGUE
      .filter(entry => this.scopes === null || this.scopes.includes(entry.definition.name))
      .map(entry => entry.definition)
  }

  /**
   * Run one tool.
   * @param name - tool name.
   * @param args - the caller's arguments.
   * @returns the MCP result.
   */
  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (this.scopes !== null && !this.scopes.includes(name)) {
      throw new Error(`the token in use is not scoped for ${name}`)
    }
    const entry = CATALOGUE.find(candidate => candidate.definition.name === name)
    if (entry === undefined) throw new Error(`unknown tool: ${name}`)
    return value(await entry.run(this.context, this.ownerId, args))
  }
}

/**
 * List the tool names a token may be scoped to.
 * @returns the catalogue's tool names, in order.
 */
export function toolNames(): readonly string[] {
  return CATALOGUE.map(entry => entry.definition.name)
}
