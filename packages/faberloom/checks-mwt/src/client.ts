/**
 * The MCP-backed `MwtCheckClient`: the five MWT.ONE reads the proforma controls
 * need, issued through an injected tool call so the transport stays outside the
 * check logic (ADR-003).
 *
 * Tool names come from the MWT.ONE catalogue in `skills-catalog` (`expedientes`,
 * `productos`, `clientes`, `inventario`); the payload fields follow the names
 * those skills and the business rules use. MWT.ONE ships no response contract to
 * this repository, so each read accepts documented aliases and returns `null`
 * rather than a default when none is present. A null price fails the blocking
 * control and a null stock figure requires confirmation, which is what D-01 and
 * D-02 ask for.
 *
 * @module @deepseek-ai/dsh-faberloom-checks-mwt/client
 */

import { fieldEquals, idField, jsonPayload, numberField, pickRecord, pickRows, stringField } from './wire.ts'
import type {
  MwtCheckClient,
  MwtExpedienteFacts,
  MwtExpedienteLine,
  MwtToolCall,
} from './types.ts'

/** Client fields carrying the price band MWT.ONE prices against. */
const BAND_FIELDS = ['banda_id', 'banda', 'price_band_id', 'banda_precio_id'] as const
/** Client fields carrying the payment term in days. */
const PAYMENT_DAYS_FIELDS = ['plazo_dias', 'dias_credito', 'credit_days', 'dias_pago', 'payment_days'] as const
/** Client fields carrying the identity the board account reference names. */
const ACCOUNT_FIELDS = ['razon_social', 'nombre', 'codigo_marluvas', 'tax_id', 'cliente'] as const
/** Client fields carrying the client identity used by `cliente_obtener`. */
const CLIENT_ID_FIELDS = ['cliente_id', 'id', 'uuid'] as const
/** Product fields carrying the catalog SKU. */
const SKU_FIELDS = ['sku', 'codigo_sku', 'producto_sku'] as const
/** Product fields carrying the product identity. */
const PRODUCT_ID_FIELDS = ['producto_id', 'id', 'uuid'] as const
/** Line fields carrying the ordered quantity. */
const QUANTITY_FIELDS = ['qty', 'quantity', 'cantidad'] as const
/** Stock fields carrying available units. */
const STOCK_FIELDS = ['cantidad_disponible', 'cantidad', 'disponible', 'saldo', 'stock', 'qty', 'available'] as const
/** Catalog-price fields carrying the list price before the overcharge (`unit_price_mwt`). */
const LIST_PRICE_FIELDS = ['unit_price_mwt', 'precio_mwt', 'list_price'] as const
/** Catalog-price fields carrying the price the account pays. */
const CLIENT_PRICE_FIELDS = ['unit_price_client', 'precio_cliente', 'precio_lista', 'client_price'] as const
/** Expediente identity fields a search result may carry. */
const EXPEDIENTE_ID_FIELDS = ['expediente_id', 'id', 'uuid', 'expediente_codigo'] as const

/** Largest page `stock_listar` accepts, per the inventory skill. */
const STOCK_PAGE_LIMIT = 200
/** Client rows read to resolve one account reference; more than one distinct hit is ambiguous. */
const ACCOUNT_PROBE_LIMIT = 2
/** Product rows read to find one exact SKU. */
const PRODUCT_PROBE_LIMIT = 10

/** Canonical UUID form, read through `expediente_lineas` instead of searched as an order number. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Read one MWT.ONE tool's JSON payload.
 * @param call - the tool call.
 * @param tool - raw tool name.
 * @param args - arguments the tool accepts.
 * @returns the parsed payload.
 */
async function read(call: MwtToolCall, tool: Parameters<MwtToolCall>[0], args: Record<string, unknown>): Promise<unknown> {
  return jsonPayload(await call(tool, args))
}

/**
 * Read an expediente's lines by the identity the source accepted.
 * @param call - the tool call.
 * @param expedienteId - expediente UUID or reference the tools resolve.
 * @returns the lines, or null when the payload carries no readable line array.
 */
async function readLines(call: MwtToolCall, expedienteId: string): Promise<MwtExpedienteFacts | null> {
  const payload = await read(call, 'expediente_lineas', { expediente_id: expedienteId })
  const rows = pickRows(payload, ['lineas', 'lines'])
  if (rows === null) return null
  const lines: MwtExpedienteLine[] = []
  for (const row of rows) {
    const sku = stringField(row, SKU_FIELDS)
    const quantity = numberField(row, QUANTITY_FIELDS)
    // A line whose SKU or quantity cannot be read leaves the whole read
    // unresolved: the quantity control must not compare against a partial order.
    if (sku === null || quantity === null) return null
    lines.push({ sku, quantity })
  }
  return { reference: expedienteId, lines }
}

/**
 * Resolve one purchase-order reference to its expediente id.
 * @param call - the tool call.
 * @param reference - order number the draft names.
 * @returns the expediente id, or null when no expediente holds that order.
 */
async function resolveExpediente(call: MwtToolCall, reference: string): Promise<string | null> {
  const payload = await read(call, 'expediente_buscar', { oc_number: reference })
  const match = pickRecord(payload, ['match', 'expediente'])
  if (match === null || match['existe'] === false) return null
  const id = idField(match, EXPEDIENTE_ID_FIELDS)
  return id === null ? null : String(id)
}

/**
 * Find the catalog row whose SKU equals the billed SKU.
 * @param call - the tool call.
 * @param sku - billed SKU.
 * @returns the row's product identity, or null when the catalog holds no exact match.
 */
async function findProduct(call: MwtToolCall, sku: string): Promise<{ readonly id: string | null } | null> {
  const payload = await read(call, 'producto_buscar', { q: sku, limit: PRODUCT_PROBE_LIMIT })
  const rows = pickRows(payload, ['productos', 'items'])
  if (rows === null) return null
  const wanted = sku.trim().toUpperCase()
  for (const row of rows) {
    const found = stringField(row, SKU_FIELDS)
    if (found !== null && found.trim().toUpperCase() === wanted) {
      return { id: stringField(row, PRODUCT_ID_FIELDS) }
    }
  }
  return null
}

/**
 * Build the MWT.ONE client over one tool call.
 * @param call - performs one MWT.ONE tool call and returns its canonical MCP value.
 * @returns the five reads the proforma controls consume.
 */
export function mcpMwtCheckClient(call: MwtToolCall): MwtCheckClient {
  return {
    async expediente(reference) {
      // A UUID needs no search; anything else is the order number the draft
      // answers, which `expediente_buscar` resolves to its expediente.
      if (UUID.test(reference)) return await readLines(call, reference)
      const id = await resolveExpediente(call, reference)
      if (id === null) return null
      return await readLines(call, id)
    },

    async skuExists(sku) {
      return (await findProduct(call, sku)) !== null
    },

    async stockAvailable(sku) {
      const product = await findProduct(call, sku)
      // An unknown SKU has no inventory record; the stock control treats that as
      // missing data and asks for confirmation (D-02).
      if (product === null) return null
      const payload = await read(call, 'stock_listar', {
        producto: product.id ?? sku,
        solo_disponible: true,
        limit: STOCK_PAGE_LIMIT,
      })
      const rows = pickRows(payload, ['stock', 'saldos', 'existencias'])
      if (rows === null) return null
      // A query restricted to available stock that lists no row reports zero
      // available units, which is a real answer, not missing data.
      if (rows.length === 0) return 0
      let total = 0
      for (const row of rows) {
        const available = numberField(row, STOCK_FIELDS)
        if (available === null) return null
        total += available
      }
      return total
    },

    async priceBand(accountRef) {
      const payload = await read(call, 'cliente_listar', { q: accountRef, limit: ACCOUNT_PROBE_LIMIT })
      const rows = pickRows(payload, ['clientes', 'items'])
      if (rows === null || rows.length === 0) return null
      const exact = rows.filter(row => fieldEquals(row, ACCOUNT_FIELDS, accountRef))
      // One record names the account, or the single row is that account. Two
      // distinct hits leave the band unresolved instead of guessing one.
      const [record] = exact.length === 1 ? exact : rows.length === 1 ? rows : []
      if (record === undefined) return null
      const id = stringField(record, CLIENT_ID_FIELDS)
      const detail = id === null
        ? record
        : pickRecord(await read(call, 'cliente_obtener', { cliente_id: id }), ['cliente']) ?? record
      const bandId = idField(detail, BAND_FIELDS)
      const paymentDays = numberField(detail, PAYMENT_DAYS_FIELDS)
      // D-01 fails the price control when the band or condition is absent, so a
      // record without either is no band at all.
      if (bandId === null && paymentDays === null) return null
      return { bandId, paymentDays }
    },

    async catalogPrice(sku, band) {
      const args: Record<string, unknown> = { sku, usar_tc_actual: true }
      if (band.bandId !== null) args['banda_id'] = band.bandId
      if (band.paymentDays !== null) args['plazo_dias'] = band.paymentDays
      const payload = await read(call, 'producto_precio_cliente', args)
      const record = pickRecord(payload, ['precio', 'producto', 'resultado'])
      if (record === null) return null
      const listPrice = numberField(record, LIST_PRICE_FIELDS)
      const clientPrice = numberField(record, CLIENT_PRICE_FIELDS)
      // The overcharge is the difference between these two prices; with one of
      // them absent there is no price fact to report (D-01).
      if (listPrice === null || clientPrice === null) return null
      return { listPrice, clientPrice }
    },
  }
}
