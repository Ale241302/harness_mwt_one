/**
 * Gateway mirror route: the deployed host's half of the product mirror.
 *
 * The desktop client reaches `https://<host>/_/harness/mirror` with the console
 * token it obtained at sign-in, its account email, and the internal credential
 * the owner's `dsh` was given. This module authenticates the request against the
 * caller's stored per-user record and forwards the JSON body to that owner's
 * `faberloom-mcp.sock`, where the native product MCP server answers the
 * `faberloom_mirror_export` and `faberloom_mirror_apply` tools.
 *
 * Nothing here serves product data by itself: without a stored user record, a
 * matching token, and the owner's socket the route refuses.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

/** The route path the gateway mounts the mirror under. */
export const MIRROR_ROUTE_PATH = '/_/harness/mirror'

/** Header carrying the internal credential the owner's dsh validates. */
export const MIRROR_KEY_HEADER = 'x-faberloom-mirror-key'

/** Header carrying the owning account email. */
export const MIRROR_OWNER_HEADER = 'x-faberloom-owner'

/** Header carrying the action the request asks for. */
export const MIRROR_ACTION_HEADER = 'x-faberloom-mirror-action'

/** Longest request body the route accepts, in bytes. */
export const DEFAULT_MIRROR_MAX_BODY_BYTES = 4 * 1024 * 1024

/** Longest the owner's socket may take to answer, in milliseconds. */
export const DEFAULT_MIRROR_TIMEOUT_MS = 60_000

/**
 * @typedef {object} MirrorOwner
 * @property {string} email - Owning account email, the `ownerId` of the owner's dsh patch.
 * @property {string} id - Account id naming the owner's home directory under the data root.
 */

/**
 * @typedef {object} MirrorRouteOptions
 * @property {(token: string) => (MirrorOwner | undefined | Promise<MirrorOwner | undefined>)} [resolveOwner]
 *   Resolve the owner a console token belongs to. The default reads the
 *   gateway's own per-user state file; a caller with a different store passes
 *   its own resolver.
 * @property {string} [dataDir] - Data root holding one directory per account id.
 * @property {string} [userStateFile] - The gateway's per-user state file; defaults to `<dataDir>/../gateway-users.json`, which is where `server.mjs` keeps it.
 * @property {string} [mirrorKey] - Deployment-wide internal credential; the per-owner key file wins.
 * @property {number} [maxBodyBytes] - Largest body accepted, in bytes.
 * @property {number} [timeoutMs] - Longest the owner's socket may take to answer.
 * @property {boolean} [log] - Whether to log refusals through `console`. Defaults to true.
 */

/**
 * The home directory one owner's data lives under.
 * @param {MirrorRouteOptions} options - the route options.
 * @param {MirrorOwner} owner - the resolved owner.
 * @returns {string} the absolute home directory.
 */
function ownerHome(options, owner) {
  return path.join(options.dataDir ?? process.env.DATA_DIR ?? '/data/users', owner.id)
}

/**
 * Read one owner's socket path.
 * @param {MirrorRouteOptions} options - the route options.
 * @param {MirrorOwner} owner - the resolved owner.
 * @returns {string} the absolute socket path the owner's dsh listens on.
 */
export function mirrorSocketPath(options, owner) {
  return path.join(ownerHome(options, owner), 'faberloom-mcp.sock')
}

/**
 * The internal credential one owner's `dsh` validates, resolved per request.
 *
 * A deployment that injects one shared value into every child
 * (`FABERLOOM_MIRROR_KEY`) sets `options.mirrorKey`; otherwise the route reads
 * the per-owner file `<home>/.mirror-key`, which the deployment writes when it
 * provisions the account. Neither present means the mirror is off, and the route
 * reports that instead of accepting the call.
 * @param {MirrorRouteOptions} options - the route options.
 * @param {MirrorOwner} owner - the resolved owner.
 * @returns {string | undefined} the key, or undefined when the deployment configured none.
 */
export function resolveMirrorKey(options, owner) {
  try {
    const key = fs.readFileSync(path.join(ownerHome(options, owner), '.mirror-key'), 'utf8').trim()
    if (key.length > 0) return key
  } catch {
    // No per-owner file: fall through to the deployment-wide value.
  }
  const shared = options.mirrorKey ?? process.env.FABERLOOM_MIRROR_KEY ?? ''
  return shared.length === 0 ? undefined : shared
}

/**
 * Generate one internal credential, for a deployment that provisions accounts.
 * @returns {string} 32 random bytes as hex.
 */
export function generateMirrorKey() {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Read the gateway's per-user state file the way `server.mjs` locates it.
 * @param options - the route options.
 * @returns the parsed state, or an empty user map when the file is absent.
 */
function readUserState(options) {
  const dataDir = options.dataDir ?? process.env.DATA_DIR ?? '/data/users'
  const file = options.userStateFile ?? process.env.USER_STATE_FILE ?? path.join(path.dirname(dataDir), 'gateway-users.json')
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.users === 'object' && parsed.users !== null) return parsed
  } catch {
    // Absent or unreadable: no stored user holds a token yet.
  }
  return { users: {} }
}

/**
 * Resolve an owner from the gateway's own per-user state.
 *
 * This is the route's default `resolveOwner`, and it matches what `server.mjs`
 * stores: the console access token of the owner's last login, filed under the
 * account email. A caller with a different store passes its own resolver.
 * @param options - the route options.
 * @param token - the Bearer token from the request.
 * @returns the owner, or undefined when no stored user holds that token.
 */
export function resolveOwnerFromUserState(options, token) {
  for (const user of Object.values(readUserState(options).users)) {
    if (user === null || typeof user !== 'object') continue
    if (typeof user.consolaAccess !== 'string' || user.consolaAccess.length === 0) continue
    if (user.consolaAccess !== token) continue
    if (typeof user.email !== 'string' || typeof user.id !== 'string') continue
    return { email: user.email, id: user.id }
  }
  return undefined
}

/**
 * Read the Bearer token of one request.
 * @param {object} request - the HTTP request.
 * @returns {string} the token, or an empty string when the header is absent or malformed.
 */
function bearerToken(request) {
  const header = request.get?.('authorization') ?? request.headers.authorization ?? ''
  if (typeof header !== 'string') return ''
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
}

/**
 * Forward one JSON-RPC message to the owner's product MCP server over its socket.
 * @param {MirrorRouteOptions} options - the route options.
 * @param {MirrorOwner} owner - the resolved owner.
 * @param {string} key - the internal credential the socket validates.
 * @param {unknown} body - the JSON-RPC message to send.
 * @returns {Promise<{ status: number, body: any }>} the socket's HTTP status and parsed body.
 */
export function forwardToOwner(options, owner, key, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  const timeoutMs = options.timeoutMs ?? DEFAULT_MIRROR_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    const upstream = http.request({
      socketPath: mirrorSocketPath(options, owner),
      path: '/mcp',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
        accept: 'application/json',
        [MIRROR_KEY_HEADER]: key,
      },
      timeout: timeoutMs,
    }, (reply) => {
      let text = ''
      reply.setEncoding('utf8')
      reply.on('data', (chunk) => { text += chunk })
      reply.on('end', () => {
        let parsed
        try {
          parsed = text === '' ? undefined : JSON.parse(text)
        } catch {
          reject(new Error(`the owner mirror server answered a non-JSON body (${String(reply.statusCode)})`))
          return
        }
        resolve({ status: reply.statusCode ?? 502, body: parsed })
      })
    })
    upstream.on('timeout', () => { upstream.destroy(new Error('the owner mirror server timed out')) })
    upstream.on('error', reject)
    upstream.end(payload)
  })
}

/**
 * Call one mirror tool through the owner's socket and return its JSON payload.
 * @param {MirrorRouteOptions} options - the route options.
 * @param {MirrorOwner} owner - the resolved owner.
 * @param {string} key - the internal credential.
 * @param {string} tool - tool name the owner's server advertises.
 * @param {Record<string, unknown>} args - tool arguments.
 * @returns {Promise<any>} the parsed tool value.
 * @throws when the socket refuses, answers an error, or returns unusable content.
 */
export async function callMirrorTool(options, owner, key, tool, args) {
  const answer = await forwardToOwner(options, owner, key, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: args },
  })
  const error = answer.body?.error
  if (error !== undefined) throw new Error(`the owner mirror server refused ${tool}: ${String(error.message)}`)
  const result = answer.body?.result
  if (result === undefined) throw new Error(`the owner mirror server answered no result for ${tool} (HTTP ${String(answer.status)})`)
  if (result.isError === true) throw new Error(result.content?.[0]?.text ?? `${tool} failed`)
  const text = result.content?.[0]?.text
  if (typeof text !== 'string') throw new Error(`${tool} answered no JSON text`)
  return JSON.parse(text)
}

/**
 * Read the JSON body of one request.
 *
 * The route parses its own body so it mounts with one line on an application
 * that carries no JSON parser: a mounted parser's `request.body` is used, and
 * otherwise the request stream is read and parsed here.
 * @param {object} request - the HTTP request.
 * @param {number} maxBodyBytes - largest body accepted, in bytes.
 * @returns {Promise<{ ok: true, body: any } | { ok: false, reason: 'too-large' | 'not-json' }>}
 */
async function readJsonBody(request, maxBodyBytes) {
  if (typeof request[Symbol.asyncIterator] !== 'function') {
    return { ok: true, body: request.body }
  }
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBodyBytes) return { ok: false, reason: 'too-large' }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return { ok: true, body: undefined }
  try {
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: false, reason: 'not-json' }
  }
}

/**
 * Resolve an owner by asking the console whose access token this is. The Desktop
 * signs into the console on its own, so the token it presents is never the one the
 * gateway stored for the operator's Web session; validating it where it was minted
 * is the only resolution that accepts both, and it also makes a token the console
 * refreshed work without the gateway having held it first.
 * @param {MirrorRouteOptions} options - route wiring; `consolaApi` names the console.
 * @param {string} token - the presented console access token.
 * @returns {Promise<MirrorOwner | undefined>} the owner, or undefined when refused.
 */
export async function resolveOwnerFromConsole(options, token) {
  const base = (options.consolaApi ?? process.env.CONSOLA_API_BASE ?? '').replace(/\/+$/u, '')
  if (base.length === 0 || token.length === 0) return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.consoleTimeoutMs ?? 8000)
  try {
    const response = await fetch(`${base}/portal/me/`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return undefined
    const body = await response.json()
    const email = body?.user?.email
    if (typeof email !== 'string' || email.trim().length === 0) return undefined
    const id = body?.user?.id
    return { id: typeof id === 'string' && id.length > 0 ? id : email.trim(), email: email.trim() }
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Mount the mirror route on one Express application.
 *
 * Every refusal names its reason, because the caller reading a gateway log is an
 * operator. The caller wires it with one line:
 * `installMirrorRoute(app, { dataDir: DATA_DIR })`.
 * @param {object} app - the Express application to mount on.
 * @param {MirrorRouteOptions} [options] - the deployment's wiring; the defaults match `server.mjs`.
 * @returns {void}
 */
export function installMirrorRoute(app, options = {}) {
  const log = options.log ?? true
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MIRROR_MAX_BODY_BYTES
  const resolveOwner = options.resolveOwner ?? (async (token) => {
    const fromConsole = await resolveOwnerFromConsole(options, token)
    if (fromConsole !== undefined) return fromConsole
    return await resolveOwnerFromUserState(options, token)
  })
  app.post(MIRROR_ROUTE_PATH, (request, response) => {
    const refuse = (status, message) => {
      if (log) console.warn(`[gateway] mirror refuse ${String(status)}: ${message}`)
      response.status(status).json({ error: message })
    }
    void (async () => {
      const token = bearerToken(request)
      if (token.length === 0) {
        refuse(401, 'falta el token Bearer del propietario')
        return
      }
      const owner = await resolveOwner(token)
      if (owner === undefined) {
        refuse(401, 'token desconocido o revocado')
        return
      }
      const claimed = request.get?.(MIRROR_OWNER_HEADER) ?? request.headers[MIRROR_OWNER_HEADER]
      if (typeof claimed === 'string' && claimed.length > 0 && decodeURIComponent(claimed) !== owner.email) {
        refuse(403, 'el propietario reclamado no es el del token')
        return
      }
      const key = resolveMirrorKey(options, owner)
      if (key === undefined) {
        refuse(503, 'el espejo no tiene credencial en este despliegue; define FABERLOOM_MIRROR_KEY o escribe <home>/.mirror-key')
        return
      }
      const presented = request.get?.(MIRROR_KEY_HEADER) ?? request.headers[MIRROR_KEY_HEADER]
      if (presented !== key) {
        refuse(401, 'la credencial del espejo no coincide')
        return
      }
      const read = await readJsonBody(request, maxBodyBytes)
      if (!read.ok) {
        if (read.reason === 'too-large') {
          refuse(413, 'el documento del espejo es demasiado grande')
          return
        }
        refuse(400, 'el cuerpo debe ser JSON')
        return
      }
      const body = read.body
      const action = request.get?.(MIRROR_ACTION_HEADER) ?? request.headers[MIRROR_ACTION_HEADER]
      if (action === 'apply' && (body === null || typeof body !== 'object' || Array.isArray(body))) {
        refuse(400, 'el cuerpo debe ser un objeto JSON con el documento de espejo')
        return
      }
      try {
        if (action === 'apply') {
          const applied = await callMirrorTool(options, owner, key, 'faberloom_mirror_apply', { document: body })
          const local = await callMirrorTool(options, owner, key, 'faberloom_mirror_export', {})
          response.status(200).json({
            ...local.document,
            applied: applied.applied ?? [],
            skillsApplied: applied.skillsApplied ?? [],
            skipped: [...(applied.skipped ?? []), ...(local.skipped ?? [])],
          })
          return
        }
        const value = await callMirrorTool(options, owner, key, 'faberloom_mirror_export', {})
        const document = value.document
        if (document === undefined) {
          refuse(502, 'el servidor del propietario no devolvió documento')
          return
        }
        response.status(200).json({ ...document, applied: [], skillsApplied: [], skipped: value.skipped ?? [] })
      } catch (error) {
        refuse(502, error instanceof Error ? error.message : String(error))
      }
    })().catch((error) => {
      refuse(500, error instanceof Error ? error.message : String(error))
    })
  })
}
