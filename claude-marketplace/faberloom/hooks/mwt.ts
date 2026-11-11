/**
 * MWT.ONE for the mod: the console sign-in that issues one DeviceToken per
 * company, and the JSON-RPC call that reaches that company's MCP endpoint.
 *
 * The console flow is the product's own: `POST /auth/login/` returns a console
 * bearer, and `POST /onboarding/device-token` returns one credential per
 * company the account can reach. The mod keeps those credentials in its own
 * store and sends each token only to the endpoint the console named.
 */

/** One company credential the console issued. */
export interface MwtCompany {
  /** Company key the console returned. */
  readonly key: string
  /** Display name. */
  readonly name: string
  /** Opaque DeviceToken. */
  readonly token: string
  /** Absolute MCP endpoint for that company. */
  readonly mcpUrl: string
}

/** Where the console API lives unless the caller names another base. */
export const DEFAULT_CONSOLA_BASE = 'https://consola.mwt.one/api'

/** Store key holding every company this installation signed in to. */
export const COMPANIES_KEY = 'mwt.companies'

/** Store key holding the active company key. */
export const ACTIVE_KEY = 'mwt.active'

/** Read one string field of an unknown object. */
function value(source: unknown, name: string): unknown {
  return source !== null && typeof source === 'object' ? (source as Record<string, unknown>)[name] : undefined
}

/**
 * Sign in to the console and read one credential per company.
 * @param $ - the mods API.
 * @param base - console API base.
 * @param usuario - console user or email.
 * @param password - console password.
 * @returns the companies the account can reach.
 * @throws when the console refuses the login or returns no company.
 */
export async function signIn($, base: string, usuario: string, password: string): Promise<readonly MwtCompany[]> {
  const root = base.trim().replace(/\/+$/u, '')
  const login = await $.http.fetch(`${root}/auth/login/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ usuario, password }),
  })
  if (!login.ok) throw new Error('La consola rechazó el usuario o la contraseña.')
  const session = JSON.parse(login.text) as unknown
  // The console names the console bearer `access`, and the account under `user`.
  const access = value(session, 'access')
  if (typeof access !== 'string' || access.length === 0) throw new Error('La consola no emitió un token de sesión.')
  const device = await $.store.get('mwt.deviceId')
  const deviceId = typeof device === 'string' && device.length > 0 ? device : crypto.randomUUID()
  if (deviceId !== device) await $.store.set('mwt.deviceId', deviceId)
  const issued = await $.http.fetch(`${root}/onboarding/device-token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${access}`,
    },
    body: JSON.stringify({ device_id: deviceId }),
  })
  if (!issued.ok) throw new Error(`La consola no emitió el token del dispositivo (${String(issued.status)}).`)
  const payload = JSON.parse(issued.text) as unknown
  const rows = value(payload, 'credentials')
  const companies: MwtCompany[] = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = value(row, 'key')
    const secret = value(row, 'token')
    const url = value(row, 'mcp_url')
    if (typeof key !== 'string' || typeof secret !== 'string' || typeof url !== 'string') continue
    const name = value(row, 'name')
    companies.push({ key, token: secret, mcpUrl: url, name: typeof name === 'string' && name.length > 0 ? name : key })
  }
  if (companies.length === 0) throw new Error('La consola no devolvió ninguna empresa con MCP para esta cuenta.')
  return companies
}

/** One JSON-RPC result envelope. */
interface RpcAnswer {
  readonly result?: unknown
  readonly error?: { readonly message?: unknown }
}

/**
 * Read one SSE or JSON response body as JSON-RPC answers.
 * @param text - the response body.
 * @returns the answers the body carried.
 */
function answersOf(text: string): readonly RpcAnswer[] {
  const answers: RpcAnswer[] = []
  for (const line of text.split(/\r?\n/u)) {
    const payload = line.startsWith('data:') ? line.slice(5).trim() : line.trim()
    if (!payload.startsWith('{')) continue
    try {
      answers.push(JSON.parse(payload) as RpcAnswer)
    } catch {
      // A partial frame is not an answer; the next line may be.
    }
  }
  return answers
}

/**
 * Read one response header, whatever case the carrier used.
 * @param headers - the response headers object.
 * @param name - lower-case header name.
 * @returns the value, or an empty string.
 */
function headerValue(headers: unknown, name: string): string {
  if (headers === null || typeof headers !== 'object') return ''
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === name && typeof value === 'string') return value
  }
  return ''
}

/**
 * Call one tool on a company's MCP endpoint.
 *
 * Streamable HTTP needs the handshake: `initialize` answers with an
 * `mcp-session-id` header, and every later request carries it. Without the
 * session the endpoint rejects the call with "Missing session ID".
 * @param $ - the mods API.
 * @param company - the company credential to use.
 * @param tool - tool name the endpoint exposes.
 * @param input - tool arguments.
 * @returns the text the tool answered with.
 */
export async function callTool($, company: MwtCompany, tool: string, input: Record<string, unknown>): Promise<string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `DeviceToken ${company.token}`,
  }
  const init = await $.http.fetch(company.mcpUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'faberloom-claude', version: '1' } },
    }),
  })
  if (init.status === 401) throw new Error('El token de esta empresa caducó: volvé a ejecutar /mwt.')
  if (!init.ok) throw new Error(`El MCP de ${company.name} respondió ${String(init.status)} al abrir la sesión.`)
  const session = headerValue(init.headers, 'mcp-session-id')
  if (session.length > 0) {
    await $.http.fetch(company.mcpUrl, {
      method: 'POST',
      headers: { ...headers, 'mcp-session-id': session },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }).catch(() => undefined)
  }
  const response = await $.http.fetch(company.mcpUrl, {
    method: 'POST',
    headers: session.length === 0 ? headers : { ...headers, 'mcp-session-id': session },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: tool, arguments: input },
    }),
  })
  if (response.status === 401) throw new Error('El token de esta empresa caducó: volvé a ejecutar /mwt.')
  if (!response.ok) throw new Error(`El MCP de ${company.name} respondió ${String(response.status)}.`)
  const answer = answersOf(response.text).at(-1)
  if (answer === undefined) throw new Error('El MCP no devolvió una respuesta legible.')
  const failure = value(answer, 'error')
  if (failure !== undefined) {
    const message = value(failure, 'message')
    throw new Error(typeof message === 'string' ? message : 'El MCP rechazó la llamada.')
  }
  const result = value(answer, 'result')
  const content = value(result, 'content')
  if (Array.isArray(content)) {
    const parts = content
      .map(part => value(part, 'text'))
      .filter((part): part is string => typeof part === 'string')
    if (parts.length > 0) return parts.join('\n')
  }
  return JSON.stringify(result ?? null)
}
