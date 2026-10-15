/**
 * The gateway mirror route: the console token authenticates the owner, the
 * internal credential authorizes the socket call, and the forwarded request
 * reaches the owner's product MCP server over a real socket.
 */

import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  MIRROR_KEY_HEADER,
  MIRROR_OWNER_HEADER,
  MIRROR_ROUTE_PATH,
  forwardToOwner,
  generateMirrorKey,
  installMirrorRoute,
  mirrorSocketPath,
  resolveMirrorKey,
} from '../mirror-route.mjs'

const OWNER = { email: 'compras2@sondelsa.com', id: 'u-1' }
const TOKEN = 'consola-token-1'
const KEY = 'mirror-key-1'
const IS_WINDOWS = process.platform === 'win32'

/** A minimal Express stand-in that captures the mounted handler. */
class FakeApp {
  constructor() {
    this.handler = undefined
  }

  post(path, handler) {
    if (path !== MIRROR_ROUTE_PATH) throw new Error(`unexpected mount path ${path}`)
    this.handler = handler
  }
}

/** One request as Express hands it to the route. */
function request(options) {
  const headers = { [MIRROR_OWNER_HEADER]: encodeURIComponent(OWNER.email) }
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`
  if (options.key !== undefined) headers[MIRROR_KEY_HEADER] = options.key
  if (options.action !== undefined) headers['x-faberloom-mirror-action'] = options.action
  return { headers, body: options.body, get: name => headers[name.toLowerCase()] }
}

/** One response as Express hands it to the route. */
function response(captured) {
  return {
    status(code) {
      captured.status = code
      return this
    },
    json(body) {
      captured.body = body
      return this
    },
  }
}

/** Dispatch one request through the mounted route and wait for its answer. */
async function dispatch(app, input) {
  const captured = { status: 0, body: {} }
  app.handler?.(input, response(captured))
  for (let attempt = 0; attempt < 100 && captured.status === 0; attempt += 1) {
    await new Promise(resolve => { setTimeout(resolve, 10) })
  }
  return captured
}

const roots = []
const servers = []

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise(resolve => { server.close(() => { resolve() }) })
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One JSON-RPC answer for a tool call, as the MCP server renders it. */
function toolAnswer(value) {
  return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } }
}

it('refuses a request with no token, an unknown token, or a mismatched credential', async () => {
  const app = new FakeApp()
  installMirrorRoute(app, { resolveOwner: token => (token === TOKEN ? OWNER : undefined), mirrorKey: KEY, log: false })
  expect(app.handler).toBeDefined()
  expect((await dispatch(app, request({ key: KEY }))).status).toBe(401)
  expect((await dispatch(app, request({ token: 'otro', key: KEY }))).status).toBe(401)
  expect((await dispatch(app, request({ token: TOKEN, key: 'otra-clave' }))).status).toBe(401)
})

it('refuses a request that claims an owner other than the token\'s', async () => {
  const app = new FakeApp()
  installMirrorRoute(app, { resolveOwner: token => (token === TOKEN ? OWNER : undefined), mirrorKey: KEY, log: false })
  const forged = request({ token: TOKEN, key: KEY })
  forged.headers[MIRROR_OWNER_HEADER] = encodeURIComponent('otro@sondelsa.com')
  expect((await dispatch(app, forged)).status).toBe(403)
})

it('resolves the owner from the gateway user state when no resolver is passed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mirror-route-'))
  roots.push(root)
  const stateFile = join(root, 'gateway-users.json')
  writeFileSync(stateFile, JSON.stringify({
    users: {
      'compras2@sondelsa.com': { email: OWNER.email, id: OWNER.id, consolaAccess: TOKEN },
      'sin-token@sondelsa.com': { email: 'sin-token@sondelsa.com', id: 'u-2' },
      nulo: null,
    },
  }))
  const app = new FakeApp()
  installMirrorRoute(app, { dataDir: join(root, 'users'), userStateFile: stateFile, mirrorKey: KEY, log: false })
  // A token no stored user holds is refused before any socket work.
  expect((await dispatch(app, request({ token: 'otro', key: KEY }))).status).toBe(401)
  // The stored owner passes authentication and then fails on the missing socket.
  const forwarded = await dispatch(app, request({ token: TOKEN, key: KEY }))
  expect(forwarded.status).toBe(502)
  expect(String(forwarded.body.error)).toContain('mirror')
})

it('reports a deployment with no mirror credential instead of accepting the call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mirror-route-'))
  roots.push(root)
  const app = new FakeApp()
  installMirrorRoute(app, { resolveOwner: () => OWNER, dataDir: root, mirrorKey: '', log: false })
  const captured = await dispatch(app, request({ token: TOKEN, key: KEY }))
  expect(captured.status).toBe(503)
  expect(String(captured.body.error)).toContain('FABERLOOM_MIRROR_KEY')
})

it('reads a streamed JSON body when no parser is mounted, and refuses a broken one', async () => {
  const { Readable } = await import('node:stream')
  const root = mkdtempSync(join(tmpdir(), 'mirror-route-'))
  roots.push(root)
  const app = new FakeApp()
  installMirrorRoute(app, { resolveOwner: () => OWNER, dataDir: root, mirrorKey: KEY, log: false })
  // No socket: a well-formed document reaches the forward attempt (502), while a
  // body that is not JSON is refused before any socket work (400).
  const streamed = Object.assign(Readable.from([Buffer.from('{"version":1}')]), {
    headers: { authorization: `Bearer ${TOKEN}`, [MIRROR_KEY_HEADER]: KEY, 'x-faberloom-mirror-action': 'apply' },
    get: function (name) { return this.headers[name.toLowerCase()] },
  })
  const captured = { status: 0, body: {} }
  app.handler?.(streamed, response(captured))
  for (let attempt = 0; attempt < 100 && captured.status === 0; attempt += 1) {
    await new Promise(resolve => { setTimeout(resolve, 10) })
  }
  expect(captured.status).toBe(502)

  const broken = Object.assign(Readable.from([Buffer.from('no-es-json')]), {
    headers: { authorization: `Bearer ${TOKEN}`, [MIRROR_KEY_HEADER]: KEY, 'x-faberloom-mirror-action': 'apply' },
    get: function (name) { return this.headers[name.toLowerCase()] },
  })
  const refused = { status: 0, body: {} }
  app.handler?.(broken, response(refused))
  for (let attempt = 0; attempt < 100 && refused.status === 0; attempt += 1) {
    await new Promise(resolve => { setTimeout(resolve, 10) })
  }
  expect(refused.status).toBe(400)
})

it('prefers the per-owner key file over the deployment-wide credential', () => {
  const root = mkdtempSync(join(tmpdir(), 'mirror-route-'))
  roots.push(root)
  const options = { resolveOwner: () => OWNER, dataDir: root, mirrorKey: 'despliegue' }
  expect(resolveMirrorKey(options, OWNER)).toBe('despliegue')
  mkdirSync(join(root, OWNER.id), { recursive: true })
  writeFileSync(join(root, OWNER.id, '.mirror-key'), 'del-propietario\n')
  expect(resolveMirrorKey(options, OWNER)).toBe('del-propietario')
  expect(mirrorSocketPath(options, OWNER)).toBe(join(root, OWNER.id, 'faberloom-mcp.sock'))
})

it('generates a key that does not repeat', () => {
  const first = generateMirrorKey()
  expect(first).toHaveLength(64)
  expect(first).not.toBe(generateMirrorKey())
})

it.skipIf(IS_WINDOWS)('forwards one call to the owner socket with the internal credential', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mirror-route-'))
  roots.push(root)
  const received = []
  const server = createServer((incoming, outgoing) => {
    let text = ''
    incoming.setEncoding('utf8')
    incoming.on('data', chunk => { text += chunk })
    incoming.on('end', () => {
      received.push({
        url: incoming.url,
        key: incoming.headers[MIRROR_KEY_HEADER],
        body: text === '' ? undefined : JSON.parse(text),
      })
      outgoing.writeHead(200, { 'content-type': 'application/json' })
      outgoing.end(JSON.stringify(toolAnswer({ document: { version: 1, platform: 'web', domains: {}, skills: {} } })))
    })
  })
  await new Promise(resolve => server.listen(join(root, 'faberloom-mcp.sock'), resolve))
  servers.push(server)

  const answer = await forwardToOwner(
    { resolveOwner: () => OWNER, dataDir: root, mirrorKey: KEY, timeoutMs: 5000 },
    { email: OWNER.email, id: '' },
    KEY,
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'faberloom_mirror_export', arguments: {} } },
  )
  expect(answer.status).toBe(200)
  expect(received[0]?.url).toBe('/mcp')
  expect(received[0]?.key).toBe(KEY)
  expect(received[0]?.body).toMatchObject({ method: 'tools/call' })
})

it.skipIf(IS_WINDOWS)('answers a pull with the owner document and an apply with what landed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mirror-route-'))
  roots.push(root)
  const document = { version: 1, platform: 'web', domains: { faberloom_grants: { tables: { grants: {} } } }, skills: {} }
  const server = createServer((incoming, outgoing) => {
    let text = ''
    incoming.setEncoding('utf8')
    incoming.on('data', chunk => { text += chunk })
    incoming.on('end', () => {
      const parsed = JSON.parse(text)
      outgoing.writeHead(200, { 'content-type': 'application/json' })
      if (parsed.params.name === 'faberloom_mirror_apply') {
        outgoing.end(JSON.stringify(toolAnswer({
          applied: [{ domain: 'faberloom_grants', table: 'grants', key: 'g1' }],
          skillsApplied: [],
          skipped: [],
        })))
        return
      }
      outgoing.end(JSON.stringify(toolAnswer({ document, skipped: [] })))
    })
  })
  await new Promise(resolve => server.listen(join(root, 'faberloom-mcp.sock'), resolve))
  servers.push(server)

  const app = new FakeApp()
  installMirrorRoute(app, { resolveOwner: token => (token === TOKEN ? OWNER : undefined), dataDir: root, mirrorKey: KEY, log: false })
  const pulled = await dispatch(app, request({ token: TOKEN, key: KEY }))
  expect(pulled.status).toBe(200)
  expect(pulled.body).toMatchObject({ version: 1, platform: 'web' })

  const applied = await dispatch(app, request({ token: TOKEN, key: KEY, action: 'apply', body: document }))
  expect(applied.status).toBe(200)
  expect(applied.body.applied).toEqual([{ domain: 'faberloom_grants', table: 'grants', key: 'g1' }])
})
