/**
 * Space session composition (`ctx.faberloomSessionAgent`): a session whose
 * working directory is a registered workspace mirrored by a Space runs as that
 * Space's responsible agent. In the awaited `agent/created` window it installs,
 * for that session alone, the agent's persona (shadowing the deployment
 * persona), its tool mask for the sources the agent may not use, and a prompt
 * directive naming the agent's skills. A session outside a Space, or a Space
 * without a responsible agent, is left unchanged. The model route is not set
 * here: a session resolves its route from its logged header or the deployment
 * default, and the agent's model policy already applies when it delegates.
 * @module @deepseek-ai/dsh-faberloom-session-agent
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FaberLoomAgentId } from '@deepseek-ai/dsh-faberloom-agents'
import type { SpaceActor } from '@deepseek-ai/dsh-faberloom-spaces'
import { toolSourcesOf } from '@deepseek-ai/dsh-faberloom-agent-plane'
// Type-only: resolves the ctx.systemPrompt and ctx.tools declarations used in the
// inject window, and the optional ctx.faberloom* services read through ctx.get.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { SessionComposition } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomSessionAgent: FaberLoomSessionAgent
  }
}

/** The acting identity the session composition resolves spaces with. */
export interface Config {
  /** Signed-in email; empty disables the composition. */
  ownerId?: string
  /** Console role. */
  role?: string
  /** The user's single company id, when they have one. */
  companyId?: string
  /** Whether the role is read-only. */
  readOnly?: boolean
}

/** Schemastery configuration for the session composition. */
export const Config: z<Config> = z.object({
  ownerId: z.string().default(''),
  role: z.string().default('client_b2b'),
  companyId: z.string(),
  readOnly: z.boolean().default(false),
})

/** One registered workspace as the session chain reads it. */
interface WorkspaceView {
  /** Workspace id. */
  readonly id: string
  /** Filesystem path a session's working directory matches. */
  readonly path: string
}

/** The workspace registry read structurally by service name. */
interface WorkspaceRegistryView {
  /** List every registered workspace. */
  list(): readonly WorkspaceView[]
}

/**
 * The Space session composition service: resolves one session's Space agent and
 * installs its persona, tool mask, and skills.
 */
export class FaberLoomSessionAgent extends Service {
  static inject = ['agents']

  private readonly fibers = new Map<Agent, ReturnType<Context['inject']>>()
  private readonly pending = new Set<Agent>()

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - the acting identity.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'faberloomSessionAgent')
    const install = async (agent: Agent): Promise<void> => {
      if (this.fibers.has(agent) || this.pending.has(agent)) return
      this.pending.add(agent)
      try {
        const composition = await this.compose(agent)
        if (composition === undefined) return
        const fiber = agent.ctx.inject(['systemPrompt', 'tools'], (scope) => {
          scope.systemPrompt.section({
            name: 'deployment:persona-prefix',
            order: scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
            text: composition.persona,
          })
          if (composition.toolFilter !== undefined) scope.tools.restrict(composition.toolFilter)
          if (composition.skills.length > 0) {
            scope.systemPrompt.section({
              name: 'faberloom:session-agent',
              order: scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 1,
              text: `Skills asignadas: ${composition.skills.join(', ')}. Cárgalas con la tool skill cuando la tarea lo requiera.`,
            })
          }
        })
        this.fibers.set(agent, fiber)
        await fiber
      } finally {
        this.pending.delete(agent)
      }
    }
    for (const agent of ctx.agents.list()) void install(agent)
    ctx.on('agent/created', async ({ agent }) => { await install(agent) })
    ctx.on('agent/disposed', ({ agent }) => {
      const fiber = this.fibers.get(agent)
      this.fibers.delete(agent)
      void fiber?.dispose()
    })
    ctx.effect(() => async () => {
      const fibers = [...this.fibers.values()]
      this.fibers.clear()
      await Promise.all(fibers.map(fiber => fiber.dispose()))
    }, 'faberloom-session-agent: compositions')
  }

  /**
   * Resolve the composition one session runs under: its working directory is a
   * registered workspace mirrored by a Space whose responsible agent declares a
   * persona, tool plane, and skills. Returns `undefined` when any link is
   * missing, so a session outside a Space keeps the deployment composition.
   * @param agent - the session's agent.
   * @returns the agent's composition, or `undefined`.
   */
  private async compose(agent: Agent): Promise<SessionComposition | undefined> {
    const ownerId = this.config.ownerId
    if (ownerId === undefined || ownerId.length === 0) return undefined
    // A delegated child inherits its parent's composed agent; re-composing it would
    // re-register the `deployment:persona-prefix` section and fail its creation.
    if (agent.session.header.parentSession !== undefined) return undefined
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return undefined
    const registry = this.ctx.get('workspaceRegistry') as WorkspaceRegistryView | undefined
    const spaces = this.ctx.get('faberloomSpaces')
    const fleet = this.ctx.get('faberloomAgents')
    const plane = this.ctx.get('faberloomAgentPlane')
    if (registry === undefined || spaces === undefined || fleet === undefined || plane === undefined) return undefined
    const workspace = registry.list().find(entry => entry.path === cwd)
    if (workspace === undefined) return undefined
    const actor: SpaceActor = {
      id: ownerId,
      role: this.config.role ?? 'client_b2b',
      companyId: this.config.companyId ?? undefined,
      readOnly: this.config.readOnly === true,
    }
    const space = (await spaces.list(actor)).find(candidate => candidate.workspaceId === workspace.id)
    if (space === undefined || space.agentId === undefined) return undefined
    const catalogAgent = await fleet.getAgent(space.agentId as FaberLoomAgentId)
    const resolved = plane.resolve(catalogAgent, toolSourcesOf(this.ctx.get('tools')?.schemas() ?? []))
    return { persona: resolved.persona, toolFilter: resolved.toolFilter, skills: resolved.skills }
  }
}

export default FaberLoomSessionAgent
