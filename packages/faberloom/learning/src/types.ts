/**
 * Public type vocabulary of native product memory: versioned teachings with
 * scope and source, usage traceability, contextual performance with
 * correction causes, late errors, and a portable knowledge snapshot. Types
 * only — the service and id factories live in `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-memory/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one teaching. */
export type FaberLoomTeachingId = Branded<'FaberLoomTeachingId'>

/** How wide a teaching applies. */
export type TeachingScope = 'case' | 'space' | 'agent' | 'skill' | 'global'

/** Teaching lifecycle. `candidate` is an unconfirmed inference. */
export type TeachingStatus = 'candidate' | 'active' | 'superseded' | 'revoked'

/** One versioned teaching. */
export interface FaberLoomTeaching {
  /** Stable teaching id (shared by every version). */
  readonly id: FaberLoomTeachingId
  /** Owning identity. */
  readonly ownerId: string
  /** Application scope. */
  readonly scope: TeachingScope
  /** Space this teaching belongs to, or `null`. */
  readonly spaceId: string | null
  /** Agent this teaching belongs to, or `null`. */
  readonly agentId: string | null
  /** Skill this teaching belongs to, or `null`. */
  readonly skill: string | null
  /** Task label this teaching applies to, or `null`. */
  readonly task: string | null
  /** The teaching text. */
  readonly text: string
  /** Where the teaching came from (case reference, user, document). */
  readonly source: string
  /** Who stated it. */
  readonly author: string
  /** Lifecycle status. */
  readonly status: TeachingStatus
  /** Monotonic version; a supersession increments it. */
  readonly version: number
  /** Version this one replaced, or `null`. */
  readonly supersedes: number | null
  /** References (case ids) where the teaching was recovered and used. */
  readonly uses: readonly string[]
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
}

/** Teaching creation input. */
export interface TeachingInput {
  /** Application scope. */
  readonly scope: TeachingScope
  /** The teaching text. */
  readonly text: string
  /** Source (case reference, user, document). */
  readonly source: string
  /** Author identity. */
  readonly author: string
  /** Owning space, when scoped. */
  readonly spaceId?: string
  /** Owning agent, when scoped. */
  readonly agentId?: string
  /** Skill, when scoped. */
  readonly skill?: string
  /** Task label, when scoped. */
  readonly task?: string
  /** Whether an explicit instruction is remembered active; default `candidate`. */
  readonly active?: boolean
  /** First use reference, when the teaching comes from a case. */
  readonly caseRef?: string
}

/** Teaching supersession input (an edit that keeps the previous version). */
export interface TeachingEditInput {
  /** The new text. */
  readonly text: string
  /** Why it changed. */
  readonly reason: string
  /** Author of the correction. */
  readonly author: string
}

/** Retrieval filter. */
export interface TeachingFilter {
  /** Restrict to a scope. */
  readonly scope?: TeachingScope
  /** Restrict to a space. */
  readonly spaceId?: string
  /** Restrict to an agent. */
  readonly agentId?: string
  /** Restrict to a skill. */
  readonly skill?: string
  /** Restrict to a task. */
  readonly task?: string
  /** Include unconfirmed candidates too. */
  readonly includeCandidates?: boolean
  /** Case reference recorded as a use when the teachings are recovered. */
  readonly caseRef?: string
}

/** Cause of a correction; requirement changes are not agent failures. */
export type PerformanceCause = 'error' | 'preference' | 'requirement-change'

/** Performance input. */
export interface PerformanceInput {
  /** Agent that produced the result. */
  readonly agentId?: string
  /** Model that produced the result. */
  readonly modelId?: string
  /** Task label. */
  readonly task: string
  /** Optional space context. */
  readonly spaceId?: string
  /** Outcome. */
  readonly outcome: 'approved' | 'corrected'
  /** Correction cause; `error` is the only one counted as an agent failure. */
  readonly cause?: PerformanceCause
  /** Real cost of the attempt, when known. */
  readonly cost?: number
}

/** Contextual performance summary. */
export interface PerformanceSummary {
  /** Total recorded outcomes. */
  readonly uses: number
  /** Approved outcomes. */
  readonly approved: number
  /** Corrected outcomes. */
  readonly corrected: number
  /** Corrections caused by an error (agent failures); requirement changes excluded. */
  readonly agentFailures: number
  /** Corrections by cause. */
  readonly correctionsByCause: Readonly<Record<string, number>>
  /** Corrected / uses, or `undefined` with no uses. */
  readonly correctionRate: number | undefined
}

/** A late error discovered after approval. */
export interface LateErrorInput {
  /** The case the error belongs to. */
  readonly caseRef: string
  /** What was discovered. */
  readonly detail: string
  /** Teaching to correct, when the error updates one. */
  readonly teachingId?: FaberLoomTeachingId
  /** Author of the correction. */
  readonly author: string
}

/** Portable knowledge snapshot; credentials are never included. */
export interface KnowledgeSnapshot {
  /** Teaching records, exactly as stored. */
  readonly teachings: readonly unknown[]
  /** Performance records. */
  readonly performance: readonly unknown[]
  /** Late-error records. */
  readonly lateErrors: readonly unknown[]
}
