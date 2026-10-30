/**
 * Proxy de modelo: el escritorio habla con el gateway y el gateway pone la llave
 * del despliegue. Así una instalación tiene modelo desde el primer arranque sin
 * que la llave quede en el disco del cliente.
 *
 * El cliente presenta su token de consola como `Authorization: Bearer <token>`.
 * El gateway lo valida contra `portal/me/` (sirve para todos los roles) y cachea
 * el resultado unos minutos, para no sumar una llamada a la consola por request.
 * La llave de DeepSeek nunca sale de este proceso: ni en la respuesta, ni en los
 * logs, ni en un archivo.
 */
import { Readable } from 'node:stream'

import express from 'express'

/** Cuánto se reutiliza una validación de token antes de volver a preguntar. */
const TOKEN_TTL_MS = 5 * 60 * 1000

/** Requests por cuenta y ventana; corta un bucle desbocado sin frenar el uso normal. */
const RATE_WINDOW_MS = 60 * 1000
const RATE_LIMIT = 120

/** Cuerpo máximo aceptado: una conversación con adjuntos ya viaja sin ellos. */
const BODY_LIMIT = '8mb'

/** Poda de la caché de tokens: por encima de este tamaño se tiran los vencidos. */
const TOKEN_CACHE_LIMIT = 500

/**
 * Instala las rutas del proxy de modelo.
 * @param app - la aplicación express del gateway.
 * @param options - proveedor de la llave, upstream y validador de tokens.
 * @param options.consolaApi - base de la API de la consola, sin barra final.
 * @param options.apiKey - llave del despliegue; sin ella las rutas responden 503.
 * @param options.upstream - base del proveedor, sin barra final.
 */
export function installLlmProxy(app, { consolaApi, apiKey, upstream }) {
  /** token → { email, exp } */
  const tokens = new Map()
  /** email → { count, resetAt } */
  const windows = new Map()

  const userOf = async (token) => {
    if (token.length === 0) return undefined
    const hit = tokens.get(token)
    if (hit !== undefined && hit.exp > Date.now()) return hit
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    try {
      const response = await fetch(`${consolaApi}/portal/me/`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) return undefined
      const me = await response.json()
      const email = typeof me?.email === 'string' && me.email.length > 0 ? me.email : undefined
      if (email === undefined) return undefined
      const entry = { email, exp: Date.now() + TOKEN_TTL_MS }
      tokens.set(token, entry)
      if (tokens.size > TOKEN_CACHE_LIMIT) {
        for (const [key, value] of tokens) if (value.exp <= Date.now()) tokens.delete(key)
      }
      return entry
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }

  const withinRate = (email) => {
    const now = Date.now()
    const window = windows.get(email)
    if (window === undefined || window.resetAt <= now) {
      windows.set(email, { count: 1, resetAt: now + RATE_WINDOW_MS })
      return true
    }
    window.count += 1
    return window.count <= RATE_LIMIT
  }

  const forward = (path) => async (req, res) => {
    const header = req.get('authorization') || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const user = await userOf(token)
    if (user === undefined) {
      return res.status(401).json({ error: { message: 'token de consola inválido o vencido', type: 'authentication_error' } })
    }
    if (!withinRate(user.email)) {
      return res.status(429).json({ error: { message: 'demasiadas solicitudes', type: 'rate_limit_error' } })
    }
    if (!apiKey) {
      return res.status(503).json({ error: { message: 'el despliegue no tiene modelo configurado', type: 'configuration_error' } })
    }
    let upstreamResponse
    try {
      upstreamResponse = await fetch(`${upstream}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: req.get('accept') || '*/*',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(req.body ?? {}),
      })
    } catch {
      return res.status(502).json({ error: { message: 'el proveedor no responde', type: 'upstream_error' } })
    }
    res.status(upstreamResponse.status)
    res.setHeader('content-type', upstreamResponse.headers.get('content-type') || 'application/json')
    res.setHeader('cache-control', 'no-store')
    if (upstreamResponse.body === null) return res.end()
    Readable.fromWeb(upstreamResponse.body).pipe(res)
  }

  const body = express.json({ limit: BODY_LIMIT })
  app.post('/llm/chat/completions', body, forward('/chat/completions'))
  app.post('/llm/messages', body, forward('/messages'))
}
