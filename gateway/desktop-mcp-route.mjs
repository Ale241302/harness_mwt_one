/**
 * Gateway half of the desktop MCP bridge.
 *
 * A desktop installation lives behind a router, so the deployment cannot open
 * its product socket. This module reverses the direction with the console
 * credential the desktop already holds:
 *
 * - the desktop registers the bearer tokens it minted;
 * - it long-polls for one public `/mcp` request at a time;
 * - it answers with its own product MCP server and posts the response back.
 *
 * The public endpoint stays `POST /mcp` with a Bearer token. The gateway only
 * routes: it never sees a product socket for a desktop token, and it keeps
 * registrations and queued requests in memory, so a redeploy simply makes the
 * desktop re-register on its next poll.
 */

import crypto from 'node:crypto'

import express from 'express'

import { resolveOwnerFromConsole, resolveOwnerFromUserState } from './mirror-route.mjs'

/** Path prefix the desktop bridge calls. */
export const DESKTOP_MCP_ROUTE_PREFIX = '/_/harness/desktop-mcp'

/** Longest a poll may wait for a request, in milliseconds. */
export const DEFAULT_DESKTOP_POLL_MS = 25_000

/** Longest a public `/mcp` call may wait for the desktop answer, in milliseconds. */
export const DEFAULT_DESKTOP_REQUEST_MS = 120_000

/** A device silent for this long is reported offline rather than queued forever. */
export const DEFAULT_DESKTOP_OFFLINE_MS = 45_000

/** Largest registration body accepted, in bytes. */
export const DEFAULT_DESKTOP_MAX_BODY_BYTES = 1024 * 1024

/** Most requests one device may have queued or in flight. */
export const DEFAULT_DESKTOP_MAX_PENDING = 100

/** Read one Bearer token. */
function bearerToken(request) {
  const header = request.get?.('authorization') ?? request.headers.authorization ?? ''
  if (typeof header !== 'string') return ''
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
}

/** A JSON-RPC error body the public client can read. */
function rpcError(message) {
  return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } })
}

/**
 * Mount the desktop bridge endpoints and return the router the public `/mcp`
 * route uses for tokens the web store does not own.
 * @param {object} app - the Express application.
 * @param {object} [options] - deployment wiring.
 * @param {(token: string) => Promise<{email: string, id: string} | undefined>} [options.resolveOwner] - console-token resolver.
 * @param {string} [options.consolaApi] - console API base used by the default resolver.
 * @param {number} [options.pollTimeoutMs] - longest one poll waits.
 * @param {number} [options.requestTimeoutMs] - longest one public call waits.
 * @param {number} [options.offlineAfterMs] - silence after which a device is offline.
 * @param {number} [options.maxPending] - per-device queue ceiling.
 * @param {boolean} [options.log] - whether refusals are logged.
 * @returns {{route: (request: {token: string, body: string, accept?: string}) => Promise<undefined | {offline: true} | {status: number, contentType: string, body: string}>, status: () => object}}
 */
export function installDesktopMcpBridge(app, options = {}) {
  const log = options.log ?? true
  const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_DESKTOP_POLL_MS
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_DESKTOP_REQUEST_MS
  const offlineAfterMs = options.offlineAfterMs ?? DEFAULT_DESKTOP_OFFLINE_MS
  const maxPending = options.maxPending ?? DEFAULT_DESKTOP_MAX_PENDING
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_DESKTOP_MAX_BODY_BYTES
  const resolveOwner = options.resolveOwner ?? (async (token) => {
    const fromConsole = await resolveOwnerFromConsole(options, token)
    if (fromConsole !== undefined) return fromConsole
    return await resolveOwnerFromUserState(options, token)
  })

  /** deviceId -> { ownerEmail, ownerId, tokens:Set<string>, lastSeen } */
  const devices = new Map()
  /** bearer token -> deviceId */
  const byToken = new Map()
  /** deviceId -> queued requests not yet handed to a poll */
  const queues = new Map()
  /** deviceId -> poll waiters */
  const waiters = new Map()
  /** requestId -> in-flight request */
  const inFlight = new Map()
  /** console token -> { owner, at } */
  const owners = new Map()

  /** Resolve an owner with a short cache, so a 25-second poll does not hit the console every time. */
  async function ownerOf(token) {
    const cached = owners.get(token)
    if (cached !== undefined && Date.now() - cached.at < 60_000) return cached.owner
    const owner = await resolveOwner(token)
    if (owner !== undefined) owners.set(token, { owner, at: Date.now() })
    return owner
  }

  /** Refuse a bridge request with a named reason. */
  function refuse(response, status, message) {
    if (log) console.warn(`[gateway] desktop-mcp refuse ${String(status)}: ${message}`)
    response.status(status).json({ error: message })
  }

  /** Remove one waiter from a device's list and clear its timer. */
  function dropWaiter(deviceId, waiter) {
    const list = waiters.get(deviceId)
    if (list === undefined) return
    const index = list.indexOf(waiter)
    if (index >= 0) list.splice(index, 1)
    if (list.length === 0) waiters.delete(deviceId)
    if (waiter.timer !== undefined) clearTimeout(waiter.timer)
  }

  /** Hand one request to a waiting poll, if any. */
  function handToWaiter(deviceId, request) {
    const list = waiters.get(deviceId)
    if (list === undefined || list.length === 0) return false
    const waiter = list.shift()
    if (list.length === 0) waiters.delete(deviceId)
    if (waiter.timer !== undefined) clearTimeout(waiter.timer)
    waiter.deliver(request)
    return true
  }

  /** Drop a request that timed out before a poll took it. */
  function dropQueued(deviceId, requestId) {
    const queue = queues.get(deviceId)
    if (queue === undefined) return
    const index = queue.findIndex(entry => entry.requestId === requestId)
    if (index >= 0) queue.splice(index, 1)
    if (queue.length === 0) queues.delete(deviceId)
  }

  app.post(`${DESKTOP_MCP_ROUTE_PREFIX}/register`, express.json({ limit: maxBodyBytes }), (request, response) => {
    void (async () => {
      const token = bearerToken(request)
      if (token.length === 0) return refuse(response, 401, 'falta el token de consola')
      const owner = await ownerOf(token)
      if (owner === undefined) return refuse(response, 401, 'token de consola desconocido o vencido')
      const body = request.body
      const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : ''
      if (deviceId.length === 0 || deviceId.length > 128) return refuse(response, 400, 'deviceId inválido')
      if (!Array.isArray(body?.tokens) || body.tokens.some(value => typeof value !== 'string')) {
        return refuse(response, 400, 'tokens debe ser una lista de cadenas')
      }
      const existing = devices.get(deviceId)
      if (existing !== undefined && existing.ownerEmail !== owner.email) {
        return refuse(response, 403, 'el dispositivo pertenece a otra cuenta')
      }
      const tokens = new Set(body.tokens.map(value => value.trim()).filter(value => value.length > 0))
      if (existing !== undefined) {
        for (const old of existing.tokens) {
          if (!tokens.has(old) && byToken.get(old) === deviceId) byToken.delete(old)
        }
      }
      for (const value of tokens) byToken.set(value, deviceId)
      devices.set(deviceId, {
        ownerEmail: owner.email,
        ownerId: owner.id,
        tokens,
        lastSeen: Date.now(),
      })
      response.status(200).json({ ok: true, deviceId, tokens: tokens.size })
    })().catch(error => refuse(response, 500, error instanceof Error ? error.message : String(error)))
  })

  app.post(`${DESKTOP_MCP_ROUTE_PREFIX}/poll`, express.json({ limit: maxBodyBytes }), (request, response) => {
    void (async () => {
      const token = bearerToken(request)
      if (token.length === 0) return refuse(response, 401, 'falta el token de consola')
      const owner = await ownerOf(token)
      if (owner === undefined) return refuse(response, 401, 'token de consola desconocido o vencido')
      const deviceId = typeof request.body?.deviceId === 'string' ? request.body.deviceId.trim() : ''
      if (deviceId.length === 0) return refuse(response, 400, 'deviceId requerido')
      const device = devices.get(deviceId)
      if (device === undefined) return refuse(response, 409, 'el dispositivo no está registrado')
      if (device.ownerEmail !== owner.email) return refuse(response, 403, 'el dispositivo pertenece a otra cuenta')
      device.lastSeen = Date.now()
      const queue = queues.get(deviceId)
      const next = queue?.shift()
      if (queue !== undefined && queue.length === 0) queues.delete(deviceId)
      if (next !== undefined) {
        response.status(200).json(next.payload)
        return
      }
      const waiter = {
        timer: undefined,
        deliver: (payload) => {
          if (response.writableEnded) return
          response.status(200).json(payload)
        },
      }
      waiter.timer = setTimeout(() => {
        dropWaiter(deviceId, waiter)
        if (!response.writableEnded) response.status(204).end()
      }, pollTimeoutMs)
      waiter.timer.unref?.()
      const list = waiters.get(deviceId) ?? []
      list.push(waiter)
      waiters.set(deviceId, list)
      response.on('close', () => { dropWaiter(deviceId, waiter) })
    })().catch(error => refuse(response, 500, error instanceof Error ? error.message : String(error)))
  })

  app.post(`${DESKTOP_MCP_ROUTE_PREFIX}/respond`, express.json({ limit: 8 * 1024 * 1024 }), (request, response) => {
    void (async () => {
      const token = bearerToken(request)
      if (token.length === 0) return refuse(response, 401, 'falta el token de consola')
      const owner = await ownerOf(token)
      if (owner === undefined) return refuse(response, 401, 'token de consola desconocido o vencido')
      const body = request.body
      const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : ''
      const requestId = typeof body?.requestId === 'string' ? body.requestId : ''
      if (deviceId.length === 0 || requestId.length === 0) return refuse(response, 400, 'deviceId y requestId son requeridos')
      const device = devices.get(deviceId)
      if (device === undefined || device.ownerEmail !== owner.email) return refuse(response, 403, 'el dispositivo no pertenece a esta cuenta')
      const pending = inFlight.get(requestId)
      if (pending === undefined || pending.deviceId !== deviceId) return refuse(response, 404, 'la petición ya venció o no existe')
      device.lastSeen = Date.now()
      inFlight.delete(requestId)
      pending.timer = undefined
      pending.resolve({
        status: Number.isSafeInteger(body.status) ? body.status : 200,
        contentType: typeof body.contentType === 'string' ? body.contentType : 'application/json; charset=utf-8',
        body: typeof body.body === 'string' ? body.body : rpcError('el escritorio devolvió una respuesta vacía'),
        ...(typeof body.sessionId === 'string' && body.sessionId.length > 0 ? { sessionId: body.sessionId } : {}),
      })
      response.status(204).end()
    })().catch(error => refuse(response, 500, error instanceof Error ? error.message : String(error)))
  })

  /**
   * Route one public `/mcp` body to the desktop that registered its token.
   * @param {{token: string, body: string, accept?: string}} call - the public call.
   * @returns {Promise<undefined | {offline: true} | {status: number, contentType: string, body: string}>}
   */
  async function route(call) {
    const deviceId = byToken.get(call.token)
    if (deviceId === undefined) return undefined
    const device = devices.get(deviceId)
    if (device === undefined) return undefined
    if (Date.now() - device.lastSeen > offlineAfterMs) return { offline: true }
    const queue = queues.get(deviceId) ?? []
    const deviceInFlight = [...inFlight.values()].filter(entry => entry.deviceId === deviceId).length
    if (queue.length + deviceInFlight >= maxPending) {
      return {
        status: 429,
        contentType: 'application/json; charset=utf-8',
        body: rpcError('el escritorio tiene demasiadas peticiones en curso'),
      }
    }
    const requestId = crypto.randomUUID()
    const payload = {
      requestId,
      body: call.body,
      token: call.token,
      accept: typeof call.accept === 'string' && call.accept.length > 0 ? call.accept : 'application/json',
    }
    return await new Promise((resolve) => {
      const pending = {
        deviceId,
        requestId,
        payload,
        resolve: (answer) => resolve(answer),
        timer: undefined,
      }
      inFlight.set(requestId, pending)
      pending.timer = setTimeout(() => {
        inFlight.delete(requestId)
        dropQueued(deviceId, requestId)
        resolve({
          status: 504,
          contentType: 'application/json; charset=utf-8',
          body: rpcError('el escritorio no respondió a tiempo; ¿sigue abierto FaberLoom?'),
        })
      }, requestTimeoutMs)
      pending.timer.unref?.()
      if (handToWaiter(deviceId, payload)) return
      queue.push(pending)
      queues.set(deviceId, queue)
    })
  }

  /** Operator snapshot: which devices are registered and how much they owe. */
  function status() {
    const now = Date.now()
    return {
      devices: [...devices.entries()].map(([deviceId, device]) => ({
        deviceId,
        owner: device.ownerEmail,
        tokens: device.tokens.size,
        online: now - device.lastSeen <= offlineAfterMs,
        lastSeen: new Date(device.lastSeen).toISOString(),
        queued: queues.get(deviceId)?.length ?? 0,
        waiting: waiters.get(deviceId)?.length ?? 0,
      })),
      inFlight: inFlight.size,
    }
  }

  return { route, status }
}
