/**
 * Public type vocabulary of the native product routines and their persistent
 * execution: versioned routine definitions, triggers, step handlers, execution
 * and effect state, waits, idempotency evidence, per-user event sources, and
 * migration. Authoring inputs use optional fields; stored and consumer types
 * use `null` so they match the durable records exactly.
 * @module @deepseek-ai/dsh-faberloom-routines/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one routine. */
export type FaberLoomRoutineId = Branded<'FaberLoomRoutineId'>

/** Identifies one execution. */
export type FaberLoomExecutionId = Branded<'FaberLoomExecutionId'>

/** Routine lifecycle. */
export type RoutineStatus = 'draft' | 'active' | 'paused'

/** Execution lifecycle. */
export type ExecutionStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'needs_review'

/** One declared way a routine starts (stored shape). */
export interface RoutineTrigger {
  /** Trigger kind. */
  readonly kind: 'manual' | 'event' | 'email' | 'date' | 'recurrence'
  /** Case-insensitive subject pattern, or `null`. */
  readonly match: string | null
}

/** Trigger authoring input. */
export interface RoutineTriggerInput {
  readonly kind: 'manual' | 'event' | 'email' | 'date' | 'recurrence'
  readonly match?: string
}

/** One declared step of a routine (stored shape). */
export interface RoutineStep {
  /** Stable step id within the routine. */
  readonly id: string
  /** Human instruction for the step. */
  readonly instruction: string
  /** Registered handler that performs the step. */
  readonly handler: string
  /** Steps that must complete first. */
  readonly dependsOn: readonly string[]
  /** Event key or `/regex/` pattern the step waits for, or `null`. */
  readonly waitFor: string | null
  /** Whether the step performs a ledgered external effect. */
  readonly effect: boolean
  /** Event data key compared on resume, or `null`. */
  readonly revalidateKey: string | null
  /** Expected value for {@link revalidateKey}, or `null`. */
  readonly revalidateExpect: string | null
}

/** Step authoring input. */
export interface RoutineStepInput {
  readonly id: string
  readonly instruction: string
  readonly handler: string
  readonly dependsOn?: readonly string[]
  readonly waitFor?: string
  readonly effect?: boolean
  readonly revalidateKey?: string
  readonly revalidateExpect?: string
}

/** The stored procedure of one routine version. */
export interface RoutineDefinition {
  /** What the routine is for. */
  readonly intent: string
  /** Declared triggers. */
  readonly triggers: readonly RoutineTrigger[]
  /** Declared steps. */
  readonly steps: readonly RoutineStep[]
  /** Expected outcome. */
  readonly expectedResult: string
  /** Permissions the routine may use. */
  readonly permissions: readonly string[]
  /** What to do when a step fails. */
  readonly failurePolicy: 'stop' | 'continue' | 'review'
}

/** Definition authoring input. */
export interface RoutineDefinitionInput {
  readonly intent: string
  readonly triggers: readonly RoutineTriggerInput[]
  readonly steps: readonly RoutineStepInput[]
  readonly expectedResult: string
  readonly permissions: readonly string[]
  readonly failurePolicy: 'stop' | 'continue' | 'review'
}

/** One versioned routine as consumers read it. */
export interface FaberLoomRoutine {
  /** Stable routine id. */
  readonly id: FaberLoomRoutineId
  /** Owning identity. */
  readonly ownerId: string
  /** Display name. */
  readonly name: string
  /** Lifecycle status. */
  readonly status: RoutineStatus
  /** Current version. */
  readonly version: number
  /** Current definition. */
  readonly definition: RoutineDefinition
  /** Every stored version, ascending. */
  readonly versions: readonly number[]
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
}

/** Routine creation or edit input. */
export interface RoutineInput {
  /** Display name. */
  readonly name: string
  /** The procedure. */
  readonly definition: RoutineDefinitionInput
}

/** One evidence entry attached to an execution. */
export interface ExecutionEvidence {
  /** Channel that produced the evidence. */
  readonly channel: string
  /** External event key, or `null`. */
  readonly eventKey: string | null
  /** ISO-8601 instant. */
  readonly at: string
}

/** Per-step execution state. */
export interface StepState {
  /** Step status. */
  readonly status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed'
  /** Step result. */
  readonly result: unknown
  /** Stable reason code, or `null`. */
  readonly reason: string | null
}

/** One persistent execution of a routine version. */
export interface Execution {
  /** Stable execution id. */
  readonly id: FaberLoomExecutionId
  /** Routine that produced it. */
  readonly routineId: FaberLoomRoutineId
  /** Routine version this execution started with. */
  readonly routineVersion: number
  /** Owning identity. */
  readonly ownerId: string
  /** Current status. */
  readonly status: ExecutionStatus
  /** Idempotency key. */
  readonly idempotencyKey: string
  /** Per-step state. */
  readonly steps: Record<string, StepState>
  /** Evidence from every channel that referenced this case. */
  readonly evidence: readonly ExecutionEvidence[]
  /** The event that produced or resumed the execution, or `null`. */
  readonly event: IngestEvent | null
  /** The wait pattern the execution is blocked on, or `null`. */
  readonly waitingFor: string | null
  /**
   * When the wait stops being reasonable, as an ISO-8601 instant, or `null`
   * when the execution is not waiting or the wait carries no deadline.
   */
  readonly deadlineAt: string | null
  /** Stable reason code, or `null`. */
  readonly reason: string | null
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
}

/** One event delivered into a routine. */
export interface IngestEvent {
  /** Stable event key used for dedupe. */
  readonly key: string
  /** Event kind. */
  readonly type: 'event' | 'email' | 'date' | 'recurrence'
  /** Subject matched by routine triggers. */
  readonly subject?: string
  /** Free event data steps read. */
  readonly data?: Record<string, unknown>
}

/** One per-user event source with its token. */
export interface EventSource {
  /** Stable source id. */
  readonly id: string
  /** Owning identity. */
  readonly ownerId: string
  /** Source kind. */
  readonly kind: 'email' | 'webhook'
  /** Display label. */
  readonly label: string
  /** Bearer token for `ingestForToken`. */
  readonly token: string
  /** ISO-8601 creation instant. */
  readonly createdAt: string
}

/** Handler context passed to a step handler. */
export interface StepContext {
  /** Execution id. */
  readonly executionId: string
  /** Routine id. */
  readonly routineId: FaberLoomRoutineId
  /** Step id. */
  readonly stepId: string
  /** The execution input. */
  readonly input: unknown
  /** The event that resumed the step, when any. */
  readonly event: IngestEvent | undefined
}

/** A registered step handler. */
export type StepHandler = (context: StepContext) => unknown | Promise<unknown>

/** Start request for one execution. */
export interface StartExecutionRequest {
  /** Routine to run. */
  readonly routineId: FaberLoomRoutineId
  /** Idempotency key; a repeated key dedupes to the same case. */
  readonly idempotencyKey: string
  /** Starting channel label. */
  readonly channel: string
  /** Execution input. */
  readonly input?: unknown
  /** Event that triggered the start, when any. */
  readonly event?: IngestEvent
}

/** Start result. */
export interface StartExecutionResult {
  /** The execution (existing when deduped). */
  readonly execution: Execution
  /** True when an existing execution was reused instead of creating one. */
  readonly deduped: boolean
}

/** Dispatcher tick request. */
export interface TickRequest {
  /** Events to deliver to waiting executions. */
  readonly events: readonly IngestEvent[]
  /** Current instant; defaults to now. */
  readonly now?: string
}

/** Dispatcher tick result. */
export interface TickResult {
  /** Executions resumed this tick. */
  readonly resumed: readonly FaberLoomExecutionId[]
}

/** Planned step changes for a version migration. */
export interface MigrationPlan {
  /** Execution being migrated. */
  readonly executionId: FaberLoomExecutionId
  /** Version the execution runs now. */
  readonly fromVersion: number
  /** Version it would move to. */
  readonly toVersion: number
  /** Steps that already completed and are preserved. */
  readonly preserved: readonly string[]
  /** Steps the target version adds and the execution still has to run. */
  readonly added: readonly string[]
}
