import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { provisionMcpCredentials } from '../src/mcp-provision.ts'

const reply = (payload: unknown, ok = true): Response => ({ ok, json: async () => payload }) as unknown as Response

it('writes one credential per company and the device id', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
  const request = vi.fn(async () => reply({
    credentials: [
      { key: 'muito-work-limitada', token: 'tok-a', mcp_url: 'https://mcp.mwt.one/device' },
      { key: 'sondel-s-a', token: 'tok-b', mcp_url: 'https://mcp.mwt.one/device' },
    ],
  }))
  const changed = await provisionMcpCredentials(home, 'https://consola.mwt.one/api/', 'sess', 'dev-1', request)

  expect(changed).toBe(true)
  expect(request).toHaveBeenCalledWith('https://consola.mwt.one/api/onboarding/device-token', expect.objectContaining({ method: 'POST' }))
  const text = readFileSync(join(home, '.env'), 'utf8')
  expect(text).toContain('MWT_MCP_COMPANIES=muito-work-limitada,sondel-s-a')
  expect(text).toContain('MWT_MCP_TOKEN_MUITO_WORK_LIMITADA=DeviceToken tok-a')
  expect(text).toContain('MWT_MCP_TOKEN_SONDEL_S_A=DeviceToken tok-b')
  expect(text).toContain('MWT_MCP_URL=https://mcp.mwt.one/device')
  expect(text).toContain('MWT_MCP_DEVICE_ID=dev-1')
})

it('keeps the other lines and drops the single-credential form it replaces', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
  writeFileSync(join(home, '.env'), 'DEEPSEEK_API_KEY=k\nMWT_MCP_AUTHORIZATION=DeviceToken old\n')
  const request = vi.fn(async () => reply({
    credentials: [{ key: 'sondel-s-a', token: 'tok-b', mcp_url: 'https://mcp.mwt.one/device' }],
  }))
  await provisionMcpCredentials(home, 'https://consola.mwt.one/api', 'sess', 'dev-1', request)

  const text = readFileSync(join(home, '.env'), 'utf8')
  expect(text).toContain('DEEPSEEK_API_KEY=k')
  expect(text).not.toContain('MWT_MCP_AUTHORIZATION=')
})

it('does nothing when this device already has its credentials', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
  writeFileSync(join(home, '.env'), 'MWT_MCP_COMPANIES=sondel-s-a\nMWT_MCP_DEVICE_ID=dev-1\n')
  const request = vi.fn(async () => reply({}))
  expect(await provisionMcpCredentials(home, 'https://consola.mwt.one/api', 'sess', 'dev-1', request)).toBe(false)
  expect(request).not.toHaveBeenCalled()
})

it('leaves the layer untouched when the console refuses or the payload is unusable', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
  const refused = vi.fn(async () => reply({ detail: 'no' }, false))
  expect(await provisionMcpCredentials(home, 'https://consola.mwt.one/api', 'sess', 'dev-1', refused)).toBe(false)
  const malformed = vi.fn(async () => reply({ credentials: [{ key: 'BAD KEY', token: 'x', mcp_url: 'https://x' }] }))
  expect(await provisionMcpCredentials(home, 'https://consola.mwt.one/api', 'sess', 'dev-1', malformed)).toBe(false)
  const offline = vi.fn(async () => { throw new Error('offline') })
  expect(await provisionMcpCredentials(home, 'https://consola.mwt.one/api', 'sess', 'dev-1', offline)).toBe(false)
})

it('does nothing without a console session', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
  const request = vi.fn(async () => reply({}))
  expect(await provisionMcpCredentials(home, 'https://consola.mwt.one/api', '', 'dev-1', request)).toBe(false)
  expect(request).not.toHaveBeenCalled()
})
