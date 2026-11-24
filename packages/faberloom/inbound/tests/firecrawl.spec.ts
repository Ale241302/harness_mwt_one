/**
 * Firecrawl Parse image OCR: the request it builds, the Markdown it returns, and
 * every refusal a deployment must see instead of a broken mail read.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FirecrawlParseError, ocrImageHosted } from '../src/firecrawl.ts'

/** One request the fake Parse endpoint received. */
interface Captured {
  readonly method: string
  readonly path: string
  readonly headers: IncomingHttpHeaders
  readonly body: Buffer
}

/** One multipart form part, decoded. */
interface Part {
  readonly name: string
  readonly filename: string | undefined
  readonly contentType: string | undefined
  readonly data: Buffer
}

/** The endpoint's answer, or undefined to leave the request unanswered. */
type Answer = { readonly status: number; readonly body: string } | undefined

/** A small PNG header; the bytes only have to survive the round trip. */
const image = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const servers: Server[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    server.close()
  }
})

describe('ocrImageHosted', () => {
  it('posts the image to /v2/parse and returns its Markdown', async () => {
    const { base, requests } = await serve(() => ({ status: 200, body: envelope('# Factura\n\nTotal 10') }))

    const markdown = await ocrImageHosted(image, 'factura.png', 'image/png', { apiKey: 'fc-test', apiUrl: base })

    expect(markdown).toBe('# Factura\n\nTotal 10\n')
    const request = first(requests)
    expect(request.method).toBe('POST')
    expect(request.path).toBe('/v2/parse')
    expect(request.headers.authorization).toBe('Bearer fc-test')
    expect(request.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    const parts = partsOf(request)
    const options = part(parts, 'options')
    expect(options.filename).toBeUndefined()
    expect(JSON.parse(options.data.toString('utf8'))).toEqual({ parsers: [{ type: 'image' }], origin: 'faberloom-inbound' })
    const file = part(parts, 'file')
    expect(file.filename).toBe('factura.png')
    expect(file.contentType).toBe('image/png')
    expect(file.data.equals(Buffer.from(image))).toBe(true)
  })

  it('keeps a Markdown that already ends in a newline', async () => {
    const { base } = await serve(() => ({ status: 200, body: envelope('# Uno\n') }))
    expect(await ocrImageHosted(image, 'uno.png', 'image/png', { apiKey: 'fc-test', apiUrl: base })).toBe('# Uno\n')
  })

  it('reads the base URL from FABERLOOM_FIRECRAWL_API_URL', async () => {
    const { base, requests } = await serve(() => ({ status: 200, body: envelope('desde el entorno') }))
    vi.stubEnv('FABERLOOM_FIRECRAWL_API_URL', base)

    expect(await ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test' })).toBe('desde el entorno\n')
    expect(first(requests).path).toBe('/v2/parse')
  })

  it('strips the trailing slash of the configured base URL', async () => {
    const { base, requests } = await serve(() => ({ status: 200, body: envelope('ok') }))
    await ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test', apiUrl: `${base}/` })
    expect(first(requests).path).toBe('/v2/parse')
  })

  it('falls back to the public API when no base URL is configured', async () => {
    vi.stubEnv('FABERLOOM_FIRECRAWL_API_URL', '')
    vi.stubEnv('FIRECRAWL_API_URL', '')
    const fetchMock = vi.fn(() => Promise.resolve(new Response(envelope('hola'), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    expect(await ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test' })).toBe('hola\n')
    const calls = fetchMock.mock.calls as unknown as Array<[string]>
    expect(calls[0]?.[0]).toBe('https://api.firecrawl.dev/v2/parse')
  })

  it('refuses without a key and sends nothing', async () => {
    // The variable must be absent, not empty: an exported empty key is a
    // different deployment state from one that never named a key.
    const previous = process.env.FIRECRAWL_API_KEY
    delete process.env.FIRECRAWL_API_KEY
    try {
      const { base, requests } = await serve(() => ({ status: 200, body: envelope('no debería llegar') }))

      const error = await failure(ocrImageHosted(image, 'foto.png', 'image/png', { apiUrl: base }))

      expect(error).toBeInstanceOf(FirecrawlParseError)
      expect(error.reason).toBe('no-key')
      expect(requests).toHaveLength(0)
    } finally {
      if (previous !== undefined) process.env.FIRECRAWL_API_KEY = previous
    }
  })

  it('uses FIRECRAWL_API_KEY when the config carries none', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc-env')
    const { base, requests } = await serve(() => ({ status: 200, body: envelope('ok') }))

    await ocrImageHosted(image, 'foto.png', 'image/png', { apiUrl: base })

    expect(first(requests).headers.authorization).toBe('Bearer fc-env')
  })

  it('treats a whitespace-only key as absent', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc-env')
    const { base, requests } = await serve(() => ({ status: 200, body: envelope('ok') }))

    await ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: '   ', apiUrl: base })

    expect(first(requests).headers.authorization).toBe('Bearer fc-env')
  })

  it('reports a rejected key', async () => {
    const { base } = await serve(() => ({ status: 401, body: 'not json' }))

    const error = await failure(ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test', apiUrl: base }))

    expect(error.reason).toBe('unauthorized')
    expect(error.message).toContain('HTTP 401')
  })

  it('reports an account out of credits', async () => {
    const { base } = await serve(() => ({ status: 402, body: JSON.stringify({ success: false, error: 'out of credits' }) }))

    const error = await failure(ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test', apiUrl: base }))

    expect(error.reason).toBe('insufficient-credits')
    expect(error.message).toContain('out of credits')
  })

  it('reports a server error without inventing a detail', async () => {
    const { base } = await serve(() => ({ status: 500, body: JSON.stringify({ success: false, error: '' }) }))

    const error = await failure(ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test', apiUrl: base }))

    expect(error.reason).toBe('server')
    expect(error.message).toContain('HTTP 500')
    expect(error.message.endsWith(': ')).toBe(false)
  })

  it('reports any other HTTP refusal as a failed request', async () => {
    const { base } = await serve(() => ({ status: 429, body: JSON.stringify({ success: false, error: 'slow down' }) }))

    const error = await failure(ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test', apiUrl: base }))

    expect(error.reason).toBe('request-failed')
  })

  it('reports a body that is not JSON', async () => {
    const { base } = await serve(() => ({ status: 200, body: 'not json' }))

    const error = await failure(ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test', apiUrl: base }))

    expect(error.reason).toBe('invalid-json')
  })

  it('reports a JSON body that is not the response envelope', async () => {
    const { base } = await serve(() => ({ status: 200, body: 'null' }))

    const error = await failure(ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test', apiUrl: base }))

    expect(error.reason).toBe('invalid-json')
  })

  it('reports a written refusal that came back with HTTP 200', async () => {
    const { base } = await serve(() => ({ status: 200, body: JSON.stringify({ success: false, error: 'bad picture' }) }))

    const error = await failure(ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test', apiUrl: base }))

    expect(error.reason).toBe('request-failed')
    expect(error.message).toContain('bad picture')
  })

  it('reports a refusal that carries no detail', async () => {
    const { base } = await serve(() => ({ status: 200, body: JSON.stringify({ success: false }) }))

    const error = await failure(ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test', apiUrl: base }))

    expect(error.reason).toBe('request-failed')
    expect(error.message.endsWith(': ')).toBe(false)
  })

  it('reports an envelope with no Markdown field', async () => {
    const { base } = await serve(() => ({ status: 200, body: JSON.stringify({ success: true, data: {} }) }))

    const error = await failure(ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test', apiUrl: base }))

    expect(error.reason).toBe('empty')
  })

  it('reports Markdown that is only whitespace', async () => {
    const { base } = await serve(() => ({ status: 200, body: JSON.stringify({ data: { markdown: '   ' } }) }))

    const error = await failure(ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test', apiUrl: base }))

    expect(error.reason).toBe('empty')
  })

  it('accepts an envelope that omits the success flag', async () => {
    const { base } = await serve(() => ({ status: 200, body: JSON.stringify({ data: { markdown: 'texto' } }) }))
    expect(await ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test', apiUrl: base })).toBe('texto\n')
  })

  it('stops waiting at the time bound', async () => {
    const { base } = await serve(() => undefined)

    const error = await failure(ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test', apiUrl: base, timeoutMs: 50 }))

    expect(error.reason).toBe('timeout')
    expect(error.message).toContain('50 ms')
  })

  it('reports an unreachable endpoint instead of throwing the transport error', async () => {
    const cause = new TypeError('fetch failed')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(cause)))

    const error = await failure(ocrImageHosted(image, 'foto.png', 'image/png', { apiKey: 'fc-test' }))

    expect(error.reason).toBe('request-failed')
    expect(error.message).toContain('fetch failed')
    expect(error.cause).toBe(cause)
  })
})

/**
 * Start a local Parse endpoint that records every request.
 * @param answer - the response for one request; undefined leaves it unanswered.
 * @returns the base URL and the captured requests.
 */
async function serve(answer: (body: Buffer) => Answer): Promise<{ base: string; requests: Captured[] }> {
  const requests: Captured[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('end', () => {
      const body = Buffer.concat(chunks)
      requests.push({ method: request.method ?? '', path: request.url ?? '', headers: request.headers, body })
      const reply = answer(body)
      if (reply === undefined) return
      response.writeHead(reply.status, { 'content-type': 'application/json' })
      response.end(reply.body)
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { base: `http://127.0.0.1:${String(port)}`, requests }
}

/**
 * Decode the multipart body of one captured request.
 * @param request - the request the endpoint received.
 * @returns its parts, in the order sent.
 */
function partsOf(request: Captured): Part[] {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(request.headers['content-type'] ?? '')
  if (boundary === null) throw new Error('the request carried no multipart boundary')
  const delimiter = boundary[1] ?? boundary[2] ?? ''
  const parts: Part[] = []
  // latin1 maps every byte 1:1, so the file survives the split unchanged.
  for (const chunk of request.body.toString('latin1').split(`--${delimiter}`).slice(1)) {
    if (chunk.startsWith('--')) continue
    const section = chunk.startsWith('\r\n') ? chunk.slice(2) : chunk
    const split = section.indexOf('\r\n\r\n')
    if (split < 0) continue
    const head = section.slice(0, split)
    const tail = section.slice(split + 4)
    parts.push({
      name: /name="([^"]*)"/i.exec(head)?.[1] ?? '',
      filename: /filename="([^"]*)"/i.exec(head)?.[1],
      contentType: /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim(),
      data: Buffer.from(tail.endsWith('\r\n') ? tail.slice(0, -2) : tail, 'latin1'),
    })
  }
  return parts
}

/**
 * The one request a single call sends.
 * @param requests - every request the endpoint captured.
 * @returns the first request.
 */
function first(requests: readonly Captured[]): Captured {
  const request = requests[0]
  if (request === undefined) throw new Error('the call sent no request')
  return request
}

/**
 * One named part of a multipart body.
 * @param parts - the decoded parts.
 * @param name - the form field name.
 * @returns the part.
 */
function part(parts: readonly Part[], name: string): Part {
  const found = parts.find(candidate => candidate.name === name)
  if (found === undefined) throw new Error(`the call sent no ${name} part`)
  return found
}

/**
 * The Parse success envelope.
 * @param markdown - the text the endpoint read from the image.
 * @returns the JSON body.
 */
function envelope(markdown: string): string {
  return JSON.stringify({ success: true, data: { markdown } })
}

/**
 * Await a call that must fail, keeping the typed error.
 * @param promise - the call under test.
 * @returns the typed rejection.
 */
async function failure(promise: Promise<unknown>): Promise<FirecrawlParseError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof FirecrawlParseError) return error
    throw error
  }
  throw new Error('the call was expected to fail')
}
