import { describe, expect, it } from 'vitest'
import { MemoryMediaPool } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { businessKeyOf, proposalItemId, proposalSourceRef } from '../src/keys.ts'
import { PROPOSAL_ARTIFACT_TYPE, PROPOSAL_LIMITS } from '../src/proposal.ts'
import {
  ACTOR_A,
  ACTOR_B,
  COMPANY_A,
  OWNER_A,
  bootBoard,
  rawBoardItem,
  seedRawItem,
} from './helpers/harness.ts'

/** One valid proposal; overrides change exactly the field under test. */
function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    archivo: 'knowledge/procedimiento.md',
    versionBase: 'rev-7',
    cambio: 'Añadir el paso de verificación antes de publicar.',
    motivo: 'La revisión humana detectó un hueco en el procedimiento.',
    evidencia: ['oc:505288', 'revision:7'],
    claveCliente: 'clave-propuesta-1',
    title: 'Verificar antes de publicar',
    ...overrides,
  }
}

describe('proposal reception (PROP-01 a PROP-06, PROP-08)', () => {
  it('returns the exact receipt of one pending item', async () => {
    const harness = await bootBoard()
    const receipt = await harness.board.submitProposal(ACTOR_A, proposal())

    expect(receipt.recibida).toBe(true)
    expect(typeof receipt.id).toBe('string')
    const item = await harness.board.get(ACTOR_A, receipt.id)
    expect(item).toMatchObject({
      id: receipt.id,
      artifactType: PROPOSAL_ARTIFACT_TYPE,
      state: 'PENDIENTE_CRITERIO',
      status: 'waiting_approval',
      approvedRevision: null,
      title: 'Verificar antes de publicar',
    })
    expect(item.sourceRef).toBe(proposalSourceRef({
      companyId: COMPANY_A,
      ownerId: OWNER_A,
      spaceId: null,
      claveCliente: 'CLAVE-PROPUESTA-1',
    }))
    expect(item.businessKey).toMatch(/^[0-9a-f]{64}$/u)
    // A proposal is work, not an effect: no reservation and no outbox message.
    expect(await harness.board.pendingEffects(ACTOR_A)).toEqual([])
  })

  it('keeps two proposals when two distinct client keys carry the same content (PROP-01)', async () => {
    const harness = await bootBoard()
    const first = await harness.board.submitProposal(ACTOR_A, proposal({ claveCliente: 'clave-1' }))
    const second = await harness.board.submitProposal(ACTOR_A, proposal({ claveCliente: 'clave-2' }))

    expect(first.id).not.toBe(second.id)
    const listed = await harness.board.list(ACTOR_A, { state: 'PENDIENTE_CRITERIO' })
    expect(listed.map(item => item.id)).toEqual(expect.arrayContaining([first.id, second.id]))
  })

  it('resolves an identical retry to the same item after a restart (PROP-02)', async () => {
    const pool = new MemoryMediaPool()
    const first = await bootBoard({ pool })
    const receipt = await first.board.submitProposal(ACTOR_A, proposal())

    // A second service over the same medium is the process that restarts after
    // the row was durable but before the first answer reached the caller.
    const restarted = await bootBoard({ pool })
    const retried = await restarted.board.submitProposal(ACTOR_A, proposal())
    expect(retried).toEqual(receipt)

    const listed = await restarted.board.list(ACTOR_A, { state: 'PENDIENTE_CRITERIO' })
    expect(listed).toHaveLength(1)
    expect(listed[0]?.rowVersion).toBe(1)
  })

  it('answers one receipt to concurrent identical calls and stores one row (PROP-02)', async () => {
    const harness = await bootBoard()
    const receipts = await Promise.all(Array.from({ length: 8 }, async () => await harness.board.submitProposal(ACTOR_A, proposal())))
    const ids = new Set(receipts.map(receipt => receipt.id))
    expect(ids.size).toBe(1)
    expect(await harness.board.list(ACTOR_A, { state: 'PENDIENTE_CRITERIO' })).toHaveLength(1)
  })

  it('refuses an unsafe path, a non-object, and an empty evidence list', async () => {
    const harness = await bootBoard()
    await expect(harness.board.submitProposal(ACTOR_A, null)).rejects.toThrow('PROPOSAL_FIELD_INVALID')
    await expect(harness.board.submitProposal(ACTOR_A, proposal({ evidencia: [] })))
      .rejects.toThrow('PROPOSAL_FIELD_REQUIRED')
    await expect(harness.board.submitProposal(ACTOR_A, proposal({ title: 42 })))
      .rejects.toThrow('PROPOSAL_FIELD_INVALID')
    await expect(harness.board.submitProposal(ACTOR_A, proposal({ title: '   ' })))
      .rejects.toThrow('PROPOSAL_FIELD_REQUIRED')
    await expect(harness.board.submitProposal(ACTOR_A, proposal({ claveCliente: '   ' })))
      .rejects.toThrow('PROPOSAL_FIELD_REQUIRED')
    for (const archivo of ['/etc/passwd', '../secreto.md', 'C:\\secreto.md', 'docs\\secreto.md']) {
      await expect(harness.board.submitProposal(ACTOR_A, proposal({ archivo })))
        .rejects.toThrow('PROPOSAL_FIELD_INVALID')
    }
    expect(() => proposalSourceRef({
      companyId: COMPANY_A, ownerId: OWNER_A, spaceId: null, claveCliente: '  ',
    })).toThrow('SOURCE_REQUIRED')
  })

  it('returns the same receipt after a human edit because the first revision is the proposal', async () => {
    const harness = await bootBoard()
    const receipt = await harness.board.submitProposal(ACTOR_A, proposal())
    const before = await harness.board.get(ACTOR_A, receipt.id)
    const edited = await harness.board.saveEdits(ACTOR_A, receipt.id, {
      expectedRowVersion: before.rowVersion,
      baseVersion: before.version,
      changes: { summary: 'Resumen editado por una persona' },
    })
    expect(edited.version).toBe(before.version + 1)

    expect(await harness.board.submitProposal(ACTOR_A, proposal())).toEqual(receipt)
    expect(await harness.board.list(ACTOR_A, { state: 'PENDIENTE_CRITERIO' })).toHaveLength(1)
  })

  it('keeps the receipt stable after a human approves the proposal', async () => {
    const harness = await bootBoard()
    const receipt = await harness.board.submitProposal(ACTOR_A, proposal())
    const current = await harness.board.get(ACTOR_A, receipt.id)
    await harness.board.approve(ACTOR_A, receipt.id, {
      expectedRowVersion: current.rowVersion,
      expectedArtifactVersion: current.version,
      expectedArtifactHash: current.artifactHash ?? '',
    })
    expect((await harness.board.get(ACTOR_A, receipt.id)).state).toBe('APROBADO')
    expect(await harness.board.submitProposal(ACTOR_A, proposal())).toEqual(receipt)
  })

  it('refuses a row at the deterministic id that belongs to another owner or is not a proposal', async () => {
    const identity = {
      companyId: COMPANY_A,
      ownerId: OWNER_A,
      spaceId: null,
      claveCliente: 'CLAVE-PROPUESTA-1',
    }
    const id = proposalItemId(identity)
    for (const record of [
      rawBoardItem({ ownerId: 'otro@sondelsa.com', companyId: COMPANY_A, artifactType: PROPOSAL_ARTIFACT_TYPE }),
      rawBoardItem({ ownerId: OWNER_A, companyId: COMPANY_A, artifactType: 'tarea' }),
      rawBoardItem({
        ownerId: OWNER_A,
        companyId: COMPANY_A,
        artifactType: PROPOSAL_ARTIFACT_TYPE,
        revisions: [{ version: 1, summary: 'sin contenido', evidence: [], content: null, documentRef: null, at: '2026-11-06T00:00:00.000Z' }],
      }),
    ]) {
      const pool = new MemoryMediaPool()
      await seedRawItem(pool, record, String(id))
      const harness = await bootBoard({ pool })
      await expect(harness.board.submitProposal(ACTOR_A, proposal())).rejects.toThrow('PROPOSAL_CONFLICT')
    }
  })

  it('refuses a different content on the same client key without touching the first proposal (PROP-03)', async () => {
    const harness = await bootBoard()
    const receipt = await harness.board.submitProposal(ACTOR_A, proposal())
    const before = await harness.board.get(ACTOR_A, receipt.id)

    await expect(harness.board.submitProposal(ACTOR_A, proposal({ cambio: 'Otro cambio distinto.' })))
      .rejects.toThrow('PROPOSAL_CONFLICT')

    const after = await harness.board.get(ACTOR_A, receipt.id)
    expect(after.rowVersion).toBe(before.rowVersion)
    expect(after.version).toBe(before.version)
    expect(after.title).toBe('Verificar antes de publicar')
    expect(JSON.stringify(after)).toContain('Añadir el paso de verificación')
  })

  it('keeps owners apart and rejects authority fields even on a direct call (PROP-04)', async () => {
    const harness = await bootBoard()
    const mine = await harness.board.submitProposal(ACTOR_A, proposal())
    const theirs = await harness.board.submitProposal(ACTOR_B, proposal())

    expect(mine.id).not.toBe(theirs.id)
    expect(await harness.board.list(ACTOR_A)).toHaveLength(1)
    expect(await harness.board.list(ACTOR_B)).toHaveLength(1)

    for (const field of ['ownerId', 'companyId', 'spaceId', 'state', 'status', 'approvedRevision', 'human']) {
      await expect(harness.board.submitProposal(ACTOR_A, proposal({ [field]: 'forged' })))
        .rejects.toThrow('PROPOSAL_AUTHORITY_FIELD')
    }
    await expect(harness.board.submitProposal(ACTOR_A, proposal({ sorpresa: 'x' })))
      .rejects.toThrow('PROPOSAL_FIELD_UNKNOWN')
  })

  it('does not modify a scheduled item that already holds the business key (PROP-05)', async () => {
    const pool = new MemoryMediaPool()
    const identity = {
      companyId: COMPANY_A,
      ownerId: OWNER_A,
      spaceId: null,
      claveCliente: 'CLAVE-PROPUESTA-1',
    }
    const sourceRef = proposalSourceRef(identity)
    const businessKey = businessKeyOf({
      companyId: COMPANY_A,
      spaceId: null,
      accountRef: null,
      sourceRef,
      artifactType: PROPOSAL_ARTIFACT_TYPE,
    })
    const scheduledId = await seedRawItem(pool, rawBoardItem({
      state: 'EJECUCION_PENDIENTE',
      status: 'in_progress',
      artifactType: PROPOSAL_ARTIFACT_TYPE,
      sourceRef,
      businessKey,
      effectKey: 'scheduled-key',
      title: 'Propuesta ya programada',
    }))
    const harness = await bootBoard({ pool })

    await expect(harness.board.submitProposal(ACTOR_A, proposal())).rejects.toThrow('PROPOSAL_CONFLICT')
    const scheduled = await harness.board.get(ACTOR_A, scheduledId)
    expect(scheduled).toMatchObject({
      state: 'EJECUCION_PENDIENTE',
      rowVersion: 1,
      effectKey: 'scheduled-key',
      title: 'Propuesta ya programada',
    })
  })

  it('leaves the proposal pending and outside effects and approval (PROP-06)', async () => {
    const harness = await bootBoard()
    const receipt = await harness.board.submitProposal(ACTOR_A, proposal())
    await expect(harness.board.recordEffect(ACTOR_A, receipt.id, {
      ref: 'externo-1',
      authorization: 'autorizacion',
    })).rejects.toThrow('NO_ACCESS')
    await expect(harness.board.complete(ACTOR_A, receipt.id)).rejects.toThrow('NO_ACCESS')
    expect(await harness.board.get(ACTOR_A, receipt.id)).toMatchObject({
      state: 'PENDIENTE_CRITERIO',
      approvedRevision: null,
      effects: [],
    })
    // An approval by the model is refused even when the item is the agent's own.
    const agent = { id: OWNER_A, companyId: COMPANY_A }
    const current = await harness.board.get(ACTOR_A, receipt.id)
    await expect(harness.board.approve(agent, receipt.id, {
      expectedRowVersion: current.rowVersion,
      expectedArtifactVersion: current.version,
      expectedArtifactHash: current.artifactHash ?? '',
    })).rejects.toThrow('HUMAN_ACTION_REQUIRED')
  })

  it('refuses an oversized field and a full evidence list without touching another proposal (PROP-08)', async () => {
    const harness = await bootBoard()
    const receipt = await harness.board.submitProposal(ACTOR_A, proposal({ claveCliente: 'intacta' }))
    const before = await harness.board.get(ACTOR_A, receipt.id)

    await expect(harness.board.submitProposal(ACTOR_A, proposal({
      claveCliente: 'demasiado-grande',
      cambio: 'x'.repeat(PROPOSAL_LIMITS.cambio + 1),
    }))).rejects.toThrow('PROPOSAL_LIMIT')
    await expect(harness.board.submitProposal(ACTOR_A, proposal({
      claveCliente: 'demasiadas-evidencias',
      evidencia: Array.from({ length: PROPOSAL_LIMITS.evidenciaItems + 1 }, (_, index) => `ref:${String(index)}`),
    }))).rejects.toThrow('PROPOSAL_LIMIT')

    expect(await harness.board.get(ACTOR_A, receipt.id)).toMatchObject({
      rowVersion: before.rowVersion,
      title: before.title,
    })
  })
})
