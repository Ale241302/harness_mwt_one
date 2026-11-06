/**
 * Evidence of an editorial decision on a board item.
 *
 * `approve()` and `approveWithEdits()` write an {@link BoardApprovalEvidence}
 * beside the state transition. Every read then treats an `APROBADO` row as
 * authoritative only when that evidence still names the current artifact
 * version and hash. A row that arrives from the mirror, a backup restore, or a
 * hand edit without matching evidence reads as `PENDIENTE_CRITERIO`, so a
 * copied state cannot approve knowledge by itself (PROP-09).
 *
 * Legacy rows written before E10 carry no `state` and are left as they are: this
 * guard changes decisions made from now on, not history.
 *
 * @module @deepseek-ai/dsh-faberloom-board/src/knowledge-approval
 */

import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { FaberLoomBoardItemId } from './types.ts'
import type { BoardItemRecord } from './spec.ts'

/** The only source that may authorize an editorial approval. */
export const APPROVAL_SOURCE = 'human-session'

/** Why a row stopped reading as approved. */
export const APPROVAL_UNVERIFIED = 'APPROVAL_UNVERIFIED'

/** Evidence one committed human approval leaves on the item. */
export interface BoardApprovalEvidence {
  /** Where the action came from; only a session-backed human path qualifies. */
  readonly source: typeof APPROVAL_SOURCE
  /** Authenticated actor that performed the action. */
  readonly actor: string
  /** Commit instant, ISO 8601 UTC. */
  readonly at: string
  /** Artifact version the person saw and approved. */
  readonly version: number
  /** Artifact hash the person saw and approved. */
  readonly artifactHash: string
}

/**
 * Build the evidence for one approval.
 * @param actor - authenticated identity that approved.
 * @param version - artifact version the action was bound to.
 * @param artifactHash - artifact hash the action was bound to.
 * @param at - commit instant; defaults to now.
 * @returns the evidence to persist.
 */
export function approvalEvidence(
  actor: string,
  version: number,
  artifactHash: string,
  at: string = new Date().toISOString(),
): BoardApprovalEvidence {
  return { source: APPROVAL_SOURCE, actor, at, version, artifactHash }
}

/**
 * Whether the evidence still authorizes the record as approved.
 * @param record - stored item.
 * @returns `true` when the row may read as approved.
 */
export function approvalIsVerified(record: BoardItemRecord): boolean {
  // A row written before E10 carries no `state`; the effective state is derived
  // from `status`, so `status: 'approved'` must face the same evidence rule.
  const approved = record.state === 'APROBADO' || (record.state === null && record.status === 'approved')
  if (!approved) return true
  // A record written before the field existed reaches this guard without a
  // parsed default when storage hands back the raw document.
  const evidence = record.approvalEvidence as BoardItemRecord['approvalEvidence'] | undefined
  if (evidence === null || evidence === undefined || (evidence.source as string) !== APPROVAL_SOURCE) return false
  if (evidence.actor.trim().length === 0) return false
  if (!Number.isFinite(Date.parse(evidence.at))) return false
  return evidence.version === record.version && evidence.artifactHash === record.artifactHash
}

/**
 * Return the record a reader may trust. An approval whose evidence no longer
 * matches the current revision is demoted to pending and marked stale, so the
 * next human decision starts from the current bytes instead of inheriting an
 * unverified one.
 * @param record - stored item.
 * @returns the verified record, or a pending copy.
 */
export function verifiedApproval(record: BoardItemRecord): BoardItemRecord {
  if (approvalIsVerified(record)) return record
  return {
    ...record,
    state: 'PENDIENTE_CRITERIO',
    status: 'waiting_approval',
    approvedRevision: null,
    approvalEvidence: null,
    stale: true,
    staleReason: APPROVAL_UNVERIFIED,
  }
}

/**
 * Wrap the items table so every read, update, and put observes verified
 * approvals. The mirror writes through its own domain handle, so this wrapper is
 * the point where a replicated or restored row loses an unverified approval.
 * @param table - the persistent items table.
 * @returns the same table with verified approval reads.
 */
export function verifiedItemsTable(
  table: KvTable<FaberLoomBoardItemId, BoardItemRecord>,
): KvTable<FaberLoomBoardItemId, BoardItemRecord> {
  return {
    get size() {
      return table.size
    },
    get(key) {
      const record = table.get(key)
      return record === undefined ? undefined : verifiedApproval(record)
    },
    entries() {
      return (function* entries() {
        for (const [key, record] of table.entries()) yield [key, verifiedApproval(record)] as [FaberLoomBoardItemId, BoardItemRecord]
      })()
    },
    keys() {
      return table.keys()
    },
    async put(key, value) {
      await table.put(key, verifiedApproval(value))
    },
    async delete(key) {
      return await table.delete(key)
    },
    async update(key, transform) {
      return await table.update(key, current => verifiedApproval(transform(verifiedApproval(current))))
    },
  }
}
