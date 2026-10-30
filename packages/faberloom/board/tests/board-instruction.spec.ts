import { describe, expect, it } from 'vitest'
import { routeFieldInstruction } from '../src/router.ts'
import { ACTOR_A, COMPANY_A, OWNER_A, bootBoard, seedProforma, seedSpace } from './helpers/harness.ts'

describe('deterministic field router (§9.7)', () => {
  it('routes @field, plain assignment, and the two verb forms', () => {
    expect(routeFieldInstruction('@total = 1234', ['summary', 'total']))
      .toEqual([{ field: 'total', value: 1234 }])
    expect(routeFieldInstruction('total: 12,5', ['total'])).toEqual([{ field: 'total', value: 12.5 }])
    expect(routeFieldInstruction('cambiar resumen a listo', ['summary']))
      .toEqual([{ field: 'summary', value: 'listo' }])
    expect(routeFieldInstruction('change summary to ready', ['summary']))
      .toEqual([{ field: 'summary', value: 'ready' }])
  })

  it('routes several segments, keeps the declared spelling, and parses scalars', () => {
    expect(routeFieldInstruction('@Total = 10; @currency = CRC', ['total', 'currency'])).toEqual([
      { field: 'total', value: 10 },
      { field: 'currency', value: 'CRC' },
    ])
    expect(routeFieldInstruction('@urgent = si', ['urgent'])).toEqual([{ field: 'urgent', value: true }])
    expect(routeFieldInstruction('@due = null', ['due'])).toEqual([{ field: 'due', value: null }])
  })

  it('refuses a sentence or a field the item does not declare', () => {
    expect(routeFieldInstruction('hacé lo que puedas', ['summary'])).toBeNull()
    expect(routeFieldInstruction('@desconocido = 1', ['summary'])).toBeNull()
    expect(routeFieldInstruction('@summary = uno; @desconocido = 2', ['summary'])).toBeNull()
    expect(routeFieldInstruction('   ', ['summary'])).toBeNull()
  })

  it('reads an empty literal and trailing separators without inventing a change', () => {
    expect(routeFieldInstruction('@summary = ""', ['summary'])).toEqual([{ field: 'summary', value: null }])
    expect(routeFieldInstruction('@urgent = no', ['urgent'])).toEqual([{ field: 'urgent', value: false }])
    expect(routeFieldInstruction('@summary = listo;', ['summary'])).toEqual([{ field: 'summary', value: 'listo' }])
    expect(routeFieldInstruction(';', ['summary'])).toBeNull()
  })
})

describe('iteration chat attachment (§9.7)', () => {
  /** Boot one item inside an attempt on the `tab-a` session. */
  async function bootAttempt() {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const item = await seedProforma(harness.board, OWNER_A, COMPANY_A, space)
    await harness.board.iterate(ACTOR_A, item.id, { baseVersion: item.version, actorSession: 'tab-a' })
    return { harness, item: await harness.board.get(ACTOR_A, item.id) }
  }

  it('applies a recognized instruction to the live draft without a model', async () => {
    const { harness, item } = await bootAttempt()
    const chat = await harness.board.attachIterationChat(ACTOR_A, item.id, 'chat-1')
    expect(chat).toMatchObject({ itemId: item.id, holderSession: 'tab-a', baseVersion: item.version })

    const outcome = await harness.board.applyIterationInstruction('chat-1', '@summary = Listo')
    expect(outcome).toMatchObject({ applied: true, changes: [{ field: 'summary', value: 'Listo' }] })
    expect(await harness.board.getIterationDraft(ACTOR_A, item.id)).toMatchObject({ summary: 'Listo' })
  })

  it('writes named content fields and delegates the rest to the agent', async () => {
    const { harness, item } = await bootAttempt()
    await harness.board.attachIterationChat(ACTOR_A, item.id, 'chat-1')
    const attempt = {
      iterationId: item.iterationId ?? '',
      generation: item.iterationLockGeneration,
      actorSession: 'tab-a',
      baseVersion: item.version,
    }
    await harness.board.saveIterationDraft(ACTOR_A, item.id, { ...attempt, content: { total: 100 } })

    const outcome = await harness.board.applyIterationInstruction('chat-1', '@total = 250')
    expect(outcome?.changes).toEqual([{ field: 'total', value: 250 }])
    expect(await harness.board.getIterationDraft(ACTOR_A, item.id)).toMatchObject({ content: { total: 250 } })

    // A sentence the router does not own, and a session with no attachment,
    // belong to the agent: nothing is written.
    expect(await harness.board.applyIterationInstruction('chat-1', 'hacé lo que puedas')).toBeUndefined()
    expect(await harness.board.applyIterationInstruction('chat-x', '@summary = no')).toBeUndefined()
    expect(await harness.board.getIterationDraft(ACTOR_A, item.id)).toMatchObject({ summary: null })
  })

  it('accepts an instruction over a field the artifact declares before the draft carries it', async () => {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const created = await harness.board.create(ACTOR_A, {
      title: 'Proforma declarada',
      summary: 'borrador',
      evidence: ['oc:decl'],
      content: { total: 50 },
      spaceId: space,
    })
    await harness.board.iterate(ACTOR_A, created.id, { baseVersion: created.version, actorSession: 'tab-a' })
    await harness.board.attachIterationChat(ACTOR_A, created.id, 'chat-1')

    const outcome = await harness.board.applyIterationInstruction('chat-1', '@total = 75')
    expect(outcome).toMatchObject({ applied: true, changes: [{ field: 'total', value: 75 }] })
    expect(await harness.board.getIterationDraft(ACTOR_A, created.id)).toMatchObject({ content: { total: 75 } })
  })

  it('refuses to attach a chat to an item without a live attempt', async () => {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const item = await seedProforma(harness.board, OWNER_A, COMPANY_A, space)
    await expect(harness.board.attachIterationChat(ACTOR_A, item.id, 'chat-1'))
      .rejects.toThrow('NO_ITERATION')
  })

  it('routes an instruction against the fields the item declares, for a reader', async () => {
    const harness = await bootBoard()
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const item = await seedProforma(harness.board, OWNER_A, COMPANY_A, space)
    expect(await harness.board.routeInstruction(ACTOR_A, item.id, '@summary = Listo'))
      .toEqual([{ field: 'summary', value: 'Listo' }])
    expect(await harness.board.routeInstruction(ACTOR_A, item.id, 'hacé lo que puedas')).toBeNull()
  })
})
