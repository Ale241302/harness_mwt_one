import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

/** One board item as the view reads it, with the fields its projection touches. */
function boardItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    ownerId: 'owner@muitowork.com',
    companyId: 'mwt',
    spaceId: null,
    routineId: null,
    title: 'PF 9001-2026',
    status: 'in_progress',
    state: 'DELEGADO_EN_VENTANA',
    column: 'DELEGADO',
    version: 3,
    rowVersion: 7,
    severity: 'HIGH',
    severitySource: 'HUMAN',
    severityConfidence: null,
    dueAt: null,
    valueUsd: 1200,
    dataClass: 'N2',
    dataClassProvisional: false,
    artifactType: 'proforma',
    accountRef: 'Cuenta Demo',
    artifactHash: 'hash-1',
    runId: 'run-1',
    supersedesItemId: null,
    pendingCandidate: null,
    events: [],
    effects: [],
    fieldOrigins: [],
    revisions: [{ version: 3, summary: 'Borrador', evidence: [] }],
    effectKey: 'eff-1',
    reversalDeadline: '2026-10-28T12:15:00.000Z',
    executionOutcome: null,
    ...overrides,
  }
}

/** The reservation one accepted execution holds. */
const RESERVATION = {
  companyId: 'mwt',
  effectKey: 'eff-1',
  actionType: 'mail.send',
  destination: 'cliente@demo.test',
  businessKey: 'PF 9001-2026',
  artifactHash: 'hash-1',
  executionId: 'exec-1',
  itemId: 'item-1',
  idempotencyKey: 'effect:eff-1',
  authorization: 'sig-1',
  status: 'RESERVADA',
  outcome: null,
  reversalDeadline: '2026-10-28T12:15:00.000Z',
  dispatchedAt: null,
  releasedAt: null,
  releaseReason: null,
  closedAt: null,
  closedBy: null,
  closeReason: null,
  settledAt: null,
  createdAt: '2026-10-28T12:00:00.000Z',
  updatedAt: '2026-10-28T12:00:00.000Z',
  retainUntil: '2027-01-26T12:00:00.000Z',
}

/** The durable intention to emit the effect. */
const MESSAGE = {
  companyId: 'mwt',
  effectKey: 'eff-1',
  executionId: 'exec-1',
  itemId: 'item-1',
  actionType: 'mail.send',
  destination: 'cliente@demo.test',
  idempotencyKey: 'effect:eff-1',
  status: 'PENDIENTE',
  dispatchable: true,
  attempts: 0,
  reason: null,
  ref: null,
  createdAt: '2026-10-28T12:00:00.000Z',
  updatedAt: '2026-10-28T12:00:00.000Z',
  dispatchedAt: null,
  settledAt: null,
  retainUntil: '2027-01-26T12:00:00.000Z',
}

/** The service graph the effect and signature remotes touch. */
function harness(options: { readOnly?: boolean; role?: string; access?: boolean; item?: ReturnType<typeof boardItem> } = {}) {
  const item = options.item ?? boardItem()
  const board = {
    list: vi.fn(async () => [item]),
    get: vi.fn(async () => item),
    getEditDraft: vi.fn(async () => undefined),
    transferredDrafts: vi.fn(async () => []),
    checkStatus: vi.fn(() => []),
    runChecks: vi.fn(async () => ({ checks: [], missing: [] })),
    effectStatus: vi.fn(async () => ({
      effectKey: 'eff-1',
      actionType: 'mail.send',
      reversalDeadline: '2026-10-28T12:15:00.000Z',
      executionOutcome: null,
      reservation: RESERVATION,
      message: MESSAGE,
      alerts: [ALERT],
      reconciliationOpen: false,
      adapter: { actionType: 'mail.send', idempotent: false, probe: false },
    })),
    effectPolicy: vi.fn(() => ({
      actionTypes: ['mail.send', 'inventory.reserve', 'shipment.create'],
      reversalWindowMs: { 'mail.send': 900_000 } as Record<string, number>,
      retentionDays: 90,
      dispatchTimeoutMs: 30_000,
      reservationLeaseMs: 300_000,
    })),
    alerts: vi.fn(async () => [ALERT, { ...ALERT, effectKey: 'eff-2', itemId: 'item-2', kind: 'ORPHAN_RELEASED', outcome: null }]),
    revert: vi.fn(async () => item),
    retry: vi.fn(async () => item),
    reconcile: vi.fn(async () => item),
    probeEffect: vi.fn(async () => ({
      effectKey: 'eff-1',
      actionType: 'mail.send',
      reversalDeadline: null,
      executionOutcome: 'CONFIRMADO',
      reservation: { ...RESERVATION, status: 'CONCILIADA', outcome: 'CONFIRMADO' },
      message: { ...MESSAGE, status: 'CONFIRMADO' },
      alerts: [],
      reconciliationOpen: false,
      adapter: { actionType: 'mail.send', idempotent: false, probe: true },
    })),
    adminClose: vi.fn(async () => ({ item, created: null })),
    approveWithExecution: vi.fn(async () => ({ item, reservation: RESERVATION, message: MESSAGE })),
  }
  const access = {
    protectedActionTypes: ['mail.send', 'shipment.create'],
    signatureStatus: vi.fn(async (_actor: unknown, actionType: string) => ({
      actionType,
      protected: true,
      state: actionType === 'mail.send' ? 'ACTIVE' : 'MISSING',
      signatureId: actionType === 'mail.send' ? 'sig-1' : null,
      signedAt: actionType === 'mail.send' ? '2026-10-28T09:00:00.000Z' : null,
      expiresAt: null,
      signedBy: actionType === 'mail.send' ? 'ceo@muitowork.com' : null,
    })),
    issueSignature: vi.fn(async () => ({ id: 'sig-2' })),
    revokeSignature: vi.fn(async () => ({ id: 'sig-1' })),
  }
  const ctx = {
    faberloomBoard: board,
    provide: () => {},
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: () => () => {},
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => name === 'faberloomAccess' && options.access !== false ? access : undefined,
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, {
    ownerId: 'owner@muitowork.com',
    role: options.role ?? 'admin',
    companyId: 'mwt',
    readOnly: options.readOnly === true,
  })
  return { view, board, access }
}

/** One visible alert the board raised for a late confirmation. */
const ALERT = {
  companyId: 'mwt',
  effectKey: 'eff-1',
  itemId: 'item-1',
  executionId: 'exec-1',
  kind: 'LATE_CONFIRMATION' as const,
  outcome: 'CONFIRMADO' as const,
  detail: 'confirmed after the close',
  actor: 'owner@muitowork.com',
  createdAt: '2026-10-28T12:30:00.000Z',
  updatedAt: '2026-10-28T12:30:00.000Z',
}

describe('FaberLoomViewService external effects', () => {
  it('projects one item effect with its reservation, its intention, and its alerts', async () => {
    const { view } = harness()
    const status = await view.boardEffectStatus('item-1')
    expect(status).toMatchObject({
      effectKey: 'eff-1',
      actionType: 'mail.send',
      destination: 'cliente@demo.test',
      reversalDeadline: '2026-10-28T12:15:00.000Z',
      outbox: 'PENDIENTE',
      idempotencyKey: 'effect:eff-1',
      reconciliationOpen: false,
      canAdminClose: true,
    })
    expect(status?.reservation).toMatchObject({ status: 'RESERVADA', releaseReason: null })
    // The alert names the item by title, so the panel never resolves an id.
    expect(status?.alerts).toEqual([{
      itemId: 'item-1',
      itemTitle: 'PF 9001-2026',
      kind: 'LATE_CONFIRMATION',
      outcome: 'CONFIRMADO',
      detail: 'confirmed after the close',
      actor: 'owner@muitowork.com',
      updatedAt: '2026-10-28T12:30:00.000Z',
    }])
  })

  it('reports no effect for an item that authorized none', async () => {
    const { view, board } = harness({ item: boardItem({ effectKey: null }) })
    board.effectStatus.mockResolvedValue(null as never)
    await expect(view.boardEffectStatus('item-1')).resolves.toBeNull()
  })

  it('reports no effect for an item the reader does not hold', async () => {
    const { view } = harness()
    await expect(view.boardEffectStatus('missing')).resolves.toBeNull()
  })

  it('reports the declaration of the adapter the board holds for the action type', async () => {
    const { view, board } = harness()
    const status = await view.boardEffectStatus('item-1')
    // W-21: the board decides by the adapter's declaration, and publishes it.
    expect(status).toMatchObject({
      actionType: 'mail.send',
      idempotent: false,
      probe: false,
    })

    board.effectStatus.mockResolvedValue({
      effectKey: 'eff-1',
      actionType: 'mail.send',
      reversalDeadline: null,
      executionOutcome: 'DESCONOCIDO',
      reservation: RESERVATION,
      message: MESSAGE,
      alerts: [],
      reconciliationOpen: true,
      adapter: { actionType: 'mail.send', idempotent: true, probe: true },
    } as never)
    await expect(view.boardEffectStatus('item-1')).resolves.toMatchObject({ idempotent: true, probe: true })
  })

  it('reports no adapter when the board has none registered', async () => {
    const { view, board } = harness()
    board.effectStatus.mockResolvedValue({
      effectKey: 'eff-1',
      actionType: 'shipment.create',
      reversalDeadline: null,
      executionOutcome: null,
      reservation: { ...RESERVATION, actionType: 'shipment.create' },
      message: { ...MESSAGE, actionType: 'shipment.create' },
      alerts: [],
      reconciliationOpen: false,
      adapter: null,
    } as never)
    await expect(view.boardEffectStatus('item-1')).resolves.toMatchObject({
      actionType: 'shipment.create',
      idempotent: false,
      probe: false,
    })
  })

  it('offers the administrative close to the item owner and to an administrator only', async () => {
    const owner = harness()
    expect((await owner.view.boardEffectStatus('item-1'))?.canAdminClose).toBe(true)

    const other = harness({
      role: 'client_b2b',
      item: boardItem({ ownerId: 'someone-else@muitowork.com' }),
    })
    expect((await other.view.boardEffectStatus('item-1'))?.canAdminClose).toBe(false)

    const admin = harness({
      role: 'admin',
      item: boardItem({ ownerId: 'someone-else@muitowork.com' }),
    })
    expect((await admin.view.boardEffectStatus('item-1'))?.canAdminClose).toBe(true)
  })

  it('lists the visible alerts newest first with the item each names', async () => {
    const { view, board } = harness()
    const rows = await view.boardEffectAlerts()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ itemId: 'item-1', itemTitle: 'PF 9001-2026', kind: 'LATE_CONFIRMATION' })
    // The second alert names an item this reader no longer holds.
    expect(rows[1]).toMatchObject({ itemId: 'item-2', itemTitle: null, kind: 'ORPHAN_RELEASED' })
    expect(board.alerts).toHaveBeenCalledWith(expect.objectContaining({ id: 'owner@muitowork.com', companyId: 'mwt' }))
  })

  it('offers the action types and windows the board resolved, never a copy of its own', async () => {
    const { view, board } = harness()
    await expect(view.boardEffectPolicy()).resolves.toEqual({
      actionTypes: ['mail.send', 'inventory.reserve', 'shipment.create'],
      reversalWindowMs: { 'mail.send': 900_000 },
    })

    board.effectPolicy.mockReturnValue({
      actionTypes: ['custom.notify'],
      reversalWindowMs: { 'custom.notify': 60_000 },
      retentionDays: 90,
      dispatchTimeoutMs: 30_000,
      reservationLeaseMs: 300_000,
    })
    await expect(view.boardEffectPolicy()).resolves.toEqual({
      actionTypes: ['custom.notify'],
      reversalWindowMs: { 'custom.notify': 60_000 },
    })
  })

  it('reverts with the reason the operator chose', async () => {
    const { view, board } = harness()
    const detail = await view.boardEffectRevert('item-1', { expectedRowVersion: 7, reason: 'DUPLICADO' })
    expect(board.revert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'owner@muitowork.com' }),
      'item-1',
      { expectedRowVersion: 7, reason: 'DUPLICADO' },
    )
    expect(detail?.state).toBe('DELEGADO_EN_VENTANA')
  })

  it('retries and reconciles through the board and returns the refreshed detail', async () => {
    const { view, board } = harness({ item: boardItem({ state: 'ERROR_RECUPERABLE' }) })
    await view.boardEffectRetry('item-1', { expectedRowVersion: 7 })
    expect(board.retry).toHaveBeenCalledWith(expect.anything(), 'item-1', { expectedRowVersion: 7 })

    await view.boardEffectReconcile('item-1', { expectedRowVersion: 7, outcome: 'CONFIRMADO', ref: 'msg-9' })
    expect(board.reconcile).toHaveBeenCalledWith(expect.anything(), 'item-1', {
      expectedRowVersion: 7,
      outcome: 'CONFIRMADO',
      ref: 'msg-9',
    })
  })

  it('asks the destination through the board and reports the answer it got', async () => {
    const { view, board } = harness({ item: boardItem({ state: 'DESCONOCIDO' }) })
    const answer = await view.boardEffectProbe('item-1', { expectedRowVersion: 7 })
    expect(board.probeEffect).toHaveBeenCalledWith(expect.anything(), 'item-1', { expectedRowVersion: 7 })
    // §9.8: the answer is the board's, and the projection says whether an
    // adapter could be asked and what the destination reported.
    expect(answer).toMatchObject({
      actionType: 'mail.send',
      executionOutcome: 'CONFIRMADO',
      probe: true,
      idempotent: false,
    })
    expect(answer?.canAdminClose).toBe(true)

    board.probeEffect.mockResolvedValue({
      effectKey: 'eff-1',
      actionType: 'mail.send',
      reversalDeadline: null,
      executionOutcome: 'DESCONOCIDO',
      reservation: { ...RESERVATION, status: 'DESPACHADA' },
      message: { ...MESSAGE, status: 'DESPACHADO' },
      alerts: [],
      reconciliationOpen: true,
      adapter: { actionType: 'mail.send', idempotent: false, probe: false },
    } as never)
    // No adapter of the action type declares a probe, so nothing was asked and
    // the effect stays exactly where it was.
    await expect(view.boardEffectProbe('item-1', {})).resolves.toMatchObject({
      probe: false,
      executionOutcome: 'DESCONOCIDO',
      reconciliationOpen: true,
    })
  })

  it('closes administratively with the reason and reports the item a candidate became', async () => {
    const { view, board } = harness()
    board.list.mockResolvedValue([boardItem({ state: 'DESCARTADO' })] as never)
    board.adminClose.mockResolvedValue({ item: boardItem({ state: 'DESCARTADO' }), created: { id: 'item-2' } } as never)
    const result = await view.boardEffectAdminClose('item-1', { expectedRowVersion: 7, reason: 'el destino no responde' })
    expect(board.adminClose).toHaveBeenCalledWith(expect.anything(), 'item-1', {
      expectedRowVersion: 7,
      reason: 'el destino no responde',
    })
    expect(result.detail?.state).toBe('DESCARTADO')
    expect(result.createdId).toBe('item-2')
  })

  it('accepts one execution with the signature that covers its action type', async () => {
    const { view, board } = harness()
    await view.boardApproveWithExecution('item-1', {
      expectedRowVersion: 7,
      expectedArtifactVersion: 3,
      expectedArtifactHash: 'hash-1',
      executionId: 'exec-1',
      actionType: 'mail.send',
      destination: 'cliente@demo.test',
      authorization: 'sig-1',
    })
    expect(board.approveWithExecution).toHaveBeenCalledWith(expect.anything(), 'item-1', {
      expectedRowVersion: 7,
      expectedArtifactVersion: 3,
      expectedArtifactHash: 'hash-1',
      executionId: 'exec-1',
      actionType: 'mail.send',
      destination: 'cliente@demo.test',
      authorization: 'sig-1',
    })
  })

  it('refuses every effect write for a read-only identity', async () => {
    const { view, board } = harness({ readOnly: true })
    await expect(view.boardEffectRevert('item-1', {})).rejects.toThrow('read-only')
    await expect(view.boardEffectRetry('item-1', {})).rejects.toThrow('read-only')
    await expect(view.boardEffectReconcile('item-1', { outcome: 'CONFIRMADO' })).rejects.toThrow('read-only')
    await expect(view.boardEffectProbe('item-1', {})).rejects.toThrow('read-only')
    await expect(view.boardEffectAdminClose('item-1', { reason: 'x' })).rejects.toThrow('read-only')
    await expect(view.boardApproveWithExecution('item-1', {
      expectedRowVersion: 7,
      expectedArtifactVersion: 3,
      expectedArtifactHash: 'hash-1',
      executionId: 'exec-1',
      actionType: 'mail.send',
      destination: 'cliente@demo.test',
    })).rejects.toThrow('read-only')
    expect(board.revert).not.toHaveBeenCalled()
  })
})

describe('FaberLoomViewService signatures', () => {
  it('reports the state that covers one action type for this reader', async () => {
    const { view, access } = harness()
    await expect(view.boardSignatureStatus('mail.send')).resolves.toEqual({
      actionType: 'mail.send',
      protected: true,
      state: 'ACTIVE',
      signatureId: 'sig-1',
      signedAt: '2026-10-28T09:00:00.000Z',
      expiresAt: null,
      signedBy: 'ceo@muitowork.com',
    })
    expect(access.signatureStatus).toHaveBeenCalledWith(
      { id: 'owner@muitowork.com', companyId: 'mwt' },
      'mail.send',
    )
  })

  it('lists every protected action type with its state', async () => {
    const { view } = harness()
    const rows = await view.boardSignatures()
    expect(rows.map(row => [row.actionType, row.state])).toEqual([
      ['mail.send', 'ACTIVE'],
      ['shipment.create', 'MISSING'],
    ])
  })

  it('issues and revokes for the acting identity and returns the fresh list', async () => {
    const { view, access } = harness()
    await view.boardSignatureIssue({ actionTypes: ['shipment.create'] })
    expect(access.issueSignature).toHaveBeenCalledWith(
      { id: 'owner@muitowork.com', companyId: 'mwt' },
      { actionTypes: ['shipment.create'] },
    )

    await view.boardSignatureRevoke('sig-1')
    expect(access.revokeSignature).toHaveBeenCalledWith(
      { id: 'owner@muitowork.com', companyId: 'mwt' },
      'sig-1',
    )
  })

  it('reports a deployment without the access service', async () => {
    const { view } = harness({ access: false })
    await expect(view.boardSignatures()).rejects.toThrow('not mounted')
  })
})
