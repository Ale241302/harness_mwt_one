import { describe, expect, it } from 'vitest'
import { MemoryMediaPool } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  ACTOR_A,
  COMPANY_A,
  bootBoard,
  rawBoardItem,
  seedRawItem,
} from './helpers/harness.ts'

/** One item of a type and account, created manually and keyless. */
async function task(harness: Awaited<ReturnType<typeof bootBoard>>, accountRef: string) {
  return await harness.board.create(ACTOR_A, {
    title: `Tarea ${accountRef}`,
    summary: `Tarea para ${accountRef}`,
    evidence: [`oc:${accountRef}`],
    artifactType: 'tarea',
    accountRef,
  })
}

describe('severity learning (human correction)', () => {  it('applies the severity a human chose to the next item of the same type and account', async () => {
  const harness = await bootBoard()
  const first = await task(harness, 'Eguisa')
  expect(first.severity).toBe('LOW')
  await harness.board.setSeverity(ACTOR_A, first.id, 'HIGH', 'HUMAN')

  const next = await task(harness, 'Eguisa')
  expect(next).toMatchObject({ severity: 'HIGH', severitySource: 'HUMAN' })

  // Another account keeps the shipped rule.
  const other = await task(harness, 'Sonepar')
  expect(other).toMatchObject({ severity: 'LOW', severitySource: 'RULE' })
})

it('does not learn from a rule or a model proposal', async () => {
  const harness = await bootBoard()
  const first = await task(harness, 'Eguisa')
  await harness.board.setSeverity(ACTOR_A, first.id, 'CRITICAL', 'LLM')
  const next = await task(harness, 'Eguisa')
  expect(next).toMatchObject({ severity: 'LOW', severitySource: 'RULE' })
})
})

describe('classify pending items', () => {
  it('asks the classifier for every item without severity and drains the batch', async () => {
    const pool = new MemoryMediaPool()
    const a = await seedRawItem(pool, rawBoardItem({ artifactType: 'tarea', accountRef: 'A', severity: null }), 'item-a')
    const b = await seedRawItem(pool, rawBoardItem({ artifactType: 'tarea', accountRef: 'B', severity: null }), 'item-b')
    const harness = await bootBoard({ pool })
    harness.ctx.provide('faberloomBoardClassifier', {
      modelVersion: 'test-model-1',
      async classifySeverity() {
        return { status: 'classified', severity: 'HIGH', confidence: 0.95 }
      },
    })

    const first = await harness.board.classifyUnclassified(ACTOR_A, { limit: 10 })
    expect(first).toEqual({ classified: 2, failed: 0, remaining: 0 })
    expect(await harness.board.get(ACTOR_A, a)).toMatchObject({
      severity: 'HIGH',
      severitySource: 'LLM',
      severityConfidence: 0.95,
    })
    expect(await harness.board.get(ACTOR_A, b)).toMatchObject({ severity: 'HIGH' })
    expect(await harness.board.classifyUnclassified(ACTOR_A, { limit: 10 }))
      .toEqual({ classified: 0, failed: 0, remaining: 0 })
  })

  it('falls back to the deterministic rule when the provider fails', async () => {
    const pool = new MemoryMediaPool()
    const id = await seedRawItem(pool, rawBoardItem({ artifactType: 'tarea', severity: null }), 'item-rule')
    const harness = await bootBoard({ pool })
    harness.ctx.provide('faberloomBoardClassifier', {
      modelVersion: 'test-model-1',
      async classifySeverity() { throw new Error('provider down') },
    })
    expect(await harness.board.classifyUnclassified(ACTOR_A)).toEqual({ classified: 1, failed: 0, remaining: 0 })
    expect(await harness.board.get(ACTOR_A, id)).toMatchObject({ severity: 'LOW', severitySource: 'RULE' })
  })

  it('classifies another identity of the same board as its owner', async () => {
    const pool = new MemoryMediaPool()
    const id = await seedRawItem(pool, rawBoardItem({
      ownerId: 'test.muitowork@muitowork.com', artifactType: 'tarea', severity: null,
    }), 'item-other-owner')
    const harness = await bootBoard({ pool })
    expect(await harness.board.classifyUnclassified(ACTOR_A)).toEqual({ classified: 1, failed: 0, remaining: 0 })
    expect((await harness.board.get({ id: 'test.muitowork@muitowork.com', companyId: COMPANY_A }, id)).severity).toBe('LOW')
  })

  it('counts an item it cannot classify and leaves it pending', async () => {
    const pool = new MemoryMediaPool()
    const id = await seedRawItem(pool, rawBoardItem({ artifactType: 'desconocido', severity: null }), 'item-null')
    const harness = await bootBoard({ pool })
    const result = await harness.board.classifyUnclassified(ACTOR_A)
    expect(result).toMatchObject({ classified: 0, failed: 1, remaining: 1 })
    expect((await harness.board.get(ACTOR_A, id)).severity).toBeNull()
  })

  it('records the question the classifier could not answer', async () => {
    const pool = new MemoryMediaPool()
    const id = await seedRawItem(pool, rawBoardItem({ artifactType: 'tarea', severity: null }), 'item-doubt')
    const harness = await bootBoard({ pool })
    harness.ctx.provide('faberloomBoardClassifier', {
      modelVersion: 'test-model-1',
      async classifySeverity() {
        return { status: 'invalid', detail: 'no answer' }
      },
    })
    await harness.board.classifyUnclassified(ACTOR_A)
    const item = await harness.board.get(ACTOR_A, id)
    expect(item.severity).toBe('LOW')
    expect(item.doubts).toEqual(['El agente no pudo justificar la prioridad; salió de las reglas.'])
    // A human decision answers the question.
    await harness.board.setSeverity(ACTOR_A, id, 'HIGH', 'HUMAN')
    expect((await harness.board.get(ACTOR_A, id)).doubts).toEqual([])
  })
})

describe('live classification sweep', () => {
  it('reapplies a human lesson to the items it already classified', async () => {
    const harness = await bootBoard()
    const first = await task(harness, 'Eguisa')
    const second = await task(harness, 'Eguisa')
    expect(second.severitySource).toBe('RULE')

    await harness.board.setSeverity(ACTOR_A, first.id, 'HIGH', 'HUMAN')
    const swept = await harness.board.sweepClassifications()
    expect(swept).toMatchObject({ reclassified: 1, remaining: 0 })
    expect(await harness.board.get(ACTOR_A, second.id)).toMatchObject({
      severity: 'HIGH',
      severitySource: 'HUMAN',
      doubts: [],
    })

    // A second sweep changes nothing: the lesson is already applied.
    expect(await harness.board.sweepClassifications()).toMatchObject({ reclassified: 0 })
  })

  it('assigns the catalog agent responsible for an item', async () => {
    const harness = await bootBoard()
    const item = await task(harness, 'Eguisa')
    const assigned = await harness.board.assignAgent(ACTOR_A, item.id, 'agent-operaciones')
    expect(assigned.assigneeId).toBe('agent-operaciones')
    const cleared = await harness.board.assignAgent(ACTOR_A, item.id, null)
    expect(cleared.assigneeId).toBeNull()
  })
})
