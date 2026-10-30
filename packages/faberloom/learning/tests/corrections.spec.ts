import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomMemory from '../src/index.ts'
import type { CorrectionInput, LearningActor, LearningOutcomeResult } from '../src/index.ts'

/** Boot the storage/domain composition plus the memory service. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomMemory)
  return { ctx, memory: ctx.faberloomMemory }
}

const TENANT = 'sondelsa'
const IDENTITY = 'compras2@sondelsa.com'

/** The human who corrects, holding one space, one account, and one agent. */
const OWNER: LearningActor = {
  id: IDENTITY,
  tenantId: TENANT,
  spaceIds: ['eguisa', 'sondel'],
  accountRefs: ['acme'],
  agentIds: ['agent-cotiza'],
}

/** One inline edit of the unit price. */
const PRICE_EDIT = { origin: 'edit' as const, field: 'lines[0].unitPrice', previous: '10', next: '12' }

/** One correction with the common lineage, open to per-test overrides. */
function correction(overrides: Partial<CorrectionInput> = {}): CorrectionInput {
  return {
    detail: PRICE_EDIT,
    itemId: 'oc-1',
    actor: IDENTITY,
    tenantId: TENANT,
    spaceId: 'eguisa',
    accountRef: 'acme',
    dataClasses: ['N1'],
    fieldsUsed: ['lines[0].unitPrice'],
    ...overrides,
  }
}

describe('correction registry', () => {
  it('W-34 · a puntual correction is recorded and teaches nothing', async () => {
    const { memory } = await harness()
    const explicit = await memory.onCorrection(OWNER, correction({ scope: 'puntual' }))
    expect(explicit.correction).toMatchObject({ itemId: 'oc-1', scope: 'puntual', origin: 'edit', actor: IDENTITY })
    expect(explicit.candidate).toBeUndefined()

    const implied = await memory.onCorrection(OWNER, correction({ itemId: 'oc-2' }))
    expect(implied.correction.scope).toBe('puntual')
    expect(implied.candidate).toBeUndefined()

    expect(await memory.listCorrections(OWNER)).toHaveLength(2)
    expect(await memory.listCandidates(OWNER)).toEqual([])
  })

  it('W-34 · an applied iteration closes with a scope classification', async () => {
    const { memory } = await harness()
    const iterate = { origin: 'iterate' as const, instructions: 'recalcula el flete', diffs: ['-30', '+45'], rounds: 1 }
    await expect(memory.onCorrection(OWNER, correction({ detail: iterate }))).rejects.toThrow('SCOPE_REQUIRED')

    const applied = await memory.onCorrection(OWNER, correction({
      detail: { ...iterate, rounds: 2 },
      scope: 'espacio',
      text: 'El flete se recalcula con la tarifa vigente del transportista.',
    }))
    expect(applied.correction.detail).toEqual({ origin: 'iterate', instructions: 'recalcula el flete', diffs: ['-30', '+45'], rounds: 2 })
    expect(applied.candidate?.allowedDestination).toBe('espacio')
  })

  it('W-34 · a non-puntual scope records the correction and one candidate', async () => {
    const { memory } = await harness()
    const outcome = await memory.onCorrection(OWNER, correction({
      scope: 'cuenta',
      text: 'El precio de lista se contrasta con la tarifa vigente.',
    }))
    expect(outcome.correction.scope).toBe('cuenta')
    expect(outcome.candidate).toMatchObject({ status: 'candidate', scope: 'cuenta', allowedDestination: 'cuenta' })
    expect(await memory.listCandidates(OWNER)).toHaveLength(1)
  })

  it('W-34 · every origin uses one record structure', async () => {
    const { memory } = await harness()
    const doubt = await memory.onCorrection(OWNER, correction({
      itemId: 'oc-7',
      detail: { origin: 'answer_doubt', question: '¿Qué tarifa aplico?', answer: 'La del día de la orden' },
      fieldsUsed: [],
    }))
    const iterate = await memory.onCorrection(OWNER, correction({
      itemId: 'oc-8',
      detail: { origin: 'iterate', instructions: 'sube el margen', diffs: ['-0.1', '+0.15'], rounds: 1 },
      scope: 'puntual',
    }))
    const edits = await memory.onCorrection(OWNER, correction({ itemId: 'oc-9' }))
    const origins = [doubt, iterate, edits].map(outcome => ({
      itemId: outcome.correction.itemId,
      origin: outcome.correction.origin,
      tenantId: outcome.correction.tenantId,
      spaceId: outcome.correction.spaceId,
      accountRef: outcome.correction.accountRef,
      actor: outcome.correction.actor,
      scope: outcome.correction.scope,
    }))
    expect(origins).toEqual([
      { itemId: 'oc-7', origin: 'answer_doubt', tenantId: TENANT, spaceId: 'eguisa', accountRef: 'acme', actor: IDENTITY, scope: 'puntual' },
      { itemId: 'oc-8', origin: 'iterate', tenantId: TENANT, spaceId: 'eguisa', accountRef: 'acme', actor: IDENTITY, scope: 'puntual' },
      { itemId: 'oc-9', origin: 'edit', tenantId: TENANT, spaceId: 'eguisa', accountRef: 'acme', actor: IDENTITY, scope: 'puntual' },
    ])
  })

  it('D-05 · an N2 provisional origin records the correction and yields no candidate', async () => {
    const { memory } = await harness()
    const outcome = await memory.onCorrection(OWNER, correction({
      scope: 'espacio',
      text: 'El flete usa la tarifa vigente.',
      dataClassProvisional: true,
    }))
    expect(outcome.correction.scope).toBe('espacio')
    expect(outcome.candidate).toBeUndefined()
    expect(await memory.listCandidates(OWNER)).toEqual([])
  })

  it('rejects the preconditions it declares', async () => {
    const { memory } = await harness()
    await expect(memory.onCorrection(OWNER, correction({ scope: 'cuenta' }))).rejects.toThrow('NO_TEXT')
    const { spaceId: _spaceId, ...withoutSpace } = correction({ scope: 'espacio', text: 'x' })
    await expect(memory.onCorrection(OWNER, withoutSpace)).rejects.toThrow('NO_DESTINATION')
    await expect(memory.onCorrection(OWNER, correction({ dataClasses: [] }))).rejects.toThrow('NO_DATA_CLASS')
    await expect(memory.onCorrection(OWNER, correction({ itemId: ' ' }))).rejects.toThrow('NO_ORIGIN')
    await expect(memory.onCorrection(OWNER, correction({ detail: { ...PRICE_EDIT, field: '' } }))).rejects.toThrow('NO_FIELD')
    await expect(memory.onCorrection(OWNER, correction({
      detail: { origin: 'iterate', instructions: 'x', diffs: [], rounds: 0 },
      scope: 'puntual',
    }))).rejects.toThrow('NO_ROUNDS')
    const foreign: LearningActor = { id: 'vendedor@sondelsa.com', tenantId: TENANT, spaceIds: ['sondel'] }
    await expect(memory.onCorrection(foreign, correction({ scope: 'puntual' }))).rejects.toThrow('NO_ACCESS')
    expect(await memory.listCorrections(OWNER)).toEqual([])
  })
})

describe('learning candidates', () => {
  it('W-35 · a candidate never activates without an explicit promotion', async () => {
    const { memory } = await harness()
    const recorded = await memory.onCorrection(OWNER, correction({ scope: 'cuenta', text: 'Regla de la cuenta' }))
    const candidate = recorded.candidate
    expect(candidate).toMatchObject({ status: 'candidate', promotedBy: null, promotedAt: null, promotionDataClasses: null })
    expect(await memory.listCandidates(OWNER, { status: 'promoted' })).toEqual([])
    expect((await memory.getCandidate(OWNER, candidate!.id)).status).toBe('candidate')

    const promoted = await memory.promoteCandidate(OWNER, candidate!.id, {
      destination: 'cuenta',
      acceptedDataClasses: ['N0', 'N1', 'N2'],
    })
    expect(promoted).toMatchObject({ status: 'promoted', promotedBy: IDENTITY, promotionDataClasses: ['N0', 'N1', 'N2'] })
    expect(promoted.promotedAt).not.toBeNull()
    await expect(memory.promoteCandidate(OWNER, candidate!.id, {
      destination: 'cuenta',
      acceptedDataClasses: ['N0', 'N1', 'N2'],
    })).rejects.toThrow('NOT_CANDIDATE')
  })

  it('W-46 · a candidate carries the lineage of its origin and inherits the highest data class', async () => {
    const { memory } = await harness()
    const recorded = await memory.onCorrection(OWNER, correction({
      scope: 'agente',
      agentId: 'agent-cotiza',
      dataClasses: ['N1', 'N3', 'N2'],
      fieldsUsed: ['lines[0].unitPrice', 'account.history'],
      text: 'Cita el precio de la tarifa vigente antes de responder.',
    }))
    expect(recorded.candidate).toMatchObject({
      tenantId: TENANT,
      spaceId: 'eguisa',
      accountRef: 'acme',
      agentId: 'agent-cotiza',
      itemId: 'oc-1',
      correctionId: recorded.correction.id,
      dataClass: 'N3',
      originDataClasses: ['N1', 'N3', 'N2'],
      fieldsUsed: ['lines[0].unitPrice', 'account.history'],
      allowedDestination: 'agente',
      derivedFrom: null,
      createdBy: IDENTITY,
    })
  })

  it('W-47 · another tenant cannot read or promote a candidate', async () => {
    const { memory } = await harness()
    const recorded = await memory.onCorrection(OWNER, correction({ scope: 'cuenta', text: 'Regla de la cuenta' }))
    const candidate = recorded.candidate!
    const outsider: LearningActor = {
      id: 'compras@otra.com',
      tenantId: 'otra',
      spaceIds: ['eguisa'],
      accountRefs: ['acme'],
      agentIds: ['agent-cotiza'],
    }
    await expect(memory.getCandidate(outsider, candidate.id)).rejects.toThrow('NO_ACCESS')
    await expect(memory.promoteCandidate(outsider, candidate.id, {
      destination: 'cuenta',
      acceptedDataClasses: ['N0', 'N1', 'N2', 'N3', 'N4'],
    })).rejects.toThrow('NO_ACCESS')
    expect(await memory.listCandidates(outsider)).toEqual([])
    expect(await memory.listCorrections(outsider)).toEqual([])
    await expect(memory.getCorrection(outsider, recorded.correction.id)).rejects.toThrow('NO_ACCESS')

    const sameTenantOtherSpace: LearningActor = { id: 'vendedor@sondelsa.com', tenantId: TENANT, spaceIds: ['sondel'] }
    expect(await memory.listCandidates(sameTenantOtherSpace)).toEqual([])
    expect((await memory.getCandidate(OWNER, candidate.id)).status).toBe('candidate')
  })

  it('W-47 · widening needs a new candidate and a new promotion', async () => {
    const { memory } = await harness()
    const recorded = await memory.onCorrection(OWNER, correction({
      scope: 'cuenta',
      text: 'El precio de lista se toma de la tarifa del día.',
    }))
    const narrow = recorded.candidate!
    const wide = await memory.widenCandidate(OWNER, narrow.id, {
      destination: 'espacio',
      text: 'En el espacio Eguisa, el precio de lista se toma de la tarifa del día y el flete de la tabla del transportista.',
      acceptedDataClasses: ['N0', 'N1', 'N2'],
    })
    expect(wide.id).not.toBe(narrow.id)
    expect(wide).toMatchObject({
      status: 'candidate',
      allowedDestination: 'espacio',
      derivedFrom: narrow.id,
      promotedBy: null,
      promotedAt: null,
      correctionId: recorded.correction.id,
    })
    expect(await memory.getCandidate(OWNER, narrow.id)).toMatchObject({ allowedDestination: 'cuenta', status: 'candidate' })

    await expect(memory.promoteCandidate(OWNER, wide.id, {
      destination: 'agente',
      acceptedDataClasses: ['N0', 'N1', 'N2'],
    })).rejects.toThrow('DESTINATION_NOT_ALLOWED')
    await expect(memory.widenCandidate(OWNER, wide.id, {
      destination: 'cuenta',
      text: 'contenido distinto',
      acceptedDataClasses: ['N0', 'N1', 'N2'],
    })).rejects.toThrow('NOT_WIDER')
    await expect(memory.widenCandidate(OWNER, narrow.id, {
      destination: 'espacio',
      text: narrow.text,
      acceptedDataClasses: ['N0', 'N1', 'N2'],
    })).rejects.toThrow('REVIEW_REQUIRED')
  })

  it('W-60 · promoting outside the allowed destination is rejected', async () => {
    const { memory } = await harness()
    const recorded = await memory.onCorrection(OWNER, correction({ scope: 'cuenta', text: 'Regla de la cuenta' }))
    const candidate = recorded.candidate!
    await expect(memory.promoteCandidate(OWNER, candidate.id, {
      destination: 'agente',
      acceptedDataClasses: ['N0', 'N1', 'N2', 'N3', 'N4'],
    })).rejects.toThrow('DESTINATION_NOT_ALLOWED')
    await expect(memory.promoteCandidate(OWNER, candidate.id, {
      destination: 'cuenta',
      acceptedDataClasses: ['N0'],
    })).rejects.toThrow('CLASSIFICATION_NOT_ALLOWED')
    expect((await memory.getCandidate(OWNER, candidate.id)).status).toBe('candidate')
  })
})

describe('maturity metrics', () => {
  /** Record one item outcome of the proforma task type. */
  async function close(
    memory: FaberLoomMemory,
    itemId: string,
    result: LearningOutcomeResult,
    spaceId = 'eguisa',
  ): Promise<void> {
    await memory.recordOutcome(OWNER, {
      itemId, result, spaceId, tenantId: TENANT, artifactType: 'proforma', actionType: 'send_quote',
    })
  }

  it('W-80 · an approval with an answered doubt is not counted as success', async () => {
    const { memory } = await harness()
    await close(memory, 'a1', 'approved')
    await close(memory, 'a2', 'approved')
    await memory.onCorrection(OWNER, correction({
      itemId: 'a2',
      detail: { origin: 'answer_doubt', question: '¿Qué tarifa aplico?', answer: 'La del día' },
      fieldsUsed: [],
    }))
    await close(memory, 'a3', 'approved')
    await memory.onCorrection(OWNER, correction({
      itemId: 'a3',
      detail: { origin: 'iterate', instructions: 'recalcula el flete', diffs: ['-30', '+45'], rounds: 1 },
      scope: 'puntual',
    }))
    await memory.onCorrection(OWNER, correction({ itemId: 'a3', detail: { ...PRICE_EDIT, field: 'lines[0].total' } }))
    await memory.onCorrection(OWNER, correction({ itemId: 'a3', detail: { ...PRICE_EDIT, field: 'total' } }))
    await close(memory, 'a4', 'discarded')
    await close(memory, 'a5', 'skipped')
    await close(memory, 'a6', 'delegated')
    await close(memory, 'a6', 'delegated-reversed')

    const [eguisa] = await memory.maturity(OWNER)
    expect(eguisa).toMatchObject({
      spaceId: 'eguisa',
      artifactType: 'proforma',
      actionType: 'send_quote',
      volume: 6,
      closed: 4,
      correctionLoad: { iterations: 1, editedFields: 2, answeredDoubts: 1, total: 4 },
      resolvedWithoutIntervention: { count: 1 },
      discarded: { count: 1 },
      skipped: { count: 1 },
      delegated: { count: 1, reversals: 1 },
    })
    expect(eguisa!.correctionLoad.perItem).toBeCloseTo(4 / 6, 6)
    expect(eguisa!.resolvedWithoutIntervention.rate).toBeCloseTo(0.25, 6)
    expect(eguisa!.discarded.rate).toBeCloseTo(0.25, 6)
    expect(eguisa!.skipped.rate).toBeCloseTo(1 / 6, 6)
    expect(eguisa!.delegated.reversalRate).toBe(1)

    // The doubt alone disqualifies b1: its task type reports no success at all.
    await close(memory, 'b1', 'approved', 'sondel')
    await memory.onCorrection(OWNER, correction({
      itemId: 'b1',
      spaceId: 'sondel',
      detail: { origin: 'answer_doubt', question: '¿Aplica descuento?', answer: 'No' },
      fieldsUsed: [],
    }))
    const [sondel] = await memory.maturity(OWNER, { spaceId: 'sondel' })
    expect(sondel).toMatchObject({
      spaceId: 'sondel',
      volume: 1,
      closed: 1,
      correctionLoad: { answeredDoubts: 1, total: 1 },
      resolvedWithoutIntervention: { count: 0, rate: 0 },
    })
  })

  it('reports each task type on its own and keeps tenants apart', async () => {
    const { memory } = await harness()
    await close(memory, 'a1', 'approved')
    await close(memory, 'a2', 'discarded')
    await memory.recordOutcome(OWNER, {
      itemId: 'r1', result: 'approved', spaceId: 'eguisa', tenantId: TENANT, artifactType: 'respuesta', actionType: 'send_reply',
    })
    const outsider: LearningActor = { id: 'compras@otra.com', tenantId: 'otra', spaceIds: ['eguisa'] }
    await memory.recordOutcome(outsider, {
      itemId: 'a1', result: 'discarded', spaceId: 'eguisa', tenantId: 'otra', artifactType: 'proforma', actionType: 'send_quote',
    })

    const report = await memory.maturity(OWNER)
    expect(report.map(entry => [entry.artifactType, entry.volume])).toEqual([['proforma', 2], ['respuesta', 1]])
    const [proforma, respuesta] = report
    expect(proforma).toMatchObject({
      volume: 2,
      closed: 2,
      resolvedWithoutIntervention: { count: 1, rate: 0.5 },
      discarded: { count: 1, rate: 0.5 },
      skipped: { count: 0, rate: 0 },
      delegated: { count: 0, reversalRate: undefined },
    })
    expect(respuesta).toMatchObject({ closed: 1, resolvedWithoutIntervention: { count: 1, rate: 1 } })
    expect(await memory.maturity(outsider)).toMatchObject([{
      volume: 1,
      closed: 1,
      resolvedWithoutIntervention: { count: 0 },
    }])
  })
})
