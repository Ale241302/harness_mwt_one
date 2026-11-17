/**
 * Egress policy: which servers a connection may reach.
 *
 * The lab declared this policy in `egress-policy.json` and nothing read it, so
 * the barrier was a document. Here it becomes a check on the choke point where
 * credentials are handed to a transport: a host the deployment did not authorize
 * never gets credentials, so no socket opens.
 *
 * Configuration is by environment, like the board's remote activation:
 * `FABERLOOM_EGRESS_DENY=*.hostinger.com,*.muitowork.com` and, when a deny list
 * exists, `FABERLOOM_EGRESS_ALLOW=127.0.0.1` for the exceptions. With neither
 * variable the policy is unconfigured and nothing changes; a deployment that
 * configures it gets default-deny.
 * @module @deepseek-ai/dsh-faberloom-connections/src/egress
 */

/** One parsed policy. */
export interface EgressPolicy {
  /** Patterns that are always allowed, even when a deny pattern matches. */
  readonly allow: readonly string[]
  /** Patterns that are refused. */
  readonly deny: readonly string[]
  /** Whether the deployment configured anything at all. */
  readonly configured: boolean
}

/** Environment variable naming the denied hosts. */
export const EGRESS_DENY_ENV = 'FABERLOOM_EGRESS_DENY'

/** Environment variable naming the allowed exceptions. */
export const EGRESS_ALLOW_ENV = 'FABERLOOM_EGRESS_ALLOW'

/** Split a comma-separated pattern list. */
function patterns(raw: string | undefined): readonly string[] {
  return (raw ?? '').split(',').map(entry => entry.trim().toLowerCase()).filter(entry => entry.length > 0)
}

/**
 * Read the policy from the environment.
 * @param env - environment to read; `process.env` by default.
 * @returns the parsed policy; `configured` is false when neither variable is set.
 */
export function egressPolicyFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): EgressPolicy {
  const deny = patterns(env[EGRESS_DENY_ENV])
  const allow = patterns(env[EGRESS_ALLOW_ENV])
  return { deny, allow, configured: deny.length > 0 || allow.length > 0 }
}

/**
 * Whether a host matches one pattern: exact, or a `*.` suffix.
 * @param pattern - pattern from the policy.
 * @param host - host being reached, lower-case.
 * @returns whether it matches.
 */
export function hostMatches(pattern: string, host: string): boolean {
  const target = host.trim().toLowerCase()
  if (pattern === target) return true
  if (!pattern.startsWith('*.')) return false
  const suffix = pattern.slice(1)
  return target.endsWith(suffix) && target.length > suffix.length
}

/**
 * Decide whether one destination may be reached.
 * @param policy - parsed policy.
 * @param host - host the connection would reach.
 * @returns the decision and, when refused, the pattern that refused it.
 */
export function checkEgress(policy: EgressPolicy, host: string): { allowed: boolean; reason: string } {
  if (!policy.configured) return { allowed: true, reason: 'NO_POLICY' }
  const allowed = policy.allow.some(pattern => hostMatches(pattern, host))
  if (allowed) return { allowed: true, reason: 'ALLOWED' }
  const denied = policy.deny.find(pattern => hostMatches(pattern, host))
  if (denied !== undefined) return { allowed: false, reason: `DENIED_BY ${denied}` }
  // A configured policy is default-deny: an unlisted host is not authorized.
  return { allowed: false, reason: 'NOT_ALLOWED' }
}

/**
 * Refuse a destination the policy does not authorize.
 * @param policy - parsed policy.
 * @param host - host the connection would reach.
 * @param purpose - short label for the refusal (`smtp`, `imap`).
 * @throws when the host is not authorized.
 */
export function assertEgressAllowed(policy: EgressPolicy, host: string, purpose: string): void {
  const decision = checkEgress(policy, host)
  if (decision.allowed) return
  throw new Error(`faberloom: EGRESS_DENIED — ${purpose} ${host} is not authorized (${decision.reason})`)
}
