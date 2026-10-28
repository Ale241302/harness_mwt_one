import { describe, expect, it } from 'vitest'
import { ACTOR_A, bootBoard, mountProformaChecks, proformaFixture } from './helpers/harness.ts'
import { fieldPaths } from '../src/projection.ts'
import { PROFORMA_CHECKS } from '../src/checks.ts'
import type { BoardHarness } from './helpers/harness.ts'
import type {
  BoardApproveInput,
  BoardCheckFn,
  BoardCheckSource,
  BoardFieldOriginEntry,
  FaberLoomBoardItem,
} from '../src/index.ts'

/** Read instant the fake source reports, so a result is comparable. */
const NOW = '2026-10-28T10:00:00.000Z'

const fixture = proformaFixture()

/** Overcharge the fake account pays on each fixture SKU. */
const OVERCHARGE: Readonly<Record<string, number>> = {
  'ART-04-271897': 20,
  'ART-04-271898': 5,
}

/** The proforma draft the controls evaluate, built from the golden fixture. */
function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orderRef: fixture.sourceRef,
    lines: fixture.lines.map(line => ({ ...line })),
    total: fixture.total,
    separation: 'new',
    ...overrides,
  }
}

/**
 * A source port that answers from the golden fixture. A test replaces the one
 * lookup it needs to fail, so the control under test is the only variable.
 * @param overrides - lookups this source answers differently.
 * @returns the source port.
 */
function fakeSource(overrides: Partial<BoardCheckSource> = {}): BoardCheckSource {
  return {
    sku: async sku => ({
      value: { exists: sku.startsWith('ART-') }, source: 'fake.catalog', version: 'v1', readAt: NOW,
    }),
    price: async ({ sku }) => {
      const line = fixture.lines.find(entry => entry.sku === sku)
      const overcharge = OVERCHARGE[sku]
      if (line === undefined || overcharge === undefined) {
        return { value: null, source: 'fake.price', version: 'v1', readAt: NOW }
      }
      return {
        value: { listPrice: line.unitPrice - overcharge, overcharge },
        source: 'fake.price',
        version: 'v1',
        readAt: NOW,
      }
    },
    stock: async () => ({ value: { available: 10 }, source: 'fake.stock', version: 'v1', readAt: NOW }),
    orderLines: async () => ({
      value: fixture.lines.map(line => ({ sku: line.sku, quantity: line.quantity })),
      source: 'fake.order',
      version: 'v1',
      readAt: NOW,
    }),
    separation: async () => ({ value: { required: 'new' }, source: 'fake.split', version: 'v1', readAt: NOW }),
    ...overrides,
  }
}

let submitted = 0

/**
 * Submit one proforma draft and record the severity the panel needs, which is
 * the state an approval starts from.
 * @param board - the booted board.
 * @param options - artifact content and declared field origins.
 * @returns the item as the panel sees it.
 */
async function preparedDraft(
  board: BoardHarness['board'],
  options: { content?: Record<string, unknown>; fieldOrigins?: readonly BoardFieldOriginEntry[] } = {},
): Promise<FaberLoomBoardItem> {
  submitted += 1
  const item = await board.submit(ACTOR_A, {
    runId: `run-${String(submitted)}`,
    idempotencyKey: `idem-${String(submitted)}`,
    businessKey: `PF 2520-2026/${String(submitted)}`,
    title: 'PF 2520-2026 · Eguisa',
    summary: 'Proforma DDP con precios verificados.',
    evidence: [`oc:${fixture.sourceRef}`],
    artifactType: 'proforma',
    accountRef: fixture.accountRef,
    content: options.content ?? draft(),
    ...options.fieldOrigins === undefined ? {} : { fieldOrigins: options.fieldOrigins },
  })
  return await board.setSeverity(ACTOR_A, item.id, 'HIGH', 'HUMAN')
}

/**
 * The approval expectations of one item.
 * @param item - the item the caller reviewed.
 * @param extra - confirmations or overridden expectations.
 * @returns the approval input.
 */
function approval(item: FaberLoomBoardItem, extra: Partial<BoardApproveInput> = {}): BoardApproveInput {
  return {
    expectedRowVersion: item.rowVersion,
    expectedArtifactVersion: item.version,
    expectedArtifactHash: item.artifactHash ?? '',
    ...extra,
  }
}

/** Boot a board whose only controls are the real proforma ones. */
async function boardWithChecks(source: BoardCheckSource = fakeSource()): Promise<BoardHarness> {
  const harness = await bootBoard({ checks: 'none' })
  mountProformaChecks(harness.ctx, harness, source)
  return harness
}

describe('proforma controls (W-49, D-01, D-02)', () => {
  it('W-49 · a blocking control in failure rejects the approval and changes nothing', async () => {
    const harness = await boardWithChecks(fakeSource({
      price: async () => ({ value: { listPrice: 1, overcharge: 0 }, source: 'fake.price', version: 'v1', readAt: NOW }),
    }))
    const item = await preparedDraft(harness.board)

    const report = await harness.board.runChecks(ACTOR_A, item.id)
    expect(report.missing).toEqual([])
    expect(report.checks.find(check => check.id === 'proforma.price')).toMatchObject({
      class: 'bloqueante',
      result: { status: 'fail', reason: 'PRICE_MISMATCH', source: 'fake.price', sourceVersion: 'v1', checkedAt: NOW },
    })

    await expect(harness.board.approve(ACTOR_A, item.id, approval(item))).rejects.toThrow('BLOCKING_CHECK')
    expect(await harness.board.get(ACTOR_A, item.id)).toMatchObject({
      state: 'PENDIENTE_CRITERIO', rowVersion: item.rowVersion, version: 1,
    })
  })

  it('D-01 · a billed line without a price fails even when the source answers', async () => {
    const harness = await boardWithChecks()
    const lines = fixture.lines.map(line => ({ sku: line.sku, quantity: line.quantity }))
    const item = await preparedDraft(harness.board, { content: draft({ lines }) })

    const report = await harness.board.runChecks(ACTOR_A, item.id)
    expect(report.checks.find(check => check.id === 'proforma.price')).toMatchObject({
      result: { status: 'fail', reason: 'PRICE_MISSING', fields: ['lines[0].unitPrice'] },
    })
    await expect(harness.board.approve(ACTOR_A, item.id, approval(item))).rejects.toThrow('BLOCKING_CHECK')
  })

  it('D-01 · a source without the list price or the band fails the price control', async () => {
    const harness = await boardWithChecks(fakeSource({
      price: async () => ({ value: null, source: 'fake.price', version: 'v1', readAt: NOW }),
    }))
    const item = await preparedDraft(harness.board)

    const report = await harness.board.runChecks(ACTOR_A, item.id)
    expect(report.checks.find(check => check.id === 'proforma.price')).toMatchObject({
      result: { status: 'fail', reason: 'PRICE_SOURCE_MISSING' },
    })
    await expect(harness.board.approve(ACTOR_A, item.id, approval(item))).rejects.toThrow('BLOCKING_CHECK')
  })

  it('T2.13 · an unknown SKU fails the catalog control', async () => {
    const harness = await boardWithChecks(fakeSource({
      sku: async () => ({ value: { exists: false }, source: 'fake.catalog', version: 'v1', readAt: NOW }),
    }))
    const item = await preparedDraft(harness.board)

    const report = await harness.board.runChecks(ACTOR_A, item.id)
    expect(report.checks.find(check => check.id === 'proforma.sku')).toMatchObject({
      class: 'bloqueante',
      result: { status: 'fail', reason: 'SKU_UNKNOWN' },
    })
  })

  it('T2.13 · a total that differs from the line sum fails the arithmetic control', async () => {
    const harness = await boardWithChecks()
    const item = await preparedDraft(harness.board, { content: draft({ total: 1 }) })

    const report = await harness.board.runChecks(ACTOR_A, item.id)
    expect(report.checks.find(check => check.id === 'proforma.total')).toMatchObject({
      class: 'bloqueante',
      result: { status: 'fail', reason: 'TOTAL_MISMATCH', source: 'artifact' },
    })
  })

  it('D-02 · stock the source does not hold requires confirmation, and the confirmation is audited', async () => {
    const harness = await boardWithChecks(fakeSource({
      stock: async () => ({ value: null, source: 'fake.stock', version: 'v1', readAt: NOW }),
    }))
    const item = await preparedDraft(harness.board)

    const report = await harness.board.runChecks(ACTOR_A, item.id)
    expect(report.checks.find(check => check.id === 'proforma.stock')).toMatchObject({
      class: 'confirmacion',
      result: { status: 'fail', reason: 'STOCK_SOURCE_MISSING' },
    })
    await expect(harness.board.approve(ACTOR_A, item.id, approval(item))).rejects.toThrow('CHECK_CONFIRMATION_REQUIRED')
    expect((await harness.board.get(ACTOR_A, item.id)).state).toBe('PENDIENTE_CRITERIO')

    const confirmed = await harness.board.approve(ACTOR_A, item.id, approval(item, {
      confirmations: ['proforma.stock'],
    }))
    expect(confirmed.state).toBe('APROBADO')
    const data = confirmed.events.at(-1)?.data ?? {}
    expect(data['confirmed']).toEqual(['proforma.stock'])
    expect((data['checks'] as { id: string; status: string }[]).find(check => check.id === 'proforma.stock'))
      .toMatchObject({ status: 'fail' })
  })

  it('D-02 · stock below the billed quantity requires confirmation', async () => {
    const harness = await boardWithChecks(fakeSource({
      stock: async () => ({ value: { available: 1 }, source: 'fake.stock', version: 'v1', readAt: NOW }),
    }))
    const item = await preparedDraft(harness.board)

    const report = await harness.board.runChecks(ACTOR_A, item.id)
    expect(report.checks.find(check => check.id === 'proforma.stock')).toMatchObject({
      result: { status: 'fail', reason: 'STOCK_INSUFFICIENT' },
    })
    await expect(harness.board.approve(ACTOR_A, item.id, approval(item))).rejects.toThrow('CHECK_CONFIRMATION_REQUIRED')
  })

  it('T2.13 · a separation the account rule contradicts requires confirmation', async () => {
    const harness = await boardWithChecks()
    const item = await preparedDraft(harness.board, { content: draft({ separation: 'complement' }) })

    const report = await harness.board.runChecks(ACTOR_A, item.id)
    expect(report.checks.find(check => check.id === 'proforma.separation')).toMatchObject({
      class: 'confirmacion',
      result: { status: 'fail', reason: 'SEPARATION_MISMATCH', fields: ['separation'] },
    })
    await expect(harness.board.approve(ACTOR_A, item.id, approval(item))).rejects.toThrow('CHECK_CONFIRMATION_REQUIRED')
    await expect(harness.board.approve(ACTOR_A, item.id, approval(item, {
      confirmations: ['proforma.separation'],
    }))).resolves.toMatchObject({ state: 'APROBADO' })
  })
})

describe('live revalidation at approval (W-49, W-50, W-58)', () => {
  it('W-50 · a source that cannot answer counts as a failure, not as a pass', async () => {
    const harness = await boardWithChecks(fakeSource({
      price: async () => {
        throw new Error('mwt timeout')
      },
    }))
    const item = await preparedDraft(harness.board)

    const report = await harness.board.runChecks(ACTOR_A, item.id)
    expect(report.checks.find(check => check.id === 'proforma.price')).toMatchObject({
      result: { status: 'fail', reason: 'SOURCE_UNAVAILABLE', source: 'unavailable' },
    })
    await expect(harness.board.approve(ACTOR_A, item.id, approval(item))).rejects.toThrow('BLOCKING_CHECK')
    expect((await harness.board.get(ACTOR_A, item.id)).state).toBe('PENDIENTE_CRITERIO')
  })

  it('W-50 · a control mounted without a source port fails instead of passing', async () => {
    const harness = await bootBoard()
    harness.ctx.effect(
      () => harness.board.registerCheck('proforma', 'proforma.sku', () => {
        throw new Error('no source')
      }, { class: 'bloqueante' }),
      'test.checks.sku',
    )
    const item = await preparedDraft(harness.board)

    const report = await harness.board.runChecks(ACTOR_A, item.id)
    expect(report.checks.find(check => check.id === 'proforma.sku')).toMatchObject({
      result: { status: 'fail', reason: 'SOURCE_UNAVAILABLE' },
    })
  })

  it('W-58 · an edit that invalidates a blocking control makes the approval be rejected', async () => {
    const harness = await boardWithChecks()
    const item = await preparedDraft(harness.board)
    const before = await harness.board.runChecks(ACTOR_A, item.id)
    expect(before.checks.every(check => check.result.status === 'ok')).toBe(true)

    const edited = await harness.board.saveEdits(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion,
      baseVersion: item.version,
      changes: {
        lines: [
          { sku: 'ART-04-271897', description: 'Repuesto hidráulico', quantity: 5, unitPrice: 120.5 },
          { sku: 'ART-04-271898', description: 'Kit de sellos', quantity: 1, unitPrice: 45 },
        ],
        total: 647.5,
      },
    })
    const report = await harness.board.runChecks(ACTOR_A, edited.id)
    expect(report.checks.find(check => check.id === 'proforma.quantity')).toMatchObject({
      result: { status: 'fail', reason: 'QUANTITY_MISMATCH' },
    })

    await expect(harness.board.approve(ACTOR_A, edited.id, approval(edited))).rejects.toThrow('BLOCKING_CHECK')
    expect(await harness.board.get(ACTOR_A, edited.id)).toMatchObject({
      state: 'PENDIENTE_CRITERIO', version: 2, rowVersion: edited.rowVersion,
    })

    const fixed = await harness.board.saveEdits(ACTOR_A, edited.id, {
      expectedRowVersion: edited.rowVersion,
      baseVersion: edited.version,
      changes: { lines: draft()['lines'], total: fixture.total },
    })
    await expect(harness.board.approve(ACTOR_A, fixed.id, approval(fixed))).resolves.toMatchObject({ state: 'APROBADO' })
  })

  it('W-50 · approveWithEdits evaluates the controls against the edited content', async () => {
    const harness = await boardWithChecks()
    const item = await preparedDraft(harness.board)

    await expect(harness.board.approveWithEdits(ACTOR_A, item.id, {
      ...approval(item),
      baseVersion: item.version,
      changes: { total: 1 },
    })).rejects.toThrow('BLOCKING_CHECK')
    expect(await harness.board.get(ACTOR_A, item.id)).toMatchObject({
      state: 'PENDIENTE_CRITERIO', version: 1, rowVersion: item.rowVersion,
    })
  })

  it('W-49 · a declared control with no adapter refuses the approval', async () => {
    const harness = await bootBoard({ checks: 'none' })
    expect(harness.board.checkStatus('proforma')).toHaveLength(PROFORMA_CHECKS.length)
    expect(harness.board.checkStatus('proforma').every(entry => !entry.registered)).toBe(true)
    const item = await preparedDraft(harness.board)

    await expect(harness.board.approve(ACTOR_A, item.id, approval(item))).rejects.toThrow('CHECK_UNAVAILABLE')
    expect((await harness.board.get(ACTOR_A, item.id)).state).toBe('PENDIENTE_CRITERIO')
  })

  it('W-49 · the registry refuses an undeclared control and a class D-8 did not sign', async () => {
    const harness = await bootBoard({ checks: 'none' })
    const check: BoardCheckFn = () => ({ status: 'ok', source: 'test', sourceVersion: null, checkedAt: NOW, fields: [] })

    expect(() => harness.board.registerCheck('proforma', 'proforma.inventada', check, { class: 'bloqueante' }))
      .toThrow('CHECK_UNKNOWN')
    expect(() => harness.board.registerCheck('proforma', 'proforma.stock', check, { class: 'bloqueante' }))
      .toThrow('CHECK_CLASS_MISMATCH')
  })

  it('W-49 · disposing the effect that mounted a control removes it from the registry', async () => {
    const harness = await bootBoard({ checks: 'none' })
    const failing: BoardCheckFn = () => ({
      status: 'fail', source: 'test', sourceVersion: null, checkedAt: NOW, fields: [], reason: 'PRICE_MISMATCH',
    })
    const dispose = harness.ctx.effect(
      () => harness.board.registerCheck('proforma', 'proforma.price', failing, { class: 'bloqueante' }),
      'test.checks.price',
    )
    const item = await preparedDraft(harness.board)
    expect(harness.board.checkStatus('proforma').find(entry => entry.id === 'proforma.price')).toMatchObject({
      registered: true,
    })

    await dispose()
    expect(harness.board.checkStatus('proforma').find(entry => entry.id === 'proforma.price')).toMatchObject({
      registered: false,
    })
    await expect(harness.board.approve(ACTOR_A, item.id, approval(item))).rejects.toThrow('CHECK_UNAVAILABLE')
  })
})

describe('field origin of the draft (W-36)', () => {
  it('W-36 · every editable field is linked to its source or marked without origin', async () => {
    const harness = await bootBoard()
    const item = await preparedDraft(harness.board, {
      fieldOrigins: [{ field: 'lines[0].unitPrice', source: 'mwt.unit_price', ref: 'ART-04-271897', at: NOW }],
    })

    expect(item.fieldOrigins.map(entry => entry.field)).toEqual(fieldPaths(item.content))
    expect(item.fieldOrigins.find(entry => entry.field === 'lines[0].unitPrice')).toEqual({
      field: 'lines[0].unitPrice', source: 'mwt.unit_price', ref: 'ART-04-271897', at: NOW,
    })
    expect(item.fieldOrigins.find(entry => entry.field === 'total')).toEqual({
      field: 'total', source: null, ref: null, at: null,
    })
  })

  it('W-36 · an edit drops the origin of the fields it rewrote', async () => {
    const harness = await bootBoard()
    const item = await preparedDraft(harness.board, {
      fieldOrigins: [
        { field: 'lines[0].unitPrice', source: 'mwt.unit_price', ref: 'ART-04-271897', at: NOW },
        { field: 'total', source: 'mwt.total', ref: 'PF 2520-2026', at: NOW },
      ],
    })

    const edited = await harness.board.saveEdits(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion,
      baseVersion: item.version,
      changes: { lines: draft()['lines'] },
    })
    expect(edited.fieldOrigins.find(entry => entry.field === 'lines[0].unitPrice')).toEqual({
      field: 'lines[0].unitPrice', source: null, ref: null, at: null,
    })
    expect(edited.fieldOrigins.find(entry => entry.field === 'total')).toMatchObject({ source: 'mwt.total' })
  })
})
