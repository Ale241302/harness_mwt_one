/**
 * The remote-board capability the service consumes when a deployment moves the
 * Mesa to the central PostgreSQL API (`gateway/board-api.mjs`). The board owns
 * the mode switch and the read/write routing; this module owns the port and the
 * activation settings, and `remote.ts` owns the HTTP client for `/board`. An
 * adapter implements this port on top of that client (or any other transport)
 * and is mounted with `faberloomBoard.useRemote`.
 *
 * The port mirrors the service surface one operation per command, so a caller
 * in `on` mode gets the remote answer unchanged: the adapter owns transport,
 * authentication, timeout, and retry, and maps a transport failure to a stable
 * `faberloom:` error (or lets it surface, and the board reports
 * `REMOTE_UNAVAILABLE`).
 * @module @deepseek-ai/dsh-faberloom-board/remote-port
 */

import type {
  BoardActor,
  BoardApproveInput,
  BoardAssignment,
  BoardDiscardInput,
  BoardEditsInput,
  BoardIterateInput,
  BoardIterationResult,
  BoardSeverity,
  BoardState,
  BoardStatus,
  BoardWriter,
  FaberLoomBoardItem,
  FaberLoomBoardItemId,
} from './types.ts'

/**
 * Where reads and writes go.
 *
 * `off` keeps every operation in local storage and never calls the adapter;
 * `shadow` reads local and remote and reports what diverges but returns the
 * local answer and writes nothing remote; `on` reads and writes the remote and
 * never falls back to local storage.
 */
export type BoardRemoteMode = 'off' | 'shadow' | 'on'

/** The remote-board settings one deployment resolves from config or environment. */
export interface BoardRemoteConfig {
  /** Routing mode; absent means `off`. */
  readonly mode?: BoardRemoteMode
  /** Base URL of the central board API, without the `/board` prefix. */
  readonly baseUrl?: string | undefined
  /** Bearer credential the adapter sends; the board never logs it. */
  readonly token?: string | undefined
  /** Entity this process selects among the actor's entities; absent uses the token's tenant. */
  readonly tenant?: string | undefined
}

/** The settings a {@link BoardRemoteAdapterFactory} receives when the board first needs the remote. */
export interface BoardRemoteSettings {
  /** Base URL from {@link BoardRemoteConfig.baseUrl}. */
  readonly baseUrl: string | undefined
  /** Bearer credential from {@link BoardRemoteConfig.token}. */
  readonly token: string | undefined
  /** Selected entity from {@link BoardRemoteConfig.tenant}. */
  readonly tenant?: string | undefined
}

/** Environment variable names of the activation contract. */
export const BOARD_REMOTE_ENV = {
  /** `off` (default), `shadow`, or `on`. */
  mode: 'FABERLOOM_BOARD_REMOTE',
  /** Central API base URL, for example `https://mesa.example.com`. */
  baseUrl: 'FABERLOOM_BOARD_REMOTE_URL',
  /** Bearer credential for the central API. */
  token: 'FABERLOOM_BOARD_REMOTE_TOKEN',
  /** Entity the process reads and writes, when the actor belongs to several. */
  tenant: 'FABERLOOM_BOARD_REMOTE_TENANT',
} as const

/**
 * Read the activation contract from the environment. Config wins over these
 * values; this is the fallback a deployment uses when it configures the board
 * from environment variables instead of `cordis.yml`.
 * @param env - environment to read; `process.env` by default.
 * @returns the settings, or undefined when the mode variable is absent.
 * @throws when the mode names a value outside `off`, `shadow`, and `on`.
 */
export function boardRemoteConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): BoardRemoteConfig | undefined {
  const raw = env[BOARD_REMOTE_ENV.mode]?.trim().toLowerCase()
  if (raw === undefined || raw.length === 0) return undefined
  if (raw !== 'off' && raw !== 'shadow' && raw !== 'on') {
    throw new Error(`faberloom: REMOTE_CONFIG_INVALID — ${BOARD_REMOTE_ENV.mode} must be off, shadow, or on`)
  }
  return {
    mode: raw,
    baseUrl: env[BOARD_REMOTE_ENV.baseUrl]?.trim() || undefined,
    token: env[BOARD_REMOTE_ENV.token]?.trim() || undefined,
    tenant: env[BOARD_REMOTE_ENV.tenant]?.trim() || undefined,
  }
}

/**
 * One field whose local and remote values disagree. A missing item reports the
 * `id` field with the side that has no row as `null`.
 */
export interface BoardRemoteFieldDivergence {
  /** Compared field; `id` also carries presence. */
  readonly field: 'id' | 'state' | 'rowVersion' | 'artifactHash'
  /** Value in local storage, or null when the row is absent there. */
  readonly local: string | number | null
  /** Value in the remote board, or null when the row is absent there. */
  readonly remote: string | number | null
}

/** One item whose shadow comparison found a difference. */
export interface BoardRemoteDivergence {
  /** Item the difference belongs to. */
  readonly itemId: string
  /** Every field that disagrees, in comparison order. */
  readonly fields: readonly BoardRemoteFieldDivergence[]
  /** Instant the comparison ran. */
  readonly at: string
}

/** The remote board as the service consumes it. */
export interface BoardRemoteAdapter {
  /** List the actor's items, applying the same filters as the local service. */
  list(
    actor: BoardActor,
    filter?: { readonly status?: BoardStatus; readonly state?: BoardState; readonly spaceId?: string },
  ): Promise<FaberLoomBoardItem[]>
  /** Read one item the actor may see. The adapter authenticates with its token. */
  get(actor: BoardActor | undefined, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem>
  /**
   * Record that the credential's actor opened a restricted item (N3/N4).
   *
   * The actor is the one the adapter's token names, never the `actor` argument
   * and never a body field: an implementation that cannot resolve an identity
   * must refuse instead of writing an anonymous event. The API keeps at most one
   * `access` event per actor, item, and hour, so a panel that re-reads the same
   * item calls this freely; the call does not move the item's `rowVersion`.
   * @param actor - ignored by the adapter; the identity travels in the credential.
   * @param id - item id.
   * @param detail - what the read was for, as the panel knows it.
   */
  noteAccess(actor: BoardActor | undefined, id: FaberLoomBoardItemId, detail: string): Promise<void>
  /**
   * Persist one item the service just created. The record travels whole; the
   * API owns the id, the owner, and the tenant.
   */
  create(writer: BoardWriter | undefined, item: FaberLoomBoardItem): Promise<FaberLoomBoardItem>
  /**
   * Persist one command the service already validated. The complete record
   * travels in the body, so the remote store keeps revisions, controls, the
   * candidate, and the iteration lock; `expectedRowVersion` is the optimistic
   * token the service read.
   */
  commit(
    writer: BoardWriter | undefined,
    id: FaberLoomBoardItemId,
    input: BoardRemoteCommitInput,
  ): Promise<FaberLoomBoardItem>
  /** Record the severity and its source. */
  setSeverity(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    severity: BoardSeverity,
    source?: 'RULE' | 'LLM' | 'HUMAN',
    confidence?: number | null,
    expectedRowVersion?: number,
    doubts?: readonly string[],
  ): Promise<FaberLoomBoardItem>
  /** Approve the exact artifact version the caller reviewed. */
  approve(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardApproveInput): Promise<FaberLoomBoardItem>
  /** Discard the item with a signed reason. */
  discard(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardDiscardInput): Promise<FaberLoomBoardItem>
  /** Save inline edits as a new revision. */
  saveEdits(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardEditsInput): Promise<FaberLoomBoardItem>
  /** Assign a Space to the item, resolving a business-key collision remotely. */
  assignWorkspace(writer: BoardWriter, id: FaberLoomBoardItemId, workspaceId: string): Promise<BoardAssignment>
  /** Start one iteration attempt over the current artifact version. */
  iterate(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardIterateInput): Promise<BoardIterationResult>
}

/** One command the service already validated, sent as a complete record. */
export interface BoardRemoteCommitInput {
  /** Optimistic token the service read. A mismatch is `409 STALE_ROW`. */
  readonly expectedRowVersion: number
  /** Command name the audit log records. */
  readonly command: string
  /** Record after the command, with its row token already incremented. */
  readonly record: FaberLoomBoardItem
}

/**
 * Build the adapter from the resolved settings, once per mounted factory. The
 * board calls it on the first remote operation and keeps the instance until the
 * registration is disposed.
 */
export type BoardRemoteAdapterFactory = (settings: BoardRemoteSettings) => BoardRemoteAdapter
