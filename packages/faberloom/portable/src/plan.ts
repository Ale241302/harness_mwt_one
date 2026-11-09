/**
 * The pure planner: merge the child and the allowed parent contributions,
 * apply the classification allowlist and the secret/session rules, resolve the
 * dependency graph, and produce a complete inventory with a canonical digest.
 * Nothing here writes to disk or reads a source.
 * @module @deepseek-ai/dsh-faberloom-portable/src/plan
 */

import { sha256OfCanonical, sha256OfText } from './canonical.ts'
import { portableError } from './errors.ts'
import { aliasKey, assertArtifactPath, pathsOverlap } from './paths.ts'
import {
  allowedClassification,
  contributionHasSecret,
  declaredClassification,
  hasDeclaredClassification,
  isSessionOrTranscript,
} from './policy.ts'
import type {
  PortableArtifactFile,
  PortableClassification,
  PortableContribution,
  PortableFileEntry,
  PortableManifest,
  PortablePlan,
  PortableRejection,
  PortableRequest,
} from './types.ts'

/** Artifact format version this planner writes. */
export const PORTABLE_FORMAT_VERSION = 1

/** Default per-file ceiling. */
export const DEFAULT_PORTABLE_MAX_BYTES = 1024 * 1024

/** Commit id shape accepted as a fixed revision: full SHA-1 or SHA-256. */
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u

/** A contribution that survived filtering and path assignment. */
interface Accepted {
  readonly source: PortableContribution
  readonly path: string
  readonly classification: PortableClassification
  readonly origin: 'inherited' | 'child'
}

/** One candidate after merging a parent and a child contribution. */
interface Merged {
  readonly contribution: PortableContribution
  readonly origin: 'inherited' | 'child'
}

/**
 * Whether a value is a non-empty bounded text.
 * @param value - the value to check.
 * @param max - byte ceiling.
 * @returns true when the value is a string in range.
 */
function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

/**
 * Validate the identity and version fields of one request.
 * @param request - the request to validate.
 * @returns the byte ceiling.
 * @throws {Error} `PORTABLE_REQUEST_INVALID`.
 */
function assertRequest(request: PortableRequest): number {
  if (!bounded(request.identity.spaceId, 128)) throw portableError('PORTABLE_REQUEST_INVALID', 'spaceId is missing')
  if (!bounded(request.identity.spaceTitle, 200)) throw portableError('PORTABLE_REQUEST_INVALID', 'spaceTitle is missing')
  if (!REVISION.test(request.identity.editorialRevision)) {
    throw portableError('PORTABLE_REQUEST_INVALID', 'editorialRevision is not a full commit id')
  }
  const parent = request.identity.parentRevision
  if (parent !== undefined && parent !== null && !REVISION.test(parent)) {
    throw portableError('PORTABLE_REQUEST_INVALID', 'parentRevision is not a full commit id')
  }
  if ((request.inherited?.length ?? 0) > 0 && (parent === undefined || parent === null)) {
    throw portableError('PORTABLE_REQUEST_INVALID', 'an inherited contribution needs a parentRevision')
  }
  if (!bounded(request.softwareVersion, 64)) throw portableError('PORTABLE_REQUEST_INVALID', 'softwareVersion is missing')
  if (Number.isNaN(Date.parse(request.generatedAt))) throw portableError('PORTABLE_REQUEST_INVALID', 'generatedAt is not a date')
  const maxBytes = request.maxBytes ?? DEFAULT_PORTABLE_MAX_BYTES
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw portableError('PORTABLE_REQUEST_INVALID', 'maxBytes is not positive')
  return maxBytes
}

/**
 * Merge the parent and child contributions. A child replaces the parent's
 * contribution with the same id; an excluded id or path is omitted without a
 * report, because the exclusion wins. A parent contribution is considered only
 * when it is inheritable and granted by contribution.
 * @param request - the request to merge.
 * @param reject - collects the restricted-parent refusal.
 * @returns the candidates keyed by contribution id.
 */
function mergeContributions(
  request: PortableRequest,
  reject: (path: string, reason: string) => void,
): Map<string, Merged> {
  const excluded = new Set(request.exclusions ?? [])
  const merged = new Map<string, Merged>()
  let restrictedSeen = false
  for (const contribution of request.inherited ?? []) {
    if (excluded.has(contribution.id) || excluded.has(contribution.path)) continue
    if (contribution.inheritable !== true || contribution.granted !== true) {
      if (!restrictedSeen) {
        restrictedSeen = true
        reject('(restricted)', 'inheritance-denied')
      }
      continue
    }
    merged.set(contribution.id, { contribution, origin: 'inherited' })
  }
  const childCounts = new Map<string, number>()
  for (const contribution of request.contributions) {
    childCounts.set(contribution.id, (childCounts.get(contribution.id) ?? 0) + 1)
  }
  for (const contribution of request.contributions) {
    if ((childCounts.get(contribution.id) ?? 0) > 1) {
      merged.delete(contribution.id)
      reject(contribution.path, 'name-conflict')
      continue
    }
    const previous = merged.get(contribution.id)
    if (previous !== undefined && previous.contribution.kind !== contribution.kind) {
      merged.delete(contribution.id)
      reject(contribution.path, 'name-conflict')
      continue
    }
    merged.set(contribution.id, { contribution, origin: 'child' })
  }
  return merged
}

/** The media type of one accepted kind. */
function mediaTypeOf(contribution: PortableContribution): string {
  return contribution.mediaType ?? (
    contribution.kind === 'document' || contribution.kind === 'context' || contribution.kind === 'skill' || contribution.kind === 'agent'
      ? 'text/markdown; charset=utf-8'
      : contribution.kind === 'resource'
        ? 'text/plain; charset=utf-8'
        : 'application/json; charset=utf-8'
  )
}

/**
 * Build the complete plan for one request.
 * @param request - identity, revisions, contributions, and limits.
 * @returns files, manifest, digest, and per-file rejections.
 * @throws {Error} `PORTABLE_REQUEST_INVALID` when identity or versions are invalid.
 */
export function planPortable(request: PortableRequest): PortablePlan {
  const maxBytes = assertRequest(request)
  const rejected = new Map<string, PortableRejection>()
  const reject = (path: string, reason: string): void => {
    rejected.set(`${path}\u0000${reason}`, { path, reason })
  }

  const merged = mergeContributions(request, reject)
  const rejectedIds = new Set<string>()
  const survivors = new Map<string, Accepted>()
  for (const [id, entry] of [...merged.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const contribution = entry.contribution
    if (isSessionOrTranscript(contribution)) {
      rejectedIds.add(id)
      reject('(restricted)', 'session-transcript')
      continue
    }
    const declared = declaredClassification(contribution)
    const classification = allowedClassification(declared)
    if (classification === undefined) {
      rejectedIds.add(id)
      const hasDeclaration = hasDeclaredClassification(contribution)
      reject('(restricted)', hasDeclaration ? 'classification-denied' : 'classification-missing')
      continue
    }
    if (contributionHasSecret(contribution)) {
      rejectedIds.add(id)
      reject('(restricted)', 'secret')
      continue
    }
    let path: string
    try {
      path = assertArtifactPath(contribution.path)
    } catch {
      rejectedIds.add(id)
      reject('(invalid)', 'path-invalid')
      continue
    }
    if (Buffer.byteLength(contribution.content, 'utf8') > maxBytes) {
      rejectedIds.add(id)
      reject(path, 'too-large')
      continue
    }
    survivors.set(id, { source: contribution, path, classification, origin: entry.origin })
  }

  // A path can be claimed once. Two different ids at the same path, or one
  // file used as the other's directory, are a name conflict and both are
  // refused rather than resolved by read order.
  const byAlias = new Map<string, string>()
  for (const [id, accepted] of [...survivors.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const key = aliasKey(accepted.path)
    const other = byAlias.get(key)
    if (other !== undefined) {
      survivors.delete(id)
      survivors.delete(other)
      rejectedIds.add(id)
      rejectedIds.add(other)
      reject(accepted.path, 'name-conflict')
      continue
    }
    byAlias.set(key, id)
  }
  const remaining = [...survivors.entries()]
  for (let index = 0; index < remaining.length; index += 1) {
    for (let other = index + 1; other < remaining.length; other += 1) {
      const left = remaining[index]
      const right = remaining[other]
      if (left === undefined || right === undefined) continue
      const [leftId, leftAccepted] = left
      const [rightId, rightAccepted] = right
      if (!pathsOverlap(leftAccepted.path, rightAccepted.path)) continue
      survivors.delete(leftId)
      survivors.delete(rightId)
      rejectedIds.add(leftId)
      rejectedIds.add(rightId)
      reject(leftAccepted.path, 'name-conflict')
    }
  }

  // Dependencies resolve only against ids the request offered. A missing,
  // restricted, session, or cyclic dependency refuses the dependent; nothing
  // is silently dropped from a document that still refers to it.
  let changed = true
  while (changed) {
    changed = false
    for (const [id, accepted] of [...survivors.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const dependencies = accepted.source.dependsOn ?? []
      const failing = dependencies.find(dependency => (
        dependency === id
        || !merged.has(dependency)
        || rejectedIds.has(dependency)
        || !survivors.has(dependency)
      ))
      if (failing === undefined) continue
      survivors.delete(id)
      rejectedIds.add(id)
      reject(accepted.path, failing === id ? 'dependency-cycle' : (merged.has(failing) ? 'dependency-rejected' : 'dependency-missing'))
      changed = true
    }
  }

  // A cycle among surviving nodes has no missing edge, so it needs its own
  // pass before the final dependency fixpoint above can run again.
  const state = new Map<string, 'visiting' | 'done'>()
  const cycle = new Set<string>()
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'visiting') {
      const start = trail.indexOf(id)
      for (const member of trail.slice(start)) cycle.add(member)
      return
    }
    state.set(id, 'visiting')
    for (const dependency of survivors.get(id)?.source.dependsOn ?? []) {
      if (survivors.has(dependency)) visit(dependency, [...trail, id])
    }
    state.set(id, 'done')
  }
  for (const id of [...survivors.keys()].sort()) visit(id, [])
  for (const id of cycle) {
    const accepted = survivors.get(id)
    if (accepted === undefined) continue
    survivors.delete(id)
    rejectedIds.add(id)
    reject(accepted.path, 'dependency-cycle')
  }
  changed = true
  while (changed) {
    changed = false
    for (const [id, accepted] of [...survivors.entries()]) {
      const failing = (accepted.source.dependsOn ?? []).find(dependency => rejectedIds.has(dependency) || !survivors.has(dependency))
      if (failing === undefined) continue
      survivors.delete(id)
      rejectedIds.add(id)
      reject(accepted.path, 'dependency-rejected')
      changed = true
    }
  }

  const files: PortableArtifactFile[] = []
  const inventory: PortableFileEntry[] = []
  for (const accepted of [...survivors.values()].sort((left, right) => left.path.localeCompare(right.path))) {
    const content = accepted.source.content
    files.push({
      path: accepted.path,
      content,
      kind: accepted.source.kind,
      mediaType: mediaTypeOf(accepted.source),
      classification: accepted.classification,
    })
    inventory.push({
      path: accepted.path,
      kind: accepted.source.kind,
      mediaType: mediaTypeOf(accepted.source),
      bytes: Buffer.byteLength(content, 'utf8'),
      sha256: sha256OfText(content),
      metadataSha256: sha256OfCanonical(accepted.source.metadata ?? {}),
      classification: accepted.classification,
      origin: accepted.origin,
    })
  }
  const contentVersion = `sha256:${sha256OfCanonical(inventory)}`
  const unsigned = {
    formatVersion: PORTABLE_FORMAT_VERSION,
    contentVersion,
    softwareVersion: request.softwareVersion,
    space: { id: request.identity.spaceId, title: request.identity.spaceTitle },
    editorialRevision: request.identity.editorialRevision,
    parentRevision: request.identity.parentRevision ?? null,
    generatedAt: request.generatedAt,
    files: inventory,
  }
  const digest = sha256OfCanonical(unsigned)
  const manifest: PortableManifest = { ...unsigned, digest }
  return {
    manifest,
    files,
    digest,
    rejected: [...rejected.values()].sort((left, right) => left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason)),
  }
}
