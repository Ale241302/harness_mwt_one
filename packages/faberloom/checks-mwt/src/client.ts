/**
 * The MCP-backed `MwtCheckClient`: the MWT.ONE reads the adapter needs, issued
 * through an injected tool call so the transport stays outside the check logic
 * (ADR-003).
 *
 * Tool names and response fields follow the answers recorded from the live
 * server (`mwt-one 1.30.0`, `.artifacts/mwt-shapes.md`). `expediente_lineas`
 * takes the reference itself: the server resolves the proforma, OC, SAP, or
 * `EXP-` code to its internal id and answers the lines. A read returns `null`
 * rather than a default when the server omits the datum: that is what keeps
 * D-01's blocking failure and D-02's required confirmation honest.
 *
 * @module @deepseek-ai/dsh-faberloom-checks-mwt/client
 */

import {
  bandRecord,
  idField,
  isEmptyAnswer,
  isRecord,
  jsonPayload,
  lineRecords,
  numberField,
  pageRows,
  productRows,
  searchMatches,
  stockRecords,
  stringField,
  stringListField,
} from './wire.ts'
import type { MwtCheckClient, MwtExpedienteFacts, MwtOrderLine, MwtToolCall, MwtToolName } from './types.ts'
import type { WirePage, WireRow } from './wire.ts'

/** Product fields carrying the catalog SKU. */
const SKU_FIELDS = ['sku'] as const
/** Product fields carrying the product identity. */
const PRODUCT_ID_FIELDS = ['id'] as const
/** Product fields carrying the catalog price. */
const CATALOG_PRICE_FIELDS = ['precio_venta'] as const
/** Product fields carrying the currency the catalog prices in. */
const CURRENCY_FIELDS = ['moneda'] as const
/** Expediente row fields listing the proforma codes it answers. */
const PROFORMA_CODE_FIELDS = ['proforma_codigos'] as const
/** Expediente row fields listing the purchase-order codes it answers. */
const OC_CODE_FIELDS = ['oc_codigos'] as const
/** Stock fields carrying the SKU of the row. */
const STOCK_SKU_FIELDS = ['producto_sku'] as const
/** Stock fields carrying units available. */
const STOCK_FIELDS = ['cantidad_disponible'] as const
/** Band field carrying the band identity. */
const BAND_ID_FIELDS = ['id'] as const
/** Band answer field carrying the payment term. */
const PAYMENT_DAYS_FIELDS = ['plazo_dias'] as const
/** Line fields carrying the SKU. */
const LINE_SKU_FIELDS = ['sku'] as const
/** Line fields carrying the size. */
const LINE_SIZE_FIELDS = ['size'] as const
/** Line fields carrying the billed quantity. */
const LINE_QTY_FIELDS = ['qty'] as const
/** Line fields carrying the price MWT.ONE charges. */
const LINE_MWT_PRICE_FIELDS = ['unit_price_mwt'] as const
/** Line fields carrying the price the client is billed. */
const LINE_CLIENT_PRICE_FIELDS = ['unit_price_client'] as const

/** Rows requested per `expediente_listar` page. */
const EXPEDIENTE_PAGE_LIMIT = 50
/** Pages read before one reference is reported unresolved; 2 000 rows. */
const EXPEDIENTE_MAX_PAGES = 40
/** Largest page `stock_listar` accepts, per the inventory skill. */
const STOCK_PAGE_LIMIT = 200
/** Product rows read to find one exact SKU. */
const PRODUCT_PROBE_LIMIT = 10

/** Canonical proforma code prefix, so the existence probe picks the right argument. */
const PROFORMA_REFERENCE = /^PF[\s-]/i
/** Display prefix on a purchase-order code; `expediente_buscar` takes the number. */
const OC_PREFIX = /^(?:PO|OC)[\s-]+/i

/**
 * Fold one code to the form codes compare in.
 * @param value - code the server or the draft states.
 * @returns the trimmed, upper-cased code.
 */
function normalise(value: string): string {
  return value.trim().toUpperCase()
}

/**
 * Read one MWT.ONE tool's JSON payload.
 * @param call - the tool call.
 * @param tool - raw tool name.
 * @param args - arguments the tool accepts.
 * @returns the parsed payload.
 */
async function read(call: MwtToolCall, tool: MwtToolName, args: Record<string, unknown>): Promise<unknown> {
  return jsonPayload(await call(tool, args))
}

/**
 * The arguments an existence probe accepts for one reference. `expediente_buscar`
 * takes either an `oc_number` or a `proforma`, not both; the purchase-order
 * argument is the number without its `PO`/`OC` display prefix.
 * @param reference - reference the draft answers.
 * @returns the argument object.
 */
function probeArgs(reference: string): Record<string, unknown> {
  if (PROFORMA_REFERENCE.test(reference)) return { proforma: reference }
  return { oc_number: reference.replace(OC_PREFIX, '') }
}

/**
 * Whether one expediente row answers the reference under its proforma or its
 * purchase-order codes.
 * @param row - expediente row from `expediente_listar`.
 * @param wanted - normalised reference.
 * @returns true when one of the two code lists names the reference.
 */
function referencesExpediente(row: WireRow, wanted: string): boolean {
  for (const fields of [PROFORMA_CODE_FIELDS, OC_CODE_FIELDS]) {
    const codes = stringListField(row, fields)
    if (codes !== null && codes.some(code => normalise(code) === wanted)) return true
  }
  return false
}

/**
 * Read one page of `expediente_listar`.
 * @param call - the tool call.
 * @param offset - rows to skip.
 * @returns the page, or null when the answer cannot be read.
 */
async function readExpedientePage(call: MwtToolCall, offset: number): Promise<WirePage | null> {
  return pageRows(await read(call, 'expediente_listar', { limit: EXPEDIENTE_PAGE_LIMIT, offset }))
}

/**
 * Resolve one reference to the expediente row that answers it. The search tool
 * is only an existence probe: it carries no identity, so the row is found by
 * paging `expediente_listar` and matching the code lists.
 * @param call - the tool call.
 * @param reference - reference the draft answers.
 * @returns the single matching row, or null when none or several match.
 */
async function resolveExpediente(call: MwtToolCall, reference: string): Promise<WireRow | null> {
  const probe = searchMatches(await read(call, 'expediente_buscar', probeArgs(reference)))
  if (probe !== null && probe.exists === false) return null

  const wanted = normalise(reference)
  let match: WireRow | null = null
  let offset = 0
  let finished = false
  for (let page = 0; page < EXPEDIENTE_MAX_PAGES; page += 1) {
    const current = await readExpedientePage(call, offset)
    if (current === null) return null
    for (const row of current.rows) {
      if (!referencesExpediente(row, wanted)) continue
      // Two rows naming the same reference leave it unresolved instead of
      // choosing one: the price control must never compare against a guess.
      if (match !== null) return null
      match = row
    }
    // A short page or a reached count ends the listing. Without either the
    // answer cannot prove there is another page, so one page is all that is read.
    const shortPage = current.limit !== null && current.rows.length < current.limit
    const complete = current.count !== null && offset + current.rows.length >= current.count
    if (current.rows.length === 0 || shortPage || complete) {
      finished = true
      break
    }
    if (current.count === null && current.limit === null) {
      finished = true
      break
    }
    offset += current.rows.length
  }
  // A truncated listing cannot prove the match is the only one.
  return finished ? match : null
}

/**
 * The totals one expediente row states.
 * @param reference - reference the caller asked for.
 * @param row - matching expediente row.
 * @returns the facts; a side the row omits stays null.
 */
function expedienteFacts(reference: string, row: WireRow): MwtExpedienteFacts {
  return {
    reference,
    totalClient: numberField(row, ['total_client']),
    totalMwt: numberField(row, ['total_mwt']),
    currency: stringField(row, CURRENCY_FIELDS),
    clientName: stringField(row, ['client_name']),
    creditDays: numberField(row, ['credit_days_cliente']),
    creditBand: idField(row, ['credit_band']),
  }
}

/**
 * The facts of one `expediente_lineas` row.
 * @param row - line row.
 * @returns the line, or null when the row states no SKU or no readable quantity.
 */
function orderLineFacts(row: WireRow): MwtOrderLine | null {
  const sku = stringField(row, LINE_SKU_FIELDS)
  const quantity = numberField(row, LINE_QTY_FIELDS)
  // A row without a SKU or a quantity cannot be attributed to a billed line, so
  // it is unusable instead of being skipped.
  if (sku === null || quantity === null) return null
  return {
    sku,
    size: stringField(row, LINE_SIZE_FIELDS),
    quantity,
    unitPriceMwt: numberField(row, LINE_MWT_PRICE_FIELDS),
    unitPriceClient: numberField(row, LINE_CLIENT_PRICE_FIELDS),
  }
}

/** The facts of one exact catalog row. */
interface ProductFacts {
  /** Product identity the row carries, or null. */
  readonly id: string | null
  /** `precio_venta`, or null when the row states none. */
  readonly price: number | null
  /** Currency the row states, or null. */
  readonly currency: string | null
}

/**
 * Find the catalog row whose SKU equals the billed SKU.
 * @param call - the tool call.
 * @param sku - billed SKU.
 * @returns the row's facts, or null when the catalog holds no exact match.
 */
async function findProduct(call: MwtToolCall, sku: string): Promise<ProductFacts | null> {
  const payload = await read(call, 'producto_buscar', { q: sku, limit: PRODUCT_PROBE_LIMIT })
  const rows = productRows(payload)
  if (rows === null) return null
  const wanted = normalise(sku)
  for (const row of rows) {
    const found = stringField(row, SKU_FIELDS)
    if (found === null || normalise(found) !== wanted) continue
    const id = idField(row, PRODUCT_ID_FIELDS)
    return {
      id: id === null ? null : String(id),
      price: numberField(row, CATALOG_PRICE_FIELDS),
      currency: stringField(row, CURRENCY_FIELDS),
    }
  }
  return null
}

/**
 * Build the MWT.ONE client over one tool call.
 * @param call - performs one MWT.ONE tool call and returns its canonical MCP value.
 * @returns the reads the proforma controls and the price facts consume.
 */
export function mcpMwtCheckClient(call: MwtToolCall): MwtCheckClient {
  return {
    async expediente(reference) {
      const row = await resolveExpediente(call, reference)
      return row === null ? null : expedienteFacts(reference, row)
    },

    async orderLines(reference) {
      const rows = lineRecords(await call('expediente_lineas', { expediente_id: reference }))
      if (rows === null) return null
      const lines: MwtOrderLine[] = []
      for (const row of rows) {
        const line = orderLineFacts(row)
        // One unattributable row leaves the answer unusable: comparing against
        // the rows that happen to parse would price a partial order.
        if (line === null) return null
        lines.push(line)
      }
      // An answer that carries no line states no quantity and no price at all.
      return lines.length === 0 ? null : lines
    },

    async skuExists(sku) {
      return (await findProduct(call, sku)) !== null
    },

    async stockAvailable(sku) {
      const product = await findProduct(call, sku)
      // An unknown SKU has no inventory record; the stock control treats that as
      // missing data and asks for confirmation (D-02).
      if (product === null) return null
      const value = await call('stock_listar', {
        producto: product.id ?? sku,
        solo_disponible: true,
        limit: STOCK_PAGE_LIMIT,
      })
      // A query restricted to available stock that carries no record states zero
      // available units, not a failed read.
      const records = isEmptyAnswer(value) ? [] : stockRecords(jsonPayload(value))
      if (records === null) return null
      const wanted = normalise(sku)
      const own = records.filter((row) => {
        const found = stringField(row, STOCK_SKU_FIELDS)
        return found === null || normalise(found) === wanted
      })
      // Records for other SKUs only mean the filter was not applied; the answer
      // states nothing about this SKU.
      if (records.length > 0 && own.length === 0) return null
      let total = 0
      for (const row of own) {
        const available = numberField(row, STOCK_FIELDS)
        // A record without a readable quantity leaves the whole answer unusable:
        // summing the rest would understate what is available.
        if (available === null) return null
        total += available
      }
      // A query restricted to available stock that lists no record reports zero
      // available units, which is a real answer, not missing data.
      return total
    },

    async priceBand(sku) {
      const payload = await read(call, 'producto_precio_cliente', { sku })
      const band = bandRecord(payload)
      const paymentDays = isRecord(payload) ? numberField(payload, PAYMENT_DAYS_FIELDS) : null
      // Neither fact means the read states no condition for this SKU.
      if (band === null && paymentDays === null) return null
      return { bandId: band === null ? null : idField(band, BAND_ID_FIELDS), paymentDays }
    },

    async catalogPrice(sku) {
      const product = await findProduct(call, sku)
      if (product === null || product.price === null) return null
      return { price: product.price, currency: product.currency }
    },
  }
}
