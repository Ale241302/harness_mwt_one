import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'

interface CapturedTool {
  readonly name: string
  readonly execute: (args: never, exec?: never) => Promise<never>
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

const CONTENT = {
  text: 'Adjunto la orden de compra PO 505433.',
  html: null,
  attachments: [
    { name: 'PO 505433.pdf', mediaType: 'application/pdf', size: 3, contentBase64: Buffer.from('abc').toString('base64') },
  ],
}

const inbound = { readEmail: async () => CONTENT }

const servers: Server[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  vi.unstubAllEnvs()
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
    const result = await read!.execute({ uid: 2843 } as never) as unknown as {
      text: string
      attachments: { name: string; mediaType: string; markdown: string }[]
    }
    expect(result.text).toContain('PO 505433')
    expect(result.attachments).toEqual([
      { name: 'PO 505433.pdf', mediaType: 'application/pdf', markdown: '' },
    ])
  })

  it('saves nothing, and creates no directory, when the named attachment is absent', async () => {
    const tools = harness(CONFIG, { faberloomInbound: inbound })
    const save = tools.get('faberloom_mail_attachment')
    expect(save).toBeDefined()
    const result = await save!.execute({ uid: 2843, name: 'otro.pdf' } as never) as unknown as { files: unknown[] }
    expect(result.files).toEqual([])
  })

  it('writes the original bytes into correo-adjuntos/ under the session cwd, not the process cwd', async () => {
    const tools = harness(CONFIG, { faberloomInbound: inbound })
    const save = tools.get('faberloom_mail_attachment')
    const dir = mkdtempSync(join(tmpdir(), 'mail-attach-'))
    try {
      const exec = { agent: { session: { header: { cwd: dir } } } }
      const result = await save!.execute({ uid: 2843 } as never, exec as never) as unknown as {
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

  it('refuses the link when no console token is configured', async () => {
    const tools = harness(CONFIG, { faberloomInbound: inbound })
    const link = tools.get('faberloom_mail_attachment_link')
    expect(link).toBeDefined()
    await expect(link!.execute({ uid: 2843 } as never)).rejects.toThrow('no hay token de la consola')
  })

  it('uploads through the console storage and returns the download link', async () => {
    const fake = await fakeConsola()
    servers.push(fake.server)
    vi.stubEnv('CONSOLA_API_BASE', fake.base)
    vi.stubEnv('CONSOLA_TOKEN', 'token-abc')
    const tools = harness(CONFIG, { faberloomInbound: inbound })
    const link = tools.get('faberloom_mail_attachment_link')
    const result = await link!.execute({ uid: 2843 } as never) as unknown as { url: string; key: string; name: string }
    expect(result.key).toBe('correo/abc/PO 505433.pdf')
    expect(result.name).toBe('PO 505433.pdf')
    expect(result.url).toBe(`${fake.base}/storage/download/?key=${encodeURIComponent('correo/abc/PO 505433.pdf')}&token=token-abc`)
  })
})
