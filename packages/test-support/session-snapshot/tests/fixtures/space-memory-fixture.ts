import type { Context } from '@deepseek-ai/cordis'

export const name = 'space-memory-fixture'

/**
 * Provide deterministic spaces and memory services so the opt-in space-memory
 * and teaching tools run without the storage domain.
 * @param ctx - owning Cordis context.
 */
export function apply(ctx: Context): void {
  ctx.provide('faberloomSpaces' as never, {
    async remember(_actor: unknown, text: string, ids: string[]) {
      return { id: 'm-new', spaceIds: ids, text, createdAt: '2026-10-03T00:00:00.000Z' }
    },
    async listMemory() { return [] },
    async effectiveMemory() { return [] },
    async forgetMemory() { return true },
  })
  ctx.provide('faberloomMemory' as never, {
    async createTeaching(_owner: string, input: { active?: boolean }) {
      return { id: 't-new', status: input.active === true ? 'active' : 'candidate', version: 1 }
    },
    async listTeachings() { return [] },
    async revokeTeaching() { return { id: 't-new', status: 'revoked', version: 1 } },
    async retrieve() { return [] },
  })
}
