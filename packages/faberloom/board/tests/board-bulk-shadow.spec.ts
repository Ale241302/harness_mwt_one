import { describe, expect, it } from 'vitest'
import { ACTOR_A, ACTOR_B, bootBoard, seedSpace } from './helpers/harness.ts'
import type { BoardClassifierResult, FaberLoomBoardItemId } from '../src/types.ts'

type Harness = Awaited<ReturnType<typeof bootBoard>>

/** Boot one LOW task inside a Space, with the row the reviewer saw. */
async function lowTask(harness: Harness, space: string, title: string, assigneeId = 'agent-1') {
  const item = await harness.board.create(ACTOR_A, {
    title, summary: title, evidence: [`oc:${title}`], artifactType: 'tarea', spaceId: space,
    assigneeId, actionType: 'mesa.decide',
  })
  await harness.board.setSeverity(ACTOR_A, item.id, 'LOW', 'HUMAN')
  const current = await harness.board.get(ACTOR_A, item.id)
  return {
    id: item.id,
    rowVersion: current.rowVersion,
    artifactVersion: current.version,
    artifactHash: current.artifactHash ?? '',
  }
}

/** One item as the reviewer saw it. */
function entry(
  item: {
    readonly id: string
    readonly rowVersion: number
    readonly artifactVersion: number
    readonly artifactHash: string
  },
  hash = item.artifactHash,
) {
  return {
    id: item.id,
    expectedRowVersion: item.rowVersion,
    expectedArtifactVersion: item.artifactVersion,
    expectedArtifactHash: hash,
  }
}
describe('bulk approval (§6.4, W-14/W-15)', () => {
  it('approves every eligible item and revalidates each one on the server', async () => {
    const harness = await bootBoard({ board: { bulkApprovalEnabled: true } })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const first = await lowTask(harness, space, 'Tarea uno')
    const second = await lowTask(harness, space, 'Tarea dos')

    const result = await harness.board.approveBulk(ACTOR_A, {
      items: [first, second].map(item => ({
        id: item.id,
        expectedRowVersion: item.rowVersion,
        expectedArtifactVersion: item.artifactVersion,
        expectedArtifactHash: item.artifactHash,
      })),
    })
    expect(result.approved).toHaveLength(2)
    expect(result.rejected).toEqual([])
    expect((await harness.board.get(ACTOR_A, first.id)).state).toBe('APROBADO')
  })

  it('reports each refusal with its code and approves the rest', async () => {
    const harness = await bootBoard({ board: { bulkApprovalEnabled: true } })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const good = await lowTask(harness, space, 'Tarea buena')
    const stale = await lowTask(harness, space, 'Tarea vieja')
    const high = await lowTask(harness, space, 'Tarea alta')
    await harness.board.setSeverity(ACTOR_A, high.id, 'HIGH', 'HUMAN')
    const mixed = await lowTask(harness, space, 'Tarea otro agente', 'agent-2')

    const result = await harness.board.approveBulk(ACTOR_A, {
      items: [
        entry(good),
        // A hash the reviewer did not see is stale.
        entry(stale, 'otro'),
        // A HIGH severity never joins a batch.
        entry(high),
        // An item outside the batch scope is refused, not silently included.
        entry(mixed),
      ],
    })
    expect(result.approved.map(entry => entry.id)).toEqual([good.id])
    const codes = Object.fromEntries(result.rejected.map(entry => [entry.id, entry.code]))
    expect(codes[stale.id]).toBe('STALE_REVISION')
    expect(codes[high.id]).toBe('BULK_SEVERITY')
    expect(codes[mixed.id]).toBe('BULK_MIXED')
  })

  it('rejects an already-approved item, a stale version, another owner, and an effect action', async () => {
    const harness = await bootBoard({ board: { bulkApprovalEnabled: true } })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const approved = await lowTask(harness, space, 'Tarea aprobada')
    await harness.board.approve(ACTOR_A, approved.id, {
      expectedRowVersion: approved.rowVersion,
      expectedArtifactVersion: approved.artifactVersion,
      expectedArtifactHash: approved.artifactHash,
    })
    const stale = await lowTask(harness, space, 'Tarea versión vieja')
    const foreign = await harness.board.create(ACTOR_B, {
      title: 'Tarea ajena', summary: 's', evidence: ['oc:ajena'], artifactType: 'tarea',
    })
    await harness.board.setSeverity(ACTOR_B, foreign.id, 'LOW', 'HUMAN')
    const foreignRow = await harness.board.get(ACTOR_B, foreign.id)
    const effect = await harness.board.create(ACTOR_A, {
      title: 'Tarea de efecto', summary: 's', evidence: ['oc:efecto'], artifactType: 'tarea', spaceId: space,
      actionType: 'mail.send',
    })
    await harness.board.setSeverity(ACTOR_A, effect.id, 'LOW', 'HUMAN')
    const effectRow = await harness.board.get(ACTOR_A, effect.id)

    const result = await harness.board.approveBulk(ACTOR_A, {
      items: [
        entry(approved),
        { ...entry(stale), expectedArtifactVersion: 99 },
        {
          id: foreign.id, expectedRowVersion: foreignRow.rowVersion,
          expectedArtifactVersion: foreignRow.version, expectedArtifactHash: foreignRow.artifactHash ?? '',
        },
        {
          id: effect.id, expectedRowVersion: effectRow.rowVersion,
          expectedArtifactVersion: effectRow.version, expectedArtifactHash: effectRow.artifactHash ?? '',
        },
      ],
    })
    expect(result.approved).toEqual([])
    const codes = Object.fromEntries(result.rejected.map(item => [item.id, item.code]))
    expect(codes[approved.id]).toBe('STALE_ROW')
    expect(codes[stale.id]).toBe('STALE_REVISION')
    expect(codes[foreign.id]).toBe('NO_ACCESS')
    expect(codes[effect.id]).toBe('BULK_ACTION')
  })

  it('honours a confirmation per item instead of one list for the batch', async () => {
    const harness = await bootBoard({ board: { bulkApprovalEnabled: true } })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const first = await lowTask(harness, space, 'Tarea uno')
    const second = await lowTask(harness, space, 'Tarea dos')
    const result = await harness.board.approveBulk(ACTOR_A, {
      items: [
        { ...entry(first), confirmations: ['proforma.separation'] },
        { ...entry(second), confirmations: ['proforma.stock'] },
      ],
    })
    expect(result.approved).toHaveLength(2)
  })
  it('keeps the batch out of the pilot configuration (W-14)', async () => {
    const harness = await bootBoard()
    await expect(harness.board.approveBulk(ACTOR_A, { items: [] })).rejects.toThrow('BULK_DISABLED')
  })

  it('refuses a priced item', async () => {
    const harness = await bootBoard({ board: { bulkApprovalEnabled: true } })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const priced = await harness.board.submit(ACTOR_A, {
      runId: 'run-priced', idempotencyKey: 'idem-priced', sourceRef: 'OC-PRICED',
      title: 'Tarea con monto', summary: 's', evidence: ['oc:priced'], artifactType: 'tarea', spaceId: space,
      valueAmount: 10, valueCurrency: 'USD',
    })
    await harness.board.setSeverity(ACTOR_A, priced.id, 'LOW', 'HUMAN')
    const current = await harness.board.get(ACTOR_A, priced.id)
    const result = await harness.board.approveBulk(ACTOR_A, {
      items: [{
        id: current.id, expectedRowVersion: current.rowVersion,
        expectedArtifactVersion: current.version, expectedArtifactHash: current.artifactHash ?? '',
      }],
    })
    expect(result.rejected[0]?.code).toBe('BULK_MONEY')
  })
})

describe('shadow evaluation of a human severity (W-63)', () => {
  /** Boot one item reclassified to N1 so the shadow is allowed to read it. */
  async function shadowItem(harness: Harness, title: string): Promise<FaberLoomBoardItemId> {
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const item = await harness.board.create(ACTOR_A, {
      title, summary: title, evidence: [`oc:${title}`], artifactType: 'tarea', spaceId: space,
    })
    await harness.board.reclassify(ACTOR_A, item.id, 'N1')
    return item.id
  }

  /** A shadow port whose answer and call count the test controls. */
  function shadow(answer: () => BoardClassifierResult) {
    const calls: string[] = []
    return {
      calls,
      port: {
        modelVersion: 'shadow-model@1',
        async classifySeverity(request: { artifactType: string }) {
          calls.push(request.artifactType)
          return answer()
        },
      },
    }
  }

  it('compares against the human label and never changes the item', async () => {
    const harness = await bootBoard()
    const fake = shadow(() => ({ status: 'classified', severity: 'HIGH', confidence: 0.95 }))
    harness.ctx.provide('faberloomBoardShadow', fake.port)
    const id = await shadowItem(harness, 'Tarea sombra')

    const confirmed = await harness.board.setSeverity(ACTOR_A, id, 'HIGH', 'HUMAN')
    expect(confirmed.severity).toBe('HIGH')
    expect(fake.calls).toHaveLength(1)
    const report = await harness.board.shadowReport(ACTOR_A)
    expect(report).toMatchObject({ evaluated: 1, matched: 1, mismatched: 0, criticalLowered: 0 })
    expect(report.byHuman.HIGH).toBe(1)
  })

  it('counts a CRITICAL the shadow lowered, and abstentions by confidence', async () => {
    const harness = await bootBoard()
    let answer: BoardClassifierResult = { status: 'classified', severity: 'LOW', confidence: 0.9 }
    harness.ctx.provide('faberloomBoardShadow', {
      modelVersion: 'shadow-model@1',
      async classifySeverity() { return answer },
    })
    const critical = await shadowItem(harness, 'Tarea crítica')
    await harness.board.setSeverity(ACTOR_A, critical, 'CRITICAL', 'HUMAN')

    answer = { status: 'classified', severity: 'MEDIUM', confidence: 0.1 }
    const doubtful = await shadowItem(harness, 'Tarea dudosa')
    await harness.board.setSeverity(ACTOR_A, doubtful, 'HIGH', 'HUMAN')

    const report = await harness.board.shadowReport(ACTOR_A)
    expect(report).toMatchObject({ evaluated: 2, mismatched: 1, abstained: 1, criticalLowered: 1 })
  })

  it('records an invalid answer and a timeout without touching the item', async () => {
    const harness = await bootBoard()
    let answer: BoardClassifierResult = { status: 'invalid', detail: 'bad json' }
    harness.ctx.provide('faberloomBoardShadow', {
      modelVersion: 'shadow-model@1',
      async classifySeverity() { return answer },
    })
    const first = await shadowItem(harness, 'Tarea inválida')
    await harness.board.setSeverity(ACTOR_A, first, 'LOW', 'HUMAN')
    answer = { status: 'timeout' }
    const second = await shadowItem(harness, 'Tarea lenta')
    await harness.board.setSeverity(ACTOR_A, second, 'LOW', 'HUMAN')

    expect(await harness.board.shadowReport(ACTOR_A)).toMatchObject({ invalid: 1, timeout: 1, matched: 0 })
    expect((await harness.board.get(ACTOR_A, first)).severity).toBe('LOW')
  })

  it('turns a throwing shadow port into an error, and filters by window', async () => {
    const harness = await bootBoard()
    harness.ctx.provide('faberloomBoardShadow', {
      modelVersion: 'shadow-model@1',
      async classifySeverity() { throw new Error('provider down') },
    })
    const id = await shadowItem(harness, 'Tarea caída')
    await harness.board.setSeverity(ACTOR_A, id, 'LOW', 'HUMAN')
    expect(await harness.board.shadowReport(ACTOR_A)).toMatchObject({ invalid: 1 })
    expect(await harness.board.shadowReport(ACTOR_A, { from: '2999-01-01T00:00:00.000Z' }))
      .toMatchObject({ evaluated: 0 })
  })

  it('does not send an N2 item to the shadow provider', async () => {
    const harness = await bootBoard()
    const fake = shadow(() => ({ status: 'classified', severity: 'LOW', confidence: 0.9 }))
    harness.ctx.provide('faberloomBoardShadow', fake.port)
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')
    const item = await harness.board.create(ACTOR_A, {
      title: 'Tarea N2', summary: 's', evidence: ['oc:1'], artifactType: 'tarea', spaceId: space,
    })
    await harness.board.setSeverity(ACTOR_A, item.id, 'LOW', 'HUMAN')
    expect(fake.calls).toHaveLength(0)
    expect(await harness.board.shadowReport(ACTOR_A)).toMatchObject({ evaluated: 0 })
  })

  it('never counts an artifact approval as a shadow label', async () => {
    const harness = await bootBoard()
    const fake = shadow(() => ({ status: 'classified', severity: 'HIGH', confidence: 0.95 }))
    harness.ctx.provide('faberloomBoardShadow', fake.port)
    const id = await shadowItem(harness, 'Tarea aprobada')
    await harness.board.setSeverity(ACTOR_A, id, 'HIGH', 'HUMAN')
    expect(await harness.board.shadowReport(ACTOR_A)).toMatchObject({ evaluated: 1 })
    const current = await harness.board.get(ACTOR_A, id)
    await harness.board.approve(ACTOR_A, id, {
      expectedRowVersion: current.rowVersion,
      expectedArtifactVersion: current.version,
      expectedArtifactHash: current.artifactHash ?? '',
    })
    // The approval is not a label: the evaluation count does not move.
    expect(await harness.board.shadowReport(ACTOR_A)).toMatchObject({ evaluated: 1, matched: 1 })
    expect(fake.calls).toHaveLength(1)
  })

  it('measures only a human confirmation, not a rule or a model proposal', async () => {
    const harness = await bootBoard()
    const fake = shadow(() => ({ status: 'classified', severity: 'LOW', confidence: 0.9 }))
    harness.ctx.provide('faberloomBoardShadow', fake.port)
    const id = await shadowItem(harness, 'Tarea regla')
    await harness.board.setSeverity(ACTOR_A, id, 'LOW', 'RULE')
    await harness.board.setSeverity(ACTOR_A, id, 'MEDIUM', 'LLM')
    expect(fake.calls).toHaveLength(0)
  })
})
