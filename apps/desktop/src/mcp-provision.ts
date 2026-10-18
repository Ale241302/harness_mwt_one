/**
 * Self-provisioning of the MCP credential for this installation.
 *
 * The console issues one DeviceToken per company a user can reach, bound to the
 * device that asks for it. The desktop asks right after sign-in, with the
 * session it just obtained, so any operator — a company admin or a B2B client —
 * gets their own credential without pasting anything, and this machine keeps
 * its own grant when the same account signs in on another computer.
 *
 * The tokens live in the Harness-home `.env`, the layer that already holds the
 * console credentials; the identity patch references the variable names only.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_ENV_FILENAME } from './home-env.ts'
import {
  MWT_MCP_COMPANIES_ENV,
  MWT_MCP_DEVICE_ID_ENV,
  MWT_MCP_URL_ENV,
  companyTokenEnv,
} from './product-mcp.ts'

/** One credential as the console returns it. */
interface ProvisionedCredential {
  readonly key: string
  readonly token: string
  readonly mcpUrl: string
}

/** Env variable holding the single-credential form this file replaces. */
const LEGACY_AUTHORIZATION_ENV = 'MWT_MCP_AUTHORIZATION'

/** Set one `KEY=value` line, dropping every previous line for that key. */
function setEnvLine(text: string, key: string, value: string): string {
  const prefix = `${key}=`
  const kept = text.split('\n').filter(line => line !== '' && !line.startsWith(prefix))
  kept.push(`${prefix}${value}`)
  return `${kept.join('\n')}\n`
}

/** Read one variable from the environment layer text. */
function envValue(text: string, key: string): string | undefined {
  const prefix = `${key}=`
  const line = text.split('\n').find(candidate => candidate.startsWith(prefix))
  return line === undefined ? undefined : line.slice(prefix.length).trim()
}

/** Keep only the fields this module can act on. */
function parseCredentials(payload: unknown): ProvisionedCredential[] {
  if (typeof payload !== 'object' || payload === null) return []
  const rows = (payload as { credentials?: unknown }).credentials
  if (!Array.isArray(rows)) return []
  const parsed: ProvisionedCredential[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const { key, token, mcp_url: url } = row as Record<string, unknown>
    if (typeof key !== 'string' || !/^[a-z0-9-]{1,24}$/u.test(key)) continue
    if (typeof token !== 'string' || token === '') continue
    if (typeof url !== 'string' || !/^https?:\/\//u.test(url)) continue
    parsed.push({ key, token, mcpUrl: url })
  }
  return parsed
}

/**
 * Ask the console for this device's credentials, unless the environment layer
 * already carries them for the same device.
 * @param dshHome - the resolved Harness home.
 * @param consolaBase - console API base, e.g. `https://consola.mwt.one/api`.
 * @param consoleToken - the session token the sign-in just obtained.
 * @param deviceId - the stable id this installation presents.
 * @param request - fetch implementation; tests inject one.
 * @returns whether the environment layer was rewritten.
 */
export async function provisionMcpCredentials(
  dshHome: string,
  consolaBase: string,
  consoleToken: string,
  deviceId: string,
  request: typeof fetch = fetch,
): Promise<boolean> {
  const envPath = join(dshHome, HOME_ENV_FILENAME)
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8').replaceAll('\r\n', '\n') : ''
  if (envValue(current, MWT_MCP_DEVICE_ID_ENV) === deviceId
    && envValue(current, MWT_MCP_COMPANIES_ENV) !== undefined) return false
  if (consoleToken === '') return false

  let credentials: ProvisionedCredential[]
  try {
    const response = await request(`${consolaBase.replace(/\/+$/u, '')}/onboarding/device-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${consoleToken}` },
      body: JSON.stringify({ device_id: deviceId }),
    })
    if (!response.ok) return false
    credentials = parseCredentials(await response.json())
  } catch {
    return false
  }
  if (credentials.length === 0) return false
  const first = credentials[0]
  if (first === undefined) return false

  let text = current
  for (const credential of credentials) {
    text = setEnvLine(text, companyTokenEnv(credential.key), `DeviceToken ${credential.token}`)
  }
  text = setEnvLine(text, MWT_MCP_COMPANIES_ENV, credentials.map(credential => credential.key).join(','))
  text = setEnvLine(text, MWT_MCP_DEVICE_ID_ENV, deviceId)
  text = setEnvLine(text, MWT_MCP_URL_ENV, first.mcpUrl)
  // A single-credential value would win over the company list on older builds.
  text = text.split('\n').filter(line => !line.startsWith(`${LEGACY_AUTHORIZATION_ENV}=`)).join('\n')
  writeFileSync(envPath, text.endsWith('\n') ? text : text + '\n')
  return true
}
