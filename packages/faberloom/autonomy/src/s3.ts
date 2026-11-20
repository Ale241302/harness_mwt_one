/**
 * O8B · the S3 executor.
 *
 * A rule may act alone only on a reversible action, inside a bounded
 * authorization, while nothing is globally suspended. The executor runs one
 * action, undoes it when the action fails or when a suspension arrives while it
 * runs, and never runs an S4 action (mail send, money, inventory, shipment,
 * expediente writes) on its own.
 */

/** One reversible action a rule asks to run. */
export interface S3Action {
  /** Action id: the ledger dedupes on it. */
  readonly id: string
  /** Rule that produced it. */
  readonly ruleId: string
  /** Rule version that produced it. */
  readonly ruleVersion: number
  /** Human description for the audit. */
  readonly description: string
  /**
   * Run the action.
   * @returns the reference the action produced.
   */
  run(): Promise<{ ref: string }>
  /** Undo the action; called on failure and on suspension while running. */
  undo(): Promise<void>
}

/** The bounded authorization one activation carries. */
export interface S3Authorization {
  /** `AUTH-RULE-ACTIVATION` identifier. */
  readonly id: string
  /** Rule the authorization covers. */
  readonly ruleId: string
  /** Rule version the authorization covers; a new version invalidates it. */
  readonly ruleVersion: number
  /** Scope the owner signed: space, mailbox and action type. */
  readonly scope: string
  /** Instant it stops being usable, ISO-8601. */
  readonly expiresAt: string
  /** Runs the authorization allows. */
  readonly maxRuns: number
  /** Runs already consumed. */
  readonly usedRuns: number
}

/** What one run did. */
export interface S3RunResult {
  /** `done` when it stayed, `refused` when it never ran, `reverted` when it was undone. */
  readonly status: 'done' | 'refused' | 'reverted'
  /** Reference the action produced, when it stayed. */
  readonly ref?: string
  /** Stable reason for a refusal or a revert. */
  readonly reason?: string
}

/** Collaborators the executor needs. */
export interface S3ExecutorOptions {
  /** Whether every rule is suspended right now. */
  readonly suspended: () => boolean | Promise<boolean>
  /** Whether the action type is S4, which never runs alone. */
  readonly isS4: (actionType: string) => boolean
  /**
   * Record one action id in the ledger.
   * @param actionId - action to record.
   * @returns true when it is new, false when it was already recorded.
   */
  readonly record: (actionId: string) => Promise<boolean>
  /** Clock, for tests. */
  readonly now?: () => Date
}

/** The S3 executor. */
export class S3Executor {
  /**
   * @param options - suspension, S4 boundary, ledger and clock.
   */
  constructor(private readonly options: S3ExecutorOptions) {}

  /**
   * Run one S3 action under one authorization.
   * @param action - the action a rule produced.
   * @param actionType - its action type, e.g. `mail.label`.
   * @param authorization - the bounded authorization covering it.
   * @returns what the executor did, with the reason when it refused or reverted.
   */
  async run(action: S3Action, actionType: string, authorization: S3Authorization): Promise<S3RunResult> {
    if (this.options.isS4(actionType)) return refused('S4_BLOCKED')
    if (await this.options.suspended()) return refused('SUSPENDED')
    if (Date.parse(authorization.expiresAt) <= (this.options.now?.() ?? new Date()).getTime()) {
      return refused('AUTHORIZATION_EXPIRED')
    }
    if (authorization.usedRuns >= authorization.maxRuns) return refused('RUN_LIMIT_REACHED')
    if (authorization.ruleId !== action.ruleId || authorization.ruleVersion !== action.ruleVersion) {
      return refused('SCOPE_MISMATCH')
    }
    if (!(await this.options.record(action.id))) return refused('DUPLICATE')
    try {
      const done = await action.run()
      // A suspension that arrives while the action runs undoes it.
      if (await this.options.suspended()) {
        await this.undo(action)
        return { status: 'reverted', reason: 'SUSPENDED_DURING_RUN' }
      }
      return { status: 'done', ref: done.ref }
    } catch (error) {
      await this.undo(action)
      const detail = error instanceof Error ? error.message : String(error)
      return { status: 'reverted', reason: `EXECUTION_FAILED:${detail}` }
    }
  }

  /**
   * Undo one action without raising: recovery is best effort and the caller
   * reports the revert either way.
   * @param action - the action to undo.
   */
  private async undo(action: S3Action): Promise<void> {
    try { await action.undo() } catch { /* the revert is reported by the caller */ }
  }
}

/** One refusal result. */
function refused(reason: string): S3RunResult {
  return { status: 'refused', reason }
}
