/**
 * The safe daily-state restore plan: a snapshot comes back with its history,
 * access inventory, and pending work, but nothing restarts by itself. Routines
 * return paused, in-flight executions return for human review, and lessons
 * return as proposals. The plan also states that restoring a backup never
 * creates or replicates another copy.
 * @module @deepseek-ai/dsh-faberloom-backup/restore-plan
 */

/** Canonical payload of one backup, as captured from the storage domains. */
export type RestorePayload = Record<string, Record<string, Record<string, unknown>>>

/** Why a restored item needs a person before it takes effect again. */
export type RestoreReviewReason =
  | 'ROUTINES_PAUSED'
  | 'EXECUTIONS_DETACHED'
  | 'TEACHINGS_REQUIRE_APPROVAL'
  | 'ACCESS_RESTORED'
  | 'COPIES_NOT_REPLICATED'

/** One field the plan changed, with the original value kept for the report. */
export interface RestorePlanChange {
  /** Storage domain. */
  readonly domain: string
  /** Table inside the domain. */
  readonly table: string
  /** Record key. */
  readonly key: string
  /** Field the plan rewrote. */
  readonly field: string
  /** Original value. */
  readonly from: unknown
  /** Written value. */
  readonly to: unknown
  /** Why it changed. */
  readonly reason: RestoreReviewReason
}

/** What the restored state contains and what still waits for a person. */
export interface FaberLoomRestorePlan {
  /** True when at least one item returned in a non-effective state. */
  readonly degraded: boolean
  /** How the product must run until the review happens. */
  readonly mode: 'read-only-until-review'
  /** Reasons the state is not fully effective. */
  readonly review: readonly RestoreReviewReason[]
  /** Field-level changes the plan applied. */
  readonly changes: readonly RestorePlanChange[]
  /** Counts for the operator report. */
  readonly counts: {
    readonly routinesPaused: number
    readonly executionsDetached: number
    readonly teachingsProposed: number
    readonly accessRestored: number
    readonly copiesWithheld: number
  }
}

/** Read one record field without trusting the JSON. */
function field(record: unknown, name: string): unknown {
  if (record === null || typeof record !== 'object') return undefined
  return (record as Record<string, unknown>)[name]
}

/** Replace one record inside the copied payload. */
function write(payload: RestorePayload, domain: string, table: string, key: string, next: Record<string, unknown>): void {
  const tableRecords = payload[domain]?.[table]
  if (tableRecords === undefined) return
  tableRecords[key] = next
}

/**
 * Build the payload a daily-state restore writes and the plan that explains it.
 *
 * The input payload is never mutated. Domains the product does not back up are
 * ignored; a payload that carries the backup domain itself has it withheld, so
 * a restore can never duplicate the copies.
 * @param original - the verified payload read from the backup.
 * @returns the safe payload and its plan.
 */
export function planDailyRestore(original: RestorePayload): { payload: RestorePayload; plan: FaberLoomRestorePlan } {
  const payload = structuredClone(original)
  const changes: RestorePlanChange[] = []
  const counts = {
    routinesPaused: 0,
    executionsDetached: 0,
    teachingsProposed: 0,
    accessRestored: 0,
    copiesWithheld: 0,
  }

  const routines = payload['faberloom_routines']?.['routines'] ?? {}
  for (const [key, record] of Object.entries(routines)) {
    if (field(record, 'status') !== 'active') continue
    write(payload, 'faberloom_routines', 'routines', key, { ...record as Record<string, unknown>, status: 'paused' })
    changes.push({ domain: 'faberloom_routines', table: 'routines', key, field: 'status', from: 'active', to: 'paused', reason: 'ROUTINES_PAUSED' })
    counts.routinesPaused += 1
  }

  const executions = payload['faberloom_routines']?.['executions'] ?? {}
  for (const [key, record] of Object.entries(executions)) {
    const status = field(record, 'status')
    if (status !== 'running' && status !== 'waiting') continue
    write(payload, 'faberloom_routines', 'executions', key, {
      ...record as Record<string, unknown>,
      status: 'needs_review',
      waitingFor: null,
      deadlineAt: null,
    })
    changes.push({ domain: 'faberloom_routines', table: 'executions', key, field: 'status', from: status, to: 'needs_review', reason: 'EXECUTIONS_DETACHED' })
    counts.executionsDetached += 1
  }

  const teachings = payload['faberloom_memory']?.['teachings'] ?? {}
  for (const [key, record] of Object.entries(teachings)) {
    if (field(record, 'status') !== 'active') continue
    write(payload, 'faberloom_memory', 'teachings', key, { ...record as Record<string, unknown>, status: 'candidate' })
    changes.push({ domain: 'faberloom_memory', table: 'teachings', key, field: 'status', from: 'active', to: 'candidate', reason: 'TEACHINGS_REQUIRE_APPROVAL' })
    counts.teachingsProposed += 1
  }

  const grants = payload['faberloom_grants']?.['grants'] ?? {}
  for (const record of Object.values(grants)) if (field(record, 'revoked') !== true) counts.accessRestored += 1

  if (payload['faberloom_backup'] !== undefined) {
    counts.copiesWithheld = Object.values(payload['faberloom_backup']).reduce((total, table) => total + Object.keys(table).length, 0)
    delete payload['faberloom_backup']
  }

  const review: RestoreReviewReason[] = []
  if (counts.routinesPaused > 0) review.push('ROUTINES_PAUSED')
  if (counts.executionsDetached > 0) review.push('EXECUTIONS_DETACHED')
  if (counts.teachingsProposed > 0) review.push('TEACHINGS_REQUIRE_APPROVAL')
  if (counts.accessRestored > 0) review.push('ACCESS_RESTORED')
  review.push('COPIES_NOT_REPLICATED')

  return {
    payload,
    plan: { degraded: changes.length > 0, mode: 'read-only-until-review', review, changes, counts },
  }
}
