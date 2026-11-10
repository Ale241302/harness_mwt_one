/**
 * The Remote namespace this surface reads, mounted by the package itself.
 *
 * The FaberLoom application compiles `dsh-faberloom-view` into its Remote
 * assembly, but the stock DeepSeek Harness application compiles its own and
 * never includes this product. A client entry that declares the namespace in
 * `inject` therefore stays PENDING on that Host forever. Mounting the generated
 * contribution here makes the surface work with the plugin alone, and a Host
 * that already mounted the namespace keeps its instance.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import faberloomViewRemote from '@deepseek-ai/dsh-faberloom-view/remote'

/** The Remote namespace the FaberLoom surface reads. */
export const VIEW_NAMESPACE = 'remote.faberloomView'

/**
 * Log one activation phase failure with its stack. The Web shell reports only
 * the fiber state of an entry that did not activate, so a phase that throws
 * would otherwise leave no cause anywhere the operator can read.
 * @param phase - activation step that failed.
 * @param error - the thrown value.
 */
export function reportFailure(phase: string, error: unknown): void {
  const detail = error instanceof Error
    ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
    : String(error)
  console.error(`[ui-faberloom] ${phase} failed: ${detail}`)
}

/**
 * Mount the generated `faberloomView` contribution unless the Host assembly
 * already mounted it.
 * @param ctx - client context carrying the Remote service.
 */
export async function ensureViewRemote(ctx: ClientContext): Promise<void> {
  if (ctx.get(VIEW_NAMESPACE) !== undefined) return
  const dispose = await ctx.remote.$mount(faberloomViewRemote)
  ctx.effect(() => dispose, 'ui-faberloom: view remote')
}
