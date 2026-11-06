/**
 * Identity of one local home, independent of any remote account.
 *
 * A local launch creates a Workspace, Spaces, and subspaces without a console
 * sign-in, so the home needs a stable owner id of its own. This file is written
 * once per installation and survives restarts. It is deliberately separate from
 * `desktop-identity.json`: writing that remote identity patches the composition
 * and activates the mirror, which a local-only installation must not do.
 *
 * @module @deepseek-ai/dsh-desktop/src/local-identity
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { renderIdentityPatch, type DesktopCatalogs } from './identity.ts'

/** File that carries the local identity of one home. */
export const LOCAL_IDENTITY_FILENAME = 'local-identity.json'

/** Patch the local home boots with; never the signed-in identity patch. */
export const LOCAL_IDENTITY_PATCH_FILENAME = 'desktop-local.patch.yml'

/** Environment names that belong to a signed-in deployment, never to a local home. */
const REMOTE_PRODUCT_ENV: readonly string[] = [
  'CONSOLA_API_BASE',
  'CONSOLA_TOKEN',
  'CONSOLA_REFRESH',
  'FABERLOOM_GATEWAY_URL',
  'FABERLOOM_LLM_PROXY_URL',
  'FABERLOOM_MCP_URL',
  'FABERLOOM_GATEWAY_KEY',
  'FABERLOOM_MIRROR_ENABLED',
  'FABERLOOM_MIRROR_OWNER',
  'FABERLOOM_MIRROR_URL',
  'FABERLOOM_MIRROR_KEY',
]

/**
 * Drop every deployment credential or endpoint from the environment a local
 * patch is rendered from. A home that once signed in keeps them in `.env`; the
 * local composition must not mount MWT, the deployment FaberLoom server, the
 * mirror, or the console credential row because they are still present.
 * @param environment - the environment the child would boot with.
 * @returns a copy without the deployment-only names; provider keys and SICOP stay.
 */
export function localProductEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const local: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(environment)) {
    if (key.startsWith('MWT_') || REMOTE_PRODUCT_ENV.includes(key)) continue
    local[key] = value
  }
  return local
}

/** Stable local identity of one installation. */
export interface LocalIdentity {
  /** Identity version, so a later migration can recognize the document. */
  readonly schemaVersion: 1
  /** Opaque id this home owns; never derived from an email or a machine name. */
  readonly id: string
  /** Instant the home first started, ISO 8601 UTC. */
  readonly createdAt: string
}

/**
 * Read the local identity.
 *
 * An absent file is a first launch. A file that exists but cannot be read or
 * parsed is `LOCAL_IDENTITY_UNREADABLE`: minting a new id would orphan every
 * board row owned by the previous one, because authorization compares
 * `ownerId`. The caller surfaces the failure instead of rotating the owner.
 * @param dshHome - absolute Harness home.
 * @returns the identity, or undefined when the home never had one.
 * @throws {Error} `LOCAL_IDENTITY_UNREADABLE` when the document exists but is invalid.
 */
export function readLocalIdentity(dshHome: string): LocalIdentity | undefined {
  const path = join(dshHome, LOCAL_IDENTITY_FILENAME)
  if (!existsSync(path)) return undefined
  let parsed: Partial<LocalIdentity>
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LocalIdentity>
  } catch {
    throw new Error(`faberloom: LOCAL_IDENTITY_UNREADABLE — ${path} exists but cannot be read; restore it instead of replacing the owner`)
  }
  if (parsed.schemaVersion !== 1) {
    throw new Error(`faberloom: LOCAL_IDENTITY_UNREADABLE — ${path} has schemaVersion ${String(parsed.schemaVersion)}, expected 1`)
  }
  if (typeof parsed.id !== 'string' || !/^[0-9a-f-]{36}$/u.test(parsed.id)) {
    throw new Error(`faberloom: LOCAL_IDENTITY_UNREADABLE — ${path} has no valid id`)
  }
  if (typeof parsed.createdAt !== 'string' || !Number.isFinite(Date.parse(parsed.createdAt))) {
    throw new Error(`faberloom: LOCAL_IDENTITY_UNREADABLE — ${path} has no valid createdAt`)
  }
  return { schemaVersion: 1, id: parsed.id, createdAt: parsed.createdAt }
}

/**
 * Return the home's identity, creating it on first use. Repeated calls and
 * restarts return the same id; an unreadable document is replaced atomically
 * rather than blocking the launch.
 * @param dshHome - absolute Harness home.
 * @param at - ISO instant for a new identity; defaults to now.
 * @returns the stable identity.
 */
export function ensureLocalIdentity(dshHome: string, at: string = new Date().toISOString()): LocalIdentity {
  const home = resolve(dshHome)
  const existing = readLocalIdentity(home)
  if (existing !== undefined) return existing
  const identity: LocalIdentity = { schemaVersion: 1, id: randomUUID(), createdAt: at }
  const target = join(home, LOCAL_IDENTITY_FILENAME)
  mkdirSync(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  writeFileSync(temporary, `${JSON.stringify(identity, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, target)
  return identity
}

/**
 * Render and write the patch a local home boots with. It carries the local id as
 * the product owner, omits the console shares row, and never writes `.env` or
 * `desktop-identity.json`, so nothing enables the mirror or a console call.
 * @param dshHome - absolute Harness home.
 * @param identity - local identity of that home.
 * @param environment - environment the Host boots with.
 * @param catalogs - read-only catalogs this installation ships.
 * @returns the patch path.
 */
export function writeLocalIdentityPatch(
  dshHome: string,
  identity: LocalIdentity,
  environment: NodeJS.ProcessEnv,
  catalogs?: DesktopCatalogs,
): string {
  const home = resolve(dshHome)
  const rendered = renderIdentityPatch(
    { email: identity.id, role: 'client_b2b', readOnly: false, consolaBase: '' },
    home,
    localProductEnvironment(environment),
    catalogs,
    { includeShares: false, local: true },
  ).replace(
    /^# Generated by the Desktop sign-in.*$/mu,
    '# Generated by the Desktop local home; deleted when this home signs in.',
  )
  const target = join(home, LOCAL_IDENTITY_PATCH_FILENAME)
  const temporary = `${target}.tmp`
  writeFileSync(temporary, rendered, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, target)
  return target
}
