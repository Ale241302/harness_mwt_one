/**
 * Native chat gestures of the FaberLoom surface: `@` lists the owner's agents
 * so a conversation can address one by name, and `/routine` runs a routine
 * from the composer. Both read the workspace overview through the declared
 * Remote namespace; nothing here re-implements host behavior.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
import type {
  ClientSessionContext,
  InputTriggerServiceContract,
  InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { FaberLoomOverview } from '@deepseek-ai/dsh-faberloom-view/types'
import type { FaberloomKey } from './locales.ts'

/** One bound translate for the gesture copy. */
type Translate = (key: FaberloomKey, params?: Record<string, unknown>) => string

/** Short overview cache: the candidates pass runs per keystroke. */
const OVERVIEW_TTL_MS = 5_000

/**
 * Register the `@agents` trigger source and the `/routine` command.
 * @param ctx - client root context.
 * @param t - the faberloom dictionary bound at apply.
 */
export function registerChatGestures(ctx: ClientContext, t: Translate): void {
  let cached: { readonly at: number; readonly value: FaberLoomOverview | undefined } = { at: 0, value: undefined }

  /** Read the overview, serving the TTL copy while it is fresh. */
  const overview = async (signal?: AbortSignal): Promise<FaberLoomOverview | undefined> => {
    if (Date.now() - cached.at < OVERVIEW_TTL_MS && cached.value !== undefined) return cached.value
    const result = await ctx.remote.faberloomView.overview()
    if (signal?.aborted === true) return cached.value
    const value = result.ok ? result.value : undefined
    cached = { at: Date.now(), value }
    return value
  }

  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  const sessions = ctx.get('sessions') as ISessions

  const agentsSource: InputTriggerSource = {
    trigger: '@',
    name: 'agents',
    // Above the files/sessions group: addressing an agent is the product gesture.
    order: -1,
    showGroupTitle: false,
    async candidates(_session: ClientSessionContext, { query, signal }) {
      const current = await overview(signal)
      if (current === undefined || signal.aborted) return []
      const needle = query.trim().toLowerCase()
      const spaces = new Map(current.spaces.map(space => [space.id, space.title]))
      return current.agents
        .filter(agent => agent.active)
        .filter(agent => needle.length === 0 || agent.name.toLowerCase().includes(needle))
        .slice(0, 20)
        .map(agent => ({
          name: agent.name,
          label: agent.name,
          description: agent.spaceId === null ? t('trigger.personalSpace') : (spaces.get(agent.spaceId) ?? ''),
          section: t('trigger.agents'),
          value: agent.name,
        }))
    },
    onPick({ candidate }) {
      return { text: `@${candidate.name} ` }
    },
  }
  ctx.effect(() => inputTriggers.registerSource(agentsSource), 'ui-faberloom: @ agents source')

  const command = ctx.get('commandUi') as CommandUiContract
  ctx.effect(() => command.register({
    name: 'routine',
    label: () => t('command.routine'),
    description: () => t('command.routineDesc'),
    available: session => sessions.subagentAddress(session.sessionId) === undefined,
    ui: {
      kind: 'popupSelect',
      options: async (session, signal) => {
        if (sessions.subagentAddress(session.sessionId) !== undefined) return []
        const current = await overview(signal)
        if (current === undefined || signal.aborted) return []
        return current.routines.map(routine => ({
          id: routine.id,
          label: routine.name,
          badge: routine.status,
        }))
      },
      onSelect: async (option) => {
        await ctx.remote.faberloomView.startRoutine(option.id)
      },
    },
  }), 'ui-faberloom: /routine contribution')
}
