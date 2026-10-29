/**
 * Deterministic field router for the iteration draft (§9.7). A change the user
 * can name is applied without a model: `@total = 1234`, `total: 1234`, or
 * `cambiar total a 1234`. Anything the router does not recognize returns null,
 * and the caller sends it to the agent instead of guessing.
 * @module @deepseek-ai/dsh-client-ui-faberloom/client/iteration-router
 */

/** One change the router recognized. */
export interface RoutedField {
  /** Field name as the item declares it. */
  readonly field: string
  /** Parsed value: number, boolean, null, or the trimmed text. */
  readonly value: string | number | boolean | null
}

/** Spanish screen names for the fields the panel always shows. */
const ALIASES: Readonly<Record<string, string>> = {
  resumen: 'summary',
  summary: 'summary',
  monto: 'total',
  total: 'total',
  moneda: 'currency',
  currency: 'currency',
  vencimiento: 'due',
  due: 'due',
}

/**
 * Parse one value literal: numbers with an optional decimal comma, booleans,
 * null, or the remaining text with optional quotes.
 * @param raw - the literal the user typed.
 * @returns the value to write.
 */
function parseValue(raw: string): string | number | boolean | null {
  const text = raw.trim().replace(/^["']|["']$/gu, '')
  if (text.length === 0) return null
  if (/^(?:true|si|sí|yes)$/iu.test(text)) return true
  if (/^(?:false|no)$/iu.test(text)) return false
  if (/^(?:null|ninguno|none)$/iu.test(text)) return null
  const normalized = text.replace(',', '.')
  if (/^-?\d+(?:\.\d+)?$/u.test(normalized)) return Number(normalized)
  return text
}

/**
 * Route one instruction against the fields an item declares. The match is
 * anchored and exact: an unknown field or an unrecognized sentence returns
 * null, so no model-free guess can touch an item.
 * @param text - the instruction the user typed.
 * @param fields - field names the item allows (content keys plus `summary`).
 * @returns the changes to write, or null when the router does not own it.
 */
export function routeIteration(text: string, fields: readonly string[]): readonly RoutedField[] | null {
  const input = text.trim()
  if (input.length === 0) return null
  const byName = new Map(fields.map(field => [field.toLowerCase(), field]))
  const changes: RoutedField[] = []
  // One instruction may carry several `campo = valor` segments separated by a
  // semicolon; each one must name a declared field.
  for (const segment of input.split(';')) {
    const part = segment.trim()
    if (part.length === 0) continue
    const verb = /^(?:cambiar|cambia|change|set|poner|pon)\s+([\w.-]+)\s+(?:a|to)\s+(.+)$/iu.exec(part)
    const at = /^@([\w.-]+)\s*[:=]\s*(.+)$/u.exec(part)
    const plain = at === null && verb === null ? /^([\w.-]+)\s*(?:=|:)\s*(.+)$/u.exec(part) : null
    const match = verb ?? at ?? plain
    if (match === null) return null
    const declared = byName.get((match[1] ?? '').toLowerCase())
      ?? byName.get(ALIASES[(match[1] ?? '').toLowerCase()] ?? '')
    if (declared === undefined) return null
    changes.push({ field: declared, value: parseValue(match[2] ?? '') })
  }
  return changes.length === 0 ? null : changes
}
