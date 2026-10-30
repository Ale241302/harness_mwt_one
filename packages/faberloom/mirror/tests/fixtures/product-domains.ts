/**
 * Declare the product domains the mirror carries in the Loader composition:
 * a product service opens its domain on the first write, and a test boot has no
 * writes, so nothing would be there for the mirror to reach.
 */

import type { Context } from '@deepseek-ai/cordis'
import { accessDomainSpec } from '../../../access/src/spec.ts'

/** Cordis plugin name. */
export const name = 'test-product-domains'

/** The domain form must exist before a domain can be opened. */
export const inject = ['storageDomain']

/**
 * Open one mirrored domain and keep it open for the composition's lifetime.
 * @param ctx - the composition context.
 * @returns nothing; the domain closes with the plugin fiber.
 */
export async function apply(ctx: Context): Promise<void> {
  const grants = await ctx.storageDomain.open(accessDomainSpec)
  ctx.effect(() => () => grants.close(), 'test-product-domains.close')
}
