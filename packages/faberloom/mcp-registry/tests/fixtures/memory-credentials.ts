/**
 * The in-memory credential seam for the Loader composition, so a saved MCP
 * server's environment or header values are stored off the durable record
 * without touching a real credential provider.
 */

import type { Context } from '@deepseek-ai/cordis'
import { MemoryCredentials } from '../../../../credentials/credentials/tests/memory.ts'

/** Cordis plugin name. */
export const name = 'test-memory-credentials'

/**
 * Mount the in-memory credential provider, seeded from the row's config.
 * @param ctx - the composition context.
 * @param config - seed values keyed by credential reference.
 * @returns the provider's fiber.
 */
export function apply(ctx: Context, config: Record<string, string> = {}) {
  return ctx.plugin(MemoryCredentials, config)
}
