/**
 * Usability evidence checker for wave 4A.3. It validates one observation made by
 * a representative person against thresholds approved before the session. It
 * refuses developer or synthetic observers, an unapproved threshold, a normal
 * path that needs a token or command, and a load record that does not match the
 * revision the person used.
 * @module @deepseek-ai/dsh-faberloom-portable/src/usability
 */

import { existsSync } from 'node:fs'

/** Approved thresholds the observation is compared against. */
export interface UsabilityThresholds {
  /** Seconds allowed to connect. */
  readonly connectSeconds: number
  /** Seconds allowed for the whole cycle. */
  readonly cycleSeconds: number
  /** Helps allowed during the session. */
  readonly maxHelp: number
  /** Who approved the thresholds and when. */
  readonly approvedBy: string
  /** ISO-8601 approval instant. */
  readonly approvedAt: string
}

/** One participant and the evidence that the person is representative. */
export interface UsabilityParticipant {
  /** Opaque participant id, never a client name or email. */
  readonly id: string
  /** The person must be representative, not the developer or a synthetic model. */
  readonly role: 'representative' | 'developer' | 'synthetic'
  /** Whether this was the person's first session. */
  readonly firstTime: boolean
}

/** One observed session. */
export interface UsabilityObservation {
  /** Observation schema version. */
  readonly schemaVersion: 1
  /** Wave the observation belongs to. */
  readonly wave: '4A.3'
  /** Surface actually used. Only Code and its desktop extension are certified here. */
  readonly surface: 'claude-code' | 'claude-desktop' | 'claude-chat' | 'claude-cowork'
  /** Exact host version. */
  readonly hostVersion: string
  /** Task the person completed, in their words. */
  readonly task: string
  /** Revision the person actually used. */
  readonly revisionUsed: string
  /** Representative participant. */
  readonly participant: UsabilityParticipant
  /** Thresholds approved before the session. */
  readonly thresholds: UsabilityThresholds
  /** Observed times. */
  readonly timings: { readonly connectSeconds: number; readonly cycleSeconds: number }
  /** Helps the person needed. */
  readonly help: { readonly count: number; readonly notes: readonly string[] }
  /** Whether the person explained the diff without reading JSON. */
  readonly diff: { readonly explained: boolean; readonly quote: string }
  /** Recovery after a failed send or publication. */
  readonly recovery: {
    readonly attempted: boolean
    readonly passed: boolean
    readonly preservedWork: boolean
    readonly nextAction: string
  }
  /** Normal connection path facts. */
  readonly normalPath: {
    readonly tokens: boolean
    readonly commands: boolean
    readonly configEdits: boolean
  }
  /** The load record the host produced. */
  readonly load: {
    readonly confirmed: boolean
    readonly revision: string
    readonly packageDigest: string
    readonly hostVersion: string
    /** Absolute or repository-relative path to the external host record. */
    readonly recordPath: string
  }
}

/** Result of one usability evidence check. */
export interface UsabilityVerdict {
  /** Whether every required property holds. */
  readonly ok: boolean
  /** Named reasons, empty when `ok`. */
  readonly reasons: readonly string[]
}

/** Whether a value is a positive finite number. */
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Check one usability observation.
 * @param value - parsed observation.
 * @param recordExists - predicate used to prove the external host record exists.
 * @returns the verdict and named reasons.
 */
export function checkUsabilityObservation(
  value: unknown,
  recordExists: (path: string) => boolean = existsSync,
): UsabilityVerdict {
  const reasons: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reasons: ['observation-not-object'] }
  }
  const observation = value as Record<string, unknown>
  if (observation['schemaVersion'] !== 1 || observation['wave'] !== '4A.3') reasons.push('schema')
  const surface = observation['surface']
  if (surface !== 'claude-code' && surface !== 'claude-desktop') reasons.push('surface-not-certified')
  const hostVersion = observation['hostVersion']
  if (typeof hostVersion !== 'string' || hostVersion.trim().length === 0) reasons.push('host-version')
  const task = observation['task']
  if (typeof task !== 'string' || task.trim().length === 0) reasons.push('task')
  const revisionUsed = observation['revisionUsed']
  if (typeof revisionUsed !== 'string' || revisionUsed.trim().length === 0) reasons.push('revision-used')
  const participant = (observation['participant'] as Record<string, unknown> | undefined) ?? {}
  if (participant['role'] !== 'representative') reasons.push('participant-not-representative')
  if (participant['firstTime'] !== true) reasons.push('participant-not-first-time')
  const participantId = participant['id']
  if (typeof participantId !== 'string' || participantId.trim().length === 0) reasons.push('participant-id')

  const thresholds = (observation['thresholds'] as Record<string, unknown> | undefined) ?? {}
  if (!positive(thresholds['connectSeconds']) || !positive(thresholds['cycleSeconds'])) reasons.push('threshold-missing')
  if (!positive(thresholds['maxHelp']) && thresholds['maxHelp'] !== 0) reasons.push('help-threshold-missing')
  const approvedBy = thresholds['approvedBy']
  if (typeof approvedBy !== 'string' || approvedBy.trim().length === 0) reasons.push('threshold-approver')
  const approvedAt = thresholds['approvedAt']
  if (typeof approvedAt !== 'string' || Number.isNaN(Date.parse(approvedAt))) reasons.push('threshold-approval-date')
  const timings = (observation['timings'] as Record<string, unknown> | undefined) ?? {}
  if (!positive(timings['connectSeconds'])) reasons.push('connect-time')
  if (!positive(timings['cycleSeconds'])) reasons.push('cycle-time')
  if (positive(timings['connectSeconds']) && positive(thresholds['connectSeconds'])
    && timings['connectSeconds'] > thresholds['connectSeconds']) reasons.push('connect-over-threshold')
  if (positive(timings['cycleSeconds']) && positive(thresholds['cycleSeconds'])
    && timings['cycleSeconds'] > thresholds['cycleSeconds']) reasons.push('cycle-over-threshold')

  const help = (observation['help'] as Record<string, unknown> | undefined) ?? {}
  if (typeof help['count'] !== 'number' || help['count'] < 0) reasons.push('help-count')
  if (typeof thresholds['maxHelp'] === 'number' && typeof help['count'] === 'number'
    && help['count'] > thresholds['maxHelp']) reasons.push('help-over-threshold')
  if (!Array.isArray(help['notes'])) reasons.push('help-notes')

  const diff = (observation['diff'] as Record<string, unknown> | undefined) ?? {}
  if (diff['explained'] !== true) reasons.push('diff-not-explained')
  const quote = diff['quote']
  if (typeof quote !== 'string' || quote.trim().length < 12) reasons.push('diff-quote')
  if (typeof quote === 'string' && /[{}[\]]/u.test(quote)) reasons.push('diff-quote-uses-structure')

  const recovery = (observation['recovery'] as Record<string, unknown> | undefined) ?? {}
  if (recovery['attempted'] !== true) reasons.push('recovery-not-attempted')
  if (recovery['passed'] !== true) reasons.push('recovery-failed')
  if (recovery['preservedWork'] !== true) reasons.push('recovery-lost-work')
  const nextAction = recovery['nextAction']
  if (typeof nextAction !== 'string' || nextAction.trim().length === 0) reasons.push('recovery-next-action')

  const normalPath = (observation['normalPath'] as Record<string, unknown> | undefined) ?? {}
  for (const field of ['tokens', 'commands', 'configEdits']) {
    if (normalPath[field] !== false) reasons.push(`normal-path-${field}`)
  }

  const load = (observation['load'] as Record<string, unknown> | undefined) ?? {}
  if (load['confirmed'] !== true) reasons.push('load-unconfirmed')
  const loadRevision = load['revision']
  if (typeof loadRevision !== 'string' || loadRevision.trim().length === 0) reasons.push('load-revision')
  const digest = load['packageDigest']
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest)) reasons.push('load-package-digest')
  if (load['hostVersion'] !== hostVersion) reasons.push('load-host-version')
  if (typeof revisionUsed === 'string' && loadRevision !== revisionUsed) reasons.push('load-revision-mismatch')
  const recordPath = load['recordPath']
  if (typeof recordPath !== 'string' || recordPath.trim().length === 0) {
    reasons.push('load-record-path')
  } else if (!recordExists(recordPath)) {
    reasons.push('load-record-missing')
  }
  return { ok: reasons.length === 0, reasons }
}
