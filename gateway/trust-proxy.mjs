/**
 * How many reverse proxies the gateway trusts in front of it.
 *
 * Express resolves `req.ip` from `X-Forwarded-For` by walking the chain from
 * the socket outward and trusting the last N hops. Trusting every hop lets any
 * client choose its own rate-limit key by prepending an address, so the number
 * is explicit and validated instead of `true`.
 *
 * The count is the number of proxies that append an address: one for a single
 * nginx, two when a CDN appends the visitor address and nginx appends the CDN
 * edge behind it.
 */

/** Environment variable that carries the hop count. */
export const TRUST_PROXY_HOPS_ENV = 'TRUST_PROXY_HOPS'

/** Hops assumed when the environment does not name a count: one reverse proxy. */
export const DEFAULT_TRUST_PROXY_HOPS = 1

/**
 * Read the trusted hop count from its environment value.
 * @param raw - the environment value; `undefined` or empty selects the default.
 * @returns the number of proxies to trust.
 */
export function trustProxyHops(raw) {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRUST_PROXY_HOPS
  if (!/^\d+$/u.test(raw.trim())) {
    throw new Error(`${TRUST_PROXY_HOPS_ENV} must be a non-negative integer, got ${JSON.stringify(raw)}`)
  }
  const value = Number(raw.trim())
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${TRUST_PROXY_HOPS_ENV} must be a safe integer, got ${JSON.stringify(raw)}`)
  }
  return value
}
