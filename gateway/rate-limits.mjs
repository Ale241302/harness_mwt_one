/**
 * Rate-limit responses the gateway returns. Kept in one module so a test can
 * read the body without booting the supervisor, the console, and the secrets
 * the gateway needs.
 * @module harness-mwt-gateway/rate-limits
 */

/**
 * The JSON-RPC error body the MCP endpoint returns when one account exceeds its
 * per-minute window. It names the limit, so the caller knows waiting is enough.
 * @param perMin - the configured requests-per-minute ceiling.
 * @returns the JSON-RPC error object.
 */
export function mcpRateLimitError(perMin) {
  return {
    code: -32000,
    message: `demasiadas peticiones (máximo ${perMin} por minuto)`,
  }
}
