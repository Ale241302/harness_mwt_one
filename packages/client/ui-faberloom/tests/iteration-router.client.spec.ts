import { describe, expect, it } from 'vitest'
import { routeIteration } from '../src/client/iteration-router.ts'

describe('iteration field router', () => {
  it('routes a field assignment with @ and with a plain name', () => {
    expect(routeIteration('@total = 1234', ['summary', 'total'])).toEqual([{ field: 'total', value: 1234 }])
    expect(routeIteration('total: 12,5', ['total'])).toEqual([{ field: 'total', value: 12.5 }])
    expect(routeIteration('cambiar resumen a listo', ['summary'])).toEqual([{ field: 'summary', value: 'listo' }])
    expect(routeIteration('change summary to ready', ['summary'])).toEqual([{ field: 'summary', value: 'ready' }])
  })

  it('routes several assignments and keeps the declared field spelling', () => {
    expect(routeIteration('@Total = 10; @currency = CRC', ['total', 'currency'])).toEqual([
      { field: 'total', value: 10 },
      { field: 'currency', value: 'CRC' },
    ])
  })

  it('parses booleans and null', () => {
    expect(routeIteration('@urgent = si', ['urgent'])).toEqual([{ field: 'urgent', value: true }])
    expect(routeIteration('@due = null', ['due'])).toEqual([{ field: 'due', value: null }])
  })

  it('refuses a sentence or a field the item does not declare', () => {
    expect(routeIteration('hacé lo que puedas', ['summary'])).toBeNull()
    expect(routeIteration('@desconocido = 1', ['summary'])).toBeNull()
    expect(routeIteration('@total = 1', ['summary', 'total'])).toEqual([{ field: 'total', value: 1 }])
    expect(routeIteration('   ', ['summary'])).toBeNull()
  })
})
