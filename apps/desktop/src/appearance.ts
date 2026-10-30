/**
 * Desktop appearance preference: the light or dark rendering the user chose.
 *
 * The preference is one non-secret JSON record in the shared Harness home, so it
 * survives every restart and stays independent of the OS setting. An absent,
 * unreadable, or malformed record yields `undefined`, and the caller follows the
 * OS appearance instead.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Persisted appearance file inside the Harness home. */
export const APPEARANCE_FILENAME = 'desktop-appearance.json'

/** The two appearances the Desktop renders. */
export type DesktopAppearance = 'light' | 'dark'

/** Appearance record written to disk. */
interface AppearanceRecord {
  readonly appearance: DesktopAppearance
}

/**
 * Read the stored appearance preference.
 * @param dshHome - resolved Harness home holding the preference file.
 * @returns the stored appearance, or undefined when absent or unreadable.
 */
export function readAppearance(dshHome: string): DesktopAppearance | undefined {
  const file = join(dshHome, APPEARANCE_FILENAME)
  if (!existsSync(file)) return undefined
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof value !== 'object' || value === null) return undefined
    const appearance = (value as Record<string, unknown>).appearance
    return appearance === 'light' || appearance === 'dark' ? appearance : undefined
  } catch {
    // A damaged record is treated as no preference, so the OS appearance stands.
    return undefined
  }
}

/**
 * Persist the appearance preference atomically: a temporary sibling is written
 * and then renamed over the record, so a crash mid-write never leaves a partial
 * preference file for the next launch to read.
 * @param dshHome - resolved Harness home receiving the preference file.
 * @param value - the appearance to remember.
 */
export function writeAppearance(dshHome: string, value: DesktopAppearance): void {
  mkdirSync(dshHome, { recursive: true })
  const file = join(dshHome, APPEARANCE_FILENAME)
  const temporary = `${file}.${process.pid}.tmp`
  const record: AppearanceRecord = { appearance: value }
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`)
  try {
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
