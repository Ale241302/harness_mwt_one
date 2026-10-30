import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomBoard, { businessKeyOf } from '../src/index.ts'
import {
  ACTOR_A,
  ACTOR_A2,
  ACTOR_B,
  COMPANY_A,
  OWNER_A,
  bootBoard,
  durableRows,
  seedSpace,
} from './helpers/harness.ts'

/** One prepared artifact the tenant suites submit. */
const ARTIFACT = { summary: 'borrador', evidence: ['oc:505288'], artifactType: 'proforma' } as const

const TERMINAL_STATES = ['APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO']

/** A media pool whose third write fails, so the item record never lands. */
class FailThirdWritePool extends MemoryMediaPool {
  private writes = 0

  override consumeInjectedFailure(): void {
    this.writes += 1
    if (this.writes === 3) throw new Error('injected item write failure')
  }
}

describe('FaberLoomBoard tenant integrity of referenced objects (W-24)', () => {
  it('refuses a space of another tenant and accepts one of the actor tenant', async () => {
    const harness = await bootBoard()
    const foreign = await seedSpace(harness, ACTOR_B, 'Ajeno')

    await expect(harness.board.submit(ACTOR_A, {
      runId: 'run-space', idempotencyKey: 'idem-space', businessKey: 'k-space', ...ARTIFACT, spaceId: foreign,
    })).rejects.toThrow('CROSS_TENANT_REFERENCE')

    const own = await seedSpace(harness, ACTOR_A, 'Propio')
    const item = await harness.board.submit(ACTOR_A, {
      runId: 'run-space', idempotencyKey: 'idem-space', businessKey: 'k-space', ...ARTIFACT, spaceId: own,
    })
    expect(item.spaceId).toBe(own)
  })

  it('refuses a space nobody can verify when the Spaces service is not mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    await ctx.plugin(FaberLoomBoard)

    await expect(ctx.faberloomBoard.create({ id: OWNER_A, companyId: COMPANY_A }, {
      title: 'x', summary: 's', evidence: ['e'], spaceId: 'sp-nowhere',
    })).rejects.toThrow('CROSS_TENANT_REFERENCE')
  })

  it('refuses a run, execution, or account another tenant already stored', async () => {
    const { board } = await bootBoard()
    await board.submit(ACTOR_B, {
      runId: 'run-b', idempotencyKey: 'idem-b', businessKey: 'k-b', ...ARTIFACT, executionId: 'exec-b', accountRef: 'Eguisa',
    })

    await expect(board.submit(ACTOR_A, {
      runId: 'run-b', idempotencyKey: 'idem-a1', businessKey: 'k-a1', ...ARTIFACT,
    })).rejects.toThrow('CROSS_TENANT_REFERENCE')
    await expect(board.submit(ACTOR_A, {
      runId: 'run-a', idempotencyKey: 'idem-a2', businessKey: 'k-a2', ...ARTIFACT, executionId: 'exec-b',
    })).rejects.toThrow('CROSS_TENANT_REFERENCE')
    await expect(board.submit(ACTOR_A, {
      runId: 'run-a', idempotencyKey: 'idem-a3', businessKey: 'k-a3', ...ARTIFACT, accountRef: 'Eguisa',
    })).rejects.toThrow('CROSS_TENANT_REFERENCE')

    const own = await board.submit(ACTOR_A, {
      runId: 'run-a', idempotencyKey: 'idem-a4', businessKey: 'k-a4', ...ARTIFACT, accountRef: 'Sonepar',
    })
    expect(own.accountRef).toBe('Sonepar')
  })

  it('refuses a cross-tenant execution and account through create', async () => {
    const { board } = await bootBoard()
    await board.submit(ACTOR_B, {
      runId: 'run-c', idempotencyKey: 'idem-c', businessKey: 'k-c', ...ARTIFACT, executionId: 'exec-c', accountRef: 'Ajeno',
    })

    await expect(board.create({ id: OWNER_A, companyId: COMPANY_A }, {
      title: 'x', summary: 's', evidence: ['e'], executionId: 'exec-c',
    })).rejects.toThrow('CROSS_TENANT_REFERENCE')
    await expect(board.create({ id: OWNER_A, companyId: COMPANY_A }, {
      title: 'x', summary: 's', evidence: ['e'], accountRef: 'Ajeno',
    })).rejects.toThrow('CROSS_TENANT_REFERENCE')
  })
})

describe('FaberLoomBoard key uniqueness (W-39)', () => {
  it('claims the business key before the item record is written', async () => {
    const harness = await bootBoard()
    const order: string[] = []
    harness.ctx.on('domain/changed', (change) => {
      if (change.domain === 'faberloom_board') order.push(change.table)
    })

    await harness.board.submit(ACTOR_A, {
      runId: 'run-order', idempotencyKey: 'idem-order', businessKey: 'k-order', ...ARTIFACT,
    })

    expect(order.slice(0, 3)).toEqual(['keys', 'keys', 'items'])
  })

  it('releases both claims when the item record cannot be written', async () => {
    const pool = new FailThirdWritePool()
    const { board } = await bootBoard({ pool })

    await expect(board.submit(ACTOR_A, {
      runId: 'run-fail', idempotencyKey: 'idem-fail', businessKey: 'k-fail', ...ARTIFACT,
    })).rejects.toThrow('injected item write failure')

    expect(durableRows(pool, 'items').size).toBe(0)
    expect(durableRows(pool, 'keys').size).toBe(0)
    const retried = await board.submit(ACTOR_A, {
      runId: 'run-fail', idempotencyKey: 'idem-fail', businessKey: 'k-fail', ...ARTIFACT,
    })
    expect(retried).toMatchObject({ sourceRef: 'k-fail' })
    expect(retried.businessKey).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('keeps one non-terminal item per tenant when two submits race on the same key', async () => {
    const harness = await bootBoard()
    const results = await Promise.allSettled([
      harness.board.submit(ACTOR_A, {
        runId: 'run-r1', idempotencyKey: 'idem-r1', businessKey: 'k-race', ...ARTIFACT,
      }),
      harness.board.submit(ACTOR_A, {
        runId: 'run-r2', idempotencyKey: 'idem-r2', businessKey: 'k-race', ...ARTIFACT,
      }),
    ])

    expect(results.every(result => result.status === 'fulfilled')).toBe(true)
    const live = (await harness.board.list(ACTOR_A)).filter(item => !TERMINAL_STATES.includes(item.state))
    expect(live).toHaveLength(1)
    const derived = businessKeyOf({
      companyId: COMPANY_A, spaceId: null, accountRef: null, sourceRef: 'k-race', artifactType: 'proforma',
    })
    const claim = [...durableRows(harness.pool, 'keys').entries()].find(([key]) => key.endsWith(`:bkey:${derived}`))
    expect(claim?.[1]).toMatchObject({ itemId: String(live[0]?.id) })
  })

  it('refuses a live key held by another owner of the same tenant', async () => {
    const harness = await bootBoard()
    const first = await harness.board.submit(ACTOR_A, {
      runId: 'run-own1', idempotencyKey: 'idem-own1', businessKey: 'k-owned', ...ARTIFACT,
    })

    await expect(harness.board.submit(ACTOR_A2, {
      runId: 'run-own2', idempotencyKey: 'idem-own2', businessKey: 'k-owned', ...ARTIFACT,
    })).rejects.toThrow('DUPLICATE')

    const live = (await harness.board.list(ACTOR_A)).filter(item => !TERMINAL_STATES.includes(item.state))
    expect(live.map(item => item.id)).toEqual([first.id])
  })
})
