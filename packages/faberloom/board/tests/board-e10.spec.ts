import { describe, expect, it } from 'vitest'
import { ACTOR_A, COMPANY_A, OWNER_A, bootBoard } from './helpers/harness.ts'

/** Submit one run-created item and return the current row. */
async function submitOne(board: Awaited<ReturnType<typeof bootBoard>>['board'], overrides: Record<string, string> = {}) {
  return await board.submit(ACTOR_A, {
    runId: overrides['runId'] ?? 'run-1',
    idempotencyKey: overrides['idempotencyKey'] ?? 'idem-1',
    businessKey: overrides['businessKey'] ?? 'bkey-1',
    title: 'Proforma Eguisa',
    summary: 'borrador',
    evidence: ['oc:505288'],
    artifactType: 'proforma',
    accountRef: 'eguisa',
  })
}

describe('FaberLoomBoard E10 commands', () => {
  it('rejects an item without a run, and dedupes by idempotency key', async () => {
    const { board } = await bootBoard()
    await expect(board.submit(ACTOR_A, {
      runId: '', idempotencyKey: 'i', businessKey: 'b', summary: 's', evidence: ['e'],
    })).rejects.toThrow('NO_RUN')

    const first = await submitOne(board)
    const second = await submitOne(board)
    expect(second.id).toBe(first.id)
    expect(second.events).toHaveLength(1)
  })

  it('supersedes the existing non-terminal item with the same business key', async () => {
    const { board } = await bootBoard()
    const first = await submitOne(board)
    const second = await submitOne(board, { idempotencyKey: 'idem-2' })
    expect(second.id).not.toBe(first.id)
    expect(second.supersedesItemId).toBe(first.id)
    expect((await board.get(ACTOR_A, first.id)).state).toBe('SUSTITUIDO')
  })

  it('records severity provenance and an audit event', async () => {
    const { board } = await bootBoard()
    const item = await submitOne(board)
    const updated = await board.setSeverity(ACTOR_A, item.id, 'HIGH', 'LLM', 0.91, item.rowVersion)
    expect(updated).toMatchObject({ severity: 'HIGH', severitySource: 'LLM', severityConfidence: 0.91, rowVersion: 2 })
    expect(updated.events.at(-1)).toMatchObject({
      command: 'set_severity', fromState: 'PENDIENTE_CRITERIO', toState: 'PENDIENTE_CRITERIO',
      data: { previous: null, source: 'LLM', confidence: 0.91 },
    })
  })

  it('refuses approval without severity, with a stale row, or with a stale hash', async () => {
    const { board } = await bootBoard()
    const item = await submitOne(board)
    await expect(board.approve(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion, expectedArtifactVersion: 1, expectedArtifactHash: item.artifactHash ?? '',
    })).rejects.toThrow('SEVERITY_REQUIRED')

    const withSeverity = await board.setSeverity(ACTOR_A, item.id, 'MEDIUM', 'HUMAN')
    await expect(board.approve(ACTOR_A, item.id, {
      expectedRowVersion: 1, expectedArtifactVersion: 1, expectedArtifactHash: withSeverity.artifactHash ?? '',
    })).rejects.toThrow('STALE_ROW')
    await expect(board.approve(ACTOR_A, item.id, {
      expectedRowVersion: withSeverity.rowVersion, expectedArtifactVersion: 1, expectedArtifactHash: 'nope',
    })).rejects.toThrow('STALE_REVISION')
  })

  it('saves edits as a new version and rejects an old base version', async () => {
    const { board } = await bootBoard()
    const item = await submitOne(board)
    const edited = await board.saveEdits(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion, baseVersion: 1, changes: { summary: 'corregido' },
    })
    expect(edited.version).toBe(2)
    expect(edited.artifactHash).not.toBe(item.artifactHash)
    await expect(board.saveEdits(ACTOR_A, item.id, {
      expectedRowVersion: edited.rowVersion, baseVersion: 1, changes: { summary: 'otra' },
    })).rejects.toThrow('STALE_REVISION')
  })

  it('approves with edits atomically', async () => {
    const { board } = await bootBoard()
    const item = await submitOne(board)
    const withSeverity = await board.setSeverity(ACTOR_A, item.id, 'MEDIUM', 'HUMAN')
    const approved = await board.approveWithEdits(ACTOR_A, item.id, {
      expectedRowVersion: withSeverity.rowVersion,
      expectedArtifactVersion: 1,
      expectedArtifactHash: withSeverity.artifactHash ?? '',
      baseVersion: 1,
      changes: { summary: 'lista para enviar' },
    })
    expect(approved).toMatchObject({ state: 'APROBADO', version: 2, approvedRevision: 2 })
    expect(approved.events.at(-1)?.command).toBe('approve_with_edits')
  })

  it('enforces the closed discard list and the OTRA note', async () => {
    const { board } = await bootBoard()
    const item = await submitOne(board)
    const withSeverity = await board.setSeverity(ACTOR_A, item.id, 'MEDIUM', 'HUMAN')
    await expect(board.discard(ACTOR_A, item.id, {
      expectedRowVersion: withSeverity.rowVersion, reason: 'INVENTADA',
    })).rejects.toThrow('REASON_INVALID')
    await expect(board.discard(ACTOR_A, item.id, {
      expectedRowVersion: withSeverity.rowVersion, reason: 'OTRA',
    })).rejects.toThrow('REASON_REQUIRED')
    const discarded = await board.discard(ACTOR_A, item.id, {
      expectedRowVersion: withSeverity.rowVersion, reason: 'DUPLICADO',
    })
    expect(discarded).toMatchObject({ state: 'DESCARTADO', discardReason: 'DUPLICADO' })
    expect(discarded.events.at(-1)?.reason).toBe('DUPLICADO')
  })

  it('keeps the concrete artifact identity on submit', async () => {
    const { board } = await bootBoard()
    const item = await board.submit(ACTOR_A, {
      runId: 'run-pf',
      idempotencyKey: 'idem-pf',
      businessKey: 'PF 2520-2026',
      title: 'PF 2520-2026 · Eguisa',
      summary: 'Proforma DDP con precios verificados.',
      evidence: ['expediente:PF 2520-2026', 'oc:505288'],
      artifactType: 'proforma',
      accountRef: 'Eguisa',
      valueAmount: 17528.55,
      valueCurrency: 'USD',
      dueAt: '2026-10-28T17:00:00.000Z',
      severity: 'HIGH',
      severityConfidence: 0.93,
    })
    expect(item).toMatchObject({
      businessKey: 'PF 2520-2026',
      accountRef: 'Eguisa',
      artifactType: 'proforma',
      valueAmount: 17528.55,
      valueUsd: 17528.55,
      dueAt: '2026-10-28T17:00:00.000Z',
      severity: 'HIGH',
      severitySource: 'LLM',
      severityConfidence: 0.93,
    })
  })

  it('keeps one writer tab and rejects a stale draft revision', async () => {
    const { board } = await bootBoard()
    const item = await submitOne(board)
    const first = await board.saveEditDraft(ACTOR_A, item.id, {
      baseVersion: 1, revision: 0, writerSession: 'tab-a', changes: { summary: 'borrador' },
    })
    expect(first.revision).toBe(1)
    await expect(board.saveEditDraft(ACTOR_A, item.id, {
      baseVersion: 1, revision: 0, writerSession: 'tab-a', changes: { summary: 'viejo' },
    })).rejects.toThrow('STALE_DRAFT')
    await expect(board.saveEditDraft(ACTOR_A, item.id, {
      baseVersion: 1, revision: 1, writerSession: 'tab-b', changes: { summary: 'otra pestaña' },
    })).rejects.toThrow('WRITER_TAKEN')

    const taken = await board.takeEditDraft(ACTOR_A, item.id, 'tab-b')
    expect(taken.writerSession).toBe('tab-b')
    const second = await board.saveEditDraft(ACTOR_A, item.id, {
      baseVersion: 1, revision: taken.revision, writerSession: 'tab-b', changes: { summary: 'desde b' },
    })
    expect(second.writerSession).toBe('tab-b')
    expect((await board.getEditDraft(ACTOR_A, item.id))?.changes['summary']).toBe('desde b')
  })

  it('clears the draft when the edits are saved or approved', async () => {
    const { board } = await bootBoard()
    const item = await submitOne(board)
    await board.saveEditDraft(ACTOR_A, item.id, {
      baseVersion: 1, revision: 0, writerSession: 'tab-a', changes: { summary: 'borrador' },
    })
    await board.setSeverity(ACTOR_A, item.id, 'MEDIUM', 'HUMAN')
    const approved = await board.approve(ACTOR_A, item.id, {
      expectedRowVersion: (await board.get(ACTOR_A, item.id)).rowVersion,
      expectedArtifactVersion: 1,
      expectedArtifactHash: item.artifactHash ?? '',
    })
    expect(approved.state).toBe('APROBADO')
    expect(await board.getEditDraft(ACTOR_A, item.id)).toBeUndefined()
  })

  it('returns the audit history and keeps it append-only', async () => {
    const { board } = await bootBoard()
    const item = await submitOne(board)
    await board.setSeverity(ACTOR_A, item.id, 'LOW', 'HUMAN')
    const events = await board.events(ACTOR_A, item.id)
    expect(events.map(event => event.command)).toEqual(['submit', 'set_severity'])
    expect(events[0]?.actor).toBe(OWNER_A)
  })

  it('keeps the company on the item and derives the pending column', async () => {
    const { board } = await bootBoard()
    const item = await submitOne(board)
    expect(item.companyId).toBe(COMPANY_A)
    expect(item.state).toBe('PENDIENTE_CRITERIO')
    expect(item.column).toBe('TU_CRITERIO')
    expect(item.runId).toBe('run-1')
    expect(item.idempotencyKey).toBe('idem-1')
    expect(item.businessKey).toBe('bkey-1')
  })
})
