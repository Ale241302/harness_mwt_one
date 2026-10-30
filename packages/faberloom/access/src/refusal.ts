/**
 * The access refusal family. Every rejection the access service raises is a
 * `FaberLoomAccessRefusal` whose message starts with `faberloom: <CODE> — `, so
 * callers match one error type and one message prefix and switch on `code`
 * instead of parsing prose. The prefix and separator match the board's refusals.
 * @module @deepseek-ai/dsh-faberloom-access/src/refusal
 */

/** Stable refusal codes the access service raises. */
export type AccessRefusalCode =
  | 'GRANT_NOT_FOUND'
  | 'GRANT_NOT_OWNER'
  | 'SIGNATURE_NOT_FOUND'
  | 'SIGNATURE_NOT_PERMITTED'
  | 'SIGNATURE_AUTHORITY_UNCONFIGURED'
  | 'SIGNATURE_SCOPE_REQUIRED'
  | 'SIGNATURE_SCOPE_INVALID'
  | 'SIGNATURE_WILDCARD_DISALLOWED'
  | 'SIGNATURE_INVALID_INSTANT'
  | 'SIGNATURE_REQUIRED'
  | 'SIGNATURE_REVOKED'
  | 'SIGNATURE_EXPIRED'

/** Refusal raised by the access service, carrying its stable code. */
export class FaberLoomAccessRefusal extends Error {
  /** Stable code; callers branch on it and never on the message text. */
  readonly code: AccessRefusalCode

  /**
   * @param code - stable refusal code.
   * @param detail - what the caller must change, without internal state.
   */
  constructor(code: AccessRefusalCode, detail: string) {
    super(`faberloom: ${code} — ${detail}`)
    this.name = 'FaberLoomAccessRefusal'
    this.code = code
  }
}
