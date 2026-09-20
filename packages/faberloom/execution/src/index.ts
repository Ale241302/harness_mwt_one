/**
 * FaberLoom Executions (`ctx.faberloomExecutions`): the persistent dispatcher.
 * It is the only component that starts work and advances it without a person:
 * a timer drives one pass at a time, which
 *
 * - starts every active routine whose `date` trigger has come due,
 * - starts every active routine whose `recurrence` trigger reached a new slot,
 * - advances the executions that have runnable steps, and
 * - reconciles the executions whose effect stayed pending after a write.
 *
 * A pass is idempotent by construction: a start is keyed by the instant the
 * `date` trigger named or by the recurrence slot it belongs to, so two passes,
 * two processes, or a restart never start the same run twice. The engine's
 * dedupe decides, not the timer.
 * @module @deepseek-ai/dsh-faberloom-execution
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { FaberLoomRoutineId } from '@deepseek-ai/dsh-faberloom-routines'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomExecutions: FaberLoomExecutions
  }
}

/** Deployment-supplied identity and cadence of the dispatcher. */
export interface Config {
  /** The owner whose routines this dispatcher drives; empty disables it. */
  ownerId?: string
  /** Whether the timer runs. A deployment can turn it off and call `runOnce` itself. */
  enabled?: boolean
  /** Milliseconds between passes. */
  intervalMs?: number
}

/** Schemastery configuration for the dispatcher. */
export const Config: z<Config> = z.object({
  ownerId: z.string(),
  enabled: z.boolean(),
  intervalMs: z.number(),
})

/** Shortest pass interval the dispatcher accepts. */
export const MIN_INTERVAL_MS = 1000

/** What one pass did. */
export interface DispatchReport {
  /** Why the pass did nothing, when it did nothing. */
  readonly skipped: string | null
  /** Executions this pass created, as `<routineId>:<key>`. */
  readonly started: readonly string[]
  /** Executions this pass advanced. */
  readonly advanced: readonly string[]
  /** Executions this pass moved to review. */
  readonly reconciled: readonly string[]
  /** Executions whose wait passed its deadline this pass. */
  readonly expired: readonly string[]
}

/** Longest a `recurrence` match may ask for, so a typo cannot schedule a year. */
const MAX_INTERVAL_MS = 31 * 24 * 60 * 60 * 1000

/**
 * Parse a `recurrence` trigger's match into its interval.
 *
 * Accepted forms: `every:<minutes>`, `<n>m`, `<n>h`, `<n>d`. Anything else is a
 * misconfiguration the caller reports; the dispatcher never guesses a cadence.
 * @param match - the trigger's match text.
 * @returns the interval in milliseconds, or null when the form is not an interval.
 */
export function parseInterval(match: string | null): number | null {
  if (match === null) return null
  const text = match.trim().toLowerCase()
  const minutes = /^every:(\d+)$/.exec(text)
  if (minutes !== null) return unitInterval(Number(minutes[1]), 60_000)
  const unit = /^(\d+)([mhd])$/.exec(text)
  if (unit === null) return null
  return unitInterval(Number(unit[1]), unit[2] === 'm' ? 60_000 : unit[2] === 'h' ? 3_600_000 : 86_400_000)
}

/** Reject a zero, oversized, or non-finite unit count. */
function unitInterval(count: number, unitMs: number): number | null {
  const interval = count * unitMs
  if (!Number.isSafeInteger(interval) || interval < MIN_INTERVAL_MS || interval > MAX_INTERVAL_MS) return null
  return interval
}

/** The persistent driver over the routines engine. */
export class FaberLoomExecutions extends Service {
  static inject = ['faberloomRoutines']

  private running = false

  private readonly reported = new Set<string>()

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - identity and cadence.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'faberloomExecutions')
    const interval = this.config.intervalMs ?? 60_000
    if (!Number.isSafeInteger(interval) || interval < MIN_INTERVAL_MS) {
      throw new Error(`faberloom: intervalMs must be a whole number of at least ${String(MIN_INTERVAL_MS)} ms`)
    }
    if (this.config.enabled !== true || (this.config.ownerId ?? '').length === 0) return
    this.ctx.effect(() => {
      const timer = setInterval(() => {
        void this.runOnce().catch((error: unknown) => {
          this.ctx.logger.warn(`faberloom: dispatcher pass failed: ${String(error)}`)
        })
      }, interval)
      this.ctx.logger.info(`faberloom: dispatcher started for ${String(this.config.ownerId)} every ${String(interval)} ms`)
      return () => { clearInterval(timer) }
    }, 'faberloom.executions.dispatcher')
  }

  /**
   * Run one pass. Acquires the engine's dispatcher lock first, so an overlapping
   * pass — a timer tick during a manual call, or the same owner served twice —
   * reports `another pass is running` instead of starting work twice.
   * @param now - the instant this pass considers current.
   * @returns what the pass did.
   */
  async runOnce(now: Date = new Date()): Promise<DispatchReport> {
    const ownerId = this.config.ownerId ?? ''
    if (ownerId.length === 0) return report('no owner configured')
    if (this.running || !this.ctx.faberloomRoutines.acquireLock()) return report('another pass is running')
    this.running = true
    try {
      const started = await this.startDue(ownerId, now)
      const { resumed } = await this.ctx.faberloomRoutines.tick({ events: [] })
      const reconciled = await this.reconcile()
      const expired = await this.ctx.faberloomRoutines.expireWaits(now)
      return { skipped: null, started, advanced: resumed.map(String), reconciled, expired: expired.map(String) }
    } finally {
      this.running = false
      this.ctx.faberloomRoutines.releaseLock()
    }
  }

  /** Start the active routines whose `date` or `recurrence` trigger is due. */
  private async startDue(ownerId: string, now: Date): Promise<string[]> {
    const started: string[] = []
    for (const routine of await this.ctx.faberloomRoutines.listRoutines(ownerId)) {
      if (routine.status !== 'active') continue
      for (const trigger of routine.definition.triggers) {
        const occurrence = occurrenceKey(trigger.kind, trigger.match, routine.id, now)
        if (occurrence === null) continue
        if ('invalid' in occurrence) {
          const subject = `${String(routine.id)}:${trigger.kind}:${occurrence.invalid}`
          if (!this.reported.has(subject)) {
            this.reported.add(subject)
            this.ctx.logger.warn(`faberloom: routine ${String(routine.id)} has an unusable ${trigger.kind} trigger match "${occurrence.invalid}"; that trigger is skipped`)
          }
          continue
        }
        const result = await this.ctx.faberloomRoutines.startExecution({
          routineId: routine.id as FaberLoomRoutineId,
          idempotencyKey: occurrence.key,
          channel: trigger.kind,
        })
        if (!result.deduped) started.push(`${String(routine.id)}:${occurrence.key}`)
      }
    }
    return started
  }

  /** Move executions whose effect stayed pending to review. */
  private async reconcile(): Promise<string[]> {
    const reconciled: string[] = []
    for (const execution of await this.ctx.faberloomRoutines.listExecutions()) {
      if (execution.status !== 'needs_review') continue
      const next = await this.ctx.faberloomRoutines.reconcile(execution.id)
      if (next.reason === 'RECONCILE_REQUIRED') reconciled.push(String(execution.id))
    }
    return reconciled
  }
}

/** Build the empty report a skipped pass returns. */
function report(skipped: string): DispatchReport {
  return { skipped, started: [], advanced: [], reconciled: [], expired: [] }
}

/** One trigger's occurrence for a pass: a key to start under, or the bad match text. */
type Occurrence = { readonly key: string } | { readonly invalid: string }

/**
 * Build the occurrence for one trigger at `now`, or null when the trigger is not
 * one this dispatcher schedules.
 *
 * A `date` trigger keys on the instant it named; a `recurrence` trigger keys on
 * the slot the instant falls in. Both make a repeated pass a dedupe hit rather
 * than a second run. An unparseable interval is a misconfiguration the caller
 * reports; the dispatcher never guesses a cadence.
 */
function occurrenceKey(kind: string, match: string | null, routineId: FaberLoomRoutineId, now: Date): Occurrence | null {
  if (kind === 'date') {
    const at = Date.parse(match ?? '')
    if (Number.isNaN(at) || now.getTime() < at) return null
    return { key: `date:${String(routineId)}:${new Date(at).toISOString()}` }
  }
  if (kind !== 'recurrence') return null
  const interval = parseInterval(match)
  if (interval === null) return { invalid: match ?? '' }
  return { key: `recurrence:${String(routineId)}:${String(Math.floor(now.getTime() / interval))}` }
}

/** Re-exported so a consumer can type a custom scheduler without the engine's types. */
export default FaberLoomExecutions
