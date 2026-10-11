import { expect, it } from 'vitest'
import { DEFAULT_GATEWAY_URL, resolveGatewayUrl } from '../src/gateway.ts'

it('defaults to the shared gateway', () => {
  expect(resolveGatewayUrl({})).toBe(DEFAULT_GATEWAY_URL)
})

it('accepts a deployment override', () => {
  expect(resolveGatewayUrl({ DSH_DESKTOP_GATEWAY_URL: 'https://staging.example.test/' })).toBe('https://staging.example.test/')
})

it.each(['', '   '])('selects the local harness for a blank override: %o', (value) => {
  expect(resolveGatewayUrl({ DSH_DESKTOP_GATEWAY_URL: value })).toBeUndefined()
})
