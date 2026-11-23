/**
 * Remote body images are fetched by the Host under the mail guard: the host is
 * resolved and checked before any connection, the socket is pinned to that
 * address, and a redirect repeats the check.
 */
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { EMAIL_IMAGE_MAX_BYTES, fetchEmailImage } from '../src/email-image.ts'
import type { PublicResponse, ResolvedAddress } from '@deepseek-ai/dsh-faberloom-inbound'

/** One response with a static body. */
function answer(status: number, body: Buffer | string, headers: Record<string, string> = {}): PublicResponse {
  return { status, headers, body: Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body)]) }
}

/** A resolver that answers every host with the same address. */
function resolver(address: string, family = 4) {
  return vi.fn(async () => [{ address, family }] as readonly ResolvedAddress[])
}

describe('fetchEmailImage', () => {
  it('returns the bytes and the declared media type', async () => {
    const send = vi.fn(async (_url: URL, _address: ResolvedAddress) =>
      answer(200, Buffer.from([1, 2, 3]), { 'content-type': 'image/png; charset=binary' }))

    await expect(fetchEmailImage('https://img.example/a.png', { resolve: resolver('93.184.216.34'), send }))
      .resolves.toEqual({ mediaType: 'image/png', dataBase64: 'AQID' })
    expect(send.mock.calls[0]?.[1]).toEqual({ address: '93.184.216.34', family: 4 })
  })

  it('refuses a name that resolves to a private address', async () => {
    const send = vi.fn()
    await expect(fetchEmailImage('https://img.example/a.png', { resolve: resolver('127.0.0.1'), send }))
      .rejects.toThrow('resolves to a private address')
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses a private literal and a non-image answer', async () => {
    await expect(fetchEmailImage('https://192.168.1.10/a.png', { resolve: resolver('93.184.216.34') }))
      .rejects.toThrow('points at a private address')

    const send = vi.fn(async () => answer(200, '<html></html>', { 'content-type': 'text/html' }))
    await expect(fetchEmailImage('https://img.example/a.png', { resolve: resolver('93.184.216.34'), send }))
      .rejects.toThrow('not an image')
  })

  it('refuses a scheme, a missing URL, an empty body and an oversized body', async () => {
    await expect(fetchEmailImage('no-es-una-url')).rejects.toThrow('not a URL')
    await expect(fetchEmailImage('ftp://img.example/a.png')).rejects.toThrow('only http(s) images')

    const empty = vi.fn(async () => answer(200, Buffer.alloc(0), { 'content-type': 'image/png' }))
    await expect(fetchEmailImage('https://img.example/a.png', { resolve: resolver('93.184.216.34'), send: empty }))
      .rejects.toThrow('empty')

    const big = vi.fn(async () => answer(200, '', { 'content-length': String(EMAIL_IMAGE_MAX_BYTES + 1) }))
    await expect(fetchEmailImage('https://img.example/a.png', { resolve: resolver('93.184.216.34'), send: big }))
      .rejects.toThrow(`more than ${String(EMAIL_IMAGE_MAX_BYTES)} bytes`)
  })

  it('follows a redirect while re-checking the destination', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(answer(302, '', { location: 'http://127.0.0.1/a.png' }))
    await expect(fetchEmailImage('https://img.example/go', { resolve: resolver('93.184.216.34'), send }))
      .rejects.toThrow('private address')

    const follows = vi.fn()
      .mockResolvedValueOnce(answer(302, '', { location: '/a.png' }))
      .mockResolvedValueOnce(answer(200, 'img', { 'content-type': 'image/png' }))
    const resolve = resolver('93.184.216.34')
    await expect(fetchEmailImage('https://img.example/go', { resolve, send: follows }))
      .resolves.toEqual({ mediaType: 'image/png', dataBase64: Buffer.from('img').toString('base64') })
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('reports the server status instead of painting an error page', async () => {
    const send = vi.fn(async () => answer(404, 'gone', { 'content-type': 'image/png' }))
    await expect(fetchEmailImage('https://img.example/missing.png', { resolve: resolver('93.184.216.34'), send }))
      .rejects.toThrow('404')
  })
})
