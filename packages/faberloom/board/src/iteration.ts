/**
 * The iteration machine of one board item (§9.7.1): the attempt a lock holds,
 * the working draft linked to its base version, and the per-item round counter.
 *
 * Every helper is pure over one record plus an explicit clock, so the service
 * keeps authorization and the single `KvTable.update` commit, and a reader
 * resolves the same phase the next write enforces. The attempt's
 * `iterationLockBy` is part of the write predicate, so only the tab session that
 * opened it may write. An `ITERANDO` record whose deadline passed has already
 * ended: it reads and behaves as "Guardar y salir" (W-44), and no helper here
 * revives it.
 * @module @deepseek-ai/dsh-faberloom-board/src/iteration
 */

import type { BoardIterationDraftRecord } from './spec.ts'
import type {
  BoardCandidateChoice,
  BoardIterationDraft,
  BoardIterationDifference,
  BoardIterationLockInput,
  BoardIterationPhase,
  BoardIterationStatus,
  BoardState,
} from './types.ts'

/** Deployment choices the iteration machine reads; the service resolves them from `Config`. */
export interface IterationPolicy {
  /** Seconds a client waits between renewals (D-09: 30). */
  readonly renewalSeconds: number
  /** Seconds an attempt lives without activity (D-09: 900). */
  readonly lockSeconds: number
  /** Days a working draft stays recoverable (D-09: 30). */
  readonly retentionDays: number
  /** Applied rounds after which the panel suggests rewriting or discarding (D-10: 5). */
  readonly roundLimit: number
}

/** The record fields the iteration machine reads; the public item carries the same ones. */
export interface IterationFields {
  /** Persisted state; `ITERANDO` is the only state that carries an attempt. */
  readonly state: string | null
  /** Current artifact version. */
  readonly version: number
  /** Current attempt, or null. */
  readonly iterationId: string | null
  /** Artifact version the attempt started from, or null. */
  readonly iterationBaseVersion: number | null
  /** Lock deadline, or null. */
  readonly iterationLockUntil: string | null
  /** Lock generation. */
  readonly iterationLockGeneration: number
  /** Tab session holding the attempt, or null. */
  readonly iterationLockBy: string | null
  /** Linked draft key, or null. */
  readonly iterationDraftKey: string | null
  /** Applied rounds. */
  readonly iterationRoundCount: number
  /** Candidate waiting for an explicit choice, or null. */
  readonly pendingCandidate: { readonly id: string; readonly hash: string } | null
}

/** The fields a new attempt writes. */
export interface AttemptFields {
  readonly state: 'ITERANDO'
  readonly status: 'in_progress'
  readonly iterationId: string
  readonly iterationBaseVersion: number
  readonly iterationLockUntil: string
  readonly iterationLockGeneration: number
  readonly iterationLockBy: string | null
}

/**
 * Lifecycle of the attempt one record carries.
 *
 * An `ITERANDO` record with no recorded deadline counts as live: absence of a
 * deadline is not evidence that the lock expired, and a record written before
 * this version of the service must keep refusing edits. Only a recorded
 * deadline in the past expires an attempt.
 * @param record - the stored item or its projection.
 * @param now - the server clock.
 * @returns the phase the panel shows and the next write enforces.
 */
export function iterationPhase(record: IterationFields, now: Date): BoardIterationPhase {
  if (record.state !== 'ITERANDO') return 'idle'
  if (record.iterationLockUntil === null) return 'active'
  const until = Date.parse(record.iterationLockUntil)
  return Number.isFinite(until) && until > now.getTime() ? 'active' : 'expired'
}

/**
 * The state a reader acts on. An expired attempt has ended, so the item reads
 * as `PENDIENTE_CRITERIO` even though the record still names `ITERANDO`; the
 * expiry is derived, never written by a read.
 * @param state - the persisted state.
 * @param record - the stored item.
 * @param now - the server clock.
 * @returns the effective state.
 */
export function stateAfterExpiry(state: BoardState, record: IterationFields, now: Date): BoardState {
  return state === 'ITERANDO' && iterationPhase(record, now) === 'expired' ? 'PENDIENTE_CRITERIO' : state
}

/**
 * The lock deadline a renewal or a new attempt writes.
 * @param policy - resolved iteration policy.
 * @param now - the server clock.
 * @returns the ISO-8601 deadline.
 */
export function lockDeadline(policy: IterationPolicy, now: Date): string {
  return new Date(now.getTime() + policy.lockSeconds * 1000).toISOString()
}

/**
 * The instant after which a draft is no longer offered (D-09).
 * @param policy - resolved iteration policy.
 * @param now - the server clock.
 * @returns the ISO-8601 retention limit.
 */
export function retainUntil(policy: IterationPolicy, now: Date): string {
  return new Date(now.getTime() + policy.retentionDays * 86_400_000).toISOString()
}

/**
 * Storage key of one attempt's draft.
 * @param itemId - item id.
 * @param iterationId - attempt id.
 * @returns `<itemId>:<iterationId>`.
 */
export function iterationDraftKeyOf(itemId: string, iterationId: string): string {
  return `${itemId}:${iterationId}`
}

/**
 * Project one stored draft for consumers.
 * @param key - storage key.
 * @param record - stored row.
 * @param now - the server clock, which decides whether the draft is still retained.
 * @returns the draft with its key and retention state.
 */
export function draftOf(key: string, record: BoardIterationDraftRecord, now: Date): BoardIterationDraft {
  return {
    key,
    itemId: record.itemId,
    transferredFrom: record.transferredFrom,
    iterationId: record.iterationId,
    baseVersion: record.baseVersion,
    summary: record.summary,
    evidence: [...record.evidence],
    content: record.content === null ? null : { ...record.content },
    archived: record.archived,
    superseded: record.superseded,
    outdated: record.outdated,
    updatedAt: record.updatedAt,
    retainUntil: record.retainUntil,
    retained: draftIsRetained(record, now),
  }
}

/**
 * Whether a stored draft is still offered (D-09 retention).
 * @param record - stored row.
 * @param now - the server clock.
 * @returns true while the draft is inside its retention window.
 */
export function draftIsRetained(record: BoardIterationDraftRecord, now: Date): boolean {
  return Date.parse(record.retainUntil) > now.getTime()
}

/**
 * Refuse a command that needs the item waiting for a decision. The caller
 * passes the effective state, so a legacy record and an expired attempt reach
 * the same rule.
 * @param state - effective state of the stored item.
 */
export function requirePending(state: BoardState): void {
  if (state !== 'PENDIENTE_CRITERIO') {
    throw new Error('faberloom: LOCK_LOST — the item is not waiting for a decision')
  }
}

/**
 * Why a write does not target the live attempt, or null when it does. `LOCK_LOST`
 * means the item is not iterating or the lock expired; `ITERATION_STALE` means
 * the caller names another attempt (W-43); `LOCK_HELD` means the caller's tab
 * session is not the attempt's holder (§9.7.1). Every iteration write consults
 * this, so a stale state, id, generation, or session has no effect (W-57).
 * @param record - the stored item.
 * @param input - attempt id, generation, and session the caller believes current.
 * @param now - the server clock.
 * @returns the stable rejection code, or null.
 */
export function attemptRejection(
  record: IterationFields,
  input: BoardIterationLockInput,
  now: Date,
): 'LOCK_LOST' | 'ITERATION_STALE' | 'LOCK_HELD' | null {
  if (record.state !== 'ITERANDO' || iterationPhase(record, now) === 'expired') return 'LOCK_LOST'
  if (record.iterationId !== input.iterationId) return 'ITERATION_STALE'
  if (record.iterationLockGeneration !== input.generation) return 'ITERATION_STALE'
  if (record.iterationLockBy !== input.actorSession) return 'LOCK_HELD'
  return null
}

/**
 * Refuse a write that names an attempt which is not live: the item left
 * `ITERANDO`, the lock expired, another attempt replaced this one, or another
 * tab session holds it.
 * @param record - the stored item.
 * @param input - attempt id, generation, and session the caller believes current.
 * @param now - the server clock.
 */
export function requireLiveAttempt(record: IterationFields, input: BoardIterationLockInput, now: Date): void {
  const code = attemptRejection(record, input, now)
  if (code === 'LOCK_LOST') {
    throw new Error('faberloom: LOCK_LOST — the item is not iterating or its lock expired')
  }
  if (code === 'ITERATION_STALE') {
    throw new Error('faberloom: ITERATION_STALE — the iteration id or lock generation is not current')
  }
  if (code === 'LOCK_HELD') requireAttemptHolder(record, input)
}

/**
 * Refuse a pause or a cancel that names another attempt. Both accept an expired
 * deadline because expiry is one of the exits they persist (`lock-vencido`),
 * and both require the caller's tab session to hold the attempt.
 * @param record - the stored item.
 * @param input - attempt id, generation, and session the caller believes current.
 */
export function requirePausableAttempt(record: IterationFields, input: BoardIterationLockInput): void {
  if (record.state !== 'ITERANDO' || record.iterationId === null) {
    throw new Error('faberloom: LOCK_LOST — the item is not iterating')
  }
  if (record.iterationId !== input.iterationId) {
    throw new Error('faberloom: ITERATION_STALE — the iteration id is not the current attempt')
  }
  if (record.iterationLockGeneration !== input.generation) {
    throw new Error('faberloom: ITERATION_STALE — the lock generation is not the current one')
  }
  requireAttemptHolder(record, input)
}

/**
 * Refuse a write issued from a tab session that is not the attempt's holder
 * (§9.7.1). A record with no recorded holder matches no session, so it keeps
 * refusing holder-bound writes until it expires or a new attempt replaces it.
 * @param record - the stored item.
 * @param input - the caller's attempt and tab session.
 */
export function requireAttemptHolder(record: IterationFields, input: BoardIterationLockInput): void {
  if (record.iterationLockBy !== input.actorSession) {
    throw new Error('faberloom: LOCK_HELD — another tab session holds the attempt')
  }
}

/**
 * Refuse a write whose base version is not the one the attempt runs over. The
 * check compares the caller's version with the item and with the attempt, so an
 * artifact that moved during the attempt makes the attempt stale instead of
 * letting it overwrite the newer content (W-57).
 * @param record - the stored item.
 * @param baseVersion - version the caller wrote against.
 */
export function requireAttemptBase(record: IterationFields, baseVersion: number): void {
  if (record.version !== baseVersion || record.iterationBaseVersion !== baseVersion) {
    throw new Error('faberloom: ITERATION_STALE — the iteration base version is not current')
  }
}

/**
 * Refuse a write made against an artifact version the caller did not see.
 * @param record - the stored item.
 * @param baseVersion - version the caller saw.
 */
export function requireBaseVersion(record: IterationFields, baseVersion: number): void {
  if (record.version !== baseVersion) {
    throw new Error('faberloom: STALE_REVISION — the artifact version is not the one the caller saw')
  }
}

/**
 * The fields a new attempt writes: a fresh id, the next generation, the base
 * version, the deadline, and the session that opened it. The artifact version
 * is untouched, so starting an iteration never changes the artifact (W-11).
 * @param record - the stored item.
 * @param policy - resolved iteration policy.
 * @param now - the server clock.
 * @param input - attempt id, base version, and tab session.
 * @returns the attempt fields to spread over the record.
 */
export function attemptFields(
  record: IterationFields,
  policy: IterationPolicy,
  now: Date,
  input: { readonly iterationId: string; readonly baseVersion: number; readonly session: string | null },
): AttemptFields {
  return {
    state: 'ITERANDO',
    status: 'in_progress',
    iterationId: input.iterationId,
    iterationBaseVersion: input.baseVersion,
    iterationLockUntil: lockDeadline(policy, now),
    iterationLockGeneration: record.iterationLockGeneration + 1,
    iterationLockBy: input.session,
  }
}

/**
 * The fields every exit writes: the lock is released, the attempt id is
 * invalidated, and the item returns to the pending column with its base
 * version and draft link intact (W-67).
 * @returns the released fields to spread over the record.
 */
export function releasedFields(): {
  state: 'PENDIENTE_CRITERIO'
  status: 'waiting_approval'
  iterationId: null
  iterationLockUntil: null
  iterationLockBy: null
} {
  return {
    state: 'PENDIENTE_CRITERIO',
    status: 'waiting_approval',
    iterationId: null,
    iterationLockUntil: null,
    iterationLockBy: null,
  }
}

/**
 * Refuse a command that must resolve a pending candidate, and refuse a choice
 * over a candidate that is no longer the last one (W-41, W-66).
 * @param record - the stored item.
 * @param choice - the explicit choice, when the caller supplied one.
 */
export function requireCandidateChoice(record: IterationFields, choice: BoardCandidateChoice | undefined): void {
  if (record.pendingCandidate === null) {
    if (choice !== undefined) {
      throw new Error('faberloom: CANDIDATE_STALE — the item has no candidate to resolve')
    }
    return
  }
  if (choice === undefined) {
    throw new Error('faberloom: CANDIDATE_PENDING — name which version wins before leaving the iteration')
  }
  if (record.pendingCandidate.id !== choice.id || record.pendingCandidate.hash !== choice.hash) {
    throw new Error('faberloom: CANDIDATE_STALE — the candidate is no longer the one the caller saw')
  }
}

/**
 * The fields where one retained draft and the current content disagree, sorted
 * by field. `resumeIteration` returns these instead of overwriting the newer
 * version (W-68).
 * @param draft - the retained draft.
 * @param current - content of the current revision.
 * @returns one entry per differing top-level key.
 */
export function draftDifferences(
  draft: BoardIterationDraft,
  current: Readonly<Record<string, unknown>>,
): BoardIterationDifference[] {
  const draftContent = draft.content ?? {}
  const fields = [...new Set([...Object.keys(draftContent), ...Object.keys(current)])].sort()
  const differences: BoardIterationDifference[] = []
  for (const field of fields) {
    const draftValue = draftContent[field]
    const currentValue = current[field]
    if (JSON.stringify(draftValue) === JSON.stringify(currentValue)) continue
    differences.push({ field, draftValue, currentValue })
  }
  return differences
}

/**
 * Whether the item reached the round limit. The counter lives on the item and
 * only produces a suggestion; no command blocks on it (D-10).
 * @param record - the stored item.
 * @param policy - resolved iteration policy.
 * @returns true when the panel should suggest rewriting or discarding.
 */
export function roundSuggestion(record: IterationFields, policy: IterationPolicy): boolean {
  return record.iterationRoundCount >= policy.roundLimit
}

/**
 * The attempt state the panel reads. `draft` is the draft the item offers: the
 * linked one, or the retained draft of an attempt it no longer links (W-57).
 * @param record - the stored item.
 * @param draft - draft the item offers, or null.
 * @param policy - resolved iteration policy.
 * @param now - the server clock.
 * @returns the status projection.
 */
export function iterationStatusOf(
  record: IterationFields,
  draft: BoardIterationDraft | null,
  policy: IterationPolicy,
  now: Date,
): BoardIterationStatus {
  return {
    phase: iterationPhase(record, now),
    iterationId: record.iterationId,
    generation: record.iterationLockGeneration,
    baseVersion: record.iterationBaseVersion,
    lockUntil: record.iterationLockUntil,
    lockBy: record.iterationLockBy,
    renewalSeconds: policy.renewalSeconds,
    rounds: record.iterationRoundCount,
    roundLimit: policy.roundLimit,
    suggestRewrite: roundSuggestion(record, policy),
    draft,
    draftLinked: draft !== null && record.iterationDraftKey === draft.key,
    draftOutdated: draft !== null && draft.baseVersion !== record.version,
    candidatePending: record.pendingCandidate !== null,
  }
}

/**
 * The draft row one save writes, merged over the previous row of the attempt so
 * a content-only answer never erases a summary the same attempt already wrote.
 * @param previous - row already stored for the attempt, or undefined.
 * @param input - item, attempt, base version, and the fields the caller wrote.
 * @param now - the server clock.
 * @param policy - resolved iteration policy.
 * @param archived - true when the attempt is dead, so the panel does not offer it.
 * @returns the row to store.
 */
export function draftRecordFor(
  previous: BoardIterationDraftRecord | undefined,
  input: {
    readonly itemId: string
    readonly iterationId: string
    readonly baseVersion: number
    readonly summary?: string | undefined
    readonly evidence?: readonly string[] | undefined
    readonly content?: Readonly<Record<string, unknown>> | undefined
  },
  now: Date,
  policy: IterationPolicy,
  archived: boolean,
): BoardIterationDraftRecord {
  return {
    itemId: input.itemId,
    transferredFrom: previous?.transferredFrom ?? null,
    iterationId: input.iterationId,
    baseVersion: input.baseVersion,
    summary: input.summary ?? previous?.summary ?? null,
    evidence: [...(input.evidence ?? previous?.evidence ?? [])],
    content: input.content === undefined
      ? previous?.content ?? null
      : { ...(previous?.content ?? {}), ...input.content },
    archived,
    superseded: previous?.superseded ?? false,
    outdated: false,
    updatedAt: now.toISOString(),
    retainUntil: retainUntil(policy, now),
  }
}
