/**
 * Desktop backend choice: which backend an installation launches, and the
 * gateway origin when it is a client of one.
 *
 * The choice is one non-secret JSON record in the shared Harness home, so an
 * installed application keeps the backend the operator picked across restarts
 * instead of depending on the environment of the process that launched it. An
 * absent, unreadable, or malformed record yields `undefined`, and the caller
 * falls back to the shipped default.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_GATEWAY_URL, resolveGatewayRequest } from './gateway.ts'

/** Persisted backend-choice file inside the Harness home. */
export const BACKEND_CHOICE_FILENAME = 'desktop-backend.json'

/** The two backends an installation launches. */
export type DesktopBackendMode = 'local' | 'gateway'

/** Backend choice persisted in the Harness home. */
export interface DesktopBackendChoice {
  readonly mode: DesktopBackendMode
}

/** Backend the Desktop launches, with the gateway origin already resolved. */
export type DesktopBackend =
  | { readonly mode: 'local' }
  | { readonly mode: 'gateway'; readonly url: string }

/** The two backends an installation launches, in switcher order. */
export const DESKTOP_BACKEND_MODES: readonly DesktopBackendMode[] = ['local', 'gateway']

/**
 * Whether a value names one of the shipped backends.
 * @param value - candidate backend mode from the renderer or the stored record.
 * @returns whether the value is a shipped backend mode.
 */
export function isDesktopBackendMode(value: unknown): value is DesktopBackendMode {
  return DESKTOP_BACKEND_MODES.some(mode => mode === value)
}

/**
 * Read the stored backend choice.
 * @param dshHome - resolved Harness home holding the choice file.
 * @returns the stored choice, or undefined when absent or unreadable.
 */
export function readBackendChoice(dshHome: string): DesktopBackendChoice | undefined {
  const file = join(dshHome, BACKEND_CHOICE_FILENAME)
  if (!existsSync(file)) return undefined
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof value !== 'object' || value === null) return undefined
    const mode = (value as Record<string, unknown>).mode
    return isDesktopBackendMode(mode) ? { mode } : undefined
  } catch {
    // A damaged record is treated as no choice, so the shipped default stands.
    return undefined
  }
}

/**
 * Persist the backend choice atomically: a temporary sibling is written and then
 * renamed over the record, so a crash mid-write never leaves a partial choice for
 * the next launch to read.
 * @param dshHome - resolved Harness home receiving the choice file.
 * @param choice - the backend to remember.
 */
export function writeBackendChoice(dshHome: string, choice: DesktopBackendChoice): void {
  mkdirSync(dshHome, { recursive: true })
  const file = join(dshHome, BACKEND_CHOICE_FILENAME)
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(choice, null, 2)}\n`)
  try {
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

/**
 * Resolve the backend an installation launches. The launching environment wins
 * over the stored choice, because a deployment or a development run configured
 * it deliberately; the gateway request then names either the local harness or
 * the gateway origin. With neither, the stored choice decides, and the shipped
 * default is the local harness, which is the installation that reads the files
 * of the computer it runs on.
 * @param dshHome - resolved Harness home holding the stored choice.
 * @param environment - the launching process environment.
 * @returns the backend to launch, with any gateway origin resolved.
 */
export function resolveBackend(dshHome: string, environment: NodeJS.ProcessEnv): DesktopBackend {
  const request = resolveGatewayRequest(environment)
  if (request.kind === 'override') return { mode: 'gateway', url: request.url }
  if (request.kind === 'local') return { mode: 'local' }
  const choice = readBackendChoice(dshHome)
  return choice?.mode === 'gateway' ? { mode: 'gateway', url: DEFAULT_GATEWAY_URL } : { mode: 'local' }
}
