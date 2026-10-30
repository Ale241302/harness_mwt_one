/**
 * The backend an installation launches: the local harness that reads this
 * computer's folders, or a gateway origin when the launching environment names
 * one.
 *
 * Only the environment can point an installation at a gateway, because a
 * deployment that configured one did it deliberately. Nothing the operator does
 * inside the application changes this, so there is no stored choice to keep in
 * step with it.
 */

import { resolveGatewayRequest } from './gateway.ts'

/** Backend the Desktop launches, with the gateway origin already resolved. */
export type DesktopBackend =
  | { readonly mode: 'local' }
  | { readonly mode: 'gateway'; readonly url: string }

/**
 * Resolve the backend this launch uses.
 * @param environment - the launching process environment.
 * @returns the gateway the environment named, or the local harness.
 */
export function resolveBackend(environment: NodeJS.ProcessEnv): DesktopBackend {
  const request = resolveGatewayRequest(environment)
  return request.kind === 'override' ? { mode: 'gateway', url: request.url } : { mode: 'local' }
}
