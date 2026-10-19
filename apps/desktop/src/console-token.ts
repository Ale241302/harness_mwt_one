/**
 * Keep the desktop's console access token current.
 *
 * A desktop installation signs into the console once and then runs for days,
 * while the console access token lives thirty minutes. The mirror, the shared
 * Session catalog, and the product shares read `process.env.CONSOLA_TOKEN` on
 * every call, so a boot-time token silently expires and every console call
 * starts answering 401 — the mirror then retries forever and nothing travels
 * between the Web and this computer.
 *
 * This module owns the missing half: it exchanges the stored refresh token for
 * a new access token, rewrites the Harness-home `.env` layer and the token file
 * the host's preload re-reads, and repeats on a timer. The preload itself is
 * written here so the packaged application carries it without a build step.
 * @module apps/desktop/src/console-token
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_ENV_FILENAME, readHomeEnv, setHomeEnvLine } from './home-env.ts'

/** Token file the host preload re-reads every minute. */
export const CONSOLE_TOKEN_FILENAME = '.consola-token'

/** Preload the host boots with, written into the Harness home. */
export const CONSOLE_TOKEN_WATCHER_FILENAME = '.consola-token-watch.mjs'

/** Console route that exchanges a refresh token for an access token. */
export const CONSOLE_REFRESH_PATH = '/auth/refresh/'

/** How often a running application renews its access token. */
export const DEFAULT_CONSOLE_REFRESH_INTERVAL_MS = 10 * 60 * 1000

/** Console API base used when the Harness-home layer names none. */
export const DEFAULT_CONSOLE_API_BASE = 'https://consola.mwt.one/api'

/**
 * The preload source. It runs inside the child host through `NODE_OPTIONS` and
 * copies the token file into the environment the product services read, so a
 * token renewed by the shell reaches a host that booted with the previous one.
 */
const WATCHER_SOURCE = `/**
 * Desktop console-token preload: keep process.env.CONSOLA_TOKEN current.
 *
 * The shell renews the token in CONSOLA_TOKEN_FILE; the product services read
 * the environment on every console call. This preload copies the file into the
 * environment at boot and every minute, so a host that outlives the token it
 * booted with keeps working. Best effort: an unreadable file leaves the
 * boot-time token in place.
 */
import { readFileSync } from 'node:fs'

const file = process.env.CONSOLA_TOKEN_FILE
if (file !== undefined && file.length > 0) {
  const sync = () => {
    try {
      const token = readFileSync(file, 'utf8').trim()
      if (token.length > 0 && token !== process.env.CONSOLA_TOKEN) process.env.CONSOLA_TOKEN = token
    } catch {
      // The shell has not written the file yet; the boot-time token stays.
    }
  }
  sync()
  setInterval(sync, 60_000).unref()
}
`

/** One renewal attempt's outcome. */
export interface ConsoleRefreshResult {
  /** Whether a new access token was written. */
  readonly refreshed: boolean
  /** The new access token, when one was written. */
  readonly token?: string
}

/** Options a caller may inject in a test. */
export interface ConsoleRefreshOptions {
  /** Transport used for the console call. */
  readonly fetch?: typeof fetch
  /** Longest the console may take to answer, in milliseconds. */
  readonly timeoutMs?: number
}

/**
 * Write the token file the host preload reads.
 * @param dshHome - the resolved Harness home.
 * @param token - the access token to publish.
 * @returns the token file's path.
 */
export function writeConsoleTokenFile(dshHome: string, token: string): string {
  mkdirSync(dshHome, { recursive: true })
  const file = join(dshHome, CONSOLE_TOKEN_FILENAME)
  writeFileSync(file, `${token}\n`)
  return file
}

/**
 * Write the preload the host boots with.
 * @param dshHome - the resolved Harness home.
 * @returns the preload's path.
 */
export function writeConsoleTokenWatcher(dshHome: string): string {
  mkdirSync(dshHome, { recursive: true })
  const file = join(dshHome, CONSOLE_TOKEN_WATCHER_FILENAME)
  writeFileSync(file, WATCHER_SOURCE)
  return file
}

/**
 * Rewrite the two console credential lines in the Harness-home `.env` layer,
 * leaving every other line — including comments and formatting — untouched.
 * @param dshHome - the resolved Harness home.
 * @param access - the new access token.
 * @param refresh - the refresh token to keep, which the console may rotate.
 */
function writeConsoleTokenPair(dshHome: string, access: string, refresh: string): void {
  const path = join(dshHome, HOME_ENV_FILENAME)
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const content = setHomeEnvLine(setHomeEnvLine(existing, 'CONSOLA_TOKEN', access), 'CONSOLA_REFRESH', refresh)
  writeFileSync(path, content)
}

/**
 * Exchange the stored refresh token for a new access token and publish it to
 * the `.env` layer and the token file. A missing refresh token, an unreachable
 * console, or a refusal leaves both files as they were: the caller keeps the
 * token it already had and tries again on the next tick.
 * @param dshHome - the resolved Harness home.
 * @param options - injected transport and timeout.
 * @returns whether a new token was written, and the token when it was.
 */
export async function refreshConsoleToken(
  dshHome: string,
  options: ConsoleRefreshOptions = {},
): Promise<ConsoleRefreshResult> {
  const values = readHomeEnv(dshHome)
  const base = (values.CONSOLA_API_BASE ?? DEFAULT_CONSOLE_API_BASE).replace(/\/+$/u, '')
  const refresh = values.CONSOLA_REFRESH
  if (refresh === undefined || refresh.length === 0) {
    // No refresh token: still publish the access token this home already holds,
    // so a host booted after a sign-in reads it from one place.
    const token = values.CONSOLA_TOKEN
    if (token === undefined || token.length === 0) return { refreshed: false }
    writeConsoleTokenFile(dshHome, token)
    return { refreshed: false }
  }
  const call = options.fetch ?? fetch
  let response: Response
  try {
    response = await call(`${base}${CONSOLE_REFRESH_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ refresh }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    })
  } catch {
    return { refreshed: false }
  }
  if (!response.ok) return { refreshed: false }
  let body: { access?: unknown; refresh?: unknown }
  try {
    body = await response.json() as { access?: unknown; refresh?: unknown }
  } catch {
    return { refreshed: false }
  }
  if (typeof body.access !== 'string' || body.access.length === 0) return { refreshed: false }
  const rotated = typeof body.refresh === 'string' && body.refresh.length > 0 ? body.refresh : refresh
  writeConsoleTokenPair(dshHome, body.access, rotated)
  writeConsoleTokenFile(dshHome, body.access)
  return { refreshed: true, token: body.access }
}

/**
 * Renew once immediately and then on an interval for as long as the caller keeps
 * the returned stop function. The timer does not hold the process open.
 * @param dshHome - the resolved Harness home.
 * @param intervalMs - how often to renew.
 * @returns the stop function.
 */
export function startConsoleTokenRefresh(
  dshHome: string,
  intervalMs = DEFAULT_CONSOLE_REFRESH_INTERVAL_MS,
): () => void {
  const run = (): void => { void refreshConsoleToken(dshHome).catch(() => ({ refreshed: false })) }
  run()
  const timer = setInterval(run, intervalMs)
  timer.unref()
  return () => { clearInterval(timer) }
}

/**
 * Drop the token file on sign-out, so a signed-out home exports no credential.
 * @param dshHome - the resolved Harness home.
 */
export function removeConsoleTokenFile(dshHome: string): void {
  rmSync(join(dshHome, CONSOLE_TOKEN_FILENAME), { force: true })
}
