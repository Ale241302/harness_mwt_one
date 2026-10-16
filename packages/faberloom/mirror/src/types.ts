/**
 * Public types of the FaberLoom mirror service: the versioned transfer document
 * shared with the gateway, and the results one pull or push reports. The
 * document is the stable wire value both sides exchange, so it is defined once
 * here and consumed by the MCP tools and the desktop client unchanged.
 * @module @deepseek-ai/dsh-faberloom-mirror/src/types
 */

/** One transferable record: the stored value, or a tombstone for a deletion. */
export interface FaberLoomMirrorRow {
  /** Whether the key is deleted on the emitting side; a tombstone carries no value. */
  readonly deleted: boolean
  /** The stored value when `deleted` is false. */
  readonly value?: unknown
}

/** One domain of a transfer document: declared tables, each keyed by record key. */
export interface FaberLoomMirrorDomain {
  /**
   * Format version the emitting side's medium stamps for this domain. The
   * receiver needs it to create a document it does not hold yet, because only
   * the medium knows the version its owner validates. Absent when the emitting
   * side had no medium to read it from.
   */
  readonly version?: number
  /** Declared table name to record key to row. */
  readonly tables: Readonly<Record<string, Readonly<Record<string, FaberLoomMirrorRow>>>>
}

/** The transfer document both sides exchange; `null` for a skill means deleted. */
export interface FaberLoomMirrorDocument {
  /** Format version; the receiver refuses a version it does not know. */
  readonly version: number
  /** Whether this side is the deployed host or the local desktop. */
  readonly platform: 'web' | 'desktop'
  /** Domain name to declared tables of that domain. */
  readonly domains: Readonly<Record<string, FaberLoomMirrorDomain>>
  /** Skill bundle name to `SKILL.md` text, or `null` for a deletion. */
  readonly skills: Readonly<Record<string, string | null>>
}

/** One row a pull applied, or refused to apply under the conflict rule. */
export interface FaberLoomMirrorRowChange {
  /** Declared domain name. */
  readonly domain: string
  /** Declared table name. */
  readonly table: string
  /** Record key. */
  readonly key: string
}

/** Locations a pull or push could not reach in this process. */
export interface FaberLoomMirrorSkip {
  /** Declared domain name the process does not have open, or a skill bundle name. */
  readonly domain: string
  /** Declared table name, or `skills` for a skill bundle. */
  readonly table: string
  /** Why it was skipped. */
  readonly reason: string
}

/** What one pull or push of a mirror cycle did. */
export interface FaberLoomMirrorSyncResult {
  /** Rows the remote reported or the local document held, in arrival order. */
  readonly rows: readonly FaberLoomMirrorRowChange[]
  /** Rows written from the document. */
  readonly applied: readonly FaberLoomMirrorRowChange[]
  /** Rows the local journal protected from overwrite; they are sent back on the next push. */
  readonly keptLocal: readonly FaberLoomMirrorRowChange[]
  /** Rows whose local value never reached the remote. */
  readonly pushed: readonly FaberLoomMirrorRowChange[]
  /** Skill bundles written from the document. */
  readonly skillsApplied: readonly string[]
  /** Locations this process could not reach. */
  readonly skipped: readonly FaberLoomMirrorSkip[]
}
