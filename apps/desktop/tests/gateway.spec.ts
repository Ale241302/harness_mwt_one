import { expect, it } from 'vitest'
import { GATEWAY_URL_ENV, resolveGatewayRequest } from '../src/gateway.ts'

it('defers to the stored choice when the environment names nothing', () => {
  expect(resolveGatewayRequest({})).toEqual({ kind: 'none' })
})

it('takes a trimmed deployment override as the gateway origin', () => {
  expect(resolveGatewayRequest({ [GATEWAY_URL_ENV]: ' https://staging.example.test/ ' }))
    .toEqual({ kind: 'override', url: 'https://staging.example.test/' })
})

it.each(['', '   '])('asks for the local harness for a blank override: %o', (value) => {
  expect(resolveGatewayRequest({ [GATEWAY_URL_ENV]: value })).toEqual({ kind: 'local' })
})
