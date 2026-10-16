/** The mirror transfer document: the version rule, the route path both sides
 * agree on, and the canonical row hash the conflict rule compares. The traversal
 * reads and writes the same generic storage-domain tuples a product snapshot
 * uses (domain, table, key) to JSON, with the tombstone rule a live mirror needs
 * and a snapshot does not.
 * @module @deepseek-ai/dsh-faberloom-mirror/src/document
 */

import { createHash } from 'node:crypto'
import type { FaberLoomMirrorDocument } from './types.ts'

export { FABERLOOM_MIRROR_DOMAINS } from './domains.ts'

/** Transfer document version; bump only on an incompatible document change. */
export const FABERLOOM_MIRROR_FORMAT_VERSION = 1

/** Route path the gateway mounts the mirror under. */
export const MIRROR_ROUTE_PATH = '/_/harness/mirror'

/** A skill bundle name: the directory name under the owner's skills root. */
export const SKILL_BUNDLE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/**
 * Derive the harness origin from the console API base the Desktop signs in with.
 *
 * `https://consola.mwt.one/api` is the console; the harness that serves the
 * mirror is the same product host without the `consola.` prefix. A base that
 * does not follow that convention yields undefined, so the mirror stays off
 * rather than reaching a host nobody named.
 * @param consolaBase - the console API base the installation uses.
 * @returns the mirror route URL, or undefined when the convention does not apply.
 */
export function deriveMirrorOrigin(consolaBase: string | undefined): string | undefined {
  if (consolaBase === undefined || consolaBase.trim().length === 0) return undefined
  let parsed: URL
  try {
    parsed = new URL(consolaBase)
  } catch {
    return undefined
  }
  const host = parsed.host
  if (!host.startsWith('consola.')) return undefined
  return `${parsed.protocol}//${host.slice('consola.'.length)}${MIRROR_ROUTE_PATH}`
}

/**
 * Deterministic JSON: object keys sorted at every level, so a row hash is
 * stable across processes and across the two hosts.
 * @param value - the value to serialize.
 * @returns canonical JSON text.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value) as string | undefined
    return serialized ?? 'null'
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`).join(',')}}`
}

/**
 * sha256 hex digest of one string.
 * @param value - the text to digest.
 * @returns the hex digest.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Digest of one stored row: the conflict rule's unit.
 * @param value - the stored value.
 * @returns the hex digest the sync journal records.
 */
export function hashRow(value: unknown): string {
  return sha256(canonicalStringify(value))
}

/**
 * Digest of one skill bundle's `SKILL.md` text.
 * @param content - the file text.
 * @returns the hex digest the sync journal records.
 */
export function hashSkill(content: string): string {
  return sha256(content)
}

/** One entry problem of a received document. */
export interface MirrorDocumentProblem {
  /** Location inside the document, for the refusal message. */
  readonly path: string
  /** What is wrong there. */
  readonly detail: string
}

/** A document that passed validation, or the problems that refused it. */
export type MirrorDocumentCheck =
  | { readonly ok: true; readonly document: FaberLoomMirrorDocument }
  | { readonly ok: false; readonly problems: readonly MirrorDocumentProblem[] }

/** True when a value is a plain JSON object (never null, never an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate one received document against the version rule and the structural
 * contract of {@link FaberLoomMirrorDocument}. A document whose version is not
 * {@link FABERLOOM_MIRROR_FORMAT_VERSION} is refused before any location is
 * inspected, so an unknown format never reaches a row write.
 * @param value - the parsed document.
 * @returns the accepted document, or every problem found.
 */
export function checkMirrorDocument(value: unknown): MirrorDocumentCheck {
  const problems: MirrorDocumentProblem[] = []
  if (!isRecord(value)) return { ok: false, problems: [{ path: '', detail: 'expected a JSON object' }] }
  if (value['version'] !== FABERLOOM_MIRROR_FORMAT_VERSION) {
    return {
      ok: false,
      problems: [{
        path: 'version',
        detail: `unsupported format version ${JSON.stringify(value['version'] ?? null)}; this build speaks ${String(FABERLOOM_MIRROR_FORMAT_VERSION)}`,
      }],
    }
  }
  if (value['platform'] !== 'web' && value['platform'] !== 'desktop') {
    problems.push({ path: 'platform', detail: 'must be "web" or "desktop"' })
  }
  const domains = value['domains']
  if (!isRecord(domains)) {
    problems.push({ path: 'domains', detail: 'must be an object' })
  } else {
    for (const [domainName, domain] of Object.entries(domains)) {
      if (!isRecord(domain)) {
        problems.push({ path: `domains.${domainName}`, detail: 'must be an object' })
        continue
      }
      if (!isRecord(domain['tables'])) {
        problems.push({ path: `domains.${domainName}.tables`, detail: 'must be an object' })
        continue
      }
      const domainVersion = domain['version']
      if (domainVersion !== undefined
        && (typeof domainVersion !== 'number' || !Number.isInteger(domainVersion) || domainVersion < 0)) {
        problems.push({ path: `domains.${domainName}.version`, detail: 'must be a non-negative integer when present' })
      }
      for (const [tableName, table] of Object.entries(domain['tables'])) {
        if (!isRecord(table)) {
          problems.push({ path: `domains.${domainName}.tables.${tableName}`, detail: 'must be an object' })
          continue
        }
        for (const [key, row] of Object.entries(table)) {
          const path = `domains.${domainName}.tables.${tableName}.${key}`
          if (!isRecord(row)) {
            problems.push({ path, detail: 'must be an object' })
            continue
          }
          if (typeof row['deleted'] !== 'boolean') problems.push({ path, detail: 'deleted must be a boolean' })
          else if (!row['deleted'] && !Object.hasOwn(row, 'value')) {
            problems.push({ path, detail: 'a live row must carry value' })
          }
        }
      }
    }
  }
  const skills = value['skills']
  if (!isRecord(skills)) {
    problems.push({ path: 'skills', detail: 'must be an object' })
  } else {
    for (const [name, content] of Object.entries(skills)) {
      if (content !== null && typeof content !== 'string') {
        problems.push({ path: `skills.${name}`, detail: 'must be a string or null' })
      } else if (typeof content === 'string' && !SKILL_BUNDLE_NAME.test(name)) {
        problems.push({ path: `skills.${name}`, detail: 'name must be a lowercase hyphenated skill bundle name' })
      }
    }
  }
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, document: value as unknown as FaberLoomMirrorDocument }
}
