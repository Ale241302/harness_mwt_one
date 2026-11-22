import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'

/** One fake HTTPS response stream handed to `node:https` requests. */
interface FakeResponse extends Readable {
  statusCode: number
  headers: Record<string, string>
}

const wire = vi.hoisted(() => {
  const responses: FakeResponse[] = []
  const requests: { host?: string; servername?: string; headers?: Record<string, string> }[] = []
  const request = (
    options: { host?: string; servername?: string; headers?: Record<string, string> },
    callback: (response: FakeResponse) => void,
  ) => {
    requests.push(options)
    const pending = new EventEmitter() as EventEmitter & { end: () => void }
    pending.end = () => {
      const next = responses.shift()
      if (next === undefined) {
        queueMicrotask(() => { pending.emit('error', new Error('no fake response')) })
        return
      }
      queueMicrotask(() => { callback(next) })
    }
    return pending
  }
  return { responses, requests, request, lookup: [{ address: '93.184.216.34' }] as { address: string }[] }
})

vi.mock('node:https', () => ({ request: wire.request }))

vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  return { ...actual, request: wire.request }
})

vi.mock('node:dns/promises', () => ({
  lookup: async () => wire.lookup,
}))

interface CapturedTool {
  readonly name: string
  readonly execute: (args: Record<string, unknown>, exec?: Record<string, unknown>) => Promise<unknown>
  readonly output: {
    readonly render: (args: unknown, value: unknown) => readonly { type: string; text?: string }[]
  }
}

/** Boot the product tools over a stub registry and capture the definitions. */
function harness(config: Config, services: Record<string, unknown> = {}): Map<string, CapturedTool> {
  const registered = new Map<string, CapturedTool>()
  const ctx = {
    tools: { register: (definition: CapturedTool) => { registered.set(definition.name, definition); return () => {} } },
    get: (name: string) => services[name],
  }
  apply(ctx as never, config)
  return registered
}

const CONFIG: Config = {
  ownerId: 'multi@muitowork.com',
  role: 'admin',
  companyId: 'ent1',
  companyIds: ['ent1'],
  readOnly: false,
  mcpUrl: 'http://127.0.0.1:1/mcp',
}

/** Build one response stream the mocked HTTPS request hands back. */
function fakeResponse(
  statusCode: number,
  body: string | readonly string[],
  headers: Record<string, string> = {},
): FakeResponse {
  const chunks = typeof body === 'string' ? (body.length === 0 ? [] : [body]) : body
  const stream = Readable.from(chunks.map(chunk => Buffer.from(chunk))) as FakeResponse
  stream.statusCode = statusCode
  stream.headers = headers
  return stream
}

const CONTENT = {
  text: 'Adjunto la orden de compra PO 505433.',
  html: null,
  attachments: [
    { name: 'PO 505433.pdf', mediaType: 'application/pdf', size: 3, contentBase64: Buffer.from('abc').toString('base64') },
  ],
}

const inbound = { readEmail: async () => CONTENT }

describe('faberloom_mail_read attachments', () => {
  it('states why an attachment has no text when conversion is off', async () => {
    const tools = harness(CONFIG, { faberloomInbound: inbound })
    const tool = tools.get('faberloom_mail_read') as unknown as {
      readonly execute: (args: Record<string, unknown>, exec?: Record<string, unknown>) => Promise<unknown>
      readonly output: { render: (args: unknown, value: unknown) => readonly { text?: string }[] }
    }
    const result = await tool.execute({ uid: 1 })
    const text = tool.output.render({}, result)[0]?.text ?? ''
    expect(text).toContain('sin texto extraíble')
    expect(text).toContain('la conversión no está configurada')
  })
})

describe('faberloom_email_draft origin', () => {
  it('keeps the account and Message-ID of the message it answers', async () => {
    const saved: Record<string, unknown>[] = []
    const tools = harness(CONFIG, {
      faberloomInbound: {
        listInbox: async () => [
          { uid: 7, messageId: '<m@x>', from: 'proveedor@eguisa.example', subject: 'OC 4711', date: null, seen: false },
        ],
      },
      faberloomConnections: {
        list: async () => [
          { id: 'c1', kind: 'imap', label: 'Compras', username: '506@muitowork.com', primary: true },
        ],
        saveDraft: async (_owner: string, input: Record<string, unknown>) => {
          saved.push(input)
          return {
            ...input,
            id: 'draft-1',
            revision: 'revision-1',
            cc: input.cc ?? [],
            bcc: input.bcc ?? [],
            attachments: input.attachments ?? [],
            agentSessionId: null,
          }
        },
        signatureFor: async () => null,
        recordDraftRevision: async () => ({ revision: 1 }),
      },
    })
    const tool = tools.get('faberloom_email_draft') as unknown as {
      readonly execute: (args: Record<string, unknown>, exec?: Record<string, unknown>) => Promise<unknown>
    }

    await tool.execute({ to: 'proveedor@eguisa.example', subject: 'Re: OC 4711', text: 'Hola', uid: 7, connectionId: 'c1' }, {})

    expect(saved[0]).toMatchObject({
      account: '506@muitowork.com',
      inReplyTo: '<m@x>',
      references: ['<m@x>'],
    })
  })
})

const servers: Server[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  vi.unstubAllEnvs()
  wire.responses.length = 0
  wire.requests.length = 0
  wire.lookup = [{ address: '93.184.216.34' }]
})

/** A fake console storage endpoint that accepts one upload-proxy post. */
function fakeConsola(): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/storage/upload-proxy/') {
      req.on('data', () => {})
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, key: 'correo/abc/PO 505433.pdf', bucket: 'mwt-one', error: null }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      resolve({ server, base: `http://127.0.0.1:${String(address.port)}` })
    })
  })
}

describe('faberloom mail attachment tools', () => {
  it('reads the body and lists the attachments as text', async () => {
    const tools = harness(CONFIG, { faberloomInbound: inbound })
    const read = tools.get('faberloom_mail_read')
    expect(read).toBeDefined()
    const result = await read!.execute({ uid: 2843 }) as {
      text: string
      attachments: { name: string; mediaType: string; markdown: string; note?: string }[]
    }
    expect(result.text).toContain('PO 505433')
    expect(result.attachments).toEqual([
      { name: 'PO 505433.pdf', mediaType: 'application/pdf', markdown: '', note: 'la conversión no está configurada' },
    ])
  })

  it('saves nothing, and creates no directory, when the named attachment is absent', async () => {
    const tools = harness(CONFIG, { faberloomInbound: inbound })
    const save = tools.get('faberloom_mail_attachment')
    expect(save).toBeDefined()
    const result = await save!.execute({ uid: 2843, name: 'otro.pdf' }) as { files: unknown[] }
    expect(result.files).toEqual([])
  })

  it('writes the original bytes into correo-adjuntos/ under the session cwd, not the process cwd', async () => {
    const tools = harness(CONFIG, { faberloomInbound: inbound })
    const save = tools.get('faberloom_mail_attachment')
    const dir = mkdtempSync(join(tmpdir(), 'mail-attach-'))
    try {
      const exec = { agent: { session: { header: { cwd: dir } } } }
      const result = await save!.execute({ uid: 2843 }, exec) as {
        files: { name: string; path: string; bytes: number }[]
      }
      expect(result.files).toHaveLength(1)
      expect(result.files[0]?.name).toBe('PO 505433.pdf')
      expect(result.files[0]?.bytes).toBe(3)
      expect(result.files[0]?.path).toBe(join(dir, 'correo-adjuntos', 'PO 505433.pdf'))
      expect(existsSync(join(dir, 'correo-adjuntos', 'PO 505433.pdf'))).toBe(true)
      expect(readFileSync(join(dir, 'correo-adjuntos', 'PO 505433.pdf'), 'utf8')).toBe('abc')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses an attachment directory redirected through a symlink', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mail-attachment-junction-'))
    const outside = mkdtempSync(join(tmpdir(), 'mail-attachment-outside-'))
    try {
      symlinkSync(outside, join(dir, 'correo-adjuntos'), process.platform === 'win32' ? 'junction' : 'dir')
      const tools = harness(CONFIG, { faberloomInbound: inbound })
      const save = tools.get('faberloom_mail_attachment')!

      await expect(save.execute({ uid: 2843 }, { agent: { session: { header: { cwd: dir } } } }))
        .rejects.toThrow('MAIL_ATTACHMENT_PATH_UNSAFE')
      expect(existsSync(join(outside, 'PO 505433.pdf'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('never overwrites an existing attachment file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mail-attachment-existing-'))
    try {
      mkdirSync(join(dir, 'correo-adjuntos'))
      const target = join(dir, 'correo-adjuntos', 'PO 505433.pdf')
      writeFileSync(target, 'owner-version')
      const tools = harness(CONFIG, { faberloomInbound: inbound })

      await expect(tools.get('faberloom_mail_attachment')!.execute(
        { uid: 2843 }, { agent: { session: { header: { cwd: dir } } } },
      )).rejects.toThrow('MAIL_ATTACHMENT_EXISTS')
      expect(readFileSync(target, 'utf8')).toBe('owner-version')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('downloads a mail link through the safe writer and refuses to replace its target', async () => {
    wire.responses.push(
      fakeResponse(200, 'downloaded-body', { 'content-type': 'text/plain' }),
      fakeResponse(200, 'downloaded-body', { 'content-type': 'text/plain' }),
    )
    const dir = mkdtempSync(join(tmpdir(), 'mail-download-existing-'))
    try {
      mkdirSync(join(dir, 'correo-adjuntos'))
      const target = join(dir, 'correo-adjuntos', 'download.txt')
      writeFileSync(target, 'owner-version')
      const tools = harness(CONFIG, { faberloomInbound: inbound })
      const download = tools.get('faberloom_mail_download')!

      await expect(download.execute(
        { url: 'https://example.test/download.txt' }, { agent: { session: { header: { cwd: dir } } } },
      )).rejects.toThrow('MAIL_ATTACHMENT_EXISTS')
      expect(readFileSync(target, 'utf8')).toBe('owner-version')

      rmSync(target)
      const result = await download.execute(
        { url: 'https://example.test/download.txt' }, { agent: { session: { header: { cwd: dir } } } },
      ) as { path: string; name: string; bytes: number }
      expect(result).toMatchObject({ path: target, name: 'download.txt', bytes: 15 })
      expect(readFileSync(target, 'utf8')).toBe('downloaded-body')
      // The connection uses the validated address, never a second DNS answer.
      expect(wire.requests.at(-1)).toMatchObject({ host: '93.184.216.34', servername: 'example.test' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('pins a plain http link to the validated address as well', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mail-download-http-'))
    try {
      wire.responses.push(fakeResponse(200, 'plain'))
      const downloadTool = harness(CONFIG, { faberloomInbound: inbound }).get('faberloom_mail_download')!
      const saved = await downloadTool.execute(
        { url: 'http://example.test/plain.txt' }, { agent: { session: { header: { cwd: dir } } } },
      ) as { bytes: number }
      expect(saved.bytes).toBe(5)
      expect(wire.requests.at(-1)).toMatchObject({ host: '93.184.216.34', headers: { host: 'example.test' } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a mail link that points to a private or reserved address', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mail-download-private-'))
    try {
      const downloadTool = harness(CONFIG, { faberloomInbound: inbound }).get('faberloom_mail_download')!
      for (const url of [
        'http://169.254.169.254/latest/meta-data/',
        'http://127.0.0.1/admin',
        'http://10.0.0.5/file',
        'http://172.16.0.1/file',
        'http://192.168.1.1/file',
        'http://100.64.0.1/file',
        'http://224.0.0.1/file',
        'http://0.0.0.0/file',
        'http://[::1]/file',
        'http://[fc00::1]/file',
        'http://[::ffff:127.0.0.1]/file',
        'https://user:secret@93.184.216.34/file',
      ]) {
        await expect(downloadTool.execute({ url }, { agent: { session: { header: { cwd: dir } } } }))
          .rejects.toThrow('MAIL_DOWNLOAD_BLOCKED')
      }
      expect(wire.requests).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('revalidates every redirect and bounds the downloaded body', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mail-download-redirect-'))
    try {
      const downloadTool = harness(CONFIG, { faberloomInbound: inbound }).get('faberloom_mail_download')!
      wire.responses.push(fakeResponse(302, '', { location: 'http://169.254.169.254/latest/meta-data/' }))
      await expect(downloadTool.execute(
        { url: 'https://example.test/redirect' }, { agent: { session: { header: { cwd: dir } } } },
      )).rejects.toThrow('MAIL_DOWNLOAD_BLOCKED')

      wire.responses.push(fakeResponse(200, 'x', { 'content-length': String(21 * 1024 * 1024) }))
      await expect(downloadTool.execute(
        { url: 'https://example.test/huge' }, { agent: { session: { header: { cwd: dir } } } },
      )).rejects.toThrow('MAIL_DOWNLOAD_TOO_LARGE')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses redirect chains with no target, too many hops, and a streamed oversized body', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mail-download-edges-'))
    try {
      const downloadTool = harness(CONFIG, { faberloomInbound: inbound }).get('faberloom_mail_download')!

      wire.responses.push(fakeResponse(302, ''))
      await expect(downloadTool.execute(
        { url: 'https://example.test/no-target' }, { agent: { session: { header: { cwd: dir } } } },
      )).rejects.toThrow('MAIL_DOWNLOAD_BLOCKED')

      for (let hop = 0; hop <= 4; hop += 1) wire.responses.push(fakeResponse(302, '', { location: '/again' }))
      await expect(downloadTool.execute(
        { url: 'https://example.test/loop' }, { agent: { session: { header: { cwd: dir } } } },
      )).rejects.toThrow('too many redirects')

      const chunks = Array.from({ length: 21 }, () => 'x'.repeat(1024 * 1024))
      wire.responses.push(fakeResponse(200, chunks))
      await expect(downloadTool.execute(
        { url: 'https://example.test/stream' }, { agent: { session: { header: { cwd: dir } } } },
      )).rejects.toThrow('MAIL_DOWNLOAD_TOO_LARGE')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports invalid URL text and saves an empty body as a zero-byte file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mail-download-empty-'))
    try {
      const downloadTool = harness(CONFIG, { faberloomInbound: inbound }).get('faberloom_mail_download')!
      await expect(downloadTool.execute(
        { url: 'https://' }, { agent: { session: { header: { cwd: dir } } } },
      )).rejects.toThrow('not a valid URL')

      wire.responses.push(fakeResponse(200, ''))
      const saved = await downloadTool.execute(
        { url: 'https://example.test/empty', name: 'empty.txt' },
        { agent: { session: { header: { cwd: dir } } } },
      ) as { path: string; bytes: number; mediaType: string }
      expect(saved.bytes).toBe(0)
      expect(saved.mediaType).toBe('application/octet-stream')
      expect(readFileSync(saved.path, 'utf8')).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to save a mail file without a Session workspace', async () => {
    const save = harness(CONFIG, { faberloomInbound: inbound }).get('faberloom_mail_attachment')!
    await expect(save.execute({ uid: 2843 }, {})).rejects.toThrow('MAIL_WORKSPACE_UNAVAILABLE')
  })

  it('reports an unavailable Session directory instead of a raw realpath error', async () => {
    const missing = join(tmpdir(), `mail-missing-${String(Date.now())}`)
    const save = harness(CONFIG, { faberloomInbound: inbound }).get('faberloom_mail_attachment')!
    await expect(save.execute({ uid: 2843 }, { agent: { session: { header: { cwd: missing } } } }))
      .rejects.toThrow('MAIL_WORKSPACE_UNAVAILABLE')
  })

  it('refuses duplicate names in one call and rolls back a partial write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mail-attachment-duplicates-'))
    try {
      const duplicate = harness(CONFIG, { faberloomInbound: {
        readEmail: async () => ({
          ...CONTENT,
          attachments: [
            { name: 'same.txt', mediaType: 'text/plain', size: 1, contentBase64: 'QQ==' },
            { name: 'same.txt', mediaType: 'text/plain', size: 1, contentBase64: 'Qg==' },
          ],
        }),
      } }).get('faberloom_mail_attachment')!
      await expect(duplicate.execute({ uid: 2843 }, { agent: { session: { header: { cwd: dir } } } }))
        .rejects.toThrow('MAIL_ATTACHMENT_EXISTS')
      expect(existsSync(join(dir, 'correo-adjuntos', 'same.txt'))).toBe(false)

      const partial = harness(CONFIG, { faberloomInbound: {
        readEmail: async () => ({
          ...CONTENT,
          attachments: [
            { name: 'first.txt', mediaType: 'text/plain', size: 1, contentBase64: 'QQ==' },
            { name: `${'x'.repeat(300)}.txt`, mediaType: 'text/plain', size: 1, contentBase64: 'Qg==' },
          ],
        }),
      } }).get('faberloom_mail_attachment')!
      await expect(partial.execute({ uid: 2843 }, { agent: { session: { header: { cwd: dir } } } })).rejects.toThrow()
      expect(existsSync(join(dir, 'correo-adjuntos', 'first.txt'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes where the working-directory service says the Session works now', async () => {
    const original = mkdtempSync(join(tmpdir(), 'mail-workspace-original-'))
    const current = mkdtempSync(join(tmpdir(), 'mail-workspace-current-'))
    try {
      const save = harness(CONFIG, {
        faberloomInbound: inbound,
        workingDirectory: { get: () => current },
      }).get('faberloom_mail_attachment')!
      await save.execute({ uid: 2843 }, { agent: { session: { header: { cwd: original } } } })
      expect(existsSync(join(current, 'correo-adjuntos', 'PO 505433.pdf'))).toBe(true)
      expect(existsSync(join(original, 'correo-adjuntos'))).toBe(false)
    } finally {
      rmSync(original, { recursive: true, force: true })
      rmSync(current, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform === 'win32')('refuses Windows device and trailing-dot attachment names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mail-attachment-device-'))
    try {
      const tools = harness(CONFIG, { faberloomInbound: {
        readEmail: async () => ({
          ...CONTENT,
          attachments: [
            { name: 'CON.txt', mediaType: 'text/plain', size: 3, contentBase64: Buffer.from('abc').toString('base64') },
          ],
        }),
      } })
      const save = tools.get('faberloom_mail_attachment')!

      await expect(save.execute({ uid: 2843 }, { agent: { session: { header: { cwd: dir } } } }))
        .rejects.toThrow('MAIL_ATTACHMENT_PATH_UNSAFE')
      expect(existsSync(join(dir, 'correo-adjuntos', 'CON.txt'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a final attachment target that is a symbolic link', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mail-attachment-file-link-'))
    const outside = join(dir, 'outside.txt')
    try {
      mkdirSync(join(dir, 'correo-adjuntos'))
      writeFileSync(outside, 'outside-owner-version')
      try {
        symlinkSync(outside, join(dir, 'correo-adjuntos', 'PO 505433.pdf'), 'file')
      } catch (error: unknown) {
        // Some Windows hosts disable file symlinks without Developer Mode.
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return
        throw error
      }
      const tools = harness(CONFIG, { faberloomInbound: inbound })

      await expect(tools.get('faberloom_mail_attachment')!.execute(
        { uid: 2843 }, { agent: { session: { header: { cwd: dir } } } },
      )).rejects.toThrow('MAIL_ATTACHMENT_EXISTS')
      expect(readFileSync(outside, 'utf8')).toBe('outside-owner-version')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses the link when no console token is configured', async () => {
    const tools = harness(CONFIG, { faberloomInbound: inbound })
    const link = tools.get('faberloom_mail_attachment_link')
    expect(link).toBeDefined()
    await expect(link!.execute({ uid: 2843 })).rejects.toThrow('no hay token de la consola')
  })

  it('uploads through the console storage without returning the console credential', async () => {
    const fake = await fakeConsola()
    servers.push(fake.server)
    const canary = 'token-canary-never-model-visible'
    vi.stubEnv('CONSOLA_API_BASE', fake.base)
    vi.stubEnv('CONSOLA_TOKEN', canary)
    const tools = harness(CONFIG, { faberloomInbound: inbound })
    const link = tools.get('faberloom_mail_attachment_link')!
    const result = await link.execute({ uid: 2843 }) as { key: string; name: string }
    const rendered = link.output.render({}, result)[0]?.text ?? ''

    expect(result).toEqual({ key: 'correo/abc/PO 505433.pdf', name: 'PO 505433.pdf' })
    expect(JSON.stringify(result)).not.toContain(canary)
    expect(rendered).not.toContain(canary)
    expect(rendered).toContain('correo/abc/PO 505433.pdf')
  })
})
