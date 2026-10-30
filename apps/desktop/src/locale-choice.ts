/**
 * Desktop language preference: the shell locale the user picked on the sign-in
 * screen.
 *
 * The choice is one non-secret JSON record in the shared Harness home, so the
 * sign-in and recovery screens keep the language the operator chose across
 * restarts. An absent, unreadable, or malformed record yields `undefined`, and
 * the caller follows the operating system's language instead. This governs the
 * Electron shell's own screens only; the signed-in application reads its
 * language from the Host user-settings document.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDesktopLocaleId, type DesktopLocaleId } from './locale.ts'

/** Persisted language file inside the Harness home. */
export const LOCALE_CHOICE_FILENAME = 'desktop-locale.json'

/** Language record written to disk. */
interface LocaleChoiceRecord {
  readonly locale: DesktopLocaleId
}

/**
 * Read the stored language preference.
 * @param dshHome - resolved Harness home holding the preference file.
 * @returns the stored locale id, or undefined when absent or unreadable.
 */
export function readLocaleChoice(dshHome: string): DesktopLocaleId | undefined {
  const file = join(dshHome, LOCALE_CHOICE_FILENAME)
  if (!existsSync(file)) return undefined
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof value !== 'object' || value === null) return undefined
    const locale = (value as Record<string, unknown>).locale
    return isDesktopLocaleId(locale) ? locale : undefined
  } catch {
    // A damaged record is treated as no preference, so the OS language stands.
    return undefined
  }
}

/**
 * Persist the language preference atomically: a temporary sibling is written
 * and then renamed over the record, so a crash mid-write never leaves a partial
 * preference file for the next launch to read.
 * @param dshHome - resolved Harness home receiving the preference file.
 * @param value - the locale id to remember.
 */
export function writeLocaleChoice(dshHome: string, value: DesktopLocaleId): void {
  mkdirSync(dshHome, { recursive: true })
  const file = join(dshHome, LOCALE_CHOICE_FILENAME)
  const temporary = `${file}.${process.pid}.tmp`
  const record: LocaleChoiceRecord = { locale: value }
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`)
  try {
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
