/**
 * The check port of the Mesa: the controls D-8 signs for each artifact type,
 * the source port a check adapter fills, and the proforma controls themselves
 * (spec §9.6, D-01, D-02). Nothing here imports an adapter, a tool host, or a
 * model: the board owns the registry and the invocation (ADR-003).
 * @module @deepseek-ai/dsh-faberloom-board/src/checks
 */

import { isContentRecord } from './projection.ts'
import type {
  BoardArtifact,
  BoardCheckDefinition,
  BoardCheckFn,
  BoardCheckInput,
  BoardCheckRegistrar,
  BoardCheckResult,
  BoardCheckSource,
  BoardCheckStatus,
  BoardCheckClass,
  FaberLoomBoardItem,
} from './types.ts'

/** Version of the declared controls and their classes; a change needs a new version (D-8). */
export const CHECKS_VERSION = '2026-10-28.1'

/** Artifact type the proforma controls apply to. */
export const PROFORMA_ARTIFACT = 'proforma'

/** D-01: the per-line overcharge the draft bills equals the one the order records. */
const PRICE_CHECK: BoardCheckDefinition = { id: 'proforma.price', class: 'bloqueante' }
/** The catalog knows every billed SKU. */
const SKU_CHECK: BoardCheckDefinition = { id: 'proforma.sku', class: 'bloqueante' }
/** Billed quantities equal the purchase order (spec §9.6). */
const QUANTITY_CHECK: BoardCheckDefinition = { id: 'proforma.quantity', class: 'bloqueante' }
/** The line sum equals the billed total. */
const TOTAL_CHECK: BoardCheckDefinition = { id: 'proforma.total', class: 'bloqueante' }
/** Available stock covers every billed quantity (D-02). */
const STOCK_CHECK: BoardCheckDefinition = { id: 'proforma.stock', class: 'confirmacion' }
/** The draft is a complement letter or a new proforma, as the account rule requires. */
const SEPARATION_CHECK: BoardCheckDefinition = { id: 'proforma.separation', class: 'confirmacion' }

/** Controls D-8 signs for a proforma, in display order. */
export const PROFORMA_CHECKS: readonly BoardCheckDefinition[] = [
  PRICE_CHECK, SKU_CHECK, QUANTITY_CHECK, TOTAL_CHECK, STOCK_CHECK, SEPARATION_CHECK,
]

/**
 * Controls declared per artifact type. An artifact type absent here requires no
 * control, so the empty registry approves it as before; a declared control with
 * no registration refuses approval with `CHECK_UNAVAILABLE`.
 */
export const DECLARED_CHECKS: Readonly<Record<string, readonly BoardCheckDefinition[]>> = {
  [PROFORMA_ARTIFACT]: PROFORMA_CHECKS,
}

/**
 * The controls one artifact type requires.
 * @param artifactType - artifact type of the item.
 * @returns the declared controls, empty when the type declares none.
 */
export function declaredChecks(artifactType: string): readonly BoardCheckDefinition[] {
  return DECLARED_CHECKS[artifactType] ?? []
}

/**
 * The signed class of one declared control.
 * @param artifactType - artifact type of the item.
 * @param checkId - control id.
 * @returns the class, or undefined when the pair is not declared.
 */
export function checkClass(artifactType: string, checkId: string): BoardCheckClass | undefined {
  return declaredChecks(artifactType).find(definition => definition.id === checkId)?.class
}

/**
 * The registry key of one control.
 * @param artifactType - artifact type of the item.
 * @param checkId - control id.
 * @returns the key the registry stores the implementation under.
 */
export function checkKey(artifactType: string, checkId: string): string {
  return `${artifactType}\u0000${checkId}`
}

/**
 * The artifact one item revision presents to the checks.
 * @param item - the item as the panel sees it.
 * @returns its type, version, and editable content.
 */
export function artifactOf(item: Pick<FaberLoomBoardItem, 'artifactType' | 'version' | 'content'>): BoardArtifact {
  return { type: item.artifactType, version: item.version, content: item.content }
}

/** One billed line as the draft holds it, tolerant of a field the human left empty. */
interface DraftLine {
  /** Zero-based position, used to name the field path of the result. */
  readonly index: number
  /** Billed SKU, or an empty string when the draft names none. */
  readonly sku: string
  /** Billed quantity, or undefined when the draft has none. */
  readonly quantity: number | undefined
  /** Billed unit price, or undefined when the draft has none. */
  readonly unitPrice: number | undefined
}

/** The finite number a content value holds, or undefined. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * The billed lines of one content record, read without rejecting an incomplete
 * line: a control reports which field is missing instead.
 * @param content - the artifact content.
 * @returns the lines, or undefined when the content declares no line array.
 */
function draftLines(content: Readonly<Record<string, unknown>>): readonly DraftLine[] | undefined {
  const raw = content['lines']
  if (!Array.isArray(raw)) return undefined
  return raw.map((entry, index) => {
    const record = isContentRecord(entry) ? entry : {}
    const sku = record['sku']
    return {
      index,
      sku: typeof sku === 'string' ? sku : '',
      quantity: finiteNumber(record['quantity']),
      unitPrice: finiteNumber(record['unitPrice']),
    }
  })
}

/** Rounds a money value to cents, so a float sum compares against a billed total. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** The freshness record of the last source read of one control. */
interface Freshness {
  /** Source identifier the answer carried. */
  readonly source: string
  /** Version the answer carried. */
  readonly version: string | null
  /** Read instant the answer carried. */
  readonly readAt: string
}

/** The artifact field path of one line value. */
function lineField(line: DraftLine, field: 'sku' | 'quantity' | 'unitPrice'): string {
  return `lines[${line.index}].${field}`
}

/** Build one result. */
function report(input: {
  readonly status: BoardCheckStatus
  readonly source: string
  readonly sourceVersion: string | null
  readonly checkedAt: string
  readonly fields: readonly string[]
  readonly reason: string | null
}): BoardCheckResult {
  return {
    status: input.status,
    source: input.source,
    sourceVersion: input.sourceVersion,
    checkedAt: input.checkedAt,
    fields: input.fields,
    reason: input.reason,
  }
}

/**
 * A failure the control proves from the artifact alone, with no source read.
 * @param fields - field paths the failure applies to.
 * @param reason - stable reason code.
 * @returns the result.
 */
function artifactFailure(fields: readonly string[], reason: string): BoardCheckResult {
  return report({
    status: 'fail', source: 'artifact', sourceVersion: null, checkedAt: new Date().toISOString(), fields, reason,
  })
}

/**
 * A failure the source answered, or a source answer the control rejects.
 * @param freshness - the last read, or undefined before the first one.
 * @param fields - field paths the failure applies to.
 * @param reason - stable reason code.
 * @returns the result.
 */
function sourceFailure(freshness: Freshness | undefined, fields: readonly string[], reason: string): BoardCheckResult {
  return report({
    status: 'fail',
    source: freshness?.source ?? 'artifact',
    sourceVersion: freshness?.version ?? null,
    checkedAt: freshness?.readAt ?? new Date().toISOString(),
    fields,
    reason,
  })
}

/**
 * A passing control.
 * @param freshness - the last read, or undefined when the control read no source.
 * @param fields - field paths the control covers.
 * @returns the result.
 */
function passed(freshness: Freshness | undefined, fields: readonly string[]): BoardCheckResult {
  return report({
    status: 'ok',
    source: freshness?.source ?? 'artifact',
    sourceVersion: freshness?.version ?? null,
    checkedAt: freshness?.readAt ?? new Date().toISOString(),
    fields,
    reason: null,
  })
}

/**
 * The source port of one registration. A check that needs a source and has none
 * throws, and the board turns that into a `fail`: a control with no way to look
 * up its datum never passes (D-01, D-02).
 * @param input - the check input.
 * @returns the registered source port.
 */
function requireSource(input: BoardCheckInput): BoardCheckSource {
  if (input.source === undefined) {
    throw new Error('faberloom: CHECK_SOURCE_UNAVAILABLE — the registration carries no source port')
  }
  return input.source
}

/** The freshness of one source answer. */
function freshnessOf(answer: { readonly source: string; readonly version: string | null; readonly readAt: string }): Freshness {
  return { source: answer.source, version: answer.version, readAt: answer.readAt }
}

/**
 * Price control: D-01's per-line overcharge. For every billed line, the price
 * the client is billed minus the price MWT.ONE charges (`unit_price_client -
 * unit_price_mwt`) must equal the overcharge the draft bills for that line
 * (`unitPrice - unit_price_mwt`) at cent precision. When the expediente also
 * states both order-total sides, the billed total must equal `total_client` as
 * a second, independent assertion.
 *
 * A billed line the order does not carry, a line whose price side is missing,
 * or an unreadable billed price fails: D-01 does not allow an approval on
 * absent price data.
 * @param input - item, artifact, and source port.
 * @returns the control result.
 */
async function priceCheck(input: BoardCheckInput): Promise<BoardCheckResult> {
  const lines = draftLines(input.artifact.content)
  if (lines === undefined || lines.length === 0) return artifactFailure(['lines'], 'LINES_MISSING')
  const priced: { readonly line: DraftLine; readonly unitPrice: number }[] = []
  for (const line of lines) {
    if (line.sku.length === 0) return artifactFailure([lineField(line, 'sku')], 'SKU_MISSING')
    if (line.unitPrice === undefined) return artifactFailure([lineField(line, 'unitPrice')], 'PRICE_MISSING')
    priced.push({ line, unitPrice: line.unitPrice })
  }
  const orderRef = input.artifact.content['orderRef']
  if (typeof orderRef !== 'string' || orderRef.length === 0) return artifactFailure(['orderRef'], 'ORDER_REF_MISSING')
  const total = finiteNumber(input.artifact.content['total'])
  if (total === undefined) return artifactFailure(['total'], 'TOTAL_MISSING')
  const source = requireSource(input)
  const answer = await source.orderLines(orderRef)
  const freshness = freshnessOf(answer)
  const priceFields = priced.map(entry => lineField(entry.line, 'unitPrice'))
  // No readable line leaves the per-line overcharge unprovable, so the control
  // fails instead of comparing the order totals it does have.
  if (answer.value === null) return sourceFailure(freshness, priceFields, 'PRICE_SOURCE_MISSING')

  for (const { line, unitPrice } of priced) {
    const field = lineField(line, 'unitPrice')
    const candidates = answer.value.filter(candidate => candidate.sku === line.sku)
    // A billed line the order does not carry leaves this price unprovable.
    if (candidates.length === 0) return sourceFailure(freshness, [field], 'PRICE_SOURCE_MISSING')
    for (const candidate of candidates) {
      // Every line the order states for the SKU must carry both price sides.
      if (candidate.unitPriceMwt === null || candidate.unitPriceClient === null) {
        return sourceFailure(freshness, [field], 'PRICE_SOURCE_MISSING')
      }
      const recorded = round2(candidate.unitPriceClient - candidate.unitPriceMwt)
      const billed = round2(unitPrice - candidate.unitPriceMwt)
      if (recorded !== billed) return sourceFailure(freshness, [field], 'PRICE_MISMATCH')
    }
  }

  const totals = await source.orderTotals(orderRef)
  if (totals.value !== null && round2(total) !== round2(totals.value.totalClient)) {
    return sourceFailure(freshnessOf(totals), ['orderRef', 'total'], 'PRICE_MISMATCH')
  }
  return passed(freshness, ['orderRef', ...priceFields])
}

/**
 * SKU control: the catalog knows every billed SKU.
 * @param input - item, artifact, and source port.
 * @returns the control result.
 */
async function skuCheck(input: BoardCheckInput): Promise<BoardCheckResult> {
  const lines = draftLines(input.artifact.content)
  if (lines === undefined || lines.length === 0) return artifactFailure(['lines'], 'LINES_MISSING')
  const source = requireSource(input)
  let freshness: Freshness | undefined
  for (const line of lines) {
    const field = lineField(line, 'sku')
    if (line.sku.length === 0) return artifactFailure([field], 'SKU_MISSING')
    const answer = await source.sku(line.sku)
    freshness = freshnessOf(answer)
    if (answer.value === null || !answer.value.exists) return sourceFailure(freshness, [field], 'SKU_UNKNOWN')
  }
  return passed(freshness, lines.map(line => lineField(line, 'sku')))
}

/**
 * Quantity control: the draft bills exactly the quantities of the purchase
 * order it answers (spec §9.6). The source states one line per SKU and size, so
 * its quantities are summed per SKU; the artifact states no size, so the
 * comparison is the per-SKU total. A missing order reference, an order the
 * source does not hold, a SKU present on only one side, or a differing quantity
 * fails, because the control cannot prove equality.
 * @param input - item, artifact, and source port.
 * @returns the control result.
 */
async function quantityCheck(input: BoardCheckInput): Promise<BoardCheckResult> {
  const lines = draftLines(input.artifact.content)
  if (lines === undefined || lines.length === 0) return artifactFailure(['lines'], 'LINES_MISSING')
  const orderRef = input.artifact.content['orderRef']
  if (typeof orderRef !== 'string' || orderRef.length === 0) return artifactFailure(['orderRef'], 'ORDER_REF_MISSING')
  const source = requireSource(input)
  const answer = await source.orderLines(orderRef)
  const freshness = freshnessOf(answer)
  if (answer.value === null) return sourceFailure(freshness, ['lines'], 'ORDER_SOURCE_MISSING')

  const billed = new Map<string, number>()
  for (const line of lines) {
    if (line.sku.length === 0) return artifactFailure([lineField(line, 'sku')], 'SKU_MISSING')
    if (line.quantity === undefined) return artifactFailure([lineField(line, 'quantity')], 'QUANTITY_MISSING')
    billed.set(line.sku, (billed.get(line.sku) ?? 0) + line.quantity)
  }
  // One line per SKU and size: summing them per SKU is what the draft bills,
  // because the artifact carries no size dimension.
  const ordered = new Map<string, number>()
  for (const line of answer.value) ordered.set(line.sku, (ordered.get(line.sku) ?? 0) + line.quantity)
  const fields = lines.map(line => lineField(line, 'quantity'))
  for (const [sku, quantity] of billed) {
    const recorded = ordered.get(sku)
    if (recorded === undefined) return sourceFailure(freshness, fields, 'ORDER_LINE_MISSING')
    if (recorded !== quantity) return sourceFailure(freshness, fields, 'QUANTITY_MISMATCH')
  }
  for (const sku of ordered.keys()) {
    if (!billed.has(sku)) return sourceFailure(freshness, fields, 'ORDER_LINE_MISSING')
  }
  return passed(freshness, fields)
}

/**
 * Total control: the sum of the billed lines equals the billed total. The
 * control reads the artifact alone, so no source is involved.
 * @param input - item and artifact.
 * @returns the control result.
 */
function totalCheck(input: BoardCheckInput): BoardCheckResult {
  const lines = draftLines(input.artifact.content)
  if (lines === undefined || lines.length === 0) return artifactFailure(['lines'], 'LINES_MISSING')
  let sum = 0
  for (const line of lines) {
    if (line.quantity === undefined) return artifactFailure([lineField(line, 'quantity')], 'QUANTITY_MISSING')
    if (line.unitPrice === undefined) return artifactFailure([lineField(line, 'unitPrice')], 'PRICE_MISSING')
    sum += line.quantity * line.unitPrice
  }
  const total = finiteNumber(input.artifact.content['total'])
  if (total === undefined) return artifactFailure(['total'], 'TOTAL_MISSING')
  if (round2(sum) !== round2(total)) return artifactFailure(['total', 'lines'], 'TOTAL_MISMATCH')
  return passed(undefined, ['lines', 'total'])
}

/**
 * Stock control: available stock covers every billed quantity. A SKU the source
 * does not hold, or a source that cannot answer, leaves the control in failure,
 * and D-02 turns that failure into a required confirmation, never a silent
 * approval.
 * @param input - item, artifact, and source port.
 * @returns the control result.
 */
async function stockCheck(input: BoardCheckInput): Promise<BoardCheckResult> {
  const lines = draftLines(input.artifact.content)
  if (lines === undefined || lines.length === 0) return artifactFailure(['lines'], 'LINES_MISSING')
  const source = requireSource(input)
  let freshness: Freshness | undefined
  for (const line of lines) {
    if (line.sku.length === 0) return artifactFailure([lineField(line, 'sku')], 'SKU_MISSING')
    if (line.quantity === undefined) return artifactFailure([lineField(line, 'quantity')], 'QUANTITY_MISSING')
    const field = lineField(line, 'quantity')
    const answer = await source.stock(line.sku)
    freshness = freshnessOf(answer)
    if (answer.value === null) return sourceFailure(freshness, [field], 'STOCK_SOURCE_MISSING')
    if (answer.value.available < line.quantity) return sourceFailure(freshness, [field], 'STOCK_INSUFFICIENT')
  }
  return passed(freshness, lines.map(line => lineField(line, 'quantity')))
}

/**
 * Separation control: the draft states whether it is a complement letter or a
 * new proforma, and the account rule agrees. An undeclared mode, a missing rule,
 * or a disagreement requires confirmation.
 * @param input - item, artifact, and source port.
 * @returns the control result.
 */
async function separationCheck(input: BoardCheckInput): Promise<BoardCheckResult> {
  const declared = input.artifact.content['separation']
  if (declared !== 'complement' && declared !== 'new') {
    return artifactFailure(['separation'], 'SEPARATION_UNDECLARED')
  }
  const accountRef = input.item.accountRef
  if (accountRef === null) return artifactFailure(['accountRef'], 'ACCOUNT_MISSING')
  const source = requireSource(input)
  const answer = await source.separation({ accountRef, businessKey: input.item.businessKey })
  const freshness = freshnessOf(answer)
  if (answer.value === null) return sourceFailure(freshness, ['separation'], 'SEPARATION_SOURCE_MISSING')
  if (answer.value.required !== declared) return sourceFailure(freshness, ['separation'], 'SEPARATION_MISMATCH')
  return passed(freshness, ['separation'])
}

/**
 * Register the six proforma controls of D-8 on one board. An adapter calls this
 * from `ctx.effect`, the same way the handlers package mounts its handlers, so
 * disposing the fiber removes every control.
 * @param board - the board service the controls register on.
 * @param source - source port the adapter fills with its own calls.
 * @returns the disposer that removes every control it registered.
 */
export function registerProformaChecks(board: BoardCheckRegistrar, source: BoardCheckSource): () => void {
  const checks: readonly { readonly definition: BoardCheckDefinition; readonly fn: BoardCheckFn }[] = [
    { definition: PRICE_CHECK, fn: priceCheck },
    { definition: SKU_CHECK, fn: skuCheck },
    { definition: QUANTITY_CHECK, fn: quantityCheck },
    { definition: TOTAL_CHECK, fn: totalCheck },
    { definition: STOCK_CHECK, fn: stockCheck },
    { definition: SEPARATION_CHECK, fn: separationCheck },
  ]
  const disposers = checks.map(check => board.registerCheck(
    PROFORMA_ARTIFACT, check.definition.id, check.fn, { class: check.definition.class, source },
  ))
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
