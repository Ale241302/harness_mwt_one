/**
 * C-B03.5/C-B03.7: the gateway reports the three rate windows and its MCP 429
 * names the limit it applies. Booting the gateway needs the deployment
 * environment (secrets, console, supervisor), so the window payload is pinned in
 * the shipped source and the MCP error body is exercised directly. The 429
 * status line itself stays asserted by source shape.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import express from 'express'
import { mcpRateLimitError } from './rate-limits.mjs'
import { trustProxyHops } from './trust-proxy.mjs'

const source = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8')

test('C-B03.5 · /healthz publishes the model proxy window beside login and MCP', () => {
  assert.match(source, /loginPerMin: cfg\.loginRateLimitPerMin/u)
  assert.match(source, /mcpPerMin: cfg\.mcpRateLimitPerMin/u)
  assert.match(source, /llmPerMin: LLM_RATE_LIMIT_PER_MIN/u)
})

test('C-B03.7 · the MCP 429 body names the limit it applies', () => {
  assert.deepEqual(mcpRateLimitError(120), {
    code: -32000,
    message: 'demasiadas peticiones (máximo 120 por minuto)',
  })
  assert.match(
    source,
    /res\.status\(429\)\.json\(\{ jsonrpc: '2\.0', id: null, error: mcpRateLimitError\(cfg\.mcpRateLimitPerMin\) \}\)/u,
  )
})

test('C-B03.8 · the gateway trusts a fixed number of proxies, not every hop', () => {
  assert.match(source, /app\.set\('trust proxy', trustProxyHops\(process\.env\.TRUST_PROXY_HOPS\)\)/u)
  assert.doesNotMatch(source, /app\.set\('trust proxy', true\)/u)
  assert.equal(trustProxyHops(undefined), 1)
  assert.equal(trustProxyHops(''), 1)
  assert.equal(trustProxyHops('2'), 2)
  assert.equal(trustProxyHops('0'), 0)
  assert.throws(() => trustProxyHops('two'))
  assert.throws(() => trustProxyHops('-1'))
})

test('C-B03.8 · rotating the client-written address does not move the limiter key', async () => {
  // La cadena de un despliegue Cloudflare -> nginx: el cliente escribe la
  // entrada de la izquierda, Cloudflare añade la del visitante y nginx la del
  // borde del CDN; el gateway ve a nginx como su par de socket.
  const resolve = async (hops, forwarded) => {
    const app = express()
    app.set('trust proxy', trustProxyHops(hops))
    app.get('/', (req, res) => res.json({ ip: req.ip }))
    const server = await new Promise(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
    })
    try {
      const address = server.address()
      const response = await fetch(`http://127.0.0.1:${address.port}/`, {
        headers: { 'x-forwarded-for': forwarded },
      })
      return (await response.json()).ip
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  }

  const chain = forged => `${forged}, 198.51.100.9, 172.70.0.1`
  assert.equal(await resolve('2', chain('203.0.113.77')), '198.51.100.9')
  assert.equal(await resolve('2', chain('203.0.113.78')), '198.51.100.9')
  assert.equal(await resolve('1', chain('203.0.113.77')), '172.70.0.1')
})
