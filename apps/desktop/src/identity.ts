/**
 * Desktop sign-in: authenticate against the MWT.ONE console and materialize the
 * per-user identity the FaberLoom modules need.
 *
 * A successful sign-in writes two things into the shared Harness home: the
 * credential env layer (`$DSH_HOME/.env`) and a Cordis patch
 * (`desktop-identity.patch.yml`) that configures every product row with the
 * signed-in `ownerId` and role. Without the patch the `faberloom-defaults`
 * seeder runs with no owner and seeds nothing, which is why a signed-out
 * Desktop shows empty Agents and Skills.
 *
 * Only non-secret identity is persisted as JSON; the console token lives in the
 * `.env` credential layer.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeConsoleTokenFile, writeConsoleTokenFile } from './console-token.ts'
import { HOME_ENV_FILENAME, setHomeEnvLine } from './home-env.ts'
import { renderProductMcpEntries } from './product-mcp.ts'

/** Persisted non-secret identity file. */
export const IDENTITY_FILENAME = 'desktop-identity.json'

/** Cordis patch layer configuring product rows with the signed-in identity. */
export const IDENTITY_PATCH_FILENAME = 'desktop-identity.patch.yml'

/** Console base used when the deployment does not override it. */
export const DEFAULT_CONSOLA_API_BASE = 'https://consola.mwt.one/api'

/** Non-secret identity established by a successful sign-in. */
export interface DesktopIdentity {
  readonly email: string
  readonly role: string
  readonly readOnly: boolean
  readonly consolaBase: string
  readonly fullName?: string
}

/** Secret material a successful sign-in produced; written to the env layer only. */
export interface DesktopCredentials {
  readonly token: string
  readonly refresh?: string
}

/** One console account as returned by `POST /auth/login/`. */
interface ConsoleUser {
  readonly id?: unknown
  readonly email?: unknown
  readonly full_name?: unknown
  readonly role?: unknown
  readonly permissions?: unknown
}

const MUTATING_ACTION = /\.(create|edit|update|delete|manage|write|activate|close|send|approve)/u

/** Mirror the console sign-in's read-only derivation. */
function deriveReadOnly(user: ConsoleUser): boolean {
  const permissions = typeof user.permissions === 'object' && user.permissions !== null
    ? user.permissions as { readonly read_only?: unknown; readonly actions?: unknown }
    : undefined
  if (permissions?.read_only === true) return true
  const actions = permissions?.actions
  if (Array.isArray(actions) && actions.length > 0) {
    return !actions.some(action => typeof action === 'string' && MUTATING_ACTION.test(action))
  }
  return user.role === 'viewer' || user.role === 'client_b2b'
}

/** Read the persisted identity, or undefined when the Desktop is signed out. */
export function readIdentity(dshHome: string): DesktopIdentity | undefined {
  const file = join(dshHome, IDENTITY_FILENAME)
  if (!existsSync(file)) return undefined
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof value !== 'object' || value === null) return undefined
    const record = value as Record<string, unknown>
    if (typeof record.email !== 'string' || record.email.length === 0) return undefined
    return {
      email: record.email,
      role: typeof record.role === 'string' ? record.role : '',
      readOnly: record.readOnly === true,
      consolaBase: typeof record.consolaBase === 'string' && record.consolaBase.length > 0
        ? record.consolaBase
        : DEFAULT_CONSOLA_API_BASE,
      ...(typeof record.fullName === 'string' && record.fullName.length > 0 ? { fullName: record.fullName } : {}),
    }
  } catch {
    return undefined
  }
}

/**
 * Authenticate one account against the MWT.ONE console.
 * @param consolaBase - console API base URL (without a trailing slash).
 * @param usuario - account user name or email.
 * @param password - account password.
 * @returns the established identity and its credentials.
 * @throws when the console is unreachable, refuses the credentials, or answers with no account.
 */
export async function signInToConsole(
  consolaBase: string,
  usuario: string,
  password: string,
): Promise<{ identity: DesktopIdentity; credentials: DesktopCredentials }> {
  const base = consolaBase.replace(/\/+$/, '')
  let response: Response
  try {
    response = await fetch(`${base}/auth/login/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ usuario, password }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    throw new Error(`No se pudo contactar la consola (${base}): ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new Error('Usuario o contraseña incorrectos.')
  const data = await response.json() as { user?: ConsoleUser; access?: unknown; refresh?: unknown }
  const user = data.user
  if (user === undefined || typeof user.email !== 'string' || user.email.trim().length === 0) {
    throw new Error('La consola no devolvió una cuenta válida.')
  }
  const identity: DesktopIdentity = {
    email: user.email.trim(),
    role: typeof user.role === 'string' ? user.role : '',
    readOnly: deriveReadOnly(user),
    consolaBase: base,
    ...(typeof user.full_name === 'string' && user.full_name.length > 0 ? { fullName: user.full_name } : {}),
  }
  return {
    identity,
    credentials: {
      token: typeof data.access === 'string' ? data.access : '',
      ...(typeof data.refresh === 'string' && data.refresh.length > 0 ? { refresh: data.refresh } : {}),
    },
  }
}

/**
 * Ask the console to email a password-reset link. The console answers the same
 * way whether or not the account exists, so a rejection is a transport or
 * service failure rather than a missing account.
 * @param consolaBase - console API base the installation signs in against.
 * @param email - the address the operator typed.
 * @throws when the console is unreachable or refuses the request.
 */
export async function requestPasswordReset(consolaBase: string, email: string): Promise<void> {
  const base = consolaBase.replace(/\/+$/, '')
  let response: Response
  try {
    response = await fetch(`${base}/users/forgot-password/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw new Error(`No se pudo contactar la consola (${base}): ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new Error(`La consola rechazó la solicitud de restablecimiento (HTTP ${response.status})`)
}

/** Render one YAML double-quoted scalar. */
function yamlScalar(value: string): string {
  return JSON.stringify(value)
}

/**
 * Read-only product catalogs an installation mounts. The deployment mounts its
 * own copies into every `dsh`; a packaged installation mounts the copies it
 * ships, so both surfaces offer the same catalog.
 */
export interface DesktopCatalogs {
  /** Directory holding one skill catalog per role. */
  readonly skillsCatalogRoot: string
  /** Curated shared skill catalog. */
  readonly skillsSharedRoot: string
  /** Deployment-shipped agent presets. */
  readonly agentsSharedRoot: string
}

/**
 * Render the product-row patch that carries the signed-in identity, plus the
 * product MCP servers a local installation can reach.
 * @param identity - the signed-in identity.
 * @param dshHome - the resolved Harness home owning the skills and socket paths.
 * @param environment - the environment the child boots with; decides which MCP servers mount.
 * @param catalogs - the read-only catalogs this installation ships, when it ships any.
 * @returns the Cordis patch document.
 */
export function renderIdentityPatch(
  identity: DesktopIdentity,
  dshHome: string,
  environment: NodeJS.ProcessEnv,
  catalogs?: DesktopCatalogs,
): string {
  const owner = yamlScalar(identity.email)
  const roleName = (identity.role.length > 0 ? identity.role : 'client_b2b').toLowerCase()
  const role = yamlScalar(roleName)
  const readOnly = identity.readOnly ? 'true' : 'false'
  const socket = yamlScalar(join(dshHome, 'faberloom-mcp.sock'))
  const mounted = catalogs ?? {
    skillsCatalogRoot: join(dshHome, 'skills'),
    skillsSharedRoot: join(dshHome, 'skills-shared'),
    agentsSharedRoot: join(dshHome, 'agents-shared'),
  }
  const skillsRoot = yamlScalar(mounted.skillsCatalogRoot)
  const sharedSkills = yamlScalar(mounted.skillsSharedRoot)
  const sharedAgents = yamlScalar(mounted.agentsSharedRoot)
  // The agent-side provider mirrors the deployment's row: only the catalog
  // directories that exist are mounted, and the owner's own skills keep theirs.
  const catalogSkillDirs = [
    ...(existsSync(join(mounted.skillsCatalogRoot, roleName)) ? [join(mounted.skillsCatalogRoot, roleName)] : []),
    ...(existsSync(mounted.skillsSharedRoot) ? [mounted.skillsSharedRoot] : []),
  ]
  const mcpEntries = renderProductMcpEntries(environment, identity.email)
  return [
    '# Generated by the Desktop sign-in; edited by signing out and in again.',
    ...(mcpEntries.length === 0 ? [] : ['- insert:', ...mcpEntries, '']),
    ...(catalogSkillDirs.length === 0 ? [] : [
      '- id: faberloom-skills',
      "  name: '@deepseek-ai/dsh-skill-filesystem'",
      '  config:',
      '    providerName: faberloom-role',
      '    includeDefaultRoots: false',
      '    watch: false',
      '    customSkillDirs:',
      ...catalogSkillDirs.map(dir => `      - ${yamlScalar(dir)}`),
      '',
    ]),
    '- id: tool-faberloom',
    '  config:',
    `    ownerId: ${owner}`,
    `    role: ${role}`,
    `    readOnly: ${readOnly}`,
    '',
    '- id: faberloom-view',
    '  config:',
    `    ownerId: ${owner}`,
    `    role: ${role}`,
    `    readOnly: ${readOnly}`,
    `    skillsCatalogRoot: ${skillsRoot}`,
    `    skillsSharedRoot: ${sharedSkills}`,
    '',
    '- id: faberloom-session-agent',
    '  config:',
    `    ownerId: ${owner}`,
    `    role: ${role}`,
    `    readOnly: ${readOnly}`,
    '',
    '- id: faberloom-defaults',
    '  config:',
    `    ownerId: ${owner}`,
    `    role: ${role}`,
    `    readOnly: ${readOnly}`,
    `    skillsCatalogRoot: ${skillsRoot}`,
    `    skillsSharedRoot: ${sharedSkills}`,
    `    agentsSharedRoot: ${sharedAgents}`,
    `    agentProvider: ${yamlScalar('deepseek-official')}`,
    `    agentModel: ${yamlScalar('deepseek-flash')}`,
    `    agentApiKeyEnv: ${yamlScalar('DEEPSEEK_API_KEY')}`,
    '',
    '- id: faberloom-execution',
    '  config:',
    `    ownerId: ${owner}`,
    '    enabled: true',
    '    intervalMs: 60000',
    '',
    '- id: faberloom-inbound',
    '  config:',
    `    ownerId: ${owner}`,
    '    enabled: true',
    '    intervalMs: 60000',
    `    mailbox: ${yamlScalar('INBOX')}`,
    '',
    '- id: faberloom-shares',
    '  config:',
    "    consoleBase: !!js process.env.CONSOLA_API_BASE ?? ''",
    "    consoleToken: !!js process.env.CONSOLA_TOKEN ?? ''",
    '',
    '- id: faberloom-mcp-server',
    '  config:',
    `    ownerId: ${owner}`,
    '    enabled: true',
    `    socketPath: ${socket}`,
    '    bridge: true',
    "    gatewayUrl: !!js process.env.FABERLOOM_GATEWAY_URL ?? ''",
    "    consoleBase: !!js process.env.CONSOLA_API_BASE ?? ''",
    '',
  ].join('\n') + '\n'
}

/**
 * Persist one signed-in identity: the credential env layer, the identity patch,
 * and the non-secret identity record.
 * @param dshHome - the resolved Harness home.
 * @param identity - the signed-in identity.
 * @param credentials - the console token pair.
 * @param environment - the environment the child boots with; decides which MCP servers mount.
 * @param catalogs - the read-only catalogs this installation ships, when it ships any.
 */
export function writeIdentity(
  dshHome: string,
  identity: DesktopIdentity,
  credentials: DesktopCredentials,
  environment: NodeJS.ProcessEnv,
  catalogs?: DesktopCatalogs,
): void {
  mkdirSync(dshHome, { recursive: true })
  for (const root of ['skills', 'skills-shared', 'agents-shared']) mkdirSync(join(dshHome, root), { recursive: true })
  const envPath = join(dshHome, HOME_ENV_FILENAME)
  let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  env = setHomeEnvLine(env, 'CONSOLA_API_BASE', identity.consolaBase)
  if (credentials.token.length > 0) env = setHomeEnvLine(env, 'CONSOLA_TOKEN', credentials.token)
  // The refresh token is what lets a desktop session outlive the thirty-minute
  // access token without asking the operator to sign in again.
  if (credentials.refresh !== undefined && credentials.refresh.length > 0) {
    env = setHomeEnvLine(env, 'CONSOLA_REFRESH', credentials.refresh)
  }
  writeFileSync(envPath, env)
  if (credentials.token.length > 0) writeConsoleTokenFile(dshHome, credentials.token)
  writeFileSync(
    join(dshHome, IDENTITY_PATCH_FILENAME),
    renderIdentityPatch(identity, dshHome, environment, catalogs),
  )
  writeFileSync(join(dshHome, IDENTITY_FILENAME), `${JSON.stringify(identity, null, 2)}\n`)
}

/**
 * Rewrite the identity patch from the stored identity. An installation that now
 * ships product catalogs mounts them on the next launch instead of waiting for
 * the operator to sign out and in again; without a stored identity there is
 * nothing to rewrite.
 * @param dshHome - the resolved Harness home.
 * @param environment - the environment the child boots with.
 * @param catalogs - the read-only catalogs this installation ships.
 * @returns whether a stored identity had its patch rewritten.
 */
export function refreshIdentityPatch(
  dshHome: string,
  environment: NodeJS.ProcessEnv,
  catalogs: DesktopCatalogs | undefined,
): boolean {
  const identity = readIdentity(dshHome)
  if (identity === undefined) return false
  writeFileSync(
    join(dshHome, IDENTITY_PATCH_FILENAME),
    renderIdentityPatch(identity, dshHome, environment, catalogs),
  )
  return true
}

/**
 * Remove the identity: drop the patch and record, and clear the identity-owned
 * environment names while leaving every other `.env` line intact.
 * @param dshHome - the resolved Harness home.
 * @returns the names removed from the env layer.
 */
export function signOut(dshHome: string): string[] {
  rmSync(join(dshHome, IDENTITY_PATCH_FILENAME), { force: true })
  rmSync(join(dshHome, IDENTITY_FILENAME), { force: true })
  removeConsoleTokenFile(dshHome)
  const envPath = join(dshHome, HOME_ENV_FILENAME)
  if (!existsSync(envPath)) return []
  const names = ['CONSOLA_TOKEN', 'CONSOLA_REFRESH']
  const content = readFileSync(envPath, 'utf8')
  const kept = content.split(/\r?\n/u).filter((line) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line)
    return match === null || match[1] === undefined || !names.includes(match[1])
  })
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop()
  writeFileSync(envPath, kept.length === 0 ? '' : `${kept.join('\n')}\n`)
  return names
}
