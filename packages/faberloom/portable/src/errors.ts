/**
 * Refusals of the portable artifact service carry one stable code and one
 * human-readable detail. The code is the contract a caller branches on.
 * @module @deepseek-ai/dsh-faberloom-portable/src/errors
 */

/**
 * Build one portable refusal.
 * @param code - stable code without the `faberloom:` prefix.
 * @param detail - one-line explanation.
 * @returns the error a caller catches.
 */
export function portableError(code: string, detail: string): Error {
  return new Error(`faberloom: ${code} — ${detail}`)
}
