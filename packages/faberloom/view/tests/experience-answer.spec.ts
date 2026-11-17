/**
 * O5-05 wiring: the view grounds an answer in the Space's approved experience and
 * abstains when there is none. The filter itself is tested in learning.
 */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { FaberLoomViewService } from '../src/index.ts'

const OWNER = 'compras2@sondelsa.com'

/** A view over stubbed Spaces and learning services. */
function harness(options: {
  readonly memories?: readonly Record<string, unknown>[]
  readonly teachings?: readonly Record<string, unknown>[]
  readonly denied?: boolean
} = {}) {
  const spaces = {
    effectiveMemory: vi.fn(async () => {
      if (options.denied === true) throw new Error('faberloom: space access denied')
      return options.memories ?? []
    }),
  }
  const learning = {
    listTeachings: vi.fn(async () => options.teachings ?? []),
  }
  const ctx = {
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => (name === 'faberloomMemory' ? learning : undefined),
    faberloomSpaces: spaces,
    faberloomMemory: learning,
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: OWNER, role: 'admin', readOnly: false })
  return { view, spaces, learning }
}

describe('O5-05 · experienceFor', () => {
  it('cites the live memory that grounds the answer', async () => {
    const { view } = await Promise.resolve(harness({
      memories: [{ id: 'm-1', text: 'Para Eguisa el precio va DDP con flete incluido.', origin: 'live' }],
    }))

    const answer = await view.experienceFor('sp-1', '¿Cómo cotizo el precio a Eguisa?')

    expect(answer.kind).toBe('suggest')
    expect(answer.sources.map(source => source.id)).toEqual(['m-1'])
    expect(answer.sources[0]?.origin).toBe('memory:m-1')
  })

  it('does not cite inherited memory and abstains when it is the only base', async () => {
    const { view } = await Promise.resolve(harness({
      memories: [{ id: 'm-old', text: 'Regla vieja de Eguisa con flete.', origin: 'legacy' }],
    }))

    const answer = await view.experienceFor('sp-1', '¿Cómo cotizo el flete a Eguisa?')

    expect(answer.kind).toBe('abstain')
    expect(answer.sources).toEqual([])
  })

  it('cites only active teachings', async () => {
    const { view } = await Promise.resolve(harness({
      teachings: [
        { id: 't-1', text: 'Eguisa exige proforma con firma.', status: 'active' },
        { id: 't-2', text: 'Eguisa exige proforma sin firma.', status: 'revoked' },
      ],
    }))

    const answer = await view.experienceFor('sp-1', '¿Qué firma exige Eguisa en la proforma?')

    expect(answer.kind).toBe('suggest')
    expect(answer.sources.map(source => source.id)).toEqual(['t-1'])
    expect(answer.sources[0]?.origin).toBe('teaching:t-1')
  })

  it('abstains when the Space cannot be read instead of failing the panel', async () => {
    const { view } = await Promise.resolve(harness({ denied: true }))

    const answer = await view.experienceFor('sp-1', '¿Cómo cotizo a Eguisa?')

    expect(answer.kind).toBe('abstain')
    expect(answer.sources).toEqual([])
  })
})
