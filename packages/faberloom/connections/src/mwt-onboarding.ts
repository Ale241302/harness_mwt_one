/**
 * MWT.ONE desktop onboarding: console sign-in and the device-bound MCP
 * credential. The console issues one DeviceToken per company the account can
 * reach; the harness turns each into an MCP server row, so the password never
 * reaches a model and the grant survives restarts without an IdP redirect.
 * @module @deepseek-ai/dsh-faberloom-connections/src/mwt-onboarding
 */

/** One console session the desktop keeps after sign-in. */
export interface MwtConsoleSession {
  /** Account email the console resolved. */
  readonly email: string
  /** Console role. */
  readonly role: string
  /** Whether the role is read-only. */
  readonly readOnly: boolean
  /** Console bearer token used only against the console API. */
  readonly token: string
  /** Refresh token when the console issued one. */
  readonly refresh: string | null
}

/** One device-bound MCP credential the console issued for a company. */
export interface MwtDeviceCredential {
  /** Company key accepted by the MCP server name grammar. */
  readonly key: string
  /** Opaque DeviceToken. */
  readonly token: string
  /** Absolute MCP endpoint for that company. */
  readonly mcpUrl: string
}

/** One failed console call, without credentials in the message. */
export class MwtOnboardingError extends Error {
  /**
   * @param message - what failed.
   * @param status - console HTTP status, when the call completed.
   */
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'MwtOnboardingError'
  }
}

/** Normalize one console base URL. */
function normalizeBase(consolaBase: string): string {
  const base = consolaBase.trim().replace(/\/+$/u, '')
  if (base.length === 0) throw new MwtOnboardingError('Falta la dirección de la consola MWT.ONE')
  return base
}

/** Keep only credential rows this client can mount. */
function parseCredentials(payload: unknown): MwtDeviceCredential[] {
  if (typeof payload !== 'object' || payload === null) return []
  const rows = (payload as { credentials?: unknown }).credentials
  if (!Array.isArray(rows)) return []
  const credentials: MwtDeviceCredential[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const { key, token, mcp_url: url } = row as Record<string, unknown>
    if (typeof key !== 'string' || !/^[a-z0-9-]{1,24}$/u.test(key)) continue
    if (typeof token !== 'string' || token.length === 0) continue
    if (typeof url !== 'string' || !/^https?:\/\//u.test(url)) continue
    credentials.push({ key, token, mcpUrl: url })
  }
  return credentials
}

/**
 * Sign in to the MWT.ONE console.
 * @param fetchImpl - HTTP implementation.
 * @param consolaBase - console API base, for example `https://consola.mwt.one/api`.
 * @param usuario - user or email the operator typed.
 * @param password - password the operator typed in the host form.
 * @returns the session, including the console token.
 */
export async function signInMwtConsole(
  fetchImpl: typeof fetch,
  consolaBase: string,
  usuario: string,
  password: string,
): Promise<MwtConsoleSession> {
  const base = normalizeBase(consolaBase)
  if (usuario.trim().length === 0) throw new MwtOnboardingError('Falta el usuario de la consola')
  if (password.length === 0) throw new MwtOnboardingError('Falta la contraseña de la consola')
  let response: Response
  try {
    response = await fetchImpl(`${base}/auth/login/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ usuario, password }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    throw new MwtOnboardingError(`No se pudo contactar la consola (${base}): ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new MwtOnboardingError('Usuario o contraseña incorrectos.', response.status)
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null) throw new MwtOnboardingError('La consola no devolvió una sesión válida.')
  const record = body as Record<string, unknown>
  const user = record['user']
  if (typeof user !== 'object' || user === null) throw new MwtOnboardingError('La consola no devolvió una cuenta válida.')
  const identity = user as Record<string, unknown>
  const email = identity['email']
  if (typeof email !== 'string' || email.trim().length === 0) {
    throw new MwtOnboardingError('La consola no devolvió una cuenta válida.')
  }
  const access = record['access']
  if (typeof access !== 'string' || access.length === 0) throw new MwtOnboardingError('La consola no emitió un token de sesión.')
  const refresh = record['refresh']
  return {
    email: email.trim(),
    role: typeof identity['role'] === 'string' ? identity['role'] : '',
    readOnly: identity['read_only'] === true || identity['readOnly'] === true,
    token: access,
    refresh: typeof refresh === 'string' && refresh.length > 0 ? refresh : null,
  }
}

/**
 * Ask the console for the device-bound credentials of every company the account
 * can reach.
 * @param fetchImpl - HTTP implementation.
 * @param consolaBase - console API base.
 * @param consoleToken - token from {@link signInMwtConsole}.
 * @param deviceId - stable id of this installation.
 * @returns one credential per company; empty when the console issued none.
 */
export async function requestMwtDeviceToken(
  fetchImpl: typeof fetch,
  consolaBase: string,
  consoleToken: string,
  deviceId: string,
): Promise<MwtDeviceCredential[]> {
  const base = normalizeBase(consolaBase)
  if (consoleToken.length === 0) throw new MwtOnboardingError('Falta el token de la consola')
  if (deviceId.trim().length === 0) throw new MwtOnboardingError('Falta el identificador del equipo')
  let response: Response
  try {
    response = await fetchImpl(`${base}/onboarding/device-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${consoleToken}` },
      body: JSON.stringify({ device_id: deviceId }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    throw new MwtOnboardingError(`No se pudo pedir la credencial del equipo: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    throw new MwtOnboardingError(`La consola rechazó la credencial del equipo (HTTP ${String(response.status)})`, response.status)
  }
  return parseCredentials(await response.json())
}

/**
 * Name one MCP server row for a company key.
 * @param key - console company key.
 * @returns the server name the MCP client namespaces tools under.
 */
export function mwtServerName(key: string): string {
  return `mwt-${key}`
}
