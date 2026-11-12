/**
 * The credential the Desktop keeps so its Mesa is the same queue the web shows.
 *
 * The Desktop signs in with the console, not with the gateway, so it has no
 * gateway session cookie. `POST /board-token` on the gateway exchanges the
 * console bearer for a board token signed for the same tenant and role the web
 * process receives; this module writes that token into the Harness home, where
 * the `faberloom-board` row reads it before every request.
 * @module @deepseek-ai/dsh-desktop/src/board-token
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_GATEWAY_URL } from './gateway.ts'

/** File the board row reads before every request. */
export const BOARD_TOKEN_FILENAME = '.board-token'

/** What one exchange needs. */
export interface BoardTokenInput {
  /** Harness home that keeps the file. */
  readonly home: string
  /** Console bearer the Desktop already holds. */
  readonly accessToken: string
  /** Gateway origin; the shipped default when absent. */
  readonly gatewayUrl?: string
  /** Fetch seam for tests. */
  readonly fetch?: typeof fetch
}

/**
 * Ask the gateway for a board token and store it.
 * @param input - home, console bearer, and the gateway origin.
 * @returns whether a token was written; a failed exchange leaves the home as it was.
 */
export async function writeBoardToken(input: BoardTokenInput): Promise<boolean> {
  const base = (input.gatewayUrl ?? DEFAULT_GATEWAY_URL).trim().replace(/\/+$/u, '')
  if (base.length === 0 || input.accessToken.length === 0) return false
  const call = input.fetch ?? fetch
  let token = ''
  try {
    const response = await call(`${base}/board-token`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: '{}',
    })
    if (!response.ok) return false
    const body = (await response.json()) as { token?: unknown }
    token = typeof body.token === 'string' ? body.token : ''
  } catch {
    // Sin gateway no hay Mesa compartida: el escritorio conserva la local y el
    // próximo inicio de sesión reintenta.
    return false
  }
  if (token.length === 0) return false
  writeFileSync(join(input.home, BOARD_TOKEN_FILENAME), token, 'utf8')
  return true
}

/**
 * Gateway origin the board should use when the home does not name one.
 * @param mirrorUrl - `FABERLOOM_MIRROR_URL` from the home, when set.
 * @returns the origin without a trailing slash.
 */
export function boardGatewayOrigin(mirrorUrl: string | undefined): string {
  const value = (mirrorUrl ?? DEFAULT_GATEWAY_URL).trim().replace(/\/+$/u, '')
  return value.length === 0 ? DEFAULT_GATEWAY_URL.replace(/\/+$/u, '') : value
}
