/** Remote body images are fetched by the Host, never by the sender-facing frame. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FaberLoomViewService } from '../src/index.ts'

const OWNER = 'owner@muitowork.com'

/** The smallest context the service needs to resolve its owner identity. */
function service(): FaberLoomViewService {
  const ctx = {
    reflect: { provide: () => {} },
    effect: () => () => {},
    on: () => () => {},
    logger: { warn: vi.fn(), info: vi.fn() },
    get: () => undefined,
  } as never
  return new FaberLoomViewService(ctx, { ownerId: OWNER, role: 'admin', readOnly: false, anydoc: false })
}

afterEach(() => { vi.restoreAllMocks() })

describe('emailImage', () => {
  it('returns the bytes and the declared media type', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png; charset=binary' } }),
    )

    await expect(service().emailImage('https://img.example/a.png'))
      .resolves.toEqual({ mediaType: 'image/png', dataBase64: 'AQID' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('refuses a scheme, a private host, a non-image, and an empty body', async () => {
    const view = service()
    await expect(view.emailImage('no-es-una-url')).rejects.toThrow('not a URL')
    await expect(view.emailImage('ftp://img.example/a.png')).rejects.toThrow('only http and https')
    await expect(view.emailImage('https://127.0.0.1/a.png')).rejects.toThrow('private host')
    await expect(view.emailImage('https://192.168.1.10/a.png')).rejects.toThrow('private host')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    )
    await expect(view.emailImage('https://img.example/a.png')).rejects.toThrow('not an image')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array(), { status: 200, headers: { 'content-type': 'image/png' } }),
    )
    await expect(view.emailImage('https://img.example/a.png')).rejects.toThrow('empty or larger')
  })

  it('reports the server status instead of painting an error page', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('gone', { status: 404, headers: { 'content-type': 'image/png' } }),
    )
    await expect(service().emailImage('https://img.example/missing.png')).rejects.toThrow('404')
  })
})
