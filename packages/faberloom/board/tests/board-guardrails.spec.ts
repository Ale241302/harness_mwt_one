import { describe, expect, it } from 'vitest'
import { MemoryMediaPool } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import type { BoardClassifierPort, BoardClassifierResult } from '../src/types.ts'
import { ACTOR_A, ACTOR_B, bootBoard, rawBoardItem, seedRawItem } from './helpers/harness.ts'

/** A classifier whose answer and call count the test controls. */
function classifier(result: BoardClassifierResult = { status: 'classified', severity: 'MEDIUM', confidence: 0.9 }) {
  const calls: string[] = []
  const port: BoardClassifierPort = {
    modelVersion: 'test-model-1',
    async classifySeverity(request) {
      calls.push(`${request.artifactType}\u0000${request.accountRef ?? ''}`)
      return result
    },
  }
  return { calls, port }
}

describe('Mesa guardrails', () => {
  it('W-38 · the caller cannot declare its own data class', async () => {
    const { board } = await bootBoard()
    const request = {
      runId: 'run-class',
      idempotencyKey: 'idem-class',
      businessKey: 'bkey-class',
      summary: 'proforma con datos del cliente',
      evidence: ['oc:1'],
      artifactType: 'proforma',
      // A caller that tries to make its own item less sensitive is ignored.
      dataClass: 'N0',
    }
    const item = await board.submit(ACTOR_A, request as never)

    expect(item.dataClass).toBe('N2')
    expect(item.dataClassProvisional).toBe(false)
  })

  it('D-3 · a non-USD amount needs the rate, source, and date, and converts to two decimals', async () => {
    const { board } = await bootBoard()
    const base = {
      runId: 'run-fx',
      idempotencyKey: 'idem-fx',
      businessKey: 'bkey-fx',
      summary: 'pedido en euros',
      evidence: ['oc:2'],
      artifactType: 'tarea',
      valueAmount: 100.005,
      valueCurrency: 'EUR',
    }

    await expect(board.submit(ACTOR_A, base)).rejects.toThrow('FX_RATE_REQUIRED')
    await expect(board.submit(ACTOR_A, { ...base, valueFxRate: 1.1 })).rejects.toThrow('FX_SOURCE_REQUIRED')
    await expect(board.submit(ACTOR_A, { ...base, valueFxRate: 1.1, valueFxSource: 'MWT ONE' }))
      .rejects.toThrow('FX_DATE_REQUIRED')

    const converted = await board.submit(ACTOR_A, {
      ...base,
      valueFxRate: 1.1,
      valueFxSource: 'MWT ONE',
      valueFxDate: '2026-10-29',
    })
    expect(converted).toMatchObject({
      valueAmount: 100.005,
      valueCurrency: 'EUR',
      valueUsd: 110.01,
      valueFxRate: 1.1,
      valueFxSource: 'MWT ONE',
      valueFxDate: '2026-10-29',
    })

    const usd = await board.submit(ACTOR_A, {
      runId: 'run-usd',
      idempotencyKey: 'idem-usd',
      businessKey: 'bkey-usd',
      summary: 'pedido en dólares',
      evidence: ['oc:3'],
      artifactType: 'tarea',
      valueAmount: 42,
      valueCurrency: 'USD',
    })
    expect(usd).toMatchObject({ valueUsd: 42, valueFxRate: 1 })
  })

  it('W-51 / W-61 · the classification cache answers per tenant and account, and calls the port once', async () => {
    const harness = await bootBoard()
    const fake = classifier()
    harness.ctx.provide('faberloomBoardClassifier', fake.port)

    const submit = async (actor: typeof ACTOR_A, suffix: string) => await harness.board.submit(actor, {
      runId: `run-${suffix}`,
      idempotencyKey: `idem-${suffix}`,
      businessKey: `bkey-${suffix}`,
      summary: 'sin regla determinista',
      evidence: ['oc:4'],
      artifactType: 'desconocido',
    })

    const first = await submit(ACTOR_A, 'c1')
    expect(first).toMatchObject({ severity: 'MEDIUM', severitySource: 'LLM' })
    const cached = await submit(ACTOR_A, 'c2')
    expect(cached.severity).toBe('MEDIUM')
    expect(fake.calls).toHaveLength(1)

    // Another account is another context and another answer.
    await harness.board.submit(ACTOR_A, {
      runId: 'run-c3',
      idempotencyKey: 'idem-c3',
      businessKey: 'bkey-c3',
      summary: 'sin regla determinista',
      evidence: ['oc:5'],
      artifactType: 'desconocido',
      accountRef: 'Eguisa',
    })
    expect(fake.calls).toHaveLength(2)

    // Another tenant never reuses the entry.
    await harness.board.submit(ACTOR_B, {
      runId: 'run-c4',
      idempotencyKey: 'idem-c4',
      businessKey: 'bkey-c4',
      summary: 'sin regla determinista',
      evidence: ['oc:6'],
      artifactType: 'desconocido',
    })
    expect(fake.calls).toHaveLength(3)
  })

  it('W-37 · a classifier that times out leaves the item unclassified and still enters', async () => {
    const harness = await bootBoard()
    harness.ctx.provide('faberloomBoardClassifier', classifier({ status: 'timeout' }).port)

    const item = await harness.board.submit(ACTOR_A, {
      runId: 'run-timeout',
      idempotencyKey: 'idem-timeout',
      businessKey: 'bkey-timeout',
      summary: 'sin clasificar',
      evidence: ['oc:7'],
      artifactType: 'desconocido',
    })
    expect(item).toMatchObject({ severity: null, severitySource: null, state: 'PENDIENTE_CRITERIO' })
  })

  it('W-26 · opening a restricted item is audited once an hour, and never for N2', async () => {
    const pool = new MemoryMediaPool()
    const restricted = await seedRawItem(pool, rawBoardItem({ dataClass: 'N3', dataClassProvisional: false }))
    const open = await seedRawItem(pool, rawBoardItem({ dataClass: 'N2' }))
    const { board } = await bootBoard({ pool })

    await board.noteAccess(ACTOR_A, restricted, 'boardDetail')
    await board.noteAccess(ACTOR_A, restricted, 'boardDetail')
    const audited = await board.get(ACTOR_A, restricted)
    expect(audited.events.filter(event => event.command === 'access')).toHaveLength(1)
    // A read never moves the optimistic token.
    expect(audited.rowVersion).toBe(1)

    await board.noteAccess(ACTOR_A, open, 'boardDetail')
    expect((await board.get(ACTOR_A, open)).events).toHaveLength(0)
  })
})
