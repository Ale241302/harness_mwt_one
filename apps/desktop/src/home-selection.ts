/**
 * Which backend this installation launches, and whether its home may hold the
 * local data.
 *
 * The launching environment still decides whether the window is a client of a
 * gateway; this module records that decision on the installation the first time
 * it runs, refuses a conflicting explicit choice, and rejects a home inside a
 * synchronized folder or a network share (D08). A local launch therefore has a
 * stable, inspectable mode before any remote token or MCP credential is touched.
 *
 * @module @deepseek-ai/dsh-desktop/src/home-selection
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Environment name that may confirm or refuse the resolved mode. */
export const DESKTOP_MODE_ENV = 'DSH_DESKTOP_MODE'

/** File that records the mode this installation selected. */
export const DESKTOP_MODE_FILENAME = 'desktop-mode.json'

/** Backend an installation runs. */
export type DesktopHomeMode = 'local' | 'remote'

/** Recorded selection. */
interface StoredMode {
  readonly schemaVersion: 1
  readonly mode: DesktopHomeMode
  readonly selectedAt: string
}

/** What one launch resolved. */
export interface HomeSelection {
  /** Backend the window uses. */
  readonly mode: DesktopHomeMode
  /** Absolute home the installation owns. */
  readonly home: string
  /** Where the mode came from. */
  readonly source: 'environment' | 'stored' | 'first-launch'
}

/**
 * Folders whose contents another process rewrites under the application. A home
 * there can be replaced mid-write, so D08 keeps it out.
 */
const SYNCHRONIZED_SEGMENTS = ['onedrive', 'dropbox', 'google drive', 'googledrive', 'icloud drive', 'box']

/**
 * Refuse a home that a synchronization client or a network share can rewrite.
 * @param home - absolute home path.
 * @param environment - process environment, used for `OneDrive` and friends.
 * @throws {Error} `DSH_DESKTOP_HOME_SYNCED` when the path is synchronized or remote.
 */
export function assertSeparateHome(home: string, environment: NodeJS.ProcessEnv = process.env): void {
  const absolute = resolve(home)
  const normalized = absolute.replace(/\\/gu, '/')
  if (normalized.startsWith('//')) {
    throw new Error(`faberloom: DSH_DESKTOP_HOME_SYNCED — ${absolute} is a network share; choose a local folder`)
  }
  const segments = normalized.toLowerCase().split('/')
  for (const name of SYNCHRONIZED_SEGMENTS) {
    if (segments.includes(name)) {
      throw new Error(`faberloom: DSH_DESKTOP_HOME_SYNCED — ${absolute} lives inside ${name}; choose a local folder`)
    }
  }
  for (const name of ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer', 'Dropbox']) {
    const root = environment[name]
    if (root === undefined || root.trim().length === 0) continue
    const prefix = resolve(root).replace(/\\/gu, '/').toLowerCase().replace(/\/+$/u, '')
    if (prefix.length > 0 && normalized.toLowerCase().startsWith(`${prefix}/`)) {
      throw new Error(`faberloom: DSH_DESKTOP_HOME_SYNCED — ${absolute} lives inside ${name}; choose a local folder`)
    }
  }
}

/**
 * Read the recorded mode, ignoring a corrupt document instead of failing the
 * launch: the environment or the first-launch default replaces it.
 * @param home - absolute home path.
 * @returns the stored mode, or undefined.
 */
export function readStoredMode(home: string): DesktopHomeMode | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(home, DESKTOP_MODE_FILENAME), 'utf8')) as Partial<StoredMode>
    return parsed.mode === 'local' || parsed.mode === 'remote' ? parsed.mode : undefined
  } catch {
    return undefined
  }
}

/**
 * Record the mode this installation runs, replacing a different earlier choice.
 * @param home - absolute home path.
 * @param mode - backend the launch uses.
 * @param at - ISO instant; defaults to now.
 */
export function writeStoredMode(home: string, mode: DesktopHomeMode, at: string = new Date().toISOString()): void {
  const target = join(home, DESKTOP_MODE_FILENAME)
  mkdirSync(dirname(target), { recursive: true })
  const body: StoredMode = { schemaVersion: 1, mode, selectedAt: at }
  const temporary = `${target}.tmp`
  writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, target)
}

/**
 * Resolve the mode for this launch.
 *
 * `effective` is what the launching environment selected (a gateway origin
 * means `remote`, otherwise `local`). `DSH_DESKTOP_MODE` may confirm it but not
 * contradict it, because only the environment can name a gateway origin. The
 * first launch records the resolved value, and every later launch reuses it.
 * @param options - home, environment, and the mode the backend request implies.
 * @returns the mode, home, and where the mode came from.
 * @throws {Error} `DSH_DESKTOP_MODE_CONFLICT` when the explicit name disagrees with the request.
 */
export function resolveHomeSelection(options: {
  readonly home: string
  readonly environment?: NodeJS.ProcessEnv
  readonly effective: DesktopHomeMode
}): HomeSelection {
  const environment = options.environment ?? process.env
  const home = resolve(options.home)
  const named = environment[DESKTOP_MODE_ENV]?.trim().toLowerCase()
  if (named !== undefined && named.length > 0) {
    if (named !== 'local' && named !== 'remote') {
      throw new Error(`faberloom: DSH_DESKTOP_MODE_INVALID — ${DESKTOP_MODE_ENV} must be local or remote, got ${JSON.stringify(named)}`)
    }
    if (named !== options.effective) {
      throw new Error(
        `faberloom: DSH_DESKTOP_MODE_CONFLICT — ${DESKTOP_MODE_ENV}=${named} contradicts the launched backend (${options.effective})`,
      )
    }
    assertSeparateHome(home, environment)
    writeStoredMode(home, named)
    return { mode: named, home, source: 'environment' }
  }
  const stored = readStoredMode(home)
  if (stored !== undefined) {
    assertSeparateHome(home, environment)
    // The launching environment owns the backend choice; record a change so the
    // file always names the mode this installation actually ran.
    if (stored !== options.effective) writeStoredMode(home, options.effective)
    return { mode: options.effective, home, source: 'stored' }
  }
  assertSeparateHome(home, environment)
  writeStoredMode(home, options.effective)
  return { mode: options.effective, home, source: 'first-launch' }
}
