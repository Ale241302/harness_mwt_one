/**
 * The six product domains one projection reads, opened for the composition's
 * lifetime. A product service opens its domain on its first write and a test
 * boot has none, so nothing would be readable without this fixture; a domain
 * this process does not hold open is what the projection reports as unread.
 */

import type { Context } from '@deepseek-ai/cordis'
import { agentsDomainSpec } from '../../../agents/src/spec.ts'
import { contextDomainSpec } from '../../../context/src/spec.ts'
import { memoryDomainSpec } from '../../../learning/src/spec.ts'
import { routinesDomainSpec } from '../../../routines/src/spec.ts'
import { spacesDomainSpec } from '../../../spaces/src/spec.ts'
import { workflowsDomainSpec } from '../../../workflows/src/spec.ts'

/** Cordis plugin name. */
export const name = 'test-product-domains'

/** The domain form must exist before a domain can be opened. */
export const inject = ['storageDomain']

/**
 * Open every product domain one projection reads and keep it open for the
 * composition's lifetime.
 * @param ctx - the composition context.
 */
export async function apply(ctx: Context): Promise<void> {
  const opened: { close(): Promise<void> }[] = []
  for (const spec of [spacesDomainSpec, agentsDomainSpec, workflowsDomainSpec, routinesDomainSpec, memoryDomainSpec, contextDomainSpec]) {
    opened.push(await ctx.storageDomain.open(spec))
  }
  ctx.effect(() => async () => {
    for (const domain of opened) await domain.close()
  }, 'test-product-domains.close')
}
