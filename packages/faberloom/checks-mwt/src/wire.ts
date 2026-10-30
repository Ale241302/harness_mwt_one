/**
 * Wire reading of MWT.ONE MCP tool results.
 *
 * A bridged MCP tool answers with `{ content, structuredContent? }`: the
 * structured value when the server declares one, otherwise text blocks that
 * carry JSON. The readers below accept only the response fields recorded from
 * the live server (`mwt-one 1.30.0`, `.artifacts/mwt-shapes.md`): `matches`,
 * `results`, `productos`, `banda_vigente`, the flat stock record, and the line
 * records of `expediente_lineas`. A field the server omits is `null`; no reader
 * supplies a default (D-01, D-02).
 *
 * @module @deepseek-ai/dsh-faberloom-checks-mwt/wire
 */

/** One row of an MWT.ONE list answer. */
export type WireRow = Record<string, unknown>

/** One page of a list answer that reports `{ count, limit, offset, results }`. */
export interface WirePage {
  /** Rows the page carries. */
  readonly rows: readonly WireRow[]
  /** Total rows the query matches, or null when the answer omits `count`. */
  readonly count: number | null
  /** Page size the server applied, or null when the answer omits `limit`. */
  readonly limit: number | null
  /** Offset the server applied, or null when the answer omits `offset`. */
  readonly offset: number | null
}

/** The answer of a search that reports `{ existe, total, matches }`. */
export interface WireMatches {
  /** What the server reported for `existe`, or null when the answer omits it. */
  readonly exists: boolean | null
  /** Rows the search matched. */
  readonly rows: readonly WireRow[]
}

/**
 * Whether one JSON value is a string-keyed object.
 * @param value - candidate value.
 * @returns true for a non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The JSON a bridged MCP tool result carries.
 * @param value - canonical MCP result from the tool runtime.
 * @returns the structured content, or the parsed text blocks.
 */
export function jsonPayload(value: unknown): unknown {
  if (!isRecord(value)) throw new Error('mwt: the tool returned no result object')
  const structured = value['structuredContent']
  if (isRecord(structured)) return structured
  const content = value['content']
  if (!Array.isArray(content)) throw new Error('mwt: the tool returned no content')
  const text = content
    .filter(isRecord)
    .filter(block => block['type'] === 'text' && typeof block['text'] === 'string')
    .map(block => block['text'] as string)
    .join('\n')
  if (text.trim().length === 0) throw new Error('mwt: the tool returned no JSON text')
  return JSON.parse(text) as unknown
}

/**
 * Whether a tool value carries no payload at all: no structured content and no
 * text block with content. A listing that matches nothing answers this way; for
 * a stock query restricted to available units it states zero, not a failed read.
 * @param value - canonical MCP tool value.
 * @returns true when the value carries no payload.
 */
export function isEmptyAnswer(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (isRecord(value['structuredContent'])) return false
  const content = value['content']
  if (!Array.isArray(content)) return true
  return content.every(block => !isRecord(block)
    || block['type'] !== 'text'
    || typeof block['text'] !== 'string'
    || block['text'].trim().length === 0)
}

/**
 * One page of an `expediente_listar` answer: `{ count, limit, offset, results }`.
 * @param payload - parsed tool payload.
 * @returns the page, or null when the answer carries no `results` array.
 */
export function pageRows(payload: unknown): WirePage | null {
  if (!isRecord(payload)) return null
  const results = payload['results']
  if (!Array.isArray(results) || !results.every(isRecord)) return null
  return {
    rows: results,
    count: numberField(payload, ['count']),
    limit: numberField(payload, ['limit']),
    offset: numberField(payload, ['offset']),
  }
}

/**
 * The answer of an `expediente_buscar` call: `{ existe, total, matches }`.
 * @param payload - parsed tool payload.
 * @returns the existence flag and the matched rows, or null when the answer
 * carries no `matches` array.
 */
export function searchMatches(payload: unknown): WireMatches | null {
  if (!isRecord(payload)) return null
  const matches = payload['matches']
  if (!Array.isArray(matches) || !matches.every(isRecord)) return null
  const exists = payload['existe']
  return { exists: typeof exists === 'boolean' ? exists : null, rows: matches }
}

/**
 * The rows of a `producto_buscar` answer: `{ productos, total }`.
 * @param payload - parsed tool payload.
 * @returns the product rows, or null when the answer carries no `productos` array.
 */
export function productRows(payload: unknown): readonly WireRow[] | null {
  if (!isRecord(payload)) return null
  const products = payload['productos']
  return Array.isArray(products) && products.every(isRecord) ? products : null
}

/** Fields that identify a flat `stock_listar` record. */
const STOCK_RECORD_FIELDS = ['producto_sku', 'producto_id', 'nodo_codigo', 'cantidad_disponible'] as const

/** Fields that identify one line of an `expediente_lineas` answer. */
const LINE_RECORD_FIELDS = ['sku', 'qty'] as const

/**
 * The stock records a `stock_listar` answer carries. The server answers one
 * flat record for a single row and a `results` array when it lists several.
 * @param payload - parsed tool payload.
 * @returns the records, or null when the answer is neither form.
 */
export function stockRecords(payload: unknown): readonly WireRow[] | null {
  if (Array.isArray(payload)) return payload.every(isRecord) ? payload : null
  if (!isRecord(payload)) return null
  const results = payload['results']
  if (Array.isArray(results)) return results.every(isRecord) ? results : null
  return STOCK_RECORD_FIELDS.some(name => name in payload) ? [payload] : null
}

/**
 * The lines an `expediente_lineas` answer carries. The same endpoint answers a
 * list, a `{ results }` page, or one line object depending on the deployment,
 * so a reader that accepts only one form drops the order silently.
 * @param payload - parsed tool payload.
 * @returns the line rows, or null when the answer is none of the three forms.
 */
export function lineRows(payload: unknown): readonly WireRow[] | null {
  if (Array.isArray(payload)) return payload.every(isRecord) ? payload : null
  if (!isRecord(payload)) return null
  const results = payload['results']
  if (Array.isArray(results)) return results.every(isRecord) ? results : null
  return LINE_RECORD_FIELDS.some(name => name in payload) ? [payload] : null
}

/**
 * The line records one `expediente_lineas` tool value carries.
 *
 * The deployed server answers one text block per line (`mwt-one 1.30.0`), so the
 * joined text that every other read parses holds several JSON documents at
 * once. A container may instead answer a single block holding a list, a
 * `{ results }` page, or one line object; all four forms are read here.
 * @param value - canonical MCP tool value.
 * @returns the line rows, or null when the value carries no readable line.
 */
export function lineRecords(value: unknown): readonly WireRow[] | null {
  if (!isRecord(value)) return null
  const structured = value['structuredContent']
  if (isRecord(structured)) return lineRows(structured)
  const content = value['content']
  if (!Array.isArray(content)) return null
  const rows: WireRow[] = []
  let blocks = 0
  for (const block of content) {
    if (!isRecord(block) || block['type'] !== 'text' || typeof block['text'] !== 'string') continue
    blocks += 1
    let parsed: unknown
    try {
      parsed = JSON.parse(block['text'])
    } catch (cause) {
      // A block that is not JSON cannot name a line, so the answer is unusable
      // instead of quietly shorter than the order.
      throw new Error(`mwt: a line block carries no JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    const page = lineRows(parsed)
    if (page === null) return null
    rows.push(...page)
  }
  return blocks === 0 ? null : rows
}

/**
 * The `banda_vigente` object of a `producto_precio_cliente` answer.
 * @param payload - parsed tool payload.
 * @returns the band record, or null when the answer carries no band object.
 */
export function bandRecord(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null
  const band = payload['banda_vigente']
  return isRecord(band) ? band : null
}

/**
 * The finite number one record carries under one of the given fields. A
 * decimal serialized as a string (`"200.000"`, `"13.2700"`) is read as its
 * number; a zero is a value, and anything unreadable is absent.
 * @param record - row or object.
 * @param names - field names to try, in order.
 * @returns the number, or null.
 */
export function numberField(record: Record<string, unknown>, names: readonly string[]): number | null {
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

/**
 * The non-empty string one record carries under one of the given fields.
 * @param record - row or object.
 * @param names - field names to try, in order.
 * @returns the string, or null.
 */
export function stringField(record: Record<string, unknown>, names: readonly string[]): string | null {
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'string' && value.trim().length > 0) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

/**
 * The identifier one record carries under one of the given fields, kept in the
 * type the source used so a numeric band id stays numeric on the next call.
 * @param record - row or object.
 * @param names - field names to try, in order.
 * @returns the identifier, or null.
 */
export function idField(record: Record<string, unknown>, names: readonly string[]): string | number | null {
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'string' && value.trim().length > 0) return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

/**
 * The non-empty strings one record carries in the first array field of the
 * given names. A non-string entry is ignored, so it can never name a match.
 * @param record - row or object.
 * @param names - field names to try, in order.
 * @returns the strings, or null when no listed field holds an array.
 */
export function stringListField(record: Record<string, unknown>, names: readonly string[]): readonly string[] | null {
  for (const name of names) {
    const value = record[name]
    if (!Array.isArray(value)) continue
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  }
  return null
}
