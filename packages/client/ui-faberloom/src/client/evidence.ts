/**
 * Readable labels for the evidence references a producer records. A mail uid, an
 * opaque UUID, or a storage key is transport detail, not evidence: the reader
 * needs the order, thread, or document the reference names.
 * @module @deepseek-ai/dsh-client-ui-faberloom/client/evidence
 */

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
    .replace(/\s{2,}/gu, ' ')
    .replace(/^[\s,;·-]+|[\s,;·-]+$/gu, '')
  return cleaned.length === 0 ? ref : cleaned
}
