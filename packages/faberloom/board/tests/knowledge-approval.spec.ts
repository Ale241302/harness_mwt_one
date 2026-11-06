import { describe, expect, it } from 'vitest'
import { MemoryMediaPool } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  APPROVAL_UNVERIFIED,
  approvalEvidence,
  approvalIsVerified,
  verifiedApproval,
} from '../src/knowledge-approval.ts'
import { ACTOR_A, COMPANY_A, bootBoard, rawBoardItem, seedRawItem } from './helpers/harness.ts'
import type { FaberLoomBoardItemId } from '../src/types.ts'

const AT = '2026-11-05T10:00:00.000Z'

/** Create one LOW task and return the row a reviewer would see. */
async function approvable(): Promise<{
  board: Awaited<ReturnType<typeof bootBoard>>['board']
  id: FaberLoomBoardItemId
  rowVersion: number
  version: number
  artifactHash: string
}> {
  const harness = await bootBoard()
  const item = await harness.board.create(ACTOR_A, {
    title: 'Tarea aprobable', summary: 's', evidence: ['oc:1'], artifactType: 'tarea',
  })
  await harness.board.setSeverity(ACTOR_A, item.id, 'LOW', 'HUMAN')
  const current = await harness.board.get(ACTOR_A, item.id)
  return {
    board: harness.board,
    id: item.id,
    rowVersion: current.rowVersion,
    version: current.version,
    artifactHash: current.artifactHash ?? '',
  }
}

describe('knowledge approval evidence (PROP-09)', () => {
  it('binds the evidence to the artifact version and hash the person saw', () => {
    const approved = rawBoardItem({
      state: 'APROBADO',
      status: 'approved',
      approvedRevision: 1,
      approvalEvidence: approvalEvidence(ACTOR_A.id, 1, 'hash-heredado', AT),
    })
    expect(approvalIsVerified(approved)).toBe(true)
    expect(verifiedApproval(approved).state).toBe('APROBADO')
    // A different revision or hash is not the same decision.
    expect(approvalIsVerified({ ...approved, version: 2 })).toBe(false)
    expect(approvalIsVerified({ ...approved, artifactHash: 'otro' })).toBe(false)
  })

  it('demotes an approval with no evidence, with a foreign source, or with an unusable instant', () => {
    const base = rawBoardItem({ state: 'APROBADO', status: 'approved', approvedRevision: 1 })

    const demoted = verifiedApproval(base)
    expect(demoted.state).toBe('PENDIENTE_CRITERIO')
    expect(demoted.status).toBe('waiting_approval')
    expect(demoted.approvedRevision).toBeNull()
    expect(demoted.stale).toBe(true)
    expect(demoted.staleReason).toBe(APPROVAL_UNVERIFIED)

    expect(approvalIsVerified({
      ...base,
      approvalEvidence: { ...approvalEvidence(ACTOR_A.id, 1, 'hash-heredado', AT), source: 'agent' as 'human-session' },
    })).toBe(false)
    expect(approvalIsVerified({
      ...base,
      approvalEvidence: approvalEvidence(ACTOR_A.id, 1, 'hash-heredado', 'not-a-date'),
    })).toBe(false)
    expect(approvalIsVerified({
      ...base,
      approvalEvidence: approvalEvidence('  ', 1, 'hash-heredado', AT),
    })).toBe(false)
  })

  it('keeps a committed human approval reading as approved', async () => {
    const item = await approvable()
    const approved = await item.board.approve(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion,
      expectedArtifactVersion: item.version,
      expectedArtifactHash: item.artifactHash,
    })
    expect(approved.state).toBe('APROBADO')
    const reread = await item.board.get(ACTOR_A, item.id)
    expect(reread.state).toBe('APROBADO')
    expect(reread.stale).toBe(false)
  })

  it('reads a replicated approval row as pending and lets a local person approve it again', async () => {
    const pool = new MemoryMediaPool()
    const replicated = rawBoardItem({
      state: 'APROBADO',
      status: 'approved',
      approvedRevision: 1,
      approvalEvidence: null,
      stale: false,
    })
    const id = await seedRawItem(pool, replicated)
    const harness = await bootBoard({ pool })

    const read = await harness.board.get(ACTOR_A, id)
    expect(read.state).toBe('PENDIENTE_CRITERIO')
    expect(read.staleReason).toBe(APPROVAL_UNVERIFIED)
    expect((await harness.board.list(ACTOR_A, { state: 'APROBADO' })).map(item => item.id)).not.toContain(id)

    // The person revalidates the replica and approves the current bytes; the
    // copied verdict never carries over.
    const revalidated = await harness.board.revalidate(ACTOR_A, id, true)
    const approved = await harness.board.approve(ACTOR_A, id, {
      expectedRowVersion: revalidated.rowVersion,
      expectedArtifactVersion: revalidated.version,
      expectedArtifactHash: revalidated.artifactHash ?? '',
    })
    expect(approved.state).toBe('APROBADO')
    expect((await harness.board.get(ACTOR_A, id)).state).toBe('APROBADO')
  })

  it('refuses an approval from an agent even when it owns the item', async () => {
    const item = await approvable()
    const agent = { id: ACTOR_A.id, companyId: COMPANY_A }
    await expect(item.board.approve(agent, item.id, {
      expectedRowVersion: item.rowVersion,
      expectedArtifactVersion: item.version,
      expectedArtifactHash: item.artifactHash,
    })).rejects.toThrow('HUMAN_ACTION_REQUIRED')
    expect((await item.board.get(ACTOR_A, item.id)).state).toBe('PENDIENTE_CRITERIO')
  })

  it('demotes a legacy approved row that carries no state field', async () => {
    const pool = new MemoryMediaPool()
    const legacy = rawBoardItem({
      state: null,
      status: 'approved',
      approvedRevision: 1,
      approvalEvidence: null,
    })
    const id = await seedRawItem(pool, legacy)
    const harness = await bootBoard({ pool })
    const read = await harness.board.get(ACTOR_A, id)
    expect(read.state).toBe('PENDIENTE_CRITERIO')
    expect(read.staleReason).toBe(APPROVAL_UNVERIFIED)
  })

  it('shows the control is what rejects the copied approval (HAR-05)', async () => {
    const pool = new MemoryMediaPool()
    const evidence = approvalEvidence(ACTOR_A.id, 1, 'hash-heredado', AT)
    const withEvidence = rawBoardItem({
      state: 'APROBADO', status: 'approved', approvedRevision: 1, approvalEvidence: evidence,
    })
    const withoutEvidence = rawBoardItem({
      state: 'APROBADO', status: 'approved', approvedRevision: 1, approvalEvidence: null,
    })
    const approvedId = await seedRawItem(pool, withEvidence)
    const copiedId = await seedRawItem(pool, withoutEvidence)
    const harness = await bootBoard({ pool })

    expect((await harness.board.get(ACTOR_A, approvedId)).state).toBe('APROBADO')
    expect((await harness.board.get(ACTOR_A, copiedId)).state).toBe('PENDIENTE_CRITERIO')
  })
})
