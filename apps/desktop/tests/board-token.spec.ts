import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BOARD_TOKEN_FILENAME, boardGatewayOrigin, writeBoardToken } from '../src/board-token.ts'

const homes: string[] = []

/** A throwaway Harness home. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-board-token-'))
  homes.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A fetch double that answers one JSON body. */
function stubFetch(status: number, body: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('desktop board token', () => {
  it('stores the token the gateway signs', async () => {
    const dir = home()
    expect(await writeBoardToken({
      home: dir,
      accessToken: 'console-token',
      gatewayUrl: 'https://harness.test/',
      fetch: stubFetch(200, { token: 'signed-board-token' }),
    })).toBe(true)
    expect(readFileSync(join(dir, BOARD_TOKEN_FILENAME), 'utf8')).toBe('signed-board-token')
  })

  it('leaves the home untouched when the exchange is refused', async () => {
    const dir = home()
    expect(await writeBoardToken({
      home: dir,
      accessToken: 'console-token',
      gatewayUrl: 'https://harness.test',
      fetch: stubFetch(401, { error: 'UNAUTHENTICATED' }),
    })).toBe(false)
    expect(existsSync(join(dir, BOARD_TOKEN_FILENAME))).toBe(false)
  })

  it('does nothing without a gateway or a console bearer', async () => {
    const dir = home()
    expect(await writeBoardToken({ home: dir, accessToken: '' })).toBe(false)
    expect(existsSync(join(dir, BOARD_TOKEN_FILENAME))).toBe(false)
  })

  it('names the gateway origin without a trailing slash', () => {
    expect(boardGatewayOrigin('https://harness.mwt.one/')).toBe('https://harness.mwt.one')
    expect(boardGatewayOrigin(undefined)).toBe('https://harness.mwt.one')
  })
})
