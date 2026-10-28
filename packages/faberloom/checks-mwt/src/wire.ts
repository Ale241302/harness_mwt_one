/**
 * Wire reading of MWT.ONE MCP tool results.
 *
 * A bridged MCP tool answers with `{ content, structuredContent? }`: the
 * structured value when the server declares one, otherwise text blocks that
 * carry JSON. MWT.ONE field names are not covered by a shipped response
 * contract, so every reader here accepts the documented aliases and returns
 * `null` when none is present. A null is what makes a control fail or require
 * confirmation; no reader supplies a default (D-01, D-02).
 *
 * @module @deepseek-ai/dsh-faberloom-checks-mwt/wire
 */

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
 * The object one payload carries under one of the given keys, or the payload
 * itself when it carries no list under any of them. A `data` or `result`
 * wrapper is read through once.
 * @param payload - parsed tool payload.
 * @param keys - wrapper keys to look through, in order.
 * @returns the record, or null when the payload is not a readable object.
 */
export function pickRecord(payload: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!isRecord(payload)) return null
  if (keys.some(key => Array.isArray(payload[key]))) return null
  for (const key of keys) {
    const candidate = payload[key]
    if (isRecord(candidate)) return candidate
  }
  for (const wrapper of ['data', 'result']) {
    const candidate = payload[wrapper]
    if (!isRecord(candidate)) continue
    for (const key of keys) {
      const inner = candidate[key]
      if (isRecord(inner)) return inner
    }
    return candidate
  }
  return payload
}

/** Keys an MWT.ONE list response wraps its rows in. */
const ROW_KEYS = ['data', 'result', 'results', 'items', 'rows', 'records'] as const

/**
 * The row array one payload carries, looking through the named wrappers and
 * then the generic list wrappers.
 * @param payload - parsed tool payload.
 * @param keys - domain wrapper keys to try first.
 * @returns the rows, or null when the payload carries no readable array.
 */
export function pickRows(payload: unknown, keys: readonly string[]): readonly Record<string, unknown>[] | null {
  return rowsAt(payload, keys, 0)
}

/**
 * Read an array of records at one nesting depth.
 * @param payload - candidate payload.
 * @param keys - domain wrapper keys.
 * @param depth - nesting depth already consumed.
 * @returns the rows, or null.
 */
function rowsAt(
  payload: unknown,
  keys: readonly string[],
  depth: number,
): readonly Record<string, unknown>[] | null {
  if (Array.isArray(payload)) return payload.every(isRecord) ? payload : null
  if (!isRecord(payload) || depth > 1) return null
  for (const key of [...keys, ...ROW_KEYS]) {
    const candidate = payload[key]
    if (Array.isArray(candidate)) return candidate.every(isRecord) ? candidate : null
  }
  for (const key of [...keys, 'data', 'result']) {
    const candidate = payload[key]
    if (isRecord(candidate)) return rowsAt(candidate, keys, depth + 1)
  }
  return null
}

/**
 * The finite number one record carries under one of the given fields. A
 * decimal serialized as a string is read as its number; anything else is
 * absent.
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
 * Whether one record names the value the caller searched for, compared
 * case-insensitively over the given fields.
 * @param record - client row.
 * @param names - identity fields to compare.
 * @param expected - value the caller supplied.
 * @returns true for one exact, case-insensitive match.
 */
export function fieldEquals(record: Record<string, unknown>, names: readonly string[], expected: string): boolean {
  const wanted = expected.trim().toUpperCase()
  return names.some((name) => {
    const value = stringField(record, [name])
    return value !== null && value.trim().toUpperCase() === wanted
  })
}
