import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  CONSOLE_TOKEN_FILENAME,
  CONSOLE_TOKEN_WATCHER_FILENAME,
  refreshConsoleToken,
  removeConsoleTokenFile,
  startConsoleTokenRefresh,
  writeConsoleTokenWatcher,
} from '../src/console-token.ts'
import { HOME_ENV_FILENAME } from '../src/home-env.ts'

const roots: string[] = []

function fixture(env: string): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-console-token-'))
  roots.push(root)
  writeFileSync(join(root, HOME_ENV_FILENAME), env)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

it('exchanges the refresh token and rewrites both credential files', async () => {
  const home = fixture('CONSOLA_API_BASE=https://console.test/api\nCONSOLA_TOKEN=old\nCONSOLA_REFRESH=refresh-1\n# keep me\n')
  const calls: { url: string; body: string | undefined }[] = []
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: typeof init?.body === 'string' ? init.body : undefined })
    return jsonResponse({ access: 'new-access', refresh: 'refresh-2' })
  }) as typeof fetch

  const result = await refreshConsoleToken(home, { fetch: fake })

  expect(result).toEqual({ refreshed: true, token: 'new-access' })
  expect(calls).toEqual([{ url: 'https://console.test/api/auth/refresh/', body: JSON.stringify({ refresh: 'refresh-1' }) }])
  const env = readFileSync(join(home, HOME_ENV_FILENAME), 'utf8')
  expect(env).toContain('CONSOLA_TOKEN=new-access')
  expect(env).toContain('CONSOLA_REFRESH=refresh-2')
  expect(env).toContain('# keep me')
  expect(readFileSync(join(home, CONSOLE_TOKEN_FILENAME), 'utf8').trim()).toBe('new-access')
})

it('keeps the previous refresh token when the console does not rotate it', async () => {
  const home = fixture('CONSOLA_TOKEN=old\nCONSOLA_REFRESH=refresh-1\n')
  const fake = (async () => jsonResponse({ access: 'new-access' })) as typeof fetch

  await refreshConsoleToken(home, { fetch: fake })

  expect(readFileSync(join(home, HOME_ENV_FILENAME), 'utf8')).toContain('CONSOLA_REFRESH=refresh-1')
  expect(readFileSync(join(home, CONSOLE_TOKEN_FILENAME), 'utf8').trim()).toBe('new-access')
})

it('publishes the stored access token when no refresh token exists', async () => {
  const home = fixture('CONSOLA_TOKEN=stored\n')
  const fake = vi.fn()

  const result = await refreshConsoleToken(home, { fetch: fake as unknown as typeof fetch })

  expect(result).toEqual({ refreshed: false })
  expect(fake).not.toHaveBeenCalled()
  expect(readFileSync(join(home, CONSOLE_TOKEN_FILENAME), 'utf8').trim()).toBe('stored')
})

it('writes nothing when the home holds no console credential', async () => {
  const home = fixture('DEEPSEEK_API_KEY=only-this\n')
  const fake = vi.fn()

  const result = await refreshConsoleToken(home, { fetch: fake as unknown as typeof fetch })

  expect(result).toEqual({ refreshed: false })
  expect(fake).not.toHaveBeenCalled()
  expect(existsSync(join(home, CONSOLE_TOKEN_FILENAME))).toBe(false)
})

it('leaves the files alone when the console is unreachable', async () => {
  const home = fixture('CONSOLA_TOKEN=old\nCONSOLA_REFRESH=refresh-1\n')
  const fake = (async () => { throw new Error('offline') }) as typeof fetch

  expect(await refreshConsoleToken(home, { fetch: fake })).toEqual({ refreshed: false })
  expect(readFileSync(join(home, HOME_ENV_FILENAME), 'utf8')).toContain('CONSOLA_TOKEN=old')
  expect(existsSync(join(home, CONSOLE_TOKEN_FILENAME))).toBe(false)
})

it('leaves the files alone when the console refuses the refresh', async () => {
  const home = fixture('CONSOLA_TOKEN=old\nCONSOLA_REFRESH=refresh-1\n')
  const fake = (async () => jsonResponse({ detail: 'no' }, 401)) as typeof fetch

  expect(await refreshConsoleToken(home, { fetch: fake })).toEqual({ refreshed: false })
  expect(readFileSync(join(home, HOME_ENV_FILENAME), 'utf8')).toContain('CONSOLA_TOKEN=old')
})

it('refuses a body that is not JSON or carries no access token', async () => {
  const home = fixture('CONSOLA_TOKEN=old\nCONSOLA_REFRESH=refresh-1\n')
  const notJson = (async () => new Response('nope', { status: 200 })) as typeof fetch
  const noAccess = (async () => jsonResponse({ refresh: 'refresh-2' })) as typeof fetch

  expect(await refreshConsoleToken(home, { fetch: notJson })).toEqual({ refreshed: false })
  expect(await refreshConsoleToken(home, { fetch: noAccess })).toEqual({ refreshed: false })
  expect(readFileSync(join(home, HOME_ENV_FILENAME), 'utf8')).toContain('CONSOLA_TOKEN=old')
})

it('falls back to the official console base when the env names none', async () => {
  const home = fixture('CONSOLA_TOKEN=old\nCONSOLA_REFRESH=refresh-1\n')
  const seen: string[] = []
  const fake = (async (url: string | URL | Request) => {
    seen.push(String(url))
    return jsonResponse({ access: 'new-access' })
  }) as typeof fetch

  await refreshConsoleToken(home, { fetch: fake })

  expect(seen).toEqual(['https://consola.mwt.one/api/auth/refresh/'])
})

it('writes the preload and removes the token file on sign-out', () => {
  const home = fixture('CONSOLA_TOKEN=old\n')

  const watcher = writeConsoleTokenWatcher(home)
  expect(watcher.endsWith(CONSOLE_TOKEN_WATCHER_FILENAME)).toBe(true)
  expect(readFileSync(watcher, 'utf8')).toContain('CONSOLA_TOKEN_FILE')
  expect(readFileSync(watcher, 'utf8')).toContain('setInterval')

  writeFileSync(join(home, CONSOLE_TOKEN_FILENAME), 'token\n')
  removeConsoleTokenFile(home)
  expect(existsSync(join(home, CONSOLE_TOKEN_FILENAME))).toBe(false)
})

it('renews once and stops on demand', async () => {
  const home = fixture('CONSOLA_TOKEN=stored\n')
  const stop = startConsoleTokenRefresh(home, 60_000)
  stop()
  expect(readFileSync(join(home, CONSOLE_TOKEN_FILENAME), 'utf8').trim()).toBe('stored')
})
