/**
 * Public type vocabulary of the shared Session catalog: one Space's Sessions as
 * a portable, per-member record and its on-demand content. Types only — the
 * service lives in `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-session-shares/src/types
 */

/** Where one shared Session row came from. */
export type FaberLoomSharedSessionOrigin = 'owner' | 'console'

/** One Session recorded in a Space's shared catalog, without its content. */
export interface FaberLoomSharedSession {
  /** Session id on its author's host. */
  readonly sessionId: string
  /** Email of the member whose host holds the Session. */
  readonly ownerId: string
  /** Space the Session is shared in. */
  readonly spaceId: string
  /** Display title as its author saw it. */
  readonly title: string
  /** Workspace the Session ran in, when known. */
  readonly workspaceId: string | null
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-change instant. */
  readonly updatedAt: string
  /** Committed event count. */
  readonly messageCount: number
  /** Whether this host captured it or imported it from the console. */
  readonly origin: FaberLoomSharedSessionOrigin
}

/** One shared Session with its portable log content. */
export interface FaberLoomSharedSessionContent extends FaberLoomSharedSession {
  /** Canonical JSONL log text. */
  readonly content: string
}

/** Input accepted when capturing one local Session into a Space. */
export interface FaberLoomSharedSessionCapture {
  /** Space to share the Session in. */
  readonly spaceId: string
  /** Session id on this host. */
  readonly sessionId: string
  /** Display title. */
  readonly title: string
  /** Workspace the Session ran in, when known. */
  readonly workspaceId?: string | null
  /** ISO-8601 creation instant; defaults to now. */
  readonly createdAt?: string
  /** ISO-8601 last-change instant; defaults to now. */
  readonly updatedAt?: string
  /** Committed event count; defaults to 0. */
  readonly messageCount?: number
  /** Canonical JSONL log text. */
  readonly content: string
}
