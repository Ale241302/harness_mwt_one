/**
 * Desktop gateway facts: the environment name a deployment or a development run
 * uses to override the backend, and the gateway origin the Desktop ships with.
 */

/** Environment name selecting the gateway the Desktop connects to. */
export const GATEWAY_URL_ENV = 'DSH_DESKTOP_GATEWAY_URL'

/** Gateway the Desktop connects to when the stored choice names the gateway. */
export const DEFAULT_GATEWAY_URL = 'https://harness.mwt.one/'

/**
 * What the launching environment asks the Desktop to launch. An unset value
 * defers to the stored choice; a blank value asks for the local harness; any
 * other value names the gateway origin to load.
 */
export type DesktopGatewayRequest =
  | { readonly kind: 'override'; readonly url: string }
  | { readonly kind: 'local' }
  | { readonly kind: 'none' }

/**
 * Read the backend the launching environment requests.
 * @param environment - the launching process environment.
 * @returns the requested backend, or `none` when the environment defers.
 */
export function resolveGatewayRequest(environment: NodeJS.ProcessEnv): DesktopGatewayRequest {
  const value = environment[GATEWAY_URL_ENV]
  if (value === undefined) return { kind: 'none' }
  const trimmed = value.trim()
  return trimmed === '' ? { kind: 'local' } : { kind: 'override', url: trimmed }
}
