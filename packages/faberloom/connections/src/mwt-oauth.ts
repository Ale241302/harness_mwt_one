/**
 * MWT.ONE OAuth client pieces: PKCE, the authorization URL, and the code and
 * refresh exchanges. The host owns the browser and the loopback callback; this
 * module keeps the protocol deterministic and free of storage so it can be
 * tested without an identity provider.
 * @module @deepseek-ai/dsh-faberloom-connections/src/mwt-oauth
 */

import { createHash, randomBytes } from 'node:crypto'

/** Endpoints and identity one MWT.ONE authorization uses. */
export interface MwtOAuthConfig {
  /** Authorization endpoint, for example `https://idp.mwt.one/application/o/authorize/`. */
  readonly authorizationEndpoint: string
  /** Token endpoint paired with the authorization endpoint. */
  readonly tokenEndpoint: string
  /** Public OAuth client id registered for the harness. */
  readonly clientId: string
  /** Requested scopes. */
  readonly scopes: readonly string[]
}

/** One PKCE verifier and its S256 challenge. */
export interface MwtPkcePair {
  /** High-entropy verifier kept until the code exchange. */
  readonly verifier: string
  /** `BASE64URL(SHA256(verifier))`, sent on the authorization request. */
  readonly challenge: string
}

/** One token response the client keeps. */
export interface MwtTokenSet {
  /** Bearer access token for the MCP endpoint. */
  readonly accessToken: string
  /** Refresh token, when the provider issued one. */
  readonly refreshToken: string | null
  /** Lifetime in seconds, when the provider declared it. */
  readonly expiresIn: number | null
  /** Token type the provider answered, `Bearer` by default. */
  readonly tokenType: string
  /** Granted scopes, when the provider echoed them. */
  readonly scope: string | null
}

/** A failed OAuth request with the provider status and a bounded body excerpt. */
export class MwtOAuthError extends Error {
  /**
   * @param message - what failed, without credentials.
   * @param status - provider HTTP status, when the request completed.
   */
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'MwtOAuthError'
  }
}

/** Encode bytes as unpadded base64url. */
function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/**
 * Create one PKCE verifier and its S256 challenge.
 * @param random - byte source; 32 bytes by default.
 * @returns the verifier and challenge.
 */
export function createPkcePair(random: (size: number) => Uint8Array = size => randomBytes(size)): MwtPkcePair {
  const verifier = base64url(random(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/**
 * Build the authorization URL the host opens in the browser.
 * @param config - endpoints and client identity.
 * @param state - one-time correlation value.
 * @param challenge - PKCE S256 challenge.
 * @param redirectUri - exact loopback URI the provider registered.
 * @returns the absolute authorization URL.
 */
export function buildMwtAuthorizeUrl(
  config: MwtOAuthConfig,
  state: string,
  challenge: string,
  redirectUri: string,
): string {
  const url = new URL(config.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', config.scopes.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/** Parse one token response body into the token set, rejecting a response without an access token. */
async function readTokenResponse(response: Response): Promise<MwtTokenSet> {
  const text = await response.text()
  if (!response.ok) {
    throw new MwtOAuthError(`MWT.ONE token endpoint answered ${String(response.status)}: ${text.slice(0, 300)}`, response.status)
  }
  const body: unknown = JSON.parse(text)
  if (typeof body !== 'object' || body === null) throw new MwtOAuthError('MWT.ONE token response is not an object')
  const record = body as Record<string, unknown>
  const accessToken = record['access_token']
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new MwtOAuthError('MWT.ONE token response has no access_token')
  }
  const refreshToken = record['refresh_token']
  const expiresIn = record['expires_in']
  return {
    accessToken,
    refreshToken: typeof refreshToken === 'string' && refreshToken.length > 0 ? refreshToken : null,
    expiresIn: typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? expiresIn : null,
    tokenType: typeof record['token_type'] === 'string' ? record['token_type'] : 'Bearer',
    scope: typeof record['scope'] === 'string' ? record['scope'] : null,
  }
}

/**
 * Exchange one authorization code for tokens.
 * @param fetchImpl - HTTP implementation.
 * @param config - endpoints and client identity.
 * @param code - authorization code from the callback.
 * @param verifier - PKCE verifier paired with the challenge.
 * @param redirectUri - exact redirect used on the authorization request.
 * @returns the token set.
 */
export async function exchangeMwtCode(
  fetchImpl: typeof fetch,
  config: MwtOAuthConfig,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<MwtTokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    code_verifier: verifier,
  })
  const response = await fetchImpl(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  })
  return await readTokenResponse(response)
}

/**
 * Exchange a refresh token for a new access token.
 * @param fetchImpl - HTTP implementation.
 * @param config - endpoints and client identity.
 * @param refreshToken - refresh token from the last exchange.
 * @returns the refreshed token set.
 */
export async function refreshMwtToken(
  fetchImpl: typeof fetch,
  config: MwtOAuthConfig,
  refreshToken: string,
): Promise<MwtTokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
  })
  const response = await fetchImpl(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  })
  return await readTokenResponse(response)
}
