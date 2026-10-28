/**
 * Projection of the editable draft: the content of the current revision and one
 * origin entry per editable field, so every field of the draft is either linked
 * to the source it came from or explicitly marked as having no origin (W-36).
 * @module @deepseek-ai/dsh-faberloom-board/src/projection
 */

import type { BoardFieldOriginEntry } from './types.ts'

/** The revision fields this projection reads. */
interface RevisionContent {
  /** Editable content, or null in a revision written before it existed. */
  readonly content: Readonly<Record<string, unknown>> | null
  /** Display summary, which a legacy revision carries in place of content. */
  readonly summary: string
}

/** One editable part of the artifact content. */
interface ContentRecord {
  readonly [key: string]: unknown
}

/**
 * The editable content of one revision. A revision written before the draft
 * carried content exposes its summary as the only editable field, so the
 * projection never invents a value the record does not hold.
 * @param revision - the current revision, or undefined for an empty item.
 * @returns the content the editor and the checks read.
 */
export function revisionContent(
  revision: RevisionContent | undefined,
): Record<string, unknown> {
  if (revision === undefined) return {}
  return revision.content === null ? { summary: revision.summary } : { ...revision.content }
}

/**
 * Whether one value is a plain JSON object the projection may descend into.
 * @param value - any content value.
 * @returns true for a non-null, non-array object.
 */
export function isContentRecord(value: unknown): value is ContentRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Every editable field path of one content record, in a stable order: a
 * top-level key, then one path per key of an object value, or one path per key
 * of each object element of an array value.
 * @param content - the artifact content.
 * @returns field paths such as `total`, `lines`, and `lines[0].unitPrice`.
 */
export function fieldPaths(content: Readonly<Record<string, unknown>>): string[] {
  const paths: string[] = []
  for (const key of Object.keys(content).sort()) {
    const value = content[key]
    paths.push(key)
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        if (!isContentRecord(entry)) return
        for (const nested of Object.keys(entry).sort()) paths.push(`${key}[${index}].${nested}`)
      })
      continue
    }
    if (!isContentRecord(value)) continue
    for (const nested of Object.keys(value).sort()) paths.push(`${key}.${nested}`)
  }
  return paths
}

/**
 * Project one origin entry per editable field. A field the item declared an
 * origin for keeps it; every other field carries the explicit no-origin mark
 * instead of silently appearing sourced (W-36).
 * @param content - the artifact content.
 * @param declared - origins the run declared for its fields.
 * @returns one entry per field of {@link fieldPaths}.
 */
export function fieldOriginsOf(
  content: Readonly<Record<string, unknown>>,
  declared: readonly BoardFieldOriginEntry[],
): BoardFieldOriginEntry[] {
  const byField = new Map(declared.map(entry => [entry.field, entry]))
  return fieldPaths(content).map(field => byField.get(field) ?? { field, source: null, ref: null, at: null })
}

/** The top-level content key one field path belongs to. */
function topKeyOf(field: string): string {
  const separator = field.search(/[.[]/)
  return separator === -1 ? field : field.slice(0, separator)
}

/**
 * Origins after one edit. An edit replaces the value a field held, so the
 * source link of every field under a changed key is dropped and the changed key
 * is marked without origin; leaving the old link would claim the new value came
 * from the old source.
 * @param previous - origins before the edit.
 * @param changed - top-level content keys the edit wrote.
 * @returns the origins to persist with the new revision.
 */
export function mergeOrigins(
  previous: readonly BoardFieldOriginEntry[],
  changed: readonly string[],
): BoardFieldOriginEntry[] {
  const changedKeys = new Set(changed)
  const kept = previous.filter(entry => !changedKeys.has(topKeyOf(entry.field)))
  return [...kept, ...changed.map(field => ({ field, source: null, ref: null, at: null }))]
}
