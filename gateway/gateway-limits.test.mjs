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
import { mcpRateLimitError } from './rate-limits.mjs'

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
