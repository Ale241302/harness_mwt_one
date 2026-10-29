/**
 * The deterministic field router of §9.7: an instruction that names a field the
 * item declares is applied without a model. One parser serves the inline edit,
 * the detail's instruction box, and the iteration chat, so an instruction that
 * works in one of them works in all three.
 *
 * A sentence the router does not own returns `null`; the caller hands it to the
 * agent instead of guessing. That is the whole rule: recognize or delegate.
 * @module @deepseek-ai/dsh-faberloom-board/router
 */

/** One field change the router recognized. */
export interface BoardFieldChange {
  /** Field name as the item declares it. */
  readonly field: string
  /** Parsed value: a JSON scalar. */
  readonly value: string | number | boolean | null
}

/** Screen names the deployment's users type for the fields the panel always shows. */
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
 * Parse one value literal: a number with an optional decimal comma, a boolean,
 * null, or the remaining text without surrounding quotes.
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
 * `null`, so the router never touches a field it does not know.
 * @param text - the instruction the user typed.
 * @param fields - field names the item declares.
 * @returns the changes to write in order, or null when the router does not own it.
 */
export function routeFieldInstruction(
  text: string,
  fields: readonly string[],
): readonly BoardFieldChange[] | null {
  const input = text.trim()
  if (input.length === 0) return null
  const byName = new Map(fields.map(field => [field.toLowerCase(), field]))
  const changes: BoardFieldChange[] = []
  // One instruction may carry several segments separated by `;` or a newline;
  // every segment must name a declared field or the whole instruction is
  // delegated.
  for (const segment of input.split(/[;\n]/u)) {
    const part = segment.trim()
    if (part.length === 0) continue
    const verb = /^(?:cambiar|cambia|change|set|poner|pon)\s+([\w.-]+)\s+(?:a|to)\s+(.+)$/iu.exec(part)
    const at = /^@([\w.-]+)\s*[:=]\s*(.+)$/u.exec(part)
    const plain = at === null && verb === null ? /^([\w.-]+)\s*(?:=|:)\s*(.+)$/u.exec(part) : null
    const match = verb ?? at ?? plain
    if (match === null) return null
    /* v8 ignore next -- the anchored pattern requires this capture group */
    const typed = (match[1] ?? '').toLowerCase()
    const declared = byName.get(typed) ?? byName.get(ALIASES[typed] ?? '')
    if (declared === undefined) return null
    /* v8 ignore next -- the anchored pattern requires the value group */
    changes.push({ field: declared, value: parseValue(match[2] ?? '') })
  }
  return changes.length === 0 ? null : changes
}
