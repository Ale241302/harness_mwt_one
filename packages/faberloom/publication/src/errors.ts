/**
 * Stable refusal codes shared by the publication service and its adapters.
 * Every message starts with `faberloom: <CODE> — ` so an operator can find the
 * failing step without parsing prose.
 * @module @deepseek-ai/dsh-faberloom-publication/src/errors
 */

/**
 * Build one refusal.
 * @param code - stable uppercase code.
 * @param detail - operator-facing detail; never carries a credential.
 * @returns the error to throw.
 */
export function publicationError(code: string, detail: string): Error {
  return new Error(`faberloom: ${code} — ${detail}`)
}
