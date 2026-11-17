/**
 * O5-05 · the shared experience filter: no base, no proposal; with base, cite
 * it; contradictions and missing inputs are shown, never smoothed over.
 */
import { describe, expect, it } from 'vitest'
import { shapeExperience, type ExperienceSource } from '../src/experience.ts'

/** One approved fact. */
function fact(patch: Partial<ExperienceSource> = {}): ExperienceSource {
  return {
    id: 't-1',
    kind: 'teaching',
    text: 'Para Eguisa, la proforma va con precio DDP y flete incluido.',
    approved: true,
    origin: 'teaching:t-1',
    ...patch,
  }
}

describe('shapeExperience', () => {
  it('abstains when no approved fact is relevant', () => {
    const answer = shapeExperience('¿Cómo cotizo a Sonepar?', [fact()], ['precio'])
    expect(answer.kind).toBe('abstain')
    expect(answer.sources).toEqual([])
    expect(answer.missing).toEqual(['precio'])
  })

  it('cites the relevant approved lesson instead of inventing a solution', () => {
    const answer = shapeExperience('¿Cómo cotizo a Eguisa?', [fact(), fact({ id: 't-2', text: 'Los pedidos de Marluvas llevan guía propia.' })])
    expect(answer.kind).toBe('suggest')
    expect(answer.sources.map(source => source.id)).toEqual(['t-1'])
    expect(answer.sources[0]?.origin).toBe('teaching:t-1')
  })

  it('treats an unapproved inherited fact as no base at all', () => {
    const answer = shapeExperience('¿Cómo cotizo a Eguisa?', [fact({ approved: false })])
    expect(answer.kind).toBe('abstain')
    expect(answer.sources).toEqual([])
  })

  it('shows contradictory facts for the same topic instead of picking one', () => {
    const answer = shapeExperience('Eguisa precio', [
      fact({ id: 't-1', key: 'flete', text: 'Eguisa paga el flete.' }),
      fact({ id: 't-2', key: 'flete', text: 'Eguisa no paga el flete.' }),
    ])
    expect(answer.kind).toBe('suggest')
    expect(answer.conflicts).toHaveLength(1)
    expect(answer.conflicts[0]?.key).toBe('flete')
    expect(answer.conflicts[0]?.values.map(value => value.sourceId).sort()).toEqual(['t-1', 't-2'])
  })

  it('does not report a conflict when the facts agree', () => {
    const answer = shapeExperience('Eguisa flete', [
      fact({ id: 't-1', key: 'flete', text: 'Eguisa paga el flete.' }),
      fact({ id: 't-2', key: 'flete', text: 'eguisa paga el flete' }),
    ])
    expect(answer.conflicts).toEqual([])
  })

  it('lists the inputs the answer still needs', () => {
    const answer = shapeExperience('Eguisa precio', [fact({ key: 'precio' })], ['precio', 'incoterm'])
    expect(answer.missing).toEqual(['incoterm'])
  })

  it('abstains on a query made only of stopwords', () => {
    expect(shapeExperience('para como este', [fact()]).kind).toBe('abstain')
  })
})
