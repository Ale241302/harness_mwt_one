/**
 * Desktop first-run environment defaults.
 *
 * The mechanism lives here; the values do not. A deployment supplies a
 * name-to-value JSON document at packaging time (`DSH_DESKTOP_HOME_ENV` inline
 * or `DSH_DESKTOP_HOME_ENV_FILE`), the packaged application bundles it as
 * `desktop-home-env.json`, and the first launch appends only the names the
 * shared Harness-home `.env` layer does not already assign. No credential is
 * ever committed to this repository.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Basename of the read-only user environment layer the Harness boots from. */
export const HOME_ENV_FILENAME = '.env'

/** Basename of the packaging-time defaults document inside the app resources. */
export const HOME_ENV_DEFAULTS_FILENAME = 'desktop-home-env.json'

/** Inline defaults document supplied through the launching environment. */
export const HOME_ENV_DEFAULTS_INLINE = 'DSH_DESKTOP_HOME_ENV'

/** Path to a defaults document supplied through the launching environment. */
export const HOME_ENV_DEFAULTS_FILE = 'DSH_DESKTOP_HOME_ENV_FILE'

/**
 * Name prefixes the Harness `.env` layer refuses because they decide how the
 * process starts, where its code loads from, or how it reaches the network.
 * A defaults document must not carry them, or the next boot fails loud.
 */
const FORBIDDEN_PREFIXES = ['DSH_', 'XDG_', 'DYLD_', 'BASH_FUNC_'] as const

/**
 * Parse one deployment's default environment document.
 * @param source - diagnostic name of where the document came from.
 * @param text - the JSON document.
 * @returns validated name-to-value defaults in document order.
 * @throws when the document is not a JSON object of non-empty strings, or names
 * a variable the Harness `.env` layer forbids.
 */
export function parseHomeEnvDefaults(source: string, text: string): Record<string, string> {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (error) {
    throw new Error(`dsh desktop: ${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new Error(`dsh desktop: ${source} must be a JSON object of environment names to values`)
  }
  const defaults: Record<string, string> = {}
  for (const [name, value] of Object.entries(document)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      throw new Error(`dsh desktop: ${source} has invalid environment name ${JSON.stringify(name)}`)
    }
    if (FORBIDDEN_PREFIXES.some(prefix => name.toUpperCase().startsWith(prefix))) {
      throw new Error(`dsh desktop: ${source} sets ${name}, which the Harness .env layer refuses`)
    }
    if (typeof value !== 'string' || value === '') {
      throw new Error(`dsh desktop: ${source} value for ${name} must be a non-empty string`)
    }
    defaults[name] = value
  }
  return defaults
}

/**
 * Resolve the deployment defaults from the packing environment: the inline
 * document wins, then an explicit file, then the bundled resource the packaged
 * application ships. An absent source yields no defaults.
 * @param environment - the launching process environment.
 * @param resourcesPath - Electron's resource directory in the packaged app.
 * @returns validated defaults, or an empty record when none is configured.
 */
export function resolveHomeEnvDefaults(
  environment: NodeJS.ProcessEnv,
  resourcesPath: string,
): Record<string, string> {
  const inline = environment[HOME_ENV_DEFAULTS_INLINE]
  if (inline !== undefined && inline !== '') return parseHomeEnvDefaults(HOME_ENV_DEFAULTS_INLINE, inline)
  const file = environment[HOME_ENV_DEFAULTS_FILE] ?? join(resourcesPath, HOME_ENV_DEFAULTS_FILENAME)
  return existsSync(file) ? parseHomeEnvDefaults(file, readFileSync(file, 'utf8')) : {}
}

/** Every name a dotenv document assigns, ignoring comments and blank lines. */
function definedNames(content: string): Set<string> {
  const names = new Set<string>()
  for (const line of content.split(/\r?\n/u)) {
    const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line)?.[1]
    if (name !== undefined) names.add(name)
  }
  return names
}

/**
 * Read the names and values the Harness-home `.env` layer assigns. The layer
 * ranks below the managed credential store and the inherited environment, so a
 * caller that needs the environment a child boots with reads this first and lets
 * the launching process override it.
 * @param dshHome - the resolved Harness home holding the `.env` layer.
 * @returns every assignment in the file, with later lines winning.
 */
export function readHomeEnv(dshHome: string): Record<string, string> {
  const path = join(dshHome, HOME_ENV_FILENAME)
  if (!existsSync(path)) return {}
  const values: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line)
    if (match === null || match[1] === undefined || match[2] === undefined) continue
    const quoted = /^(['"])(.*)\1$/u.exec(match[2].trim())
    values[match[1]] = quoted?.[2] ?? match[2].trim()
  }
  return values
}

/**
 * Ensure `$DSH_HOME/.env` assigns each default name, appending only the missing
 * ones so a value an operator or the Models page already wrote is never
 * replaced. Existing comments and formatting survive untouched. The credential
 * seam ranks this layer below the managed `$DSH_HOME/.credentials.yaml` store
 * and the inherited environment, so both still win.
 * @param dshHome - the resolved Harness home whose `.env` layer to complete.
 * @param defaults - name/value pairs to materialize when absent.
 * @returns the names appended this run, in declaration order.
 */
export function ensureHomeEnvFile(dshHome: string, defaults: Readonly<Record<string, string>>): string[] {
  const path = join(dshHome, HOME_ENV_FILENAME)
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const defined = definedNames(existing)
  const missing = Object.entries(defaults).filter(([name]) => !defined.has(name))
  if (missing.length === 0) return []
  mkdirSync(dshHome, { recursive: true })
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
  const appended = missing.map(([name, value]) => `${name}=${value}`).join('\n')
  writeFileSync(path, `${existing}${separator}${appended}\n`)
  return missing.map(([name]) => name)
}
