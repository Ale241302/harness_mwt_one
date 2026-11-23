/** The floating mail conversation sees the owner's Spaces before it offers one. */
import { describe, expect, it, vi } from 'vitest'
import { FaberLoomViewService } from '../src/index.ts'

const OWNER = 'owner@muitowork.com'

/** One space the fake registry answers with. */
interface FakeSpace {
  id: string
  title: string
  parentId: string | null
  context: string
}

/** A context whose Spaces service and agent registry are observable. */
function bench(options: {
  spaces?: readonly FakeSpace[]
  matches?: readonly { id: string; score: number; reasons: string[] }[]
  events?: readonly { type: string }[]
} = {}) {
  const spaces = options.spaces ?? [
    { id: 'sp-marluvas', title: 'Marluvas', parentId: null, context: '' },
    { id: 'sp-pedidos', title: 'Pedidos', parentId: 'sp-marluvas', context: '' },
  ]
  const spacesService = {
    list: vi.fn(async () => spaces),
    find: vi.fn(async (_actor: unknown, _query: string, _limit?: number) => options.matches ?? []),
    listMemory: vi.fn(async () => [{ text: 'El cliente pide LCL a San José.' }]),
    listFiles: vi.fn(async () => [{ name: 'OC-4711.pdf' }]),
  }
  const agent = {
    session: {
      id: 'session-1',
      snapshotEvents: () => options.events ?? [],
    },
  }
  const ctx = {
    reflect: { provide: () => {} },
    effect: () => () => {},
    on: () => () => {},
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => name === 'agents' ? { list: () => [agent] } : undefined,
    faberloomSpaces: spacesService,
  } as never
  const view = new FaberLoomViewService(ctx, { ownerId: OWNER, role: 'admin', readOnly: false, anydoc: false })
  return { view, spacesService }
}

describe('mailSpaceBrief', () => {
  it('ranks the Spaces for the mail and carries memory, files, and the parent title', async () => {
    const { view, spacesService } = bench({
      matches: [{ id: 'sp-pedidos', score: 4, reasons: ['coincide el cliente'] }],
    })

    const brief = await view.mailSpaceBrief('Re: OC 4711', 'compras@sondelsa.com', 'LCL Santos')

    expect(brief.total).toBe(2)
    expect(brief.candidates).toEqual([{
      id: 'sp-pedidos',
      title: 'Pedidos',
      parentTitle: 'Marluvas',
      score: 4,
      reasons: ['coincide el cliente'],
      memory: ['El cliente pide LCL a San José.'],
      files: ['OC-4711.pdf'],
    }])
    expect(spacesService.find).toHaveBeenCalledOnce()
    expect(spacesService.find.mock.calls[0]?.[1]).toContain('OC 4711')
  })

  it('answers the Space count with no candidates when nothing matches', async () => {
    const { view } = bench({ matches: [] })

    await expect(view.mailSpaceBrief('Hola', undefined, undefined)).resolves.toEqual({ total: 2, candidates: [] })
  })
})

describe('mailSessionTurns', () => {
  it('counts the assistant answers already in the conversation', async () => {
    const { view } = bench({
      events: [
        { type: 'user/message' },
        { type: 'assistant/message' },
        { type: 'assistant/message' },
      ],
    })
    await expect(view.mailSessionTurns('session-1')).resolves.toBe(2)
    await expect(view.mailSessionTurns('session-other')).resolves.toBe(0)
  })
})
