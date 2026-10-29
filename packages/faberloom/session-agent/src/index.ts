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
 *
 * Every Space session also carries its readable Space subtree: the Space its
 * folder belongs to and every sub-Space below it, with memory, curated context,
 * agents, skills, harness artifacts, and file paths, so a session in a parent
 * Space reads its children and a session in a child reads its own children.
 * Sibling and unrelated Spaces stay out until the session records a read grant
 * through {@link FaberLoomSessionAgent.grantRead}; the grant is one durable
 * session event and never widens the writable sandbox root.
 * @module @deepseek-ai/dsh-faberloom-session-agent
 */

import { resolve, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FaberLoomAgentId } from '@deepseek-ai/dsh-faberloom-agents'
import { toolSourcesOf, type AgentToolSources } from '@deepseek-ai/dsh-faberloom-agent-plane'
import type { FaberLoomSpace, FaberLoomSpaceId, SpaceActor } from '@deepseek-ai/dsh-faberloom-spaces'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
// Type-only: resolves the ctx.systemPrompt and ctx.tools declarations used in the
// inject window, and the optional ctx.faberloom* services read through ctx.get.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { latestUserText, matchMentionedAgent } from './mention.ts'
import { appendInstructionExchange, instructionReply, type IterationInstructionBoard } from './instruction.ts'
import {
  isUnderFolder,
  readSpaceNode,
  readSpaceScope,
  type SpaceScope,
  type SpaceScopeAgents,
  type SpaceScopeContextEntries,
  type SpaceScopeNode,
  type SpaceScopeSpaces,
} from './scope.ts'
import type { SessionComposition, SessionAgentRoute } from './types.ts'

export type * from './types.ts'
export { renderSpaceNode, renderSpaceScope } from './scope.ts'
export type { SpaceScope, SpaceScopeNode } from './scope.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomSessionAgent: FaberLoomSessionAgent
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One Space was granted read access for this session — log-only (like
     * `sandbox/mode`; NOT a surface event, carries no `surfaceOp`). The event is
     * appended once per Space after the user approves the read through
     * `faberloom_spaces_open_read`, so the grant survives restart by replay and
     * never widens the session's writable sandbox root.
     */
    'faberloom/space-read-grant': { spaceId: string }
  }
}

/** Read-grant state folded from the session log. */
interface SpaceReadGrantsState {
  /** Space ids granted read access, in grant order. */
  readonly spaces: readonly string[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Spaces this session may read outside its own subtree. */
    faberloomSpaceReads: SpaceReadGrantsState
  }
}

const spaceReadGrantsStateSchema = zod.object({
  spaces: zod.array(zod.string()),
}) as unknown as zod.ZodType<SpaceReadGrantsState>

/** The durable read-grant fold: one unit shared by every session. */
const spaceReadGrantsProjection = {
  key: 'faberloomSpaceReads',
  stateVersion: 1,
  stateSchema: spaceReadGrantsStateSchema,
  init: (): SpaceReadGrantsState => ({ spaces: [] }),
  apply: (state: SpaceReadGrantsState, event): SpaceReadGrantsState => {
    if (event.type !== 'faberloom/space-read-grant') return state
    const spaceId = event.data.spaceId
    return state.spaces.includes(spaceId) ? state : { spaces: [...state.spaces, spaceId] }
  },
} satisfies ProjectionDefinition<'faberloomSpaceReads', SpaceReadGrantsState>

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
  /** Ceiling on the rendered Space-scope text, in characters. */
  maxScopeChars?: number
  /** Ceiling on the Spaces one session scope lists, including sub-Spaces. */
  maxScopeSpaces?: number
}

/** Schemastery configuration for the session composition. */
export const Config: z<Config> = z.object({
  ownerId: z.string().default(''),
  role: z.string().default('client_b2b'),
  companyId: z.string(),
  readOnly: z.boolean().default(false),
  maxScopeChars: z.number(),
  maxScopeSpaces: z.number(),
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
  /** The Space and working directory each live Space session resolved to. */
  private readonly resolved = new Map<Agent, { readonly space: FaberLoomSpace; readonly cwd: string }>()
  /** The last rendered scope of each live Space session. */
  private readonly scopes = new Map<Agent, SpaceScope>()
  /** Serializes scope refreshes per agent, so a burst of steps reads once. */
  private readonly scopeTails = new WeakMap<Agent, Promise<void>>()
  /** The disposers of the per-turn mention listeners each live agent registered. */
  private readonly mentionListeners = new Map<Agent, () => void>()
  /** The disposers of the per-step scope refresh listeners. */
  private readonly scopeListeners = new Map<Agent, () => void>()
  /** The disposers of the iteration-chat instruction listeners. */
  private readonly instructionListeners = new Map<Agent, () => void>()

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - the acting identity.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'faberloomSessionAgent')
    ctx.inject(['sessionProjections'], (scope: Context) => {
      scope.sessionProjections.register(spaceReadGrantsProjection)
    })
    const install = async (agent: Agent): Promise<void> => {
      if (this.fibers.has(agent) || this.pending.has(agent)) return
      this.pending.add(agent)
      try {
        const resolved = await this.resolveSpace(agent)
        if (resolved === undefined) return
        const composition = await this.compose(agent, resolved.space)
        this.routes.set(agent, composition?.route)
        this.resolved.set(agent, resolved)
        await this.refreshScope(agent)
        const fiber = agent.ctx.inject(['systemPrompt', 'tools'], (scope) => {
          const registerScope = (): void => {
            scope.systemPrompt.section({
              name: 'faberloom:space-scope',
              order: scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 4,
              text: () => this.scopes.get(agent)?.text ?? '',
            })
          }
          if (composition === undefined) {
            registerScope()
            return
          }
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
          registerScope()
        })
        this.fibers.set(agent, fiber)
        await fiber
        const offRefresh = agent.ctx.on('agent/pre-step', async ({ step }, next) => {
          // One refresh per turn: the assembly for step 1 already ran, so this
          // snapshot is what step 2 and the rest of the turn carry.
          if (step === 1) await this.refreshScope(agent)
          return next()
        })
        const offGuard = agent.ctx.on('tools/pre-execute', async (exec, next) => {
          const reason = this.denyForeignRead(agent, exec.name, exec.arguments)
          return reason === undefined ? next() : { kind: 'deny', reason }
        })
        this.scopeListeners.set(agent, () => { offRefresh(); offGuard() })
      } finally {
        this.pending.delete(agent)
      }
    }
    const attach = (agent: Agent): void => {
      this.attachMentionRoute(agent)
      this.attachIterationInstruction(agent)
      void install(agent).catch((error: unknown) => {
        this.ctx.logger.warn(`faberloom: no se pudo instalar la composición de la sesión: ${String(error)}`)
      })
    }
    for (const agent of ctx.agents.list()) attach(agent)
    ctx.on('agent/created', async ({ agent }) => {
      this.attachMentionRoute(agent)
      this.attachIterationInstruction(agent)
      await install(agent)
    })
    ctx.on('agent/disposed', ({ agent }) => {
      const fiber = this.fibers.get(agent)
      this.fibers.delete(agent)
      this.routes.delete(agent)
      this.resolved.delete(agent)
      this.scopes.delete(agent)
      this.mentionListeners.get(agent)?.()
      this.mentionListeners.delete(agent)
      this.scopeListeners.get(agent)?.()
      this.scopeListeners.delete(agent)
      this.instructionListeners.get(agent)?.()
      this.instructionListeners.delete(agent)
      void fiber?.dispose()
    })
    ctx.effect(() => async () => {
      const fibers = [...this.fibers.values()]
      this.fibers.clear()
      this.routes.clear()
      this.resolved.clear()
      this.scopes.clear()
      const listeners = [...this.mentionListeners.values(), ...this.scopeListeners.values(), ...this.instructionListeners.values()]
      this.mentionListeners.clear()
      this.scopeListeners.clear()
      this.instructionListeners.clear()
      for (const off of listeners) off()
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
   * Register the deterministic field router for one live agent (§9.7). A chat
   * the panel attached to an iteration writes a recognized instruction to the
   * attempt's draft and answers in the log; the turn then closes without a
   * model call, because the step is entered with no messages. A sentence the
   * router does not own, a session with no attachment, or a failed write all
   * delegate to the agent unchanged.
   * @param agent - the live agent the router applies to.
   */
  private attachIterationInstruction(agent: Agent): void {
    if (this.instructionListeners.has(agent)) return
    const off = agent.ctx.on('agent/pre-step', async ({ messages, turn, step }, next) => {
      if (step !== 1) return next()
      const text = latestUserText(messages)
      if (text === undefined) return next()
      const board = this.ctx.get('faberloomBoard') as IterationInstructionBoard | undefined
      if (board === undefined) return next()
      const outcome = await board.applyIterationInstruction(agent.session.id, text).catch((error: unknown) => {
        // A failed deterministic write never fails the turn: the agent takes over.
        this.ctx.logger.warn(`faberloom: no se pudo aplicar la instrucción de campo: ${String(error)}`)
        return undefined
      })
      if (outcome === undefined) return next()
      appendInstructionExchange(agent.session, messages, turn, step, instructionReply(outcome))
      // The instruction is answered: the loop closes the turn without a model call.
      return { kind: 'enter', messages: [] }
    })
    this.instructionListeners.set(agent, off)
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
   * The scope one live Space session reads: its own Space, every sub-Space
   * below it, and the granted subtrees. A session outside a Space returns
   * `undefined`; a Space session whose scope is not cached reads it first, so a
   * tool call never observes an empty scope for a resolved session.
   * @param agent - the session's agent.
   * @returns the current scope, or `undefined`.
   */
  async scopeFor(agent: Agent): Promise<SpaceScope | undefined> {
    if (!this.scopes.has(agent)) await this.refreshScope(agent)
    return this.scopes.get(agent)
  }

  /**
   * Read one Space subtree for a tool result. The caller authorizes the read
   * first: a Space in the session's own subtree needs no grant, and one outside
   * it is recorded through {@link grantRead}.
   * @param agent - the session's agent.
   * @param spaceId - the Space to describe.
   * @returns the Space subtree, or `undefined` when the actor cannot read it.
   */
  async describeSpace(agent: Agent, spaceId: string): Promise<SpaceScopeNode | undefined> {
    const resolved = this.resolved.get(agent)
    if (resolved === undefined) return undefined
    return await readSpaceNode(this.scopeInput(resolved, agent.session), spaceId)
  }

  /**
   * Whether the session already covers one Space: its own subtree or a granted
   * subtree. A covered Space needs no approval before a tool reads it.
   * @param agent - the session's agent.
   * @param spaceId - the Space to check.
   * @returns `true` when the Space is in the readable scope.
   */
  coversSpace(agent: Agent, spaceId: string): boolean {
    const scope = this.scopes.get(agent)
    if (scope === undefined) return false
    return containsSpace([scope.space, ...scope.granted], spaceId)
  }

  /**
   * Refuse file or shell access that targets a Space outside this session's
   * scope, and refuse writes to a granted Space. The check covers the file
   * tools' path arguments and a folder spelling inside a shell command; a path
   * outside every Space (an attachment, a temp file, a skill installation)
   * stays readable exactly as before. A granted Space is no longer foreign, so
   * reads reopen it, while `write`, `edit`, and shell commands remain refused
   * because the grant is read-only.
   * @param agent - the session's agent.
   * @param toolName - the tool the model called.
   * @param args - the call's raw arguments.
   * @returns the refusal text, or undefined to allow the call.
   */
  denyForeignRead(agent: Agent, toolName: string, args: unknown): string | undefined {
    const scope = this.scopes.get(agent)
    const cwd = agent.session.header.cwd
    if (scope === undefined || scope.foreign.length === 0 || cwd === undefined) return undefined
    const input = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
    const own = nodeFolders(scope.space)
    if (SHELL_TOOLS.has(toolName)) {
      const command = input['command']
      if (typeof command === 'string') {
        for (const entry of scope.foreign) {
          if (containsPath(command, entry.path)) return foreignReadDenial(entry.title)
        }
        // Resolve every token that looks like a path, so `cat ../CO/nota.txt`
        // is refused as well as the absolute spelling. Shell syntax is not
        // interpreted; a token that resolves under a foreign folder is enough.
        for (const token of command.split(/[\s"'`;|&<>()={}]+/)) {
          const clean = token.replace(/^-[^=]*=/, '')
          if (clean.length === 0 || clean.startsWith('-')) continue
          const target = resolve(cwd, clean)
          if (own.some(folder => isUnderFolder(target, resolve(folder)))) continue
          const foreign = scope.foreign.find(entry => isUnderFolder(target, resolve(entry.path)))
          if (foreign !== undefined) return foreignReadDenial(foreign.title)
          const granted = grantedNodeAt(scope, target)
          if (granted !== undefined) return grantedWriteDenial(granted.title)
        }
      }
    }
    for (const key of PATH_ARGUMENTS[toolName] ?? []) {
      const value = input[key]
      if (typeof value !== 'string' || value.length === 0) continue
      const target = resolve(cwd, value)
      // The current subtree wins over the foreign list: a parent folder above
      // it never turns a read of the current Space into a foreign read.
      if (own.some(folder => isUnderFolder(target, resolve(folder)))) continue
      const foreign = scope.foreign.find(entry => isUnderFolder(target, resolve(entry.path)))
      if (foreign !== undefined) return foreignReadDenial(foreign.title)
      if (WRITE_TOOLS.has(toolName)) {
        const granted = grantedNodeAt(scope, target)
        if (granted !== undefined) return grantedWriteDenial(granted.title)
      }
    }
    return undefined
  }

  /**
   * Record a durable read grant for one Space and refresh the session's scope.
   * The spaces service refuses a Space the actor may not read, so a grant can
   * never widen product access; it only records that this session may use it.
   * The grant is one log-only session event, so a resume replays it.
   * @param agent - the session's agent.
   * @param spaceId - the Space to grant.
   * @throws when the session is not a Space session or the actor cannot read the Space.
   */
  async grantRead(agent: Agent, spaceId: string): Promise<void> {
    const resolved = this.resolved.get(agent)
    if (resolved === undefined) throw new Error('faberloom: la sesión no pertenece a un Space')
    const spaces = this.ctx.get('faberloomSpaces')
    if (spaces === undefined) throw new Error('faberloom: the spaces service is not mounted')
    const space = await spaces.get(this.actor(), spaceId as FaberLoomSpaceId)
    if (this.grantedSpaceIds(agent.session).includes(String(space.id))) return
    agent.session.append('faberloom/space-read-grant', { spaceId: String(space.id) })
    await this.refreshScope(agent)
  }

  /** The Space ids this session was granted read access to, in grant order. */
  private grantedSpaceIds(session: Session): readonly string[] {
    const projections = this.ctx.get('sessionProjections')
    return projections?.stateOf(session, 'faberloomSpaceReads')?.spaces ?? []
  }

  /** The acting identity, as every product service expects it. */
  private actor(): SpaceActor {
    return {
      id: this.config.ownerId ?? '',
      role: this.config.role ?? 'client_b2b',
      companyId: this.config.companyId ?? undefined,
      readOnly: this.config.readOnly === true,
    }
  }

  /** The services and roots one scope read consumes for a resolved session. */
  private scopeInput(resolved: { readonly space: FaberLoomSpace; readonly cwd: string }, session: Session) {
    const agents = this.ctx.get('faberloomAgents') as SpaceScopeAgents | undefined
    const contextEntries = this.ctx.get('faberloomContext') as SpaceScopeContextEntries | undefined
    const registry = this.ctx.get('workspaceRegistry') as { list(): readonly { id: string; path: string }[] } | undefined
    return {
      actor: this.actor(),
      cwd: resolved.cwd,
      spaces: this.ctx.get('faberloomSpaces') as SpaceScopeSpaces,
      ...agents === undefined ? {} : { agents },
      ...contextEntries === undefined ? {} : { contextEntries },
      ...registry === undefined ? {} : { registry },
      dshHome: resolveDshHome(),
      grantedSpaceIds: this.grantedSpaceIds(session),
      ...this.config.maxScopeChars === undefined ? {} : { maxChars: this.config.maxScopeChars },
      ...this.config.maxScopeSpaces === undefined ? {} : { maxSpaces: this.config.maxScopeSpaces },
    }
  }

  /**
   * Re-read one session's scope and replace the text the prompt section
   * returns. Refreshes are serialized per agent; an unchanged product state
   * renders the same text, so the cached prompt prefix stays stable.
   * @param agent - the session's agent.
   */
  private async refreshScope(agent: Agent): Promise<void> {
    const resolved = this.resolved.get(agent)
    if (resolved === undefined) return
    const previous = this.scopeTails.get(agent) ?? Promise.resolve()
    const run = previous.then(async () => {
      if (this.resolved.get(agent) === undefined) return
      const scope = await readSpaceScope(this.scopeInput(resolved, agent.session))
      if (scope !== undefined) this.scopes.set(agent, scope)
    }).catch((error: unknown) => {
      this.ctx.logger.warn(`faberloom: no se pudo leer el ámbito del Space de la sesión: ${String(error)}`)
    })
    this.scopeTails.set(agent, run)
    await run
  }

  /**
   * Resolve the Space one session runs in: its working directory is a
   * registered workspace mirrored by a Space. A delegated child inherits its
   * parent's composition and resolves nothing here.
   * @param agent - the session's agent.
   * @returns the Space and working directory, or `undefined`.
   */
  private async resolveSpace(agent: Agent): Promise<{ readonly space: FaberLoomSpace; readonly cwd: string } | undefined> {
    const ownerId = this.config.ownerId
    if (ownerId === undefined || ownerId.length === 0) return undefined
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return undefined
    const registry = this.ctx.get('workspaceRegistry') as WorkspaceRegistryView | undefined
    const spaces = this.ctx.get('faberloomSpaces')
    if (registry === undefined || spaces === undefined) return undefined
    const workspace = registry.list().find(entry => entry.path === cwd)
    if (workspace === undefined) return undefined
    const space = (await spaces.list(this.actor())).find(candidate => candidate.workspaceId === workspace.id)
    if (space === undefined) return undefined
    return { space, cwd }
  }

  /**
   * Resolve the composition one session runs under: its responsible agent
   * declares a persona, tool plane, skills, and (when routed and keyed) a model
   * route. Returns `undefined` when the Space has no responsible agent, so the
   * session keeps the deployment composition while still reading its subtree.
   * @param agent - the session's agent.
   * @param space - the Space the session resolved to.
   * @returns the agent's composition, or `undefined`.
   */
  private async compose(agent: Agent, space: FaberLoomSpace): Promise<SessionComposition | undefined> {
    // A delegated child inherits its parent's composed agent; re-composing it
    // would re-register the `deployment:persona-prefix` section and fail its
    // creation. The child still installs its Space scope, which has its own
    // section name.
    if (agent.session.header.parentSession !== undefined) return undefined
    if (space.agentId === undefined) return undefined
    const fleet = this.ctx.get('faberloomAgents')
    const plane = this.ctx.get('faberloomAgentPlane')
    if (fleet === undefined || plane === undefined || space.agentId === undefined) return undefined
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

/** The file-tool argument that names the path each tool reads or writes. */
const PATH_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  read: ['file_path'],
  read_image: ['file_path'],
  write: ['file_path'],
  edit: ['file_path'],
  glob: ['path'],
  grep: ['path'],
}

/** Shell tools whose command text can name an absolute foreign folder. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(['bash', 'pwsh'])

/** File tools that mutate their target rather than read it. */
const WRITE_TOOLS: ReadonlySet<string> = new Set(['write', 'edit'])

/**
 * The granted subtree containing one path, if any.
 * @param scope - the session scope.
 * @param target - absolute path to test.
 * @returns the matching granted node, or undefined.
 */
function grantedNodeAt(scope: SpaceScope, target: string): SpaceScopeNode | undefined {
  const walk = (nodes: readonly SpaceScopeNode[]): SpaceScopeNode | undefined => {
    for (const node of nodes) {
      if (isUnderFolder(target, resolve(node.path))) return node
      const child = walk(node.children)
      if (child !== undefined) return child
    }
    return undefined
  }
  return walk(scope.granted)
}

/**
 * Every folder in one readable scope node and its descendants.
 * @param node - subtree root.
 * @returns the folders, parents before children.
 */
function nodeFolders(node: SpaceScopeNode): string[] {
  const folders = [node.path]
  for (const child of node.children) folders.push(...nodeFolders(child))
  return folders
}

/**
 * Whether a shell command names one absolute folder.
 * @param command - the command text.
 * @param root - the absolute folder.
 * @returns `true` when the command carries the folder spelling.
 */
function containsPath(command: string, root: string): boolean {
  const normalize = (value: string): string => {
    const unified = value.replace(/[\\/]+/g, sep)
    return process.platform === 'win32' ? unified.toLowerCase() : unified
  }
  return normalize(command).includes(normalize(root))
}

/**
 * The model-facing refusal for a Space outside the session scope.
 * @param title - the Space title.
 * @returns the refusal text naming the read-grant tool.
 */
function foreignReadDenial(title: string): string {
  return `faberloom: «${title}» está fuera del ámbito de esta sesión. Pedí permiso de solo lectura con faberloom_spaces_open_read antes de leer su carpeta o sus archivos.`
}

/**
 * The refusal for a write or a shell command against a granted Space.
 * @param title - the Space title.
 * @returns the refusal text explaining the read-only grant.
 */
function grantedWriteDenial(title: string): string {
  return `faberloom: el permiso sobre «${title}» es de solo lectura en esta sesión; no se puede escribir ni ejecutar comandos sobre esa carpeta. Usá read, glob o grep para consultarla.`
}

/**
 * Whether one Space id appears anywhere in the readable trees.
 * @param nodes - root nodes to walk.
 * @param spaceId - the Space to find.
 * @returns `true` when the id is covered.
 */
function containsSpace(nodes: readonly SpaceScopeNode[], spaceId: string): boolean {
  for (const node of nodes) {
    if (node.id === spaceId) return true
    if (containsSpace(node.children, spaceId)) return true
  }
  return false
}

export default FaberLoomSessionAgent
