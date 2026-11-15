/**
 * Readable labels for the evidence references a producer records. A mail uid, an
 * opaque UUID, or a storage key is transport detail, not evidence: the reader
 * needs the order, thread, or document the reference names.
 * @module @deepseek-ai/dsh-client-ui-faberloom/client/evidence
 */
import type { FaberloomKey } from './locales.ts'

/**
 * Remove transport identifiers from one evidence reference.
 * @param ref - evidence reference the producer recorded.
 * @returns the reference without mail UIDs, opaque UUIDs, or storage keys.
 */
export function evidenceLabel(ref: string): string {
  const cleaned = ref
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, '')
    .replace(/\buid\s+\d+\b/giu, '')
    .replace(/\bkey\s+documento\/\S*/giu, '')
    .replace(/\(\s*id\s*\)/giu, '')
    .replace(/\bid\s*([,)])/giu, '$1')
    .replace(/\s*,\s*/gu, ', ')
    .replace(/,\s*\)/gu, ')')
    .replace(/\(\s*\)/gu, '')
    .replace(/\(\s*$/u, '')
    .replace(/\s{2,}/gu, ' ')
    .replace(/^[\s,;·-]+|[\s,;·-]+$/gu, '')
  return cleaned.length === 0 ? ref : cleaned
}

/**
 * The sentence a reader sees for one evidence reference. A producer records the
 * reference as `<channel>:<key>`, which is transport vocabulary: the panel names
 * the channel ("Correo del hilo 1") and keeps only the readable remainder. An
 * unrecognised reference falls back to {@link evidenceLabel}, so a new channel
 * degrades to its own text instead of a wrong label.
 * @param ref - evidence reference the producer recorded.
 * @param t - copy seat for the channel names.
 * @returns the readable reference.
 */
export function evidenceText(ref: string, t: (key: FaberloomKey) => string): string {
  const [rawPrefix = '', ...tail] = ref.split(':')
  const prefix = rawPrefix.trim().toLowerCase()
  const rest = tail.join(':')
  const join = (label: string, value: string): string => {
    // An opaque id alone names nothing a reader can act on: the channel stands
    // on its own ("Routine") instead of repeating a UUID.
    const opaque = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value.trim())
    const readable = opaque ? '' : evidenceLabel(value)
    return readable.length === 0 ? label : `${label} ${readable}`
  }
  switch (prefix) {
    case 'mail':
      return join(t('mesa.evidence.mail'), rest.replace(/^thread[-_ ]?/iu, ''))
    case 'mw': {
      const [kind = '', ...value] = tail
      return kind.trim().toLowerCase() === 'price'
        ? join(t('mesa.evidence.mwPrice'), value.join(':'))
        : join(t('mesa.evidence.mw'), rest)
    }
    case 'oc':
      return join(t('mesa.evidence.order'), rest)
    case 'sap':
      return join(t('mesa.evidence.sap'), rest)
    case 'fx':
      return join(t('mesa.evidence.fx'), rest)
    case 'expediente':
      return join(t('mesa.evidence.expediente'), rest)
    case 'sicop':
      return join(t('mesa.evidence.sicop'), rest)
    case 'routine':
      return join(t('mesa.evidence.routine'), rest)
    case 'execution':
      return join(t('mesa.evidence.execution'), rest)
    case 'step':
      return join(t('mesa.evidence.step'), rest)
    default:
      return evidenceLabel(ref)
  }
}
