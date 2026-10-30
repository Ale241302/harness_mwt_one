/**
 * An empty `sessionPersistence` for the composition. The workspace registry
 * bootstraps its header index from this seam and the fixture holds no stored
 * sessions, so the composition resolves Workspace paths without a session
 * medium.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name. */
export const name = 'test-session-persistence'

/**
 * Publish the seam with an empty session list.
 * @param ctx - the composition context.
 */
export function apply(ctx: Context): void {
  ctx.provide('sessionPersistence', {
    /** No stored sessions exist in this composition. */
    list: () => Promise.resolve([]),
  } as never)
}
