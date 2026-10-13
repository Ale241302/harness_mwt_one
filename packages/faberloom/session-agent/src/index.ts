/**
 * Space session composition (`ctx.faberloomSessionAgent`): a session whose
 * working directory is a registered workspace mirrored by a Space runs as that
 * Space's responsible agent. In the awaited `agent/created` window it installs,
 * for that session alone, the agent's persona (shadowing the deployment
 * persona), its tool mask for the sources the agent may not use, and a prompt
 * directive naming the agent's skills. A session outside a Space, or a Space
 * without a responsible agent, is left unchanged. The composition also carries
 * the agent's model route (provider, model, and the reference naming its API
 * key), which a session controller reads through {@link FaberLoomSessionAgent.routeFor}
 * and uses as the session's default route; an unrouted or unkeyed agent
 * contributes no route, so the deployment default applies.
 *
 * The same service makes a message that opens with `@Name` run its turn on that
 * catalog agent's route: an `agent/request` listener applies the named agent's
 * provider, model, and key reference to that turn alone, and restores the
 * session's own route on the next turn without a mention. An unknown name, a
 * missing catalog or plane, or an agent without a complete keyed route leaves
 * the request untouched, so nothing here fails a turn.
 * @module @deepseek-ai/dsh-faberloom-session-agent
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FaberLoomAgentId } from '@deepseek-ai/dsh-faberloom-agents'
import { toolSourcesOf, type AgentToolSources } from '@deepseek-ai/dsh-faberloom-agent-plane'
import type { SpaceActor } from '@deepseek-ai/dsh-faberloom-spaces'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
// Type-only: resolves the ctx.systemPrompt and ctx.tools declarations used in the
// inject window, and the optional ctx.faberloom* services read through ctx.get.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { latestUserText, matchMentionedAgent } from './mention.ts'
import type { SessionComposition, SessionAgentRoute } from './types.ts'

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

/** The provider route fields one request carries, as the loop's waterfall resolves them. */
interface RequestRoute {
  /** Registered provider route. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Key reference the request authenticates with, or `undefined` for the route's own. */
  readonly credentialRef: SessionAgentRoute['credentialRef'] | undefined
  /** Adapter-owned reasoning effort, or `undefined` for the route's own. */
  readonly reasoningEffort: LlmCallConfig['reasoningEffort']
}

/**
 * Copy the route fields one resolved request config carries.
 * @param config - the config the loop's waterfall resolved.
 * @returns the provider, model, key reference, and effort fields.
 */
function routeOf(config: LlmCallConfig): RequestRoute {
  return {
    provider: config.provider,
    model: config.model,
    credentialRef: config.credentialRef,
    reasoningEffort: config.reasoningEffort,
  }
}

/**
 * Replace the route fields of one request config, dropping a field the route
 * does not set (an absent key reference must not keep the replaced route's).
 * @param config - the config to rewrite.
 * @param route - the provider route fields to carry.
 * @returns a replacement config.
 */
function withRoute(config: LlmCallConfig, route: RequestRoute): LlmCallConfig {
  const { credentialRef: _credentialRef, reasoningEffort: _reasoningEffort, ...rest } = config
  return {
    ...rest,
    provider: route.provider,
    model: route.model,
    ...route.credentialRef === undefined ? {} : { credentialRef: route.credentialRef },
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
  }
}

/**
 * The Space session composition service: resolves one session's Space agent,
 * installs its persona, tool mask, and skills, and makes an `@Name` mention
 * route its turn to that catalog agent.
 */
export class FaberLoomSessionAgent extends Service {
  static inject = ['agents']

  private readonly fibers = new Map<Agent, ReturnType<Context['inject']>>()
  private readonly pending = new Set<Agent>()
  /** The resolved model route of each composed session, keyed by its agent. */
  private readonly routes = new Map<Agent, SessionAgentRoute | undefined>()
  /** The disposers of the per-turn mention listeners each live agent registered. */
  private readonly mentionListeners = new Map<Agent, () => void>()

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
        this.routes.set(agent, composition.route)
        const fiber = agent.ctx.inject(['systemPrompt', 'tools'], (scope) => {
          scope.systemPrompt.section({
            name: 'deployment:persona-prefix',
            order: scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
            text: composition.persona,
          })
          if (composition.toolFilter !== undefined) scope.tools.restrict(composition.toolFilter)
          if (composition.prompt.length > 0) {
            scope.systemPrompt.section({
              name: 'faberloom:space-directive',
              order: scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 1,
              text: composition.prompt,
            })
          }
          if (composition.skills.length > 0) {
            scope.systemPrompt.section({
              name: 'faberloom:session-agent',
              order: scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 2,
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
    const attach = (agent: Agent): void => {
      this.attachMentionRoute(agent)
      void install(agent)
    }
    for (const agent of ctx.agents.list()) attach(agent)
    ctx.on('agent/created', async ({ agent }) => {
      this.attachMentionRoute(agent)
      await install(agent)
    })
    ctx.on('agent/disposed', ({ agent }) => {
      const fiber = this.fibers.get(agent)
      this.fibers.delete(agent)
      this.routes.delete(agent)
      this.mentionListeners.get(agent)?.()
      this.mentionListeners.delete(agent)
      void fiber?.dispose()
    })
    ctx.effect(() => async () => {
      const fibers = [...this.fibers.values()]
      this.fibers.clear()
      this.routes.clear()
      const mentions = [...this.mentionListeners.values()]
      this.mentionListeners.clear()
      for (const off of mentions) off()
      await Promise.all(fibers.map(fiber => fiber.dispose()))
    }, 'faberloom-session-agent: compositions')
  }

  /**
   * The model route one session's Space agent runs on. It is a complete route
   * only when the agent declares both a provider and a model and stores an API
   * key; otherwise the value is `undefined`, so an unrouted or unkeyed agent
   * leaves the session on the deployment default. A session controller reads
   * this through `ctx.get('faberloomSessionAgent')` and applies it as the
   * session's default, below any explicit selection of its own.
   * @param agent - the session's agent.
   * @returns the agent's route, or `undefined`.
   */
  routeFor(agent: Agent): SessionAgentRoute | undefined {
    return this.routes.get(agent)
  }

  /**
   * Register the per-turn `@Name` route for one live agent.
   *
   * The mention is read from the messages a step claims: the `agent/request`
   * payload carries no messages, and the loop commits the claimed batch to the
   * log only after that waterfall, so `agent/pre-step` is the point where the
   * turn's user text is still available. The request listener is registered
   * outermost (`prepend`) so the route it applies wins over the session's own.
   * @param agent - the live agent the route applies to.
   */
  private attachMentionRoute(agent: Agent): void {
    if (this.mentionListeners.has(agent)) return
    // The current turn's routed mention, plus the route the session used before
    // the mention and the mention route itself, kept until a mention-free turn.
    // The loop logs the header the request used, so a mention would otherwise
    // stay the session's route; the captured pair restores the earlier one.
    const state: {
      mention: SessionAgentRoute | undefined
      previous: { readonly base: RequestRoute; applied: SessionAgentRoute } | undefined
    } = { mention: undefined, previous: undefined }
    const offPreStep = agent.ctx.on('agent/pre-step', async ({ messages, step }, next) => {
      if (step === 1) state.mention = await this.mentionRouteFor(messages)
      return next()
    })
    const offRequest = agent.ctx.on('agent/request', async (_payload, next) => {
      const resolved = await next()
      if (state.mention !== undefined) {
        // Keep the base captured before the first override so consecutive
        // mentions all restore the session's own route; track the newest applied.
        const previous = state.previous ?? { base: routeOf(resolved), applied: state.mention }
        previous.applied = state.mention
        state.previous = previous
        return withRoute(resolved, {
          provider: state.mention.provider,
          model: state.mention.model,
          credentialRef: state.mention.credentialRef,
          reasoningEffort: undefined,
        })
      }
      const previous = state.previous
      state.previous = undefined
      // Restore only while the logged route is still the mention's; a route the
      // session changed meanwhile (an explicit selection) is left in force.
      if (previous === undefined
        || resolved.provider !== previous.applied.provider
        || resolved.model !== previous.applied.model) return resolved
      return withRoute(resolved, previous.base)
    }, { prepend: true })
    this.mentionListeners.set(agent, () => { offPreStep(); offRequest() })
  }

  /**
   * Resolve the route one step's messages name through an `@Name` mention. An
   * unknown name, a missing catalog or plane, or an agent without all of a
   * provider, a model, and a key resolves to `undefined`, leaving the request on
   * its own route rather than failing the turn.
   * @param messages - messages removed from the inbox for the step.
   * @returns the mentioned agent's route, or `undefined`.
   */
  private async mentionRouteFor(messages: readonly UserMessage[]): Promise<SessionAgentRoute | undefined> {
    const text = latestUserText(messages)
    if (text === undefined || !text.startsWith('@')) return undefined
    const fleet = this.ctx.get('faberloomAgents')
    const plane = this.ctx.get('faberloomAgentPlane')
    if (fleet === undefined || plane === undefined) return undefined
    const agent = matchMentionedAgent(text, await fleet.listAgents())
    if (agent === undefined) return undefined
    const resolved = plane.resolve(agent, this.toolSources())
    if (resolved.provider === undefined || resolved.model === undefined || resolved.credentialRef === undefined) return undefined
    return { provider: resolved.provider, model: resolved.model, credentialRef: resolved.credentialRef }
  }

  /** The registered tool names grouped by source, as the agent plane reads them. */
  private toolSources(): AgentToolSources {
    return toolSourcesOf(this.ctx.get('tools')?.schemas() ?? [])
  }

  /**
   * Resolve the composition one session runs under: its working directory is a
   * registered workspace mirrored by a Space whose responsible agent declares a
   * persona, tool plane, skills, and (when routed and keyed) a model route.
   * Returns `undefined` when any link is missing, so a session outside a Space
   * keeps the deployment composition.
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
    const resolved = plane.resolve(catalogAgent, this.toolSources())
    const route: SessionAgentRoute | undefined = resolved.provider !== undefined
      && resolved.model !== undefined
      && resolved.credentialRef !== undefined
      ? { provider: resolved.provider, model: resolved.model, credentialRef: resolved.credentialRef }
      : undefined
    return {
      persona: resolved.persona,
      toolFilter: resolved.toolFilter,
      skills: resolved.skills,
      prompt: space.prompt,
      route,
    }
  }
}

export default FaberLoomSessionAgent
