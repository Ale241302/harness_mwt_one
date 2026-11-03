/**
 * Ventana del proxy de modelo, medida y no supuesta: 120 solicitudes por cuenta
 * y minuto pasan, la 121 responde 429 `rate_limit_error`, otra cuenta conserva
 * su propia ventana y la ventana vuelve a abrirse al cumplirse el intervalo.
 *
 * Todo ocurre contra servidores locales en `127.0.0.1`: la consola falsa
 * resuelve `GET /portal/me/` por token y el proveedor falso responde JSON. No
 * hay red externa ni llave real.
 *
 * Se ejecuta solo: `node --test gateway/llm-proxy.test.mjs`.
 *
 * Reapertura de ventana: se mockea únicamente la API `Date` (Node 22), que es
 * la que leen `withinRate` y la caché de tokens; `fetch` y los `setTimeout`
 * reales siguen funcionando. Se eligió el reloj falso sobre dos procesos porque
 * permite observar la misma instancia del proxy antes y después del corte, sin
 * duplicar el arranque ni inventar un reloj interno.
 */

import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it, mock } from 'node:test'

import express from 'express'

import { installLlmProxy, LLM_RATE_LIMIT_PER_MIN, RATE_WINDOW_MS } from './llm-proxy.mjs'

const DEPLOYMENT_KEY = 'sk-test-deployment'
const PATH = '/llm/chat/completions'
const BODY = { model: 'test-model', messages: [{ role: 'user', content: 'hola' }] }

/** token → email que la consola falsa reconoce. */
const ACCOUNTS = new Map([
  ['tok-alpha', 'alpha@test.invalid'],
  ['tok-beta', 'beta@test.invalid'],
])

/** Cuerpos que el proveedor falso recibió, para comprobar la llave del despliegue. */
const upstreamBodies = []

/** @type {{ server: import('node:http').Server, url: string } | undefined} */
let consola
/** @type {{ server: import('node:http').Server, url: string } | undefined} */
let upstream
/** @type {import('node:http').Server[]} */
const proxyServers = []

/**
 * Escucha una app express en un puerto efímero de `127.0.0.1`.
 * @param app - aplicación express a servir.
 * @returns el servidor y su base URL.
 */
function listen(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app)
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

/**
 * Cierra un servidor y espera a que suelten el puerto.
 * @param server - servidor HTTP ya escuchando.
 * @returns promesa que resuelve al cerrar.
 */
function closeServer(server) {
  return new Promise(resolve => server.close(() => resolve()))
}

/**
 * Arranca una instancia aislada del proxy, con su propio mapa de ventanas.
 * @returns base URL del proxy y su servidor.
 */
async function startProxy() {
  const app = express()
  installLlmProxy(app, {
    consolaApi: consola.url,
    apiKey: DEPLOYMENT_KEY,
    upstream: upstream.url,
  })
  const started = await listen(app)
  proxyServers.push(started.server)
  return started
}

/**
 * Envía una solicitud de modelo al proxy.
 * @param baseUrl - base del proxy recién arrancado.
 * @param token - token de consola presentado como Bearer.
 * @returns estado HTTP y cuerpo JSON ya leído.
 */
async function post(baseUrl, token) {
  const response = await fetch(`${baseUrl}${PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(BODY),
  })
  const text = await response.text()
  return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined }
}

before(async () => {
  const consolaApp = express()
  consolaApp.get('/portal/me/', (req, res) => {
    const header = req.get('authorization') || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const email = ACCOUNTS.get(token)
    if (email === undefined) return res.status(401).json({ detail: 'no autorizado' })
    return res.json({ email })
  })
  consola = await listen(consolaApp)

  const upstreamApp = express()
  upstreamApp.post('/chat/completions', express.json(), (req, res) => {
    upstreamBodies.push({ authorization: req.get('authorization'), body: req.body })
    res.json({ id: 'chatcmpl-test', choices: [{ message: { role: 'assistant', content: 'ok' } }] })
  })
  upstreamApp.post('/messages', express.json(), (req, res) => {
    upstreamBodies.push({ authorization: req.get('authorization'), body: req.body })
    res.json({ id: 'msg-test', content: [{ type: 'text', text: 'ok' }] })
  })
  upstream = await listen(upstreamApp)
})

after(async () => {
  await Promise.all(proxyServers.map(closeServer))
  await Promise.all([closeServer(consola.server), closeServer(upstream.server)])
})

describe('C-B03 · ventana del proxy de modelo', () => {
  it(`C-B03.2 · ${LLM_RATE_LIMIT_PER_MIN} solicitudes de la misma cuenta pasan`, async () => {
    const { url } = await startProxy()
    const firstUpstream = upstreamBodies.length
    for (let index = 1; index <= LLM_RATE_LIMIT_PER_MIN; index += 1) {
      const { status, json } = await post(url, 'tok-alpha')
      assert.equal(status, 200, `la solicitud ${index} debía pasar y respondió ${status}: ${JSON.stringify(json)}`)
    }
    // La llave del despliegue viaja al proveedor; la respuesta no la repite.
    assert.equal(upstreamBodies[firstUpstream].authorization, `Bearer ${DEPLOYMENT_KEY}`)
    assert.deepEqual(upstreamBodies[firstUpstream].body, BODY)
  })

  it('C-B03.3 · la solicitud 121 responde 429 rate_limit_error', async () => {
    const { url } = await startProxy()
    for (let index = 1; index <= LLM_RATE_LIMIT_PER_MIN; index += 1) {
      const { status } = await post(url, 'tok-alpha')
      assert.equal(status, 200, `la solicitud ${index} debía pasar`)
    }
    const { status, json } = await post(url, 'tok-alpha')
    assert.equal(status, 429)
    assert.equal(json.error.type, 'rate_limit_error')
    assert.equal(json.error.message, 'demasiadas solicitudes')
  })

  it('C-B03.4 · otra cuenta conserva su propia ventana en el mismo minuto', async () => {
    const { url } = await startProxy()
    for (let index = 1; index <= LLM_RATE_LIMIT_PER_MIN; index += 1) {
      const { status } = await post(url, 'tok-alpha')
      assert.equal(status, 200, `la solicitud ${index} de alpha debía pasar`)
    }
    const limited = await post(url, 'tok-alpha')
    assert.equal(limited.status, 429, 'alpha ya gastó su ventana')
    const other = await post(url, 'tok-beta')
    assert.equal(other.status, 200, 'beta no comparte la ventana de alpha')
    assert.equal(other.json.choices[0].message.content, 'ok')
  })

  it('C-B03 · token vacío o inválido responde 401', async () => {
    const { url } = await startProxy()
    const empty = await post(url, '')
    assert.equal(empty.status, 401)
    assert.equal(empty.json.error.type, 'authentication_error')
    const invalid = await post(url, 'tok-no-existe')
    assert.equal(invalid.status, 401)
    assert.equal(invalid.json.error.type, 'authentication_error')
  })

  it('C-B03 · la ventana vuelve a abrirse al cumplirse el intervalo', async () => {
    const { url } = await startProxy()
    mock.timers.enable({ apis: ['Date'] })
    try {
      for (let index = 1; index <= LLM_RATE_LIMIT_PER_MIN; index += 1) {
        const { status } = await post(url, 'tok-alpha')
        assert.equal(status, 200, `la solicitud ${index} debía pasar`)
      }
      const limited = await post(url, 'tok-alpha')
      assert.equal(limited.status, 429)

      mock.timers.setTime(Date.now() + RATE_WINDOW_MS)

      const reopened = await post(url, 'tok-alpha')
      assert.equal(reopened.status, 200, 'pasada la ventana, la cuenta vuelve a tener cupo')
    } finally {
      mock.timers.reset()
    }
  })
})
