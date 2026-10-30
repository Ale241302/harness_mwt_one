/**
 * The gateway desktop-MCP bridge: the console token registers a device, a long
 * poll receives one public `/mcp` call, and the posted answer resolves it.
 */

import { afterEach, expect, it } from 'vitest'
import express from 'express'
import { installDesktopMcpBridge } from '../desktop-mcp-route.mjs'

const OWNER = { email: 'compras2@sondelsa.com', id: 'u-1' }
const CONSOLE = 'console-token-1'
const MCP_TOKEN = 'fbl_desktop_token'
const DEVICE = '11111111-1111-4111-8111-111111111111'

const servers = []

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise(resolve => { server.close(() => { resolve() }) })
})

/** Boot one app with the bridge mounted over a real loopback HTTP port. */
async function harness(options = {}) {
  const app = express()
  const bridge = installDesktopMcpBridge(app, {
    resolveOwner: async token => (token === CONSOLE ? OWNER : undefined),
    log: false,
    pollTimeoutMs: 2_000,
    requestTimeoutMs: 2_000,
    offlineAfterMs: 30_000,
    ...options,
  })
  const server = app.listen(0, '127.0.0.1')
  servers.push(server)
  await new Promise(resolve => { server.once('listening', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { bridge, base: `http://127.0.0.1:${String(port)}` }
}

/** POST one JSON body to a bridge endpoint. */
function post(base, path, body, token = CONSOLE) {
  return fetch(`${base}/_/harness/desktop-mcp/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...token.length === 0 ? {} : { authorization: `Bearer ${token}` },
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  })
}

it('refuses a registration without a console token or with an unknown one', async () => {
  const { base } = await harness()
  expect((await post(base, 'register', { deviceId: DEVICE, tokens: [MCP_TOKEN] }, '')).status).toBe(401)
  expect((await post(base, 'register', { deviceId: DEVICE, tokens: [MCP_TOKEN] }, 'otro')).status).toBe(401)
  expect((await post(base, 'register', { deviceId: DEVICE, tokens: 'nope' })).status).toBe(400)
})

it('routes an unregistered token as unknown and a registered token once a poll is waiting', async () => {
  const { bridge, base } = await harness()
  expect(await bridge.route({ token: MCP_TOKEN, body: '{}' })).toBeUndefined()

  const registered = await post(base, 'register', { deviceId: DEVICE, tokens: [MCP_TOKEN] })
  expect(registered.status).toBe(200)
  expect(await registered.json()).toMatchObject({ ok: true, deviceId: DEVICE, tokens: 1 })

  // A poll waits for the public call; the route then hands the request over.
  const poll = post(base, 'poll', { deviceId: DEVICE })
  await new Promise(resolve => { setTimeout(resolve, 50) })
  const routed = bridge.route({ token: MCP_TOKEN, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}', accept: 'application/json' })
  const polled = await poll
  expect(polled.status).toBe(200)
  const payload = await polled.json()
  expect(payload).toMatchObject({
    requestId: expect.any(String),
    body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
    token: MCP_TOKEN,
    accept: 'application/json',
  })

  const answered = await post(base, 'respond', {
    deviceId: DEVICE,
    requestId: payload.requestId,
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: '{"jsonrpc":"2.0","id":1,"result":{}}',
  })
  expect(answered.status).toBe(204)
  await expect(routed).resolves.toMatchObject({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: '{"jsonrpc":"2.0","id":1,"result":{}}',
  })
})

it('queues a call until the next poll and reports an offline device instead of waiting forever', async () => {
  const { bridge, base } = await harness({ offlineAfterMs: 1 })
  await post(base, 'register', { deviceId: DEVICE, tokens: [MCP_TOKEN] })
  await new Promise(resolve => { setTimeout(resolve, 20) })
  await expect(bridge.route({ token: MCP_TOKEN, body: '{}' })).resolves.toEqual({ offline: true })

  const fresh = await harness()
  await post(fresh.base, 'register', { deviceId: DEVICE, tokens: [MCP_TOKEN] })
  const routed = fresh.bridge.route({ token: MCP_TOKEN, body: '{"jsonrpc":"2.0","id":2,"method":"ping"}' })
  const polled = await post(fresh.base, 'poll', { deviceId: DEVICE })
  expect(polled.status).toBe(200)
  const payload = await polled.json()
  await post(fresh.base, 'respond', {
    deviceId: DEVICE,
    requestId: payload.requestId,
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: '{"jsonrpc":"2.0","id":2,"result":{}}',
  })
  await expect(routed).resolves.toMatchObject({ status: 200 })
})

it('does not let one account register or respond for another account\'s device', async () => {
  const { bridge, base } = await harness({
    resolveOwner: async token => (
      token === CONSOLE ? OWNER : token === 'other-console' ? { email: 'otro@sondelsa.com', id: 'u-2' } : undefined
    ),
  })
  await post(base, 'register', { deviceId: DEVICE, tokens: [MCP_TOKEN] })
  expect((await post(base, 'register', { deviceId: DEVICE, tokens: ['otro'] }, 'other-console')).status).toBe(403)
  expect((await post(base, 'poll', { deviceId: DEVICE }, 'other-console')).status).toBe(403)
  expect((await post(base, 'respond', { deviceId: DEVICE, requestId: 'x' }, 'other-console')).status).toBe(403)
  expect(bridge.status().devices).toMatchObject([{ deviceId: DEVICE, owner: OWNER.email, tokens: 1, online: true }])
})
