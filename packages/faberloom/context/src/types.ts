/**
 * Public type vocabulary of the Workspace/Space Context module: a versioned,
 * approvable store of facts and rules a Space shares, separate from the episodic
 * Memory. Types only — the service lives in `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-context/src/types
 */

/**
 * Who may see one context entry:
 * - `local` — only its author,
 * - `pending` — its author and the Space owner, waiting for approval,
 * - `shared` — indexed into the Space's general context, everyone with `view`.
 */
export type FaberLoomContextVisibility = 'local' | 'pending' | 'shared'

/** One context entry as consumers read it. */
export interface FaberLoomContextEntry {
  /** Stable entry id. */
  readonly id: string
  /** Space the entry belongs to, or null for the personal scope. */
  readonly spaceId: string | null
  /** Display title. */
  readonly title: string
  /** Context body. */
  readonly body: string
  /** Monotonic version. */
  readonly version: number
  /** Who may see it. */
  readonly visibility: FaberLoomContextVisibility
  /** Email of the identity that first created the entry. */
  readonly authorId: string
  /** Email of the Space owner the entry is indexed to (the author when personal). */
  readonly ownerId: string
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-change instant. */
  readonly updatedAt: string
}

/** One stored version of a context entry. */
export interface FaberLoomContextVersion {
  /** Version number. */
  readonly version: number
  /** Title at that version. */
  readonly title: string
  /** Body at that version. */
  readonly body: string
  /** Who wrote that version. */
  readonly authorId: string
  /** ISO-8601 instant that version was written. */
  readonly createdAt: string
}

/** Input accepted when creating one context entry. */
export interface FaberLoomContextInput {
  /** Space to attach the entry to, or null/absent for the personal scope. */
  readonly spaceId?: string | null | undefined
  /** Display title. */
  readonly title: string
  /** Context body. */
  readonly body: string
}

/** Input accepted when editing one context entry. */
export interface FaberLoomContextEdit {
  /** New title. */
  readonly title?: string | undefined
  /** New body. */
  readonly body?: string | undefined
}

/** One exported context entry with its full version history. */
export interface FaberLoomContextExportEntry {
  /** Stable entry id. */
  readonly id: string
  /** Space the entry belongs to, or null for the personal scope. */
  readonly spaceId: string | null
  /** Display title. */
  readonly title: string
  /** Current body. */
  readonly body: string
  /** Current version. */
  readonly version: number
  /** Author of the current version. */
  readonly authorId: string
  /** ISO-8601 last-change instant. */
  readonly updatedAt: string
  /** Every stored version, newest first. */
  readonly versions: readonly FaberLoomContextVersion[]
}

/** The portable export of a context record. */
export interface FaberLoomContextExport {
  /** Suggested file name. */
  readonly filename: string
  /** Export body: JSON or Markdown. */
  readonly content: string
  /** Number of entries exported. */
  readonly entries: number
}

/** Options accepted when exporting a context record. */
export interface FaberLoomContextExportOptions {
  /** Restrict the export to one Space; absent exports the personal scope plus every Space. */
  readonly spaceId?: string | undefined
  /** Output format; defaults to `json`. */
  readonly format?: 'json' | 'markdown' | undefined
}

/** One entry input of a wholesale replace. */
export interface FaberLoomContextReplaceEntry {
  /** Display title. */
  readonly title: string
  /** Context body. */
  readonly body: string
}

/** The result of importing a context record. */
export interface FaberLoomContextImportResult {
  /** Entries created. */
  readonly created: number
  /** Entries skipped because an equal title already existed. */
  readonly skipped: number
}
