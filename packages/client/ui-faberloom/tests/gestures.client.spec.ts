import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { CommandContribution, CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { registerChatGestures } from '../src/client/triggers.ts'
import { en, type FaberloomKey } from '../src/client/locales.ts'

/** One overview with active and inactive agents and two routines. */
const OVERVIEW = {
  spaces: [{ id: 'sp1', title: 'Marluvas', parentId: null }],
  agents: [
    { id: 'ag1', name: 'Proformas Eguisa', spaceId: 'sp1', active: true },
    { id: 'ag2', name: 'Recepción', spaceId: null, active: true },
    { id: 'ag3', name: 'Archivado', spaceId: null, active: false },
  ],
  board: [],
  routines: [
    { id: 'ru1', name: 'Pedido → proforma', status: 'active' },
    { id: 'ru2', name: 'Seguimiento', status: 'paused' },
  ],
  memory: [],
  canWrite: true,
}

/** Boot the gestures over stub seats and return what they registered. */
function harness(overviewResult: unknown = { ok: true, value: OVERVIEW }) {
  const sources: InputTriggerSource[] = []
  const contributions: CommandContribution[] = []
  const startRoutine = vi.fn(async () => ({ ok: true, value: [] }))
  const t = (key: FaberloomKey): string => en[key]
  const ctx = {
    remote: { faberloomView: { overview: vi.fn(async () => overviewResult), startRoutine } },
    get(name: string) {
      if (name === 'inputTriggers') {
        const stub: Partial<InputTriggerServiceContract> = { registerSource: (source) => { sources.push(source); return () => {} } }
        return stub
      }
      if (name === 'commandUi') {
        const register: CommandUiContract['register'] = (contribution) => { contributions.push(contribution); return () => {} }
        return { register } satisfies Partial<CommandUiContract>
      }
      if (name === 'sessions') return { subagentAddress: () => undefined }
      return undefined
    },
    effect: (run: () => () => void) => { run() },
  } as unknown as ClientContext
  registerChatGestures(ctx, t)
  return { sources, contributions, startRoutine, overview: ctx.remote.faberloomView.overview }
}

describe('faberloom chat gestures', () => {
  it('@ lists the active agents, filtered by the query, with their space', async () => {
    const { sources } = harness()
    const source = sources.find(entry => entry.trigger === '@' && entry.name === 'agents')
    expect(source).toBeDefined()
    const session = { sessionId: 's1' } as never
    const all = await source!.candidates(session, { query: '', position: 'leading', signal: new AbortController().signal } as never)
    expect(all.map(candidate => candidate.name)).toEqual(['Proformas Eguisa', 'Recepción'])
    expect(all[0]).toMatchObject({ description: 'Marluvas', section: 'Agents' })
    expect(all[1]).toMatchObject({ description: 'personal' })

    const filtered = await source!.candidates(session, { query: 'eguisa', position: 'leading', signal: new AbortController().signal } as never)
    expect(filtered.map(candidate => candidate.name)).toEqual(['Proformas Eguisa'])

    expect(source!.onPick({ candidate: all[0]!, session, position: 'leading', via: 'menu', action: 'pick', span: {} as never }))
      .toEqual({ text: '@Proformas Eguisa ' })
  })

  it('/routine offers the routines and starts the picked one', async () => {
    const { contributions, startRoutine } = harness()
    const contribution = contributions.find(entry => entry.name === 'routine')
    expect(contribution).toBeDefined()
    const session = { sessionId: 's1' } as never
    const ui = contribution!.ui as unknown as {
      options: (session: never, signal: AbortSignal) => Promise<readonly { id: string; label: string; badge?: string }[]>
      onSelect: (option: { id: string }) => Promise<void>
    }
    const options = await ui.options(session, new AbortController().signal)
    expect(options).toEqual([
      { id: 'ru1', label: 'Pedido → proforma', badge: 'active' },
      { id: 'ru2', label: 'Seguimiento', badge: 'paused' },
    ])
    await ui.onSelect({ id: 'ru2' })
    expect(startRoutine).toHaveBeenCalledWith('ru2')
  })

  it('keeps serving the last overview when a read fails', async () => {
    const { sources } = harness({ ok: false, error: { code: 'x', message: 'caído' } })
    const source = sources.find(entry => entry.trigger === '@' && entry.name === 'agents')
    const all = await source!.candidates({ sessionId: 's1' } as never, { query: '', position: 'leading', signal: new AbortController().signal } as never)
    expect(all).toEqual([])
  })
})
