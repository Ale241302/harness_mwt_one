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
        context.faberloomSpaces.list({ id: ownerId, role: 'client_b2b', companyId: undefined, readOnly: false }),
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
      name: 'faberloom_teachings',
      description: 'Lista las enseñanzas versionadas del propietario con su alcance, estado y procedencia.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task: { type: 'string', description: 'Filtra por tipo de tarea.' },
          status: { type: 'string', description: 'Filtra por estado (candidate, active, superseded, revoked).' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const task = optional(args, 'task')
      const status = optional(args, 'status')
      return (await context.faberloomMemory.listTeachings(ownerId, task === undefined ? {} : { task }))
        .filter(teaching => status === undefined || teaching.status === status)
        .map(teaching => ({
          id: String(teaching.id),
          text: teaching.text,
          scope: teaching.scope,
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
          task: { type: 'string', description: 'Tipo de tarea al que aplica.' },
          source: { type: 'string', description: 'De dónde viene (referencia de caso, documento, usuario).' },
        },
      },
    },
    run: async (context, ownerId, args) => {
      const teaching = await context.faberloomMemory.createTeaching(ownerId, {
        scope: (optional(args, 'scope') ?? 'global') as TeachingScope,
        text: required(args, 'text'),
        source: optional(args, 'source') ?? 'cliente MCP',
        author: ownerId,
        ...optional(args, 'task') === undefined ? {} : { task: optional(args, 'task') ?? '' },
        active: true,
      })
      return { id: String(teaching.id), status: teaching.status, version: teaching.version }
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
