/**
 * Native product routines (`ctx.faberloomRoutines`): versioned routines with
 * validation, persistent executions that keep their starting version, a
 * persistent dispatcher for waits, an idempotent start with cross-channel
 * evidence, an effect ledger with reconciliation, per-user event sources, and
 * version migration. Records are durable through `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-faberloom-routines
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-faberloom-access'
import {
  routinesDomainSpec,
  type EffectLedgerRecord,
  type EventRecord,
  type ExecutionRecord,
  type RoutineRecord,
} from './spec.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  EventSource,
  Execution,
  ExecutionStatus,
  FaberLoomExecutionId,
  FaberLoomRoutine,
  FaberLoomRoutineId,
  IngestEvent,
  MigrationPlan,
  RoutineDefinition,
  RoutineDefinitionInput,
  RoutineInput,
  RoutineStep,
  StartExecutionRequest,
  StartExecutionResult,
  StepContext,
  StepHandler,
  StepState,
  TickRequest,
  TickResult,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomRoutines: FaberLoomRoutines
  }
}

/** Deployment-supplied execution policy. */
export interface Config {
  /**
   * How long a parked step may wait before a pass moves its execution to
   * review, in milliseconds. A deployment shortens it to notice a lost reply
   * sooner; the default is one day.
   */
  waitTimeoutMs?: number
}

/** Schemastery configuration for the routines engine. */
export const Config: z<Config> = z.object({
  waitTimeoutMs: z.number(),
})

/** How long a parked step waits before its execution needs review. */
export const DEFAULT_WAIT_TIMEOUT_MS = 24 * 60 * 60 * 1000

/** Shortest wait policy a deployment may declare. */
export const MIN_WAIT_TIMEOUT_MS = 60_000

/** Normalize an authoring definition into its stored shape. */
function normalizeDefinition(input: RoutineDefinitionInput): RoutineDefinition {
  return {
    intent: input.intent,
    triggers: input.triggers.map(trigger => ({ kind: trigger.kind, match: trigger.match ?? null })),
    steps: input.steps.map(step => ({
      id: step.id,
      instruction: step.instruction,
      handler: step.handler,
      dependsOn: step.dependsOn !== undefined ? [...step.dependsOn] : [],
      waitFor: step.waitFor ?? null,
      effect: step.effect ?? false,
      revalidateKey: step.revalidateKey ?? null,
      revalidateExpect: step.revalidateExpect ?? null,
    })),
    expectedResult: input.expectedResult,
    permissions: [...input.permissions],
    failurePolicy: input.failurePolicy,
  }
}

/** Project a definition into the mutable record shape zod stores. */
function toStoredDefinition(definition: RoutineDefinition): RoutineRecord['definition'] {
  return {
    intent: definition.intent,
    triggers: definition.triggers.map(trigger => ({ kind: trigger.kind, match: trigger.match })),
    steps: definition.steps.map(step => ({
      id: step.id,
      instruction: step.instruction,
      handler: step.handler,
      dependsOn: [...step.dependsOn],
      waitFor: step.waitFor,
      effect: step.effect,
      revalidateKey: step.revalidateKey,
      revalidateExpect: step.revalidateExpect,
    })),
    expectedResult: definition.expectedResult,
    permissions: [...definition.permissions],
    failurePolicy: definition.failurePolicy,
  }
}

/** Validate a routine definition against the registered handlers. */
function validateDefinition(definition: RoutineDefinition, handlers: ReadonlySet<string>): string[] {
  const problems: string[] = []
  const known = new Set(definition.steps.map(step => step.id))
  for (const step of definition.steps) {
    if (!handlers.has(step.handler)) problems.push(`MISSING_HANDLER:${step.id}:${step.handler}`)
    for (const dependency of step.dependsOn) {
      if (!known.has(dependency)) problems.push(`MISSING_DEPENDENCY:${step.id}:${dependency}`)
    }
  }
  const color = new Map<string, number>()
  const byId = new Map(definition.steps.map(step => [step.id, step]))
  const visit = (id: string): boolean => {
    const state = color.get(id) ?? 0
    if (state === 1) return true
    if (state === 2) return false
    color.set(id, 1)
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (visit(dependency)) return true
    }
    color.set(id, 2)
    return false
  }
  for (const step of definition.steps) {
    if (visit(step.id)) {
      problems.push(`CYCLE:${step.id}`)
      break
    }
  }
  return problems
}

/** Order steps so every dependency precedes its dependents. */
function orderSteps(steps: readonly RoutineStep[]): RoutineStep[] {
  const done = new Set<string>()
  const out: RoutineStep[] = []
  let remaining = [...steps]
  while (remaining.length > 0) {
    const ready = remaining.filter(step => step.dependsOn.every(dependency => done.has(dependency)))
    if (ready.length === 0) break
    for (const step of ready) {
      out.push(step)
      done.add(step.id)
    }
    remaining = remaining.filter(step => !done.has(step.id))
  }
  return out
}

/** Whether an event satisfies a wait pattern: `/regex/`, an exact key, or a subject substring. */
function eventMatches(pattern: string, event: IngestEvent): boolean {
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
    try {
      return new RegExp(pattern.slice(1, -1), 'i').test(event.subject ?? event.key)
    } catch {
      return false
    }
  }
  if (event.key === pattern) return true
  return (event.subject ?? '').toLowerCase().includes(pattern.toLowerCase())
}

/** Map a durable event to the consumer-facing event. */
function toEvent(record: EventRecord): IngestEvent {
  return {
    key: record.key,
    type: record.type,
    ...record.subject === null ? {} : { subject: record.subject },
    ...record.data === null ? {} : { data: record.data },
  }
}

/** Map one incoming event to its durable record. */
function toEventRecord(event: IngestEvent): EventRecord {
  return {
    key: event.key,
    type: event.type,
    subject: event.subject ?? null,
    data: (event.data ?? null) as EventRecord['data'],
  }
}

/** Map a durable execution to the consumer-facing execution. */
function toExecution(id: FaberLoomExecutionId, record: ExecutionRecord): Execution {
  return {
    id,
    routineId: record.routineId,
    routineVersion: record.routineVersion,
    ownerId: record.ownerId,
    status: record.status,
    idempotencyKey: record.idempotencyKey,
    steps: record.steps,
    evidence: record.evidence,
    event: record.event === null ? null : toEvent(record.event),
    events: (record.events ?? []).map(toEvent),
    waitingFor: record.waitingFor,
    deadlineAt: record.deadlineAt ?? null,
    reason: record.reason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Prepare a fresh step-state map for a definition. */
function initialState(definition: RoutineDefinition): Record<string, StepState> {
  const steps: Record<string, StepState> = {}
  for (const step of definition.steps) steps[step.id] = { status: 'pending', result: null, reason: null }
  return steps
}

/**
 * The product routines service: versioned definitions, validated activation,
 * persistent executions, dispatcher, effects ledger, sources, and migration.
 */
export class FaberLoomRoutines extends Service {
  static inject = ['storageDomain', 'faberloomAccess']

  private domainPromise: Promise<Domain<typeof routinesDomainSpec>> | undefined
  private readonly handlers = new Map<string, StepHandler>()
  private locked = false

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - the deployment's wait policy.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'faberloomRoutines')
    const timeout = this.config.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
    if (!Number.isSafeInteger(timeout) || timeout < MIN_WAIT_TIMEOUT_MS) {
      throw new Error(`faberloom: waitTimeoutMs must be a whole number of at least ${String(MIN_WAIT_TIMEOUT_MS)} ms`)
    }
  }

  /** How long a parked step may wait before the dispatcher moves it to review. */
  private waitTimeoutMs(): number {
    return this.config.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  }

  private domain(): Promise<Domain<typeof routinesDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(routinesDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.routinesDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async routines(): Promise<KvTable<string, RoutineRecord>> { return (await this.domain()).table('routines') }
  private async versions(): Promise<KvTable<string, { routineId: FaberLoomRoutineId; version: number; definition: RoutineRecord['definition']; createdAt: string }>> {
    return (await this.domain()).table('routine_versions') as unknown as KvTable<string, { routineId: FaberLoomRoutineId; version: number; definition: RoutineRecord['definition']; createdAt: string }>
  }
  private async executions(): Promise<KvTable<string, ExecutionRecord>> { return (await this.domain()).table('executions') }
  private async effects(): Promise<KvTable<string, EffectLedgerRecord>> { return (await this.domain()).table('effects') }
  private async sources(): Promise<KvTable<string, { ownerId: string; kind: 'email' | 'webhook'; label: string; token: string; createdAt: string }>> {
    return (await this.domain()).table('sources') as unknown as KvTable<string, { ownerId: string; kind: 'email' | 'webhook'; label: string; token: string; createdAt: string }>
  }
  private async eventKeys(): Promise<KvTable<string, { ownerId: string; eventKey: string }>> {
    return (await this.domain()).table('event_keys') as unknown as KvTable<string, { ownerId: string; eventKey: string }>
  }

  // ── Handlers ────────────────────────────────────────────────────────

  /**
   * Register one step handler.
   * @param name - handler name referenced by steps.
   * @param handler - the sync or async handler.
   * @returns the disposer removing the handler.
   */
  registerHandler(name: string, handler: StepHandler): () => void {
    this.handlers.set(name, handler)
    return () => {
      if (this.handlers.get(name) === handler) this.handlers.delete(name)
    }
  }

  /**
   * List registered handler names.
   * @returns the names.
   */
  listHandlers(): string[] { return [...this.handlers.keys()] }

  // ── Definitions ─────────────────────────────────────────────────────

  private async storeVersion(id: FaberLoomRoutineId, version: number, definition: RoutineRecord['definition'], at: string): Promise<void> {
    await (await this.versions()).put(`${id}:${String(version)}`, { routineId: id, version, definition, createdAt: at })
  }

  private async versionsOf(id: FaberLoomRoutineId): Promise<number[]> {
    const out: number[] = []
    for (const [, record] of (await this.versions()).entries()) {
      if (record.routineId === id) out.push(record.version)
    }
    out.sort((left, right) => left - right)
    return out
  }

  private async routineView(id: FaberLoomRoutineId, record: RoutineRecord): Promise<FaberLoomRoutine> {
    return {
      id,
      ownerId: record.ownerId,
      name: record.name,
      status: record.status,
      version: record.version,
      definition: record.definition,
      versions: await this.versionsOf(id),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }

  /**
   * Create one routine as version 1 in draft.
   * @param ownerId - the owning identity.
   * @param input - name and definition.
   * @returns the created routine.
   */
  async createRoutine(ownerId: string, input: RoutineInput): Promise<FaberLoomRoutine> {
    const id = brandString<FaberLoomRoutineId>(randomUUID())
    const now = new Date().toISOString()
    const definition = toStoredDefinition(normalizeDefinition(input.definition))
    const record: RoutineRecord = { ownerId, name: input.name, status: 'draft', version: 1, definition, createdAt: now, updatedAt: now }
    await (await this.routines()).put(id, record)
    await this.storeVersion(id, 1, definition, now)
    return this.routineView(id, record)
  }

  /**
   * Read one routine.
   * @param id - routine id.
   * @returns the routine.
   */
  async getRoutine(id: FaberLoomRoutineId): Promise<FaberLoomRoutine> {
    const record = (await this.routines()).get(id)
    if (record === undefined) throw new Error(`faberloom: routine ${id} not found`)
    return this.routineView(id, record)
  }

  /**
   * List one owner's routines, oldest first.
   * @param ownerId - the owning identity.
   * @returns the routines.
   */
  async listRoutines(ownerId: string): Promise<FaberLoomRoutine[]> {
    const out: FaberLoomRoutine[] = []
    for (const [rawId, record] of (await this.routines()).entries()) {
      if (record.ownerId !== ownerId) continue
      out.push(await this.routineView(rawId as FaberLoomRoutineId, record))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }

  /**
   * Edit a routine, producing a new version. Executions keep their starting version.
   * @param ownerId - the acting identity.
   * @param id - routine id.
   * @param input - the new name and definition.
   * @returns the updated routine.
   */
  async updateRoutine(ownerId: string, id: FaberLoomRoutineId, input: RoutineInput): Promise<FaberLoomRoutine> {
    const table = await this.routines()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: routine ${id} not found`)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can edit this routine')
    const version = record.version + 1
    const now = new Date().toISOString()
    const definition = toStoredDefinition(normalizeDefinition(input.definition))
    const next: RoutineRecord = { ...record, name: input.name, version, definition, updatedAt: now }
    await table.update(id, () => next)
    await this.storeVersion(id, version, definition, now)
    return this.routineView(id, next)
  }

  /**
   * Remove one routine and the versions stored for it.
   *
   * Executions and the effect ledger are the run's history and stay: only the
   * definition leaves, so a case that already ran keeps its record.
   * @param ownerId - the acting identity.
   * @param id - routine id.
   * @returns whether a routine was removed.
   */
  async removeRoutine(ownerId: string, id: FaberLoomRoutineId): Promise<boolean> {
    const table = await this.routines()
    const record = table.get(id)
    if (record === undefined) return false
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can remove this routine')
    const removed = await table.delete(id)
    const versions = await this.versions()
    for (const [key, version] of versions.entries()) {
      if (version.routineId === id) await versions.delete(key)
    }
    return removed
  }

  /**
   * Decide whether one effectful step may run.
   *
   * Access to a tool never grants the agent permission to act alone: an effect
   * runs only under an active grant for the action the routine declares, scoped
   * to that routine. The guard is hard — without a grant the step fails with
   * `NOT_AUTHORIZED` and the case goes to review — and it runs before each
   * effect, so a revocation stops the next one. The engine declares the access
   * service, so an effect never runs in a composition that mounts no grants.
   * @param ownerId - the owning identity whose grants are consulted.
   * @param definition - the routine version the execution runs.
   * @param stepId - the effectful step.
   * @param routineId - the routine, used as the grant's context.
   * @returns whether the effect may run, and the stable reason.
   */
  private async authorize(
    ownerId: string,
    definition: RoutineDefinition,
    stepId: string,
    routineId: FaberLoomRoutineId,
  ): Promise<{ allowed: boolean; reason: string }> {
    const action = definition.permissions[0] ?? `faberloom.effect.${stepId}`
    const decision = await this.ctx.faberloomAccess.check({ ownerId, action, context: String(routineId) })
    return { allowed: decision.allowed, reason: decision.reason }
  }

  /**
   * Move every execution whose wait passed its deadline to review.
   *
   * A wait that nobody answers is not a success and not a crash: the case needs
   * a person, so the waiting step is marked failed with `WAIT_TIMEOUT` and the
   * execution keeps its history for the panel. The dispatcher calls this on each
   * pass; calling it by hand is safe, because an execution already past its
   * deadline is the only thing it touches.
   * @param now - the instant this pass considers current.
   * @returns the execution ids it moved.
   */
  async expireWaits(now: Date = new Date()): Promise<FaberLoomExecutionId[]> {
    const expired: FaberLoomExecutionId[] = []
    for (const [rawId, record] of (await this.executions()).entries()) {
      if (record.status !== 'waiting' || record.deadlineAt === null || record.deadlineAt === undefined) continue
      if (Date.parse(record.deadlineAt) > now.getTime()) continue
      const steps = { ...record.steps }
      for (const [stepId, state] of Object.entries(steps)) {
        if (state.status === 'waiting') steps[stepId] = { status: 'failed', result: null, reason: 'WAIT_TIMEOUT' }
      }
      const id = rawId as FaberLoomExecutionId
      await this.saveExecution(id, {
        ...record,
        steps,
        status: 'needs_review',
        waitingFor: null,
        deadlineAt: null,
        reason: 'WAIT_TIMEOUT',
        updatedAt: now.toISOString(),
      })
      expired.push(id)
    }
    return expired
  }

  /**
   * Read one stored routine version.
   * @param id - routine id.
   * @param version - version number.
   * @returns the definition.
   */
  async getRoutineVersion(id: FaberLoomRoutineId, version: number): Promise<RoutineDefinition> {
    const record = (await this.versions()).get(`${id}:${String(version)}`)
    if (record === undefined) throw new Error(`faberloom: routine ${id} version ${String(version)} not found`)
    return record.definition
  }

  /**
   * Count executions that started with a given routine version.
   * @param id - routine id.
   * @param version - routine version.
   * @returns the execution count.
   */
  async countExecutionsAtVersion(id: FaberLoomRoutineId, version: number): Promise<number> {
    let count = 0
    for (const [, record] of (await this.executions()).entries()) {
      if (record.routineId === id && record.routineVersion === version) count += 1
    }
    return count
  }

  /**
   * Validate and activate a routine. Missing handlers, missing dependencies, or
   * cycles refuse activation with the exact problems.
   * @param ownerId - the acting identity.
   * @param id - routine id.
   * @returns the activated routine.
   */
  async activateRoutine(ownerId: string, id: FaberLoomRoutineId): Promise<FaberLoomRoutine> {
    const table = await this.routines()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: routine ${id} not found`)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can activate this routine')
    const problems = validateDefinition(record.definition, new Set(this.handlers.keys()))
    if (problems.length > 0) throw new Error(`faberloom: routine cannot activate — ${problems.join(', ')}`)
    const next: RoutineRecord = { ...record, status: 'active', updatedAt: new Date().toISOString() }
    await table.update(id, () => next)
    return this.routineView(id, next)
  }

  /**
   * Pause a routine; running executions keep going.
   * @param ownerId - the acting identity.
   * @param id - routine id.
   * @returns the paused routine.
   */
  async pauseRoutine(ownerId: string, id: FaberLoomRoutineId): Promise<FaberLoomRoutine> {
    const table = await this.routines()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: routine ${id} not found`)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can pause this routine')
    const next: RoutineRecord = { ...record, status: 'paused', updatedAt: new Date().toISOString() }
    await table.update(id, () => next)
    return this.routineView(id, next)
  }

  // ── Execution ───────────────────────────────────────────────────────

  private async saveExecution(id: FaberLoomExecutionId, record: ExecutionRecord): Promise<void> {
    await (await this.executions()).put(id, record)
  }

  /**
   * Start one execution, deduping by idempotency key: a repeated key appends the
   * new channel's evidence to the same case instead of starting another.
   * @param request - routine, idempotency key, channel, input, and event.
   * @returns the execution and whether it was deduped.
   */
  async startExecution(request: StartExecutionRequest): Promise<StartExecutionResult> {
    const routine = (await this.routines()).get(request.routineId)
    if (routine === undefined) throw new Error(`faberloom: routine ${request.routineId} not found`)
    if (routine.status !== 'active') throw new Error('faberloom: routine is not active')

    const dedupeKey = `${routine.ownerId}:${request.idempotencyKey}`
    const keys = await this.eventKeys()
    if (keys.get(dedupeKey) !== undefined) {
      const executions = await this.executions()
      for (const [rawId, record] of executions.entries()) {
        if (record.ownerId !== routine.ownerId || record.idempotencyKey !== request.idempotencyKey) continue
        const id = rawId as FaberLoomExecutionId
        const next: ExecutionRecord = {
          ...record,
          evidence: [...record.evidence, { channel: request.channel, eventKey: request.event?.key ?? null, at: new Date().toISOString() }],
          updatedAt: new Date().toISOString(),
        }
        await this.saveExecution(id, next)
        return { execution: toExecution(id, next), deduped: true }
      }
    }

    const id = brandString<FaberLoomExecutionId>(randomUUID())
    const now = new Date().toISOString()
    const record: ExecutionRecord = {
      routineId: request.routineId,
      routineVersion: routine.version,
      ownerId: routine.ownerId,
      status: 'running',
      idempotencyKey: request.idempotencyKey,
      steps: initialState(routine.definition),
      evidence: [{ channel: request.channel, eventKey: request.event?.key ?? null, at: now }],
      events: request.event === undefined ? [] : [toEventRecord(request.event)],
      event: request.event === undefined
        ? null
        : { key: request.event.key, type: request.event.type, subject: request.event.subject ?? null, data: request.event.data ?? null },
      waitingFor: null,
      deadlineAt: null,
      reason: null,
      createdAt: now,
      updatedAt: now,
    }
    await this.saveExecution(id, record)
    await keys.put(dedupeKey, { ownerId: routine.ownerId, eventKey: request.idempotencyKey })
    const run = await this.runSteps(id, routine.definition, request.input, request.event)
    return { execution: toExecution(id, run), deduped: false }
  }

  private async runSteps(
    id: FaberLoomExecutionId,
    definition: RoutineDefinition,
    input: unknown,
    event: IngestEvent | undefined,
  ): Promise<ExecutionRecord> {
    const executions = await this.executions()
    let record = executions.get(id)
    if (record === undefined) throw new Error(`faberloom: execution ${id} not found`)
    const steps = { ...record.steps }

    for (const step of orderSteps(definition.steps)) {
      const state = steps[step.id]
      if (state !== undefined && state.status === 'completed') continue
      if (step.waitFor !== null && (event === undefined || !eventMatches(step.waitFor, event))) {
        steps[step.id] = { status: 'waiting', result: null, reason: null }
        const at = new Date().toISOString()
        record = {
          ...record,
          steps,
          status: 'waiting',
          waitingFor: step.waitFor,
          deadlineAt: new Date(Date.parse(at) + this.waitTimeoutMs()).toISOString(),
          updatedAt: at,
        }
        await this.saveExecution(id, record)
        return record
      }
      if (step.revalidateKey !== null && event !== undefined) {
        const actual = event.data === undefined ? '' : String(event.data[step.revalidateKey] ?? '')
        if (actual !== (step.revalidateExpect ?? '')) {
          steps[step.id] = { status: 'failed', result: null, reason: 'REVALIDATION_CHANGED' }
          record = { ...record, steps, status: 'needs_review', deadlineAt: null, reason: 'REVALIDATION_CHANGED', updatedAt: new Date().toISOString() }
          await this.saveExecution(id, record)
          return record
        }
      }
      if (step.effect) {
        const decision = await this.authorize(record.ownerId, definition, step.id, record.routineId)
        if (!decision.allowed) {
          const reason = `NOT_AUTHORIZED:${decision.reason}`
          steps[step.id] = { status: 'failed', result: null, reason }
          record = { ...record, steps, status: 'needs_review', deadlineAt: null, reason, updatedAt: new Date().toISOString() }
          await this.saveExecution(id, record)
          return record
        }
      }
      steps[step.id] = { status: 'running', result: null, reason: null }
      record = { ...record, steps, updatedAt: new Date().toISOString() }
      await this.saveExecution(id, record)

      if (step.effect) {
        await (await this.effects()).put(`${id}:${step.id}`, { state: 'pending', result: null, at: new Date().toISOString() })
      }
      const handler = this.handlers.get(step.handler)
      if (handler === undefined) {
        steps[step.id] = { status: 'failed', result: null, reason: 'MISSING_HANDLER' }
        record = { ...record, steps, status: 'needs_review', reason: 'MISSING_HANDLER', updatedAt: new Date().toISOString() }
        await this.saveExecution(id, record)
        return record
      }
      if (event !== undefined && !(record.events ?? []).some(entry => entry.key === event.key)) {
        record = { ...record, events: [...(record.events ?? []), toEventRecord(event)], updatedAt: new Date().toISOString() }
      }
      const results: Record<string, unknown> = {}
      for (const [stepId, state] of Object.entries(steps)) {
        if (state.status === 'completed') results[stepId] = state.result
      }
      const context: StepContext = {
        executionId: id,
        routineId: record.routineId,
        stepId: step.id,
        input,
        event,
        results,
        events: (record.events ?? []).map(toEvent),
      }
      try {
        const result = await handler(context)
        if (step.effect) {
          await (await this.effects()).put(`${id}:${step.id}`, { state: 'applied', result: result ?? null, at: new Date().toISOString() })
        }
        steps[step.id] = { status: 'completed', result: result ?? null, reason: null }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        steps[step.id] = { status: 'failed', result: null, reason: message }
        const status: ExecutionStatus = step.effect ? 'needs_review' : definition.failurePolicy === 'stop' ? 'failed' : 'needs_review'
        record = { ...record, steps, status, deadlineAt: null, reason: step.effect ? 'EFFECT_UNCERTAIN' : message, updatedAt: new Date().toISOString() }
        await this.saveExecution(id, record)
        return record
      }
      record = { ...record, steps, updatedAt: new Date().toISOString() }
      await this.saveExecution(id, record)
    }
    record = { ...record, status: 'completed', waitingFor: null, deadlineAt: null, updatedAt: new Date().toISOString() }
    await this.saveExecution(id, record)
    return record
  }

  /**
   * Deliver events to waiting executions.
   * @param request - events and the current instant.
   * @returns the resumed execution ids.
   */
  async tick(request: TickRequest): Promise<TickResult> {
    const resumed: FaberLoomExecutionId[] = []
    for (const [rawId, record] of (await this.executions()).entries()) {
      if (record.status !== 'waiting' || record.waitingFor === null) continue
      const waitingFor = record.waitingFor
      const match = request.events.find(candidate => eventMatches(waitingFor, candidate))
      if (match === undefined) continue
      const definition = await this.getRoutineVersion(record.routineId, record.routineVersion)
      const id = rawId as FaberLoomExecutionId
      await this.saveExecution(id, {
        ...record,
        status: 'running',
        waitingFor: null,
        deadlineAt: null,
        event: { key: match.key, type: match.type, subject: match.subject ?? null, data: match.data ?? null },
        evidence: [...record.evidence, { channel: 'tick', eventKey: match.key, at: new Date().toISOString() }],
      })
      await this.runSteps(id, definition, undefined, match)
      resumed.push(id)
    }
    return { resumed }
  }

  /**
   * Read one execution.
   * @param id - execution id.
   * @returns the execution.
   */
  async getExecution(id: FaberLoomExecutionId): Promise<Execution> {
    const record = (await this.executions()).get(id)
    if (record === undefined) throw new Error(`faberloom: execution ${id} not found`)
    return toExecution(id, record)
  }

  /**
   * List executions, optionally filtered by routine and status.
   * @param filter - optional routine and status filters.
   * @returns executions oldest first.
   */
  async listExecutions(filter: { routineId?: FaberLoomRoutineId; status?: ExecutionStatus } = {}): Promise<Execution[]> {
    const out: Execution[] = []
    for (const [rawId, record] of (await this.executions()).entries()) {
      if (filter.routineId !== undefined && record.routineId !== filter.routineId) continue
      if (filter.status !== undefined && record.status !== filter.status) continue
      out.push(toExecution(rawId as FaberLoomExecutionId, record))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }

  /**
   * Reconcile an execution whose effect stayed pending after a write.
   * @param id - execution id.
   * @returns the reconciled execution.
   */
  async reconcile(id: FaberLoomExecutionId): Promise<Execution> {
    const record = (await this.executions()).get(id)
    if (record === undefined) throw new Error(`faberloom: execution ${id} not found`)
    const pending = [...(await this.effects()).entries()].some(([ref, effect]) => ref.startsWith(`${id}:`) && effect.state === 'pending')
    if (!pending) return toExecution(id, record)
    const next: ExecutionRecord = { ...record, status: 'needs_review', reason: 'RECONCILE_REQUIRED', updatedAt: new Date().toISOString() }
    await this.saveExecution(id, next)
    return toExecution(id, next)
  }

  /**
   * Mark one pending effect as cancelled, so an obsolete draft is not applied.
   * @param id - execution id.
   * @param stepId - the step owning the effect.
   * @returns true when the effect existed and was pending.
   */
  async cancelEffect(id: FaberLoomExecutionId, stepId: string): Promise<boolean> {
    const effects = await this.effects()
    const ref = `${id}:${stepId}`
    const record = effects.get(ref)
    if (record === undefined || record.state !== 'pending') return false
    await effects.update(ref, () => ({ state: 'cancelled', result: record.result, at: new Date().toISOString() }))
    return true
  }

  /**
   * Plan a migration from the execution's version to a target version.
   * @param id - execution id.
   * @param toVersion - target routine version.
   * @returns the preserved and added steps.
   */
  async previewMigration(id: FaberLoomExecutionId, toVersion: number): Promise<MigrationPlan> {
    const execution = await this.getExecution(id)
    const fromDefinition = await this.getRoutineVersion(execution.routineId, execution.routineVersion)
    const target = await this.getRoutineVersion(execution.routineId, toVersion)
    const currentIds = new Set(fromDefinition.steps.map(step => step.id))
    const preserved = Object.entries(execution.steps).filter(([, state]) => state.status === 'completed').map(([stepId]) => stepId)
    const added = target.steps.map(step => step.id).filter(stepId => !currentIds.has(stepId))
    return { executionId: id, fromVersion: execution.routineVersion, toVersion, preserved, added }
  }

  /**
   * Migrate one execution to a target version, preserving completed steps and
   * running the added ones.
   * @param id - execution id.
   * @param toVersion - target routine version.
   * @returns the migrated execution.
   */
  async migrate(id: FaberLoomExecutionId, toVersion: number): Promise<Execution> {
    const record = (await this.executions()).get(id)
    if (record === undefined) throw new Error(`faberloom: execution ${id} not found`)
    const target = await this.getRoutineVersion(record.routineId, toVersion)
    const steps = { ...record.steps }
    for (const step of target.steps) {
      if (steps[step.id] === undefined) steps[step.id] = { status: 'pending', result: null, reason: null }
    }
    await this.saveExecution(id, { ...record, routineVersion: toVersion, steps, updatedAt: new Date().toISOString() })
    const run = await this.runSteps(id, target, undefined, undefined)
    return toExecution(id, run)
  }

  // ── Sources and triggers ────────────────────────────────────────────

  /**
   * Register one per-user event source.
   * @param ownerId - the owning identity.
   * @param kind - source kind.
   * @param label - display label.
   * @returns the source with its token.
   */
  async registerSource(ownerId: string, kind: 'email' | 'webhook', label: string): Promise<EventSource> {
    const id = randomUUID()
    const token = randomBytes(24).toString('base64url')
    const record = { ownerId, kind, label, token, createdAt: new Date().toISOString() }
    await (await this.sources()).put(id, record)
    return { id, ...record }
  }

  /**
   * List one owner's event sources.
   * @param ownerId - the owning identity.
   * @returns the sources.
   */
  async listSources(ownerId: string): Promise<EventSource[]> {
    const out: EventSource[] = []
    for (const [id, record] of (await this.sources()).entries()) {
      if (record.ownerId === ownerId) out.push({ id, ...record })
    }
    return out
  }

  /**
   * Remove one event source.
   * @param ownerId - the acting identity.
   * @param id - source id.
   * @returns true when it existed.
   */
  async removeSource(ownerId: string, id: string): Promise<boolean> {
    const table = await this.sources()
    const record = table.get(id)
    if (record === undefined || record.ownerId !== ownerId) return false
    return table.delete(id)
  }

  /**
   * Ingest one event for its owner: every matching active routine starts or
   * dedupes to its case.
   * @param ownerId - the owning identity the event belongs to.
   * @param event - the event.
   * @returns the executions started or deduped.
   */
  async ingest(ownerId: string, event: IngestEvent): Promise<StartExecutionResult[]> {
    const results: StartExecutionResult[] = []
    for (const [rawId, record] of (await this.routines()).entries()) {
      if (record.ownerId !== ownerId || record.status !== 'active') continue
      const matches = record.definition.triggers.some(trigger =>
        (trigger.kind === 'event' || trigger.kind === 'email')
        && (trigger.match === null || eventMatches(trigger.match, event)))
      if (!matches) continue
      results.push(await this.startExecution({
        routineId: rawId as FaberLoomRoutineId,
        idempotencyKey: `event:${event.key}`,
        channel: 'ingest',
        event,
      }))
    }
    return results
  }

  /**
   * Ingest one event through a source token.
   * @param token - the source token.
   * @param event - the event.
   * @returns the executions started or deduped.
   * @throws when the token matches no source.
   */
  async ingestForToken(token: string, event: IngestEvent): Promise<StartExecutionResult[]> {
    for (const [, record] of (await this.sources()).entries()) {
      if (record.token === token) return this.ingest(record.ownerId, event)
    }
    throw new Error('faberloom: unknown source token')
  }

  // ── Dispatcher lock (in-process) ────────────────────────────────────

  /**
   * Acquire the dispatcher lock for this process.
   * @returns true when the caller now holds it.
   */
  acquireLock(): boolean {
    if (this.locked) return false
    this.locked = true
    return true
  }

  /** Release the dispatcher lock. */
  releaseLock(): void { this.locked = false }
}

export default FaberLoomRoutines
