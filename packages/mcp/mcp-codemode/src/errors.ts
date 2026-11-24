/**
 * Error-text rendering shared by the facade's modules. One owner keeps the
 * `Error`/non-`Error` decision in a single tested place.
 * @module @deepseek-ai/dsh-mcp-codemode/src/errors
 */

/**
 * Render any thrown value as the one-line message a diagnostic or a tool result carries.
 * @param error - Thrown value, which need not be an `Error`.
 * @returns `Error.message` for an `Error`, otherwise the value as text.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
