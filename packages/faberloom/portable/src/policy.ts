/**
 * The export policy: an allowlist of classifications, a synthetic-secret
 * detector, and the rule that a session or transcript is never portable, even
 * from the same Space.
 * @module @deepseek-ai/dsh-faberloom-portable/src/policy
 */

import type { PortableClassification, PortableContribution } from './types.ts'

/** The only classifications the export allows. */
const ALLOWED: ReadonlySet<string> = new Set<PortableClassification>(['N0', 'N1', 'N2'])

/** Secret shapes the export refuses before writing. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /-----BEGIN PGP PRIVATE KEY BLOCK-----/u,
  /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/u,
  /(?:^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}/u,
  /(?:^|[^A-Za-z0-9])ghp_[A-Za-z0-9]{20,}/u,
  /(?:^|[^A-Za-z0-9])glpat-[A-Za-z0-9_-]{16,}/u,
  /(?:^|[^A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/u,
  /(?:^|[^A-Za-z0-9])AIza[0-9A-Za-z_-]{35}/u,
  /(?:^|[^A-Za-z0-9])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u,
]

/**
 * Accept a classification only when the allowlist names it.
 * @param value - the declared classification.
 * @returns the classification, or undefined when it is absent or unknown.
 */
export function allowedClassification(value: unknown): PortableClassification | undefined {
  return typeof value === 'string' && ALLOWED.has(value) ? value as PortableClassification : undefined
}

/**
 * Normalize a metadata key for class detection: trimmed, lowercased, and
 * without separators.
 * @param key - metadata key.
 * @returns the normalized key.
 */
function classKey(key: string): string {
  return key.trim().toLocaleLowerCase('en').replaceAll(/[_-]/gu, '')
}

/** Whether a normalized metadata key declares a class. */
function isClassKey(key: string): boolean {
  const normalized = classKey(key)
  return normalized === 'dataclass' || normalized.endsWith('classification')
}

/**
 * Whether a contribution declares a classification under any accepted spelling.
 * @param contribution - the contribution to inspect.
 * @returns true when a class key exists.
 */
export function hasDeclaredClassification(contribution: PortableContribution): boolean {
  if (contribution.classification !== undefined) return true
  return Object.keys(contribution.metadata ?? {}).some(key => isClassKey(key))
}

/**
 * Read the classification a contribution declares at the top level or in its
 * metadata. Every recognized spelling must agree and the value must be a
 * string; a conflict is refused by returning undefined.
 * @param contribution - the contribution to inspect.
 * @returns the declared string, or undefined.
 */
export function declaredClassification(contribution: PortableContribution): string | undefined {
  const declarations: string[] = []
  if (contribution.classification !== undefined) declarations.push(contribution.classification)
  for (const [key, value] of Object.entries(contribution.metadata ?? {})) {
    if (!isClassKey(key)) continue
    if (typeof value !== 'string') return undefined
    declarations.push(value)
  }
  if (declarations.length === 0) return undefined
  const [first] = declarations
  return declarations.every(value => value === first) ? first : undefined
}

/**
 * Whether a text carries a secret shape the export never writes.
 * @param text - content or metadata value.
 * @returns true when a secret pattern matches.
 */
export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * Whether a contribution is a session or transcript, which no export includes
 * even when it belongs to the same Space.
 * @param contribution - the contribution to classify.
 * @returns true for a session, a transcript, or a record that names one.
 */
export function isSessionOrTranscript(contribution: PortableContribution): boolean {
  if (contribution.kind === 'session' || contribution.kind === 'transcript') return true
  const metadata = contribution.metadata ?? {}
  const normalized = new Map<string, string>()
  for (const [key, value] of Object.entries(metadata)) normalized.set(classKey(key), value.toLocaleLowerCase('en'))
  const source = normalized.get('source') ?? normalized.get('kind')
  if (source === 'session' || source === 'transcript' || source === 'sesion' || source === 'transcripcion') return true
  if (['sessionid', 'transcriptid', 'sesionid', 'transcripcionid'].some(key => normalized.has(key))) return true
  const path = contribution.path.toLocaleLowerCase('en')
  return /\/(?:sessions?|transcripts?|sesiones?|transcripciones?)\//u.test(`/${path}/`)
    || /^\.?(?:sessions?|transcripts?|sesiones?|transcripciones?)\//u.test(path)
}

/**
 * Scan a contribution's content and metadata for a secret.
 * @param contribution - the contribution to scan.
 * @returns true when any string carries a secret shape.
 */
export function contributionHasSecret(contribution: PortableContribution): boolean {
  const fields = [
    contribution.id,
    contribution.title,
    contribution.path,
    contribution.mediaType ?? '',
    contribution.content,
  ]
  if (fields.some(value => containsSecret(value))) return true
  for (const [key, value] of Object.entries(contribution.metadata ?? {})) {
    if (containsSecret(key) || containsSecret(value)) return true
  }
  return false
}
