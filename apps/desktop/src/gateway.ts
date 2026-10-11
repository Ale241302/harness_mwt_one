/**
 * Desktop backend selection: the shared gateway the Desktop loads as a client,
 * or the local single-user harness.
 */

/** Environment name selecting the gateway the Desktop connects to. */
export const GATEWAY_URL_ENV = 'DSH_DESKTOP_GATEWAY_URL'

/** Gateway the Desktop connects to when the deployment does not override it. */
export const DEFAULT_GATEWAY_URL = 'https://harness.mwt.one/'

/**
 * Resolve the gateway URL for remote mode. The Desktop ships as a client of the
 * shared multi-user gateway so every product module shows the same data as the
 * Web UI; an empty value selects the local single-user harness instead.
 * @param environment - the launching process environment.
 * @returns the gateway URL, or undefined to boot the local harness.
 */
export function resolveGatewayUrl(environment: NodeJS.ProcessEnv): string | undefined {
  const value = environment[GATEWAY_URL_ENV] ?? DEFAULT_GATEWAY_URL
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}
