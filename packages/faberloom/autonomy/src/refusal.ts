/**
 * The autonomy refusal family. Every rejection this service raises is a
 * `FaberLoomAutonomyRefusal` whose message starts with `faberloom: <CODE> — `,
 * so callers match one error type and one prefix and switch on `code` instead
 * of parsing prose. The prefix and separator match the board and access
 * refusals.
 * @module @deepseek-ai/dsh-faberloom-autonomy/src/refusal
 */

/** Stable refusal codes the autonomy service raises. */
export type AutonomyRefusalCode =
  | 'TENANT_REQUIRED'
  | 'TENANT_MISMATCH'
  | 'UNIT_REFERENCE_INVALID'
  | 'UNIT_NOT_FOUND'
  | 'GOVERNANCE_NOT_PERMITTED'
  | 'ALREADY_DELEGATED'
  | 'NOT_ELIGIBLE'
  | 'CAUSE_REQUIRED'
  | 'PERIOD_INVALID'
  | 'OUTCOME_SOURCE_UNAVAILABLE'
  | 'TECHNICAL_FAILURE_REASON_REQUIRED'
  | 'NOT_DELEGATED'
  | 'SAMPLE_NOT_FOUND'
  | 'SAMPLE_ALREADY_REVIEWED'

/** Refusal raised by the autonomy service, carrying its stable code. */
export class FaberLoomAutonomyRefusal extends Error {
  /** Stable code; callers branch on it and never on the message text. */
  readonly code: AutonomyRefusalCode

  /**
   * @param code - stable refusal code.
   * @param detail - what the caller must change, without internal state.
   */
  constructor(code: AutonomyRefusalCode, detail: string) {
    super(`faberloom: ${code} — ${detail}`)
    this.name = 'FaberLoomAutonomyRefusal'
    this.code = code
  }
}
