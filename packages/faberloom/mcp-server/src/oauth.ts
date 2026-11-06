/**
 * Local OAuth 2.1 authorization-code flow with PKCE, used to connect one MCP
 * client to one Space without either side copying a bearer secret.
 *
 * This module owns the pure validation and the consent page. The server owns
 * the durable transaction, the one-time code, and the token exchange. The
 * endpoint is local: `issuer`, `resource`, and `redirect_uri` are checked against
 * the running server and against a loopback callback, never against a remote
 * provider (D02).
 * @module @deepseek-ai/dsh-faberloom-mcp-server/oauth
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { PROPOSAL_TOOL } from './protocol.ts'

/** The only client this local authorization server registers. */
export const LOCAL_CLIENT_ID = 'faberloom-local'

/** How long the consent transaction stays pending. */
export const AUTHORIZE_TTL_MS = 10 * 60_000

/** How long an authorization code can be exchanged. */
export const CODE_TTL_MS = 5 * 60_000

/** Longest scope a client may ask for. */
const MAX_SCOPE = 128

/** One validated authorization request. */
export interface LocalAuthorizationRequest {
  /** Registered client identifier. */
  readonly clientId: string
  /** Exact loopback callback the code returns to. */
  readonly redirectUri: string
  /** S256 challenge derived from the client verifier. */
  readonly codeChallenge: string
  /** Opaque state the client verifies on return. */
  readonly state: string
  /** MCP endpoint the token is for. */
  readonly resource: string
  /** Tool scopes the token will carry. */
  readonly scopes: readonly string[]
  /** Space the work is confined to, when any. */
  readonly spaceId: string | null
  /** Revision the reference is fixed to, when the client named one. */
  readonly revision: string | null
}

/** The result of validating one authorization request. */
export type AuthorizationValidation =
  | { readonly ok: true; readonly value: LocalAuthorizationRequest }
  | { readonly ok: false; readonly error: string }

/**
 * Encode one buffer as unpadded base64url.
 * @param bytes - bytes to encode.
 * @returns the base64url text.
 */
function base64url(bytes: Buffer): string {
  return bytes.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

/**
 * Hash one PKCE verifier the way S256 requires.
 * @param verifier - client verifier.
 * @returns the base64url challenge.
 */
export function pkceChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

/**
 * Verify a PKCE verifier against the challenge the client sent.
 * @param verifier - client verifier.
 * @param challenge - stored S256 challenge.
 * @returns whether they match.
 */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const actual = Buffer.from(pkceChallenge(verifier))
  const expected = Buffer.from(challenge)
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

/**
 * Generate one opaque value with a stable prefix.
 * @param prefix - prefix the value must carry.
 * @returns the prefixed random value.
 */
export function opaque(prefix: string): string {
  return `${prefix}${randomBytes(24).toString('base64url')}`
}

/**
 * Whether a redirect target is a loopback callback this server accepts. The
 * exact string is still stored and compared at exchange time.
 * @param raw - redirect URI from the request.
 * @returns whether it is an http loopback URL without fragment.
 */
function loopbackRedirect(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' || url.hash.length > 0) return false
  if (url.username.length > 0 || url.password.length > 0) return false
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1' || url.hostname === '[::1]'
}

/**
 * Validate one authorization request against the local server.
 * @param params - query parameters.
 * @param options - MCP resource and the tools this deployment advertises.
 * @returns the normalized request, or the OAuth error code.
 */
export function validateAuthorization(
  params: URLSearchParams,
  options: { readonly audience: string; readonly scopes: readonly string[] },
): AuthorizationValidation {
  if (params.get('response_type') !== 'code') return { ok: false, error: 'unsupported_response_type' }
  if (params.get('client_id') !== LOCAL_CLIENT_ID) return { ok: false, error: 'unauthorized_client' }
  const redirectUri = params.get('redirect_uri') ?? ''
  if (!loopbackRedirect(redirectUri)) return { ok: false, error: 'invalid_redirect_uri' }
  const state = params.get('state') ?? ''
  if (state.length < 8 || state.length > 256) return { ok: false, error: 'invalid_state' }
  const codeChallenge = params.get('code_challenge') ?? ''
  if (!/^[A-Za-z0-9_-]{43,128}$/u.test(codeChallenge)) return { ok: false, error: 'invalid_code_challenge' }
  if (params.get('code_challenge_method') !== 'S256') return { ok: false, error: 'invalid_code_challenge_method' }
  const resource = params.get('resource') ?? ''
  if (resource !== options.audience) return { ok: false, error: 'invalid_target' }
  const scopes = (params.get('scope') ?? '').split(/\s+/u).filter(scope => scope.length > 0)
  if (scopes.length === 0 || scopes.some(scope => scope.length > MAX_SCOPE || !options.scopes.includes(scope))) {
    return { ok: false, error: 'invalid_scope' }
  }
  const unique = [...new Set(scopes)]
  if (unique.includes(PROPOSAL_TOOL) && unique.length !== 1) return { ok: false, error: 'invalid_scope' }
  const spaceId = params.get('space_id')?.trim() ?? ''
  if (spaceId.length > 0 && (unique.length !== 1 || unique[0] !== PROPOSAL_TOOL)) {
    return { ok: false, error: 'invalid_scope' }
  }
  const revision = params.get('revision')?.trim() ?? ''
  if (revision.length > 128) return { ok: false, error: 'invalid_request' }
  return {
    ok: true,
    value: {
      clientId: LOCAL_CLIENT_ID,
      redirectUri,
      codeChallenge,
      state,
      resource,
      scopes: unique,
      spaceId: spaceId.length === 0 ? null : spaceId,
      revision: revision.length === 0 ? null : revision,
    },
  }
}

/**
 * Escape text for one HTML text node or attribute.
 * @param value - untrusted text.
 * @returns the escaped text.
 */
function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/**
 * Render the waiting page. The approval happens in the signed-in product UI,
 * not in this page: the page only tells the person where to approve and keeps
 * checking the transaction. No approving control and no secret are embedded.
 * @param request - validated authorization request.
 * @param transaction - one-time transaction id.
 * @param spaceTitle - title of the Space, when the request names one.
 * @param companyId - company the request will act for, when known.
 * @returns the HTML page.
 */
export function consentPage(
  request: LocalAuthorizationRequest,
  transaction: string,
  spaceTitle: string | null,
  companyId: string | null,
): string {
  const scopes = request.scopes.map(scope => `<li><code>${escapeHtml(scope)}</code></li>`).join('')
  const space = request.spaceId === null
    ? '<p>Sin espacio: el token conserva el alcance del hogar.</p>'
    : `<p>Espacio solicitado: <strong>${escapeHtml(spaceTitle ?? request.spaceId)}</strong></p>`
  const company = companyId === null ? '<p>Sin empresa.</p>' : `<p>Empresa: <strong>${escapeHtml(companyId)}</strong></p>`
  const status = `/authorize/status?transaction=${encodeURIComponent(transaction)}`
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Conectar FaberLoom</title>
<meta http-equiv="refresh" content="2;url=${escapeHtml(status)}">
<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;line-height:1.5}code{background:#eee;padding:.1rem .3rem}</style>
</head><body>
<h1>Conectar un agente a FaberLoom</h1>
<p>Aprueba esta solicitud en <strong>FaberLoom → Conexiones → Servidor MCP</strong>. Esta página se actualizará cuando lo hagas.</p>
${space}
${company}
<ul>${scopes}</ul>
<p><a href="${escapeHtml(status)}">Continuar</a></p>
</body></html>
`
}
