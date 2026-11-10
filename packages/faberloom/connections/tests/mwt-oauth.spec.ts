import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  MwtOAuthError,
  buildMwtAuthorizeUrl,
  createPkcePair,
  exchangeMwtCode,
  refreshMwtToken,
  type MwtOAuthConfig,
} from '../src/mwt-oauth.ts'

const CONFIG: MwtOAuthConfig = {
  authorizationEndpoint: 'https://idp.mwt.one/application/o/authorize/',
  tokenEndpoint: 'https://idp.mwt.one/application/o/token/',
  clientId: 'harness-desktop',
  scopes: ['openid', 'profile', 'email'],
}

/** Read one recorded form body, rejecting anything that is not a string. */
function formBody(init: RequestInit | undefined): URLSearchParams {
  const body = init?.body
  if (typeof body !== 'string') throw new Error('expected a form body')
  return new URLSearchParams(body)
}

describe('MWT.ONE OAuth client', () => {
  it('derives the S256 challenge from the verifier (RFC 7636)', () => {
    const pair = createPkcePair()
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    const expected = createHash('sha256').update(pair.verifier).digest('base64url')
    expect(pair.challenge).toBe(expected)
  })

  it('builds an authorization URL with PKCE and the exact redirect', () => {
    const url = new URL(buildMwtAuthorizeUrl(CONFIG, 'state-1', 'challenge-1', 'http://127.0.0.1:49152/callback'))
    expect(url.origin + url.pathname).toBe('https://idp.mwt.one/application/o/authorize/')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('harness-desktop')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:49152/callback')
    expect(url.searchParams.get('scope')).toBe('openid profile email')
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('exchanges the code with the verifier and parses the token set', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid profile',
    }), { status: 200 }))
    const tokens = await exchangeMwtCode(fetchImpl, CONFIG, 'code-1', 'verifier-1', 'http://127.0.0.1:49152/callback')
    expect(tokens).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresIn: 3600,
      tokenType: 'Bearer',
      scope: 'openid profile',
    })
    const call = fetchImpl.mock.calls[0]
    if (call === undefined) throw new Error('fetch was not called')
    const [url, init] = call
    expect(url).toBe(CONFIG.tokenEndpoint)
    expect(init?.method).toBe('POST')
    const body = formBody(init)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('code-1')
    expect(body.get('code_verifier')).toBe('verifier-1')
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:49152/callback')
  })

  it('refreshes without asking for a new code', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      access_token: 'access-2',
      expires_in: 3600,
    }), { status: 200 }))
    const tokens = await refreshMwtToken(fetchImpl, CONFIG, 'refresh-1')
    expect(tokens.accessToken).toBe('access-2')
    expect(tokens.refreshToken).toBeNull()
    const call = fetchImpl.mock.calls[0]
    if (call === undefined) throw new Error('fetch was not called')
    const body = formBody(call[1])
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('refresh-1')
  })

  it('reports a failed exchange with its status and no credentials', async () => {
    const fetchImpl = vi.fn(async () => new Response('invalid_grant', { status: 400 }))
    await expect(exchangeMwtCode(fetchImpl, CONFIG, 'code', 'verifier', 'http://127.0.0.1/callback'))
      .rejects.toBeInstanceOf(MwtOAuthError)
  })
})
