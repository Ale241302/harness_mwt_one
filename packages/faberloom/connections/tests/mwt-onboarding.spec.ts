import { describe, expect, it, vi } from 'vitest'
import {
  MwtOnboardingError,
  mwtServerName,
  requestMwtDeviceToken,
  signInMwtConsole,
} from '../src/mwt-onboarding.ts'

const BASE = 'https://consola.mwt.one/api'

describe('MWT.ONE desktop onboarding', () => {
  it('signs in and keeps the console token without echoing the password', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      user: { email: 'sondel@example.com', role: 'client_b2b', read_only: false },
      access: 'console-token',
      refresh: 'refresh-token',
    }), { status: 200 }))
    const session = await signInMwtConsole(fetchImpl, BASE, 'sondel', 'secret-value')
    expect(session).toEqual({
      email: 'sondel@example.com',
      role: 'client_b2b',
      readOnly: false,
      token: 'console-token',
      refresh: 'refresh-token',
    })
    const call = fetchImpl.mock.calls[0]
    if (call === undefined) throw new Error('fetch was not called')
    expect(call[0]).toBe(`${BASE}/auth/login/`)
    const raw = call[1]?.body
    if (typeof raw !== 'string') throw new Error('expected a JSON body')
    const body = JSON.parse(raw) as Record<string, unknown>
    expect(body['usuario']).toBe('sondel')
    expect(body['password']).toBe('secret-value')
  })

  it('reports a refused sign-in without the password', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('nope', { status: 401 }))
    await expect(signInMwtConsole(fetchImpl, BASE, 'sondel', 'secret-value'))
      .rejects.toBeInstanceOf(MwtOnboardingError)
    await expect(signInMwtConsole(fetchImpl, BASE, 'sondel', 'secret-value'))
      .rejects.not.toThrow(/secret-value/u)
  })

  it('requests device credentials and keeps only usable rows', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      device_id: 'device-1',
      credentials: [
        { key: 'sondel-s-a', name: 'Sondel S.A.', token: 'device-token', mcp_url: 'https://mcp.mwt.one/device' },
        { key: 'bad key', token: 'x', mcp_url: 'https://mcp.mwt.one/device' },
        { key: 'no-token', token: '', mcp_url: 'https://mcp.mwt.one/device' },
        { key: 'no-url', token: 't', mcp_url: 'not-a-url' },
      ],
    }), { status: 200 }))
    const credentials = await requestMwtDeviceToken(fetchImpl, BASE, 'console-token', 'device-1')
    expect(credentials).toEqual([{ key: 'sondel-s-a', name: 'Sondel S.A.', token: 'device-token', mcpUrl: 'https://mcp.mwt.one/device' }])
    const call = fetchImpl.mock.calls[0]
    if (call === undefined) throw new Error('fetch was not called')
    expect(call[0]).toBe(`${BASE}/onboarding/device-token`)
    expect((call[1]?.headers as Record<string, string>)['authorization']).toBe('Bearer console-token')
  })

  it('names one MCP server per company', () => {
    expect(mwtServerName('sondel-s-a')).toBe('mwt-sondel-s-a')
  })
})
