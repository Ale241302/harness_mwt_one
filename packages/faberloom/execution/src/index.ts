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
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Execution, ExecutionReview, FaberLoomRoutineId, FaberLoomRoutine, RoutineTrigger } from '@deepseek-ai/dsh-faberloom-routines'
import type {} from '@deepseek-ai/dsh-faberloom-board'
import type {} from '@deepseek-ai/dsh-faberloom-connections'

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

/** One routine's liveness, as the panel and the gateway metrics read it. */
export interface RoutineHealth {
  /** Routine id. */
  readonly routineId: string
  /** Display name. */
  readonly name: string
  /** Lifecycle status. */
  readonly status: string
  /** Status of the most recent execution, or null when the routine never ran. */
  readonly lastStatus: string | null
  /** ISO-8601 instant of the most recent execution, or null. */
  readonly lastAt: string | null
  /** Executions recorded. */
  readonly runs: number
  /** Executions that ended failed. */
  readonly failures: number
  /** Executions awaiting a person. */
  readonly needsReview: number
  /** Executions parked on a wait. */
  readonly waiting: number
  /** Handler retries the routine's executions made. */
  readonly retries: number
  /** Earliest wait deadline among the routine's executions, or null. */
  readonly deadlineAt: string | null
}

/** The dispatcher's aggregate liveness. */
export interface FaberLoomHealth {
  /** Owner the dispatcher drives. */
  readonly ownerId: string
  /** One row per routine the owner holds. */
  readonly routines: readonly RoutineHealth[]
  /** Aggregate counters. */
  readonly totals: {
    /** Executions recorded. */
    readonly runs: number
    /** Executions that ended failed. */
    readonly failures: number
    /** Executions awaiting a person. */
    readonly needsReview: number
    /** Executions parked on a wait. */
    readonly waiting: number
    /** Handler retries made. */
    readonly retries: number
    /** Executions dead-lettered to the board. */
    readonly deadLettered: number
    /** Owner alerts sent. */
    readonly alerts: number
  }
}

/** Count the retries one execution's steps made beyond their first attempt. */
function retriesOf(execution: Execution): number {
  let total = 0
  for (const state of Object.values(execution.steps)) {
    if (state.status !== 'completed' && state.status !== 'failed') continue
    total += Math.max(0, state.attempts - 1)
  }
  return total
}

/**
 * Parse a `recurrence` trigger's match into its interval.
 *
 * Accepted forms: `every:<minutes>`, `every:<n>m|h|d`, `<n>m`, `<n>h`, `<n>d`.
 * A cron expression is not an interval and returns null here; anything else is
 * a misconfiguration the caller reports, and the dispatcher never guesses a
 * cadence.
 * @param match - the trigger's match text.
 * @returns the interval in milliseconds, or null when the form is not an interval.
 */
export function parseInterval(match: string | null): number | null {
  if (match === null) return null
  const text = match.trim().toLowerCase()
  const every = /^every:(\d+)([mhd])?$/.exec(text)
  if (every !== null) return unitInterval(Number(every[1]), unitOf(every[2]))
  const unit = /^(\d+)([mhd])$/.exec(text)
  if (unit === null) return null
  return unitInterval(Number(unit[1]), unitOf(unit[2]))
}

/** Milliseconds one cadence unit stands for; absent means minutes. */
function unitOf(unit: string | undefined): number {
  return unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000
}

/** Reject a zero, oversized, or non-finite unit count. */
function unitInterval(count: number, unitMs: number): number | null {
  const interval = count * unitMs
  if (!Number.isSafeInteger(interval) || interval < MIN_INTERVAL_MS || interval > MAX_INTERVAL_MS) return null
  return interval
}

/** One cron field: `*` (any) or a set of allowed numbers. */
interface CronField {
  /** True for `*`. */
  readonly any: boolean
  /** Allowed values when {@link any} is false. */
  readonly values: ReadonlySet<number>
}

/** A parsed five-field cron expression. */
export interface CronSpec {
  /** Minute field (0-59). */
  readonly minute: CronField
  /** Hour field (0-23). */
  readonly hour: CronField
  /** Day-of-month field (1-31). */
  readonly dayOfMonth: CronField
  /** Month field (1-12). */
  readonly month: CronField
  /** Day-of-week field (0 = Sunday … 6 = Saturday). */
  readonly dayOfWeek: CronField
}

/** Parse one cron field: `*`, a number, a range, or a comma list of those. */
function parseCronField(field: string, min: number, max: number): CronField | null {
  if (field === '*') return { any: true, values: new Set() }
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const range = /^(\d+)-(\d+)$/.exec(part)
    if (range !== null) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from > to || from < min || to > max) return null
      for (let value = from; value <= to; value += 1) values.add(value)
      continue
    }
    if (!/^\d+$/.test(part)) return null
    const value = Number(part)
    if (value < min || value > max) return null
    values.add(value)
  }
  return { any: false, values }
}

/**
 * Parse a basic five-field cron expression (`minute hour day-of-month month
 * day-of-week`). Each field accepts `*`, a number, a range, or a comma list.
 * @param match - the trigger's match text.
 * @returns the parsed fields, or null when the text is not a valid cron.
 */
export function parseCron(match: string | null): CronSpec | null {
  if (match === null) return null
  const fields = match.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const minute = parseCronField(fields[0] as string, 0, 59)
  const hour = parseCronField(fields[1] as string, 0, 23)
  const dayOfMonth = parseCronField(fields[2] as string, 1, 31)
  const month = parseCronField(fields[3] as string, 1, 12)
  const dayOfWeek = parseCronField(fields[4] as string, 0, 6)
  if (minute === null || hour === null || dayOfMonth === null || month === null || dayOfWeek === null) return null
  return { minute, hour, dayOfMonth, month, dayOfWeek }
}

/** Whether one cron field allows a value. */
function cronFieldMatches(field: CronField, value: number): boolean {
  return field.any || field.values.has(value)
}

/** Whether a parsed cron fires at one local wall-clock instant. */
function cronMatches(spec: CronSpec, local: LocalParts): boolean {
  if (!cronFieldMatches(spec.minute, local.minute)) return false
  if (!cronFieldMatches(spec.hour, local.hour)) return false
  if (!cronFieldMatches(spec.month, local.month)) return false
  const domAny = spec.dayOfMonth.any
  const dowAny = spec.dayOfWeek.any
  if (domAny && dowAny) return true
  const domMatch = cronFieldMatches(spec.dayOfMonth, local.day)
  const dowMatch = cronFieldMatches(spec.dayOfWeek, local.weekday)
  if (domAny) return dowMatch
  if (dowAny) return domMatch
  return domMatch || dowMatch
}

/** One instant's local wall-clock fields. */
export interface LocalParts {
  /** Local year. */
  readonly year: number
  /** Local month (1-12). */
  readonly month: number
  /** Local day of month (1-31). */
  readonly day: number
  /** Local hour (0-23). */
  readonly hour: number
  /** Local minute (0-59). */
  readonly minute: number
  /** Local weekday (0 = Sunday … 6 = Saturday). */
  readonly weekday: number
}

/**
 * Resolve one instant's local wall-clock fields in a timezone.
 * @param at - the instant.
 * @param timezone - the IANA timezone, or null for UTC.
 * @returns the local fields.
 */
export function localParts(at: Date, timezone: string | null): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone ?? 'UTC',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = formatter.formatToParts(at)
  const value = (type: string): string => parts.find(part => part.type === type)?.value ?? ''
  const year = Number(value('year'))
  const month = Number(value('month'))
  const day = Number(value('day'))
  return {
    year,
    month,
    day,
    hour: Number(value('hour')),
    minute: Number(value('minute')),
    // The weekday of the local calendar date, independent of the host locale.
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  }
}

/** Whether a timezone name is one `Intl` accepts. */
function validTimezone(timezone: string | null): boolean {
  if (timezone === null || timezone.length === 0) return true
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/** Whether one instant passes a trigger's local day and hour window. */
function inWindow(trigger: RoutineTrigger, local: LocalParts): boolean {
  if (trigger.businessDays && (local.weekday === 0 || local.weekday === 6)) return false
  if (trigger.days.length > 0 && !trigger.days.includes(local.weekday)) return false
  const from = trigger.windowFrom ?? 0
  const to = trigger.windowTo ?? 24
  if (from === 0 && to === 24) return true
  return from < to ? local.hour >= from && local.hour < to : local.hour >= from || local.hour < to
}

/** Local wall-clock minute key a cron occurrence dedupes on. */
function localMinuteKey(local: LocalParts): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(local.year)}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}`
}

/** The persistent driver over the routines engine. */
export class FaberLoomExecutions extends Service {
  static inject = ['faberloomRoutines']

  private running = false

  private readonly reported = new Set<string>()

  /** Executions dead-lettered to the board since this process started. */
  private deadLettered = 0

  /** Owner alerts sent since this process started. */
  private alerts = 0

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - identity and cadence.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'faberloomExecutions')
    this.ctx.effect(
      () => this.ctx.faberloomRoutines.registerReviewListener((review) => {
        void this.onReview(review).catch((error: unknown) => {
          this.ctx.logger.warn(`faberloom: review handling failed: ${String(error)}`)
        })
      }),
      'faberloom.executions.review',
    )
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
      const { resumed } = await this.ctx.faberloomRoutines.tick({ events: [], now: now.toISOString() })
      const reconciled = await this.reconcile()
      const expired = await this.ctx.faberloomRoutines.expireWaits(now)
      await this.publishMetrics()
      return { skipped: null, started, advanced: resumed.map(String), reconciled, expired: expired.map(String) }
    } finally {
      this.running = false
      this.ctx.faberloomRoutines.releaseLock()
    }
  }

  /** Start the active routines whose `date` or `recurrence` trigger is due. */
  private async startDue(ownerId: string, now: Date): Promise<string[]> {
    const started: string[] = []
    const executions = await this.ctx.faberloomRoutines.listExecutions()
    for (const routine of await this.ctx.faberloomRoutines.listRoutines(ownerId)) {
      if (routine.status !== 'active') continue
      const max = routine.definition.maxConcurrency
      let active = max === null ? 0 : executions.filter(execution => execution.routineId === routine.id
        && execution.status !== 'completed' && execution.status !== 'failed').length
      for (const trigger of routine.definition.triggers) {
        if (max !== null && active >= max) break
        const occurrence = occurrenceKey(trigger, routine.id, now)
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
          routineId: routine.id,
          idempotencyKey: occurrence.key,
          channel: trigger.kind,
        })
        if (!result.deduped) {
          started.push(`${String(routine.id)}:${occurrence.key}`)
          active += 1
        }
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

  /**
   * The dispatcher's liveness: one row per routine plus aggregate counters.
   * @returns the health snapshot.
   */
  async health(): Promise<FaberLoomHealth> {
    const ownerId = this.config.ownerId ?? ''
    const routines = await this.ctx.faberloomRoutines.listRoutines(ownerId)
    const executions = await this.ctx.faberloomRoutines.listExecutions()
    const rows = routines.map(routine => healthOf(routine, executions.filter(execution => execution.routineId === routine.id)))
    const sum = (pick: (row: RoutineHealth) => number): number => rows.reduce((total, row) => total + pick(row), 0)
    return {
      ownerId,
      routines: rows,
      totals: {
        runs: sum(row => row.runs),
        failures: sum(row => row.failures),
        needsReview: sum(row => row.needsReview),
        waiting: sum(row => row.waiting),
        retries: sum(row => row.retries),
        deadLettered: this.deadLettered,
        alerts: this.alerts,
      },
    }
  }

  /**
   * Dead-letter one reviewed execution to the board and alert the owner, so a
   * failure that exhausted its attempts is never lost.
   * @param review - the execution the engine handed to review.
   */
  private async onReview(review: ExecutionReview): Promise<void> {
    const board = this.ctx.get('faberloomBoard')
    if (board !== undefined) {
      try {
        await board.create(review.ownerId, {
          title: `Dead letter: ${review.stepId ?? review.routineId}`,
          summary: review.reason,
          evidence: [
            `execution:${review.executionId}`,
            `routine:${review.routineId}`,
            ...review.stepId === null ? [] : [`step:${review.stepId}`],
          ],
          routineId: review.routineId,
          executionId: review.executionId,
        })
        this.deadLettered += 1
      } catch (error) {
        this.ctx.logger.warn(`faberloom: dead-letter to the board failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const connections = this.ctx.get('faberloomConnections')
    if (connections !== undefined) {
      try {
        await connections.sendMail(review.ownerId, {
          to: [review.ownerId],
          subject: 'FaberLoom: un flujo necesita revisión',
          text: `La ejecución ${review.executionId} (${review.reason}) necesita revisión en la Mesa de trabajo.`,
        })
        this.alerts += 1
      } catch (error) {
        this.ctx.logger.warn(`faberloom: owner alert failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /** Write the aggregate counters where the gateway's `/metrics` reads them. */
  private async publishMetrics(): Promise<void> {
    const home = process.env['DSH_HOME']
    if (home === undefined || home.length === 0) return
    try {
      const snapshot = await this.health()
      mkdirSync(home, { recursive: true })
      writeFileSync(
        join(home, 'faberloom-metrics.json'),
        JSON.stringify({ ownerId: snapshot.ownerId, totals: snapshot.totals, updatedAt: new Date().toISOString() }),
        'utf8',
      )
    } catch (error) {
      this.ctx.logger.warn(`faberloom: publishing metrics failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** Project one routine's executions into its liveness row. */
function healthOf(routine: FaberLoomRoutine, executions: readonly Execution[]): RoutineHealth {
  const sorted = [...executions].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
  const last = sorted.at(-1)
  const deadlines = executions
    .map(execution => execution.deadlineAt)
    .filter((deadline): deadline is string => deadline !== null)
    .sort()
  return {
    routineId: String(routine.id),
    name: routine.name,
    status: routine.status,
    lastStatus: last?.status ?? null,
    lastAt: last?.updatedAt ?? null,
    runs: executions.length,
    failures: executions.filter(execution => execution.status === 'failed').length,
    needsReview: executions.filter(execution => execution.status === 'needs_review').length,
    waiting: executions.filter(execution => execution.status === 'waiting').length,
    retries: executions.reduce((total, execution) => total + retriesOf(execution), 0),
    deadlineAt: deadlines[0] ?? null,
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
 * the slot the instant falls in (`every:`/`m|h|d`) or on the local wall-clock
 * minute a cron expression matches. The local day and hour window, the allowed
 * weekdays, and the business-day skip filter a recurrence before its slot is
 * used. All three make a repeated pass a dedupe hit rather than a second run. An
 * unparseable interval, cron, or timezone is a misconfiguration the caller
 * reports; the dispatcher never guesses a cadence.
 * @param trigger - the declared trigger.
 * @param routineId - the routine the trigger belongs to.
 * @param now - the instant the pass considers current.
 * @returns the occurrence key, the bad match text, or null when not due.
 */
function occurrenceKey(trigger: RoutineTrigger, routineId: FaberLoomRoutineId, now: Date): Occurrence | null {
  if (trigger.kind === 'date') {
    const at = Date.parse(trigger.match ?? '')
    if (Number.isNaN(at) || now.getTime() < at) return null
    return { key: `date:${String(routineId)}:${new Date(at).toISOString()}` }
  }
  if (trigger.kind !== 'recurrence') return null
  if (!validTimezone(trigger.timezone)) return { invalid: `timezone:${trigger.timezone ?? ''}` }
  const local = localParts(now, trigger.timezone)
  const cron = parseCron(trigger.match)
  if (cron !== null) {
    if (!inWindow(trigger, local) || !cronMatches(cron, local)) return null
    return { key: `cron:${String(routineId)}:${localMinuteKey(local)}` }
  }
  const interval = parseInterval(trigger.match)
  if (interval === null) return { invalid: trigger.match ?? '' }
  if (!inWindow(trigger, local)) return null
  return { key: `recurrence:${String(routineId)}:${String(Math.floor(now.getTime() / interval))}` }
}

/** Re-exported so a consumer can type a custom scheduler without the engine's types. */
export default FaberLoomExecutions
