import { describe, expect, it } from 'vitest'
import { MemoryMediaPool } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  ACTOR_A,
  ACTOR_A2,
  ACTOR_B,
  bootBoard,
  durableRows,
  rawBoardItem,
  seedRawItem,
  seedSpace,
} from './helpers/harness.ts'
import type { FaberLoomBoardItem } from '../src/index.ts'

/** One prepared artifact the candidate suites submit. */
const ARTIFACT = { summary: 'borrador', evidence: ['oc:505288'], artifactType: 'proforma' } as const

const TERMINAL_STATES = ['APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO']

/** Submit one prepared artifact under one business key. */
async function submitArtifact(
  board: Awaited<ReturnType<typeof bootBoard>>['board'],
  idempotencyKey: string,
  businessKey: string,
  accountRef = 'Eguisa',
): Promise<FaberLoomBoardItem> {
  return await board.submit(ACTOR_A, {
    runId: 'run-1',
    idempotencyKey,
    businessKey,
    ...ARTIFACT,
    accountRef,
  })
}

describe('FaberLoomBoard assignWorkspace (W-45, W-59, W-87, W-88)', () => {
  it('refuses a destination space outside the actor scope', async () => {
    const harness = await bootBoard()
    const foreign = await seedSpace(harness, ACTOR_B, 'Ajeno')
    const item = await submitArtifact(harness.board, 'idem-scope', 'k-scope')

    await expect(harness.board.assignWorkspace(ACTOR_A, item.id, foreign)).rejects.toThrow('NO_ACCESS')
    expect((await harness.board.get(ACTOR_A, item.id)).spaceId).toBeNull()
  })

  it('refuses an account the destination space does not serve', async () => {
    const harness = await bootBoard()
    const eguisa = await seedSpace(harness, ACTOR_A, 'Eguisa', ['Eguisa'])
    const item = await submitArtifact(harness.board, 'idem-acc', 'k-acc', 'Sonepar')

    await expect(harness.board.assignWorkspace(ACTOR_A, item.id, eguisa)).rejects.toThrow('ACCOUNT_MISMATCH')
    expect((await harness.board.get(ACTOR_A, item.id)).spaceId).toBeNull()
  })

  it('keeps the business key, supersedes a substitutable peer, and returns the live item', async () => {
    const pool = new MemoryMediaPool()
    const first = await seedRawItem(pool, rawBoardItem({ businessKey: 'k-shared', title: 'A' }))
    const second = await seedRawItem(pool, rawBoardItem({ businessKey: 'k-shared', title: 'B' }))
    const harness = await bootBoard({ pool })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')

    const assigned = await harness.board.assignWorkspace(ACTOR_A, first, space)

    expect(assigned.id).toBe(first)
    expect(assigned.spaceId).toBe(space)
    expect(assigned.businessKey).toBe('k-shared')
    expect(assigned.supersedesItemId).toBe(String(second))
    expect((await harness.board.get(ACTOR_A, second)).state).toBe('SUSTITUIDO')
  })

  it('transfers the artifact as a candidate to a non-substitutable peer and opens that peer', async () => {
    const pool = new MemoryMediaPool()
    const source = await seedRawItem(pool, rawBoardItem({ businessKey: 'k-iter', title: 'A' }))
    const iterating = await seedRawItem(pool, rawBoardItem({ businessKey: 'k-iter', title: 'B', state: 'ITERANDO' }))
    const harness = await bootBoard({ pool })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')

    const live = await harness.board.assignWorkspace(ACTOR_A, source, space)

    expect(live.id).toBe(iterating)
    expect(live.state).toBe('ITERANDO')
    expect(live.pendingCandidate).toMatchObject({ summary: 'borrador', evidence: ['oc:505288'] })
    const closed = await harness.board.get(ACTOR_A, source)
    expect(closed.state).toBe('SUSTITUIDO')
    expect(closed.events.at(-1)).toMatchObject({ command: 'superseded', reason: 'transferred-as-candidate' })
  })

  it('leaves one non-terminal item and one key claim when two assignments race', async () => {
    const pool = new MemoryMediaPool()
    const left = await seedRawItem(pool, rawBoardItem({ businessKey: 'k-race-ws', title: 'A' }))
    const right = await seedRawItem(pool, rawBoardItem({ businessKey: 'k-race-ws', title: 'B' }))
    const harness = await bootBoard({ pool })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')

    await Promise.allSettled([
      harness.board.assignWorkspace(ACTOR_A, left, space),
      harness.board.assignWorkspace(ACTOR_A, right, space),
    ])

    const live = (await harness.board.list(ACTOR_A)).filter(item => !TERMINAL_STATES.includes(item.state))
    expect(live).toHaveLength(1)
    const claims = [...durableRows(pool, 'keys').entries()].filter(([key]) => key.endsWith(':bkey:k-race-ws'))
    expect(claims).toHaveLength(1)
    expect(claims[0]?.[1]).toMatchObject({ itemId: String(live[0]?.id) })
    expect(live[0]?.spaceId).toBe(space)
  })

  it('refuses to assign a closed item', async () => {
    const pool = new MemoryMediaPool()
    const closed = await seedRawItem(pool, rawBoardItem({ businessKey: 'k-closed', state: 'DESCARTADO' }))
    const harness = await bootBoard({ pool })
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')

    await expect(harness.board.assignWorkspace(ACTOR_A, closed, space)).rejects.toThrow('NO_ACCESS')
  })

  it('refuses an assignment from another owner or another tenant', async () => {
    const harness = await bootBoard()
    const item = await submitArtifact(harness.board, 'idem-own', 'k-own')
    const space = await seedSpace(harness, ACTOR_A, 'Proformas')

    await expect(harness.board.assignWorkspace(ACTOR_A2, item.id, space)).rejects.toThrow('NO_ACCESS')
    await expect(harness.board.assignWorkspace(ACTOR_B, item.id, space)).rejects.toThrow('NO_ACCESS')
    expect((await harness.board.get(ACTOR_A, item.id)).spaceId).toBeNull()
  })
})

describe('FaberLoomBoard DESCONOCIDO and candidates (W-22, W-42, W-66, W-76)', () => {
  it('stores a new artifact for an unknown result as a candidate instead of a new item', async () => {
    const harness = await bootBoard()
    const item = await submitArtifact(harness.board, 'idem-unknown', 'k-unknown')
    const unknown = await harness.board.fail(ACTOR_A, item.id, 'DESCONOCIDO')
    expect(unknown).toMatchObject({ state: 'DESCONOCIDO', column: 'ERROR_ACCIONABLE' })

    const candidate = await harness.board.submit(ACTOR_A, {
      runId: 'run-1', idempotencyKey: 'idem-unknown-2', businessKey: 'k-unknown', ...ARTIFACT,
    })

    expect(candidate.id).toBe(item.id)
    expect(candidate.state).toBe('DESCONOCIDO')
    expect(candidate.pendingCandidate).not.toBeNull()
    expect(await harness.board.list(ACTOR_A)).toHaveLength(1)
  })

  it('refuses discard of an unknown result and leaves it in DESCONOCIDO', async () => {
    const harness = await bootBoard()
    const item = await submitArtifact(harness.board, 'idem-u2', 'k-u2')
    const unknown = await harness.board.fail(ACTOR_A, item.id, 'DESCONOCIDO')

    await expect(harness.board.discard(ACTOR_A, item.id, {
      expectedRowVersion: unknown.rowVersion, reason: 'DUPLICADO',
    })).rejects.toThrow('NO_ACCESS')
    await expect(harness.board.submitRevision(ACTOR_A, item.id, {
      summary: 'corregido', evidence: ['oc:2'],
    })).rejects.toThrow('NO_ACCESS')
    expect((await harness.board.get(ACTOR_A, item.id)).state).toBe('DESCONOCIDO')
  })

  it('refuses approval and discard while a candidate is pending', async () => {
    const harness = await bootBoard()
    const item = await submitArtifact(harness.board, 'idem-pend', 'k-pend')
    await harness.board.fail(ACTOR_A, item.id, 'DESCONOCIDO')
    await harness.board.submit(ACTOR_A, {
      runId: 'run-1', idempotencyKey: 'idem-pend-2', businessKey: 'k-pend', ...ARTIFACT,
    })
    const waiting = await harness.board.reopen(ACTOR_A, item.id)
    const withSeverity = await harness.board.setSeverity(ACTOR_A, item.id, 'HIGH', 'HUMAN')

    await expect(harness.board.approve(ACTOR_A, item.id, {
      expectedRowVersion: withSeverity.rowVersion,
      expectedArtifactVersion: waiting.version,
      expectedArtifactHash: withSeverity.artifactHash ?? '',
    })).rejects.toThrow('CANDIDATE_PENDING')
    await expect(harness.board.discard(ACTOR_A, item.id, {
      expectedRowVersion: withSeverity.rowVersion, reason: 'DUPLICADO',
    })).rejects.toThrow('CANDIDATE_PENDING')
  })

  it('rejects a choice over a candidate that is no longer the last one', async () => {
    const harness = await bootBoard()
    const item = await submitArtifact(harness.board, 'idem-stale', 'k-stale')
    await harness.board.fail(ACTOR_A, item.id, 'DESCONOCIDO')
    const first = await harness.board.submit(ACTOR_A, {
      runId: 'run-1', idempotencyKey: 'idem-stale-2', businessKey: 'k-stale', ...ARTIFACT,
    })
    const shown = first.pendingCandidate
    expect(shown).not.toBeNull()

    const second = await harness.board.submit(ACTOR_A, {
      runId: 'run-1', idempotencyKey: 'idem-stale-3', businessKey: 'k-stale', summary: 'segundo', evidence: ['oc:2'],
    })
    expect(second.pendingCandidate?.id).not.toBe(shown?.id)

    await expect(harness.board.resolveCandidate(ACTOR_A, item.id, shown?.id ?? '', shown?.hash ?? '', 'adopt'))
      .rejects.toThrow('CANDIDATE_STALE')
    const adopted = await harness.board.resolveCandidate(
      ACTOR_A, item.id, second.pendingCandidate?.id ?? '', second.pendingCandidate?.hash ?? '', 'adopt',
    )
    expect(adopted).toMatchObject({ pendingCandidate: null, version: 2 })
  })
})
