/**
 * Fase 4 acceptance probe, browser half: drive the real `@` reference source
 * against an existing on-disk folder.
 *
 * The discovery half mirrors `packages/api/workspace-files/tests/acceptance-real-folder.spec.ts`:
 * the folder is found, never created, and the suite self-skips without it (CI).
 * `DSH_ACCEPTANCE_FOLDER` overrides the discovery.
 *
 * The Remote face here is a double that reads the real folder, because a Client
 * package test cannot mount the Host service; the host probe pins the real
 * listing endpoint over the same folder, and the two meet at the documented
 * `workspaceFiles` wire type. What this file proves about the `@` menu:
 * - `@` lists the folder's own children, folders before files, one level;
 * - a folder row drills, and the next level lists on its own;
 * - a mention for a path containing spaces is the quoted `@"…"` form;
 * - a traversal above the folder renders the readable refusal row;
 * - an attach row reads a real image's bytes for the composer's attachment intake.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  CandidateRequest, ClientSessionContext, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply, inject } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

/** One workspace directory listing as the Remote returns it. */
interface Listing {
  readonly path: string
  readonly entries: readonly { readonly name: string; readonly type: 'file' | 'directory' | 'other'; readonly size?: number }[]
  readonly truncated: boolean
}

const sid = (value: string): SessionId => value as SessionId
const session: ClientSessionContext = { sessionId: sid('target') }

/** The Fase 4 acceptance folder name as it exists on the author's host. */
const ACCEPTANCE_NAME = /^2417-2026\s+PO 504802$/

/**
 * Locate the acceptance folder: the explicit override when it exists, else the
 * first matching directory under the OneDrive Pictures folder.
 * @returns the folder's absolute path, or undefined when this host has none.
 */
function acceptanceFolder(): string | undefined {
  const override = process.env.DSH_ACCEPTANCE_FOLDER
  if (override !== undefined && override !== '') return existsSync(override) ? override : undefined
  const pictures = join(homedir(), 'OneDrive', 'Pictures')
  if (!existsSync(pictures)) return undefined
  const match = readdirSync(pictures).find(name => ACCEPTANCE_NAME.test(name))
  return match === undefined ? undefined : join(pictures, match)
}

const FOLDER = acceptanceFolder()

function request(query: string, options: { quoted?: boolean; drilled?: boolean } = {}): CandidateRequest {
  return {
    query,
    quoted: options.quoted ?? false,
    position: 'inline',
    drilled: options.drilled ?? false,
    signal: new AbortController().signal,
  }
}

const pick = (source: InputTriggerSource, candidate: Parameters<InputTriggerSource['onPick']>[0]['candidate'], action: 'pick' | 'drill') =>
  source.onPick({
    candidate,
    session,
    position: 'inline',
    via: 'menu',
    action,
    span: { start: 0, end: 1, draftRev: 1 },
  })

/** The refusal codes the double raises, matching the wire error vocabulary. */
type RefusalCode = 'workspace-file/outside-workspace' | 'workspace-file/not-found' | 'workspace-file/not-directory'

/** The `remote.workspaceFiles` double, reading the real folder through Node. */
function remoteOver(folder: string): {
  list: (sessionId: SessionId, path: string, signal?: AbortSignal) => Promise<
    { ok: true; value: Listing } | { ok: false; error: RemoteError }
  >
  readAll: (sessionId: SessionId, path: string, signal?: AbortSignal) => Promise<
    { ok: true; value: { data: string } } | { ok: false; error: RemoteError }
  >
} {
  const refusal = (code: RefusalCode, path: string) => ({ ok: false as const, error: new RemoteError(code, path, { path }) })
  return {
    list: (_sessionId, path) => {
      const target = resolve(folder, path)
      const rel = relative(folder, target)
      if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) return Promise.resolve(refusal('workspace-file/outside-workspace', path))
      if (!existsSync(target)) return Promise.resolve(refusal('workspace-file/not-found', path))
      if (!statSync(target).isDirectory()) return Promise.resolve(refusal('workspace-file/not-directory', path))
      const entries = readdirSync(target, { withFileTypes: true }).map((dirent) => {
        const type = dirent.isDirectory() ? 'directory' as const : dirent.isFile() ? 'file' as const : 'other' as const
        return {
          name: dirent.name,
          type,
          ...type === 'file' ? { size: statSync(join(target, dirent.name)).size } : {},
        }
      })
      return Promise.resolve({
        ok: true as const,
        value: { path: rel === '' ? '' : rel.split(sep).join('/'), entries, truncated: false },
      })
    },
    readAll: (_sessionId, path) => {
      const target = resolve(folder, path)
      const rel = relative(folder, target)
      if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) return Promise.resolve(refusal('workspace-file/outside-workspace', path))
      return Promise.resolve({ ok: true as const, value: { data: readFileSync(target).toString('base64') } })
    },
  }
}

/** One mounted `@` source over the real folder, plus its attach sink. */
async function bench(folder: string): Promise<{
  source: InputTriggerSource
  attach: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  fiber: Awaited<ReturnType<Context['plugin']>>
}> {
  const ctx = new Context()
  ctx.provide('sidebarRight', { openResource: vi.fn() })
  let source: InputTriggerSource | undefined
  ctx.provide('inputTriggers', {
    registerSource(candidate: InputTriggerSource) {
      source = candidate
      return () => { source = undefined }
    },
  })
  class RemoteService extends Service {
    readonly $host = { home: homedir(), isLoopback: true }

    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const remote = remoteOver(folder)
  ctx.provide('remote.fileReferences', { list: () => Promise.resolve({ ok: true, value: [] }) })
  ctx.provide('remote.sessionReferenceResolver', { candidates: () => Promise.resolve({ ok: true, value: [] }) })
  ctx.provide('remote.workspaceFiles', remote)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const attach = vi.fn()
  const notify = vi.fn()
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ byId: { target: { cwd: folder } } }) },
    scope: () => ({
      get: (name: string) => name === 'conversation'
        ? { attachWorkspaceFile: attach, input: { for: () => ({ notify }) } }
        : undefined,
    }),
  })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  if (source === undefined) throw new Error('reference source was not registered')
  return { source, attach, notify, fiber }
}

let mounted: Awaited<ReturnType<typeof bench>>

beforeEach(async () => {
  const folder = FOLDER
  // skipIf guards the suite; this narrows the type for the body.
  if (folder === undefined) throw new Error('acceptance folder is absent')
  mounted = await bench(folder)
})

afterEach(async () => {
  await mounted.fiber.dispose()
})

describe.skipIf(FOLDER === undefined)('Fase 4 acceptance: the real folder in the @ menu', () => {
  it('lists the folder\'s own children for a bare @, folders before files', async () => {
    const rows = await mounted.source.candidates(session, request(''))
    const folders = rows.filter(row => row.drill === true).map(row => row.name).sort()
    expect(folders).toEqual([
      'DUA/', 'Factura 2417-2026/', 'Guia 2417-2026/', 'OC del Cliente 504802/',
      'Packing List Detallado 2417-2026/', 'Pago de Impuestos 2417-2026/',
      'Proforma 2417-2026/', 'SAP 2417-2026/',
    ])
    const names = rows.map(row => row.name)
    expect(names).toContain('ComprobanteTransferencia407457.pdf')
    expect(names).toContain('Attach ComprobanteTransferencia407457.pdf')
    expect(names).toContain('plantilla_expediente_llena - copia.csv')
    // Directories first: no file row precedes the last folder row.
    expect(names.indexOf('DUA/')).toBeLessThan(names.indexOf('ComprobanteTransferencia407457.pdf'))
    // One level only: the nested screenshot under DUA is not in the root list.
    expect(names.some(name => name.includes('Captura'))).toBe(false)
    expect(rows.every(row => row.section === en['section.files'])).toBe(true)
  })

  it('drills one level and quotes a mention whose path contains spaces', async () => {
    const root = await mounted.source.candidates(session, request(''))
    const folder = root.find(row => row.name === 'Factura 2417-2026/')!
    // The drill keeps completion open with the literal path; the spaces force
    // the quoted grammar even though the user opened no quote.
    expect(pick(mounted.source, folder, 'drill')).toEqual({ text: '@"Factura 2417-2026/', continue: true })

    const childRows = await mounted.source.candidates(
      session,
      request('Factura 2417-2026/', { quoted: true, drilled: true }),
    )
    const invoice = childRows.find(row => row.name === 'Invoice 2417-2026.pdf')!
    expect(invoice).toBeDefined()
    expect(pick(mounted.source, invoice, 'pick')).toEqual({
      insert: {
        source: 'reference',
        ref: '@"Factura 2417-2026/Invoice 2417-2026.pdf"',
        label: 'Invoice 2417-2026.pdf',
        appearance: 'file',
        clipboardText: '@"Factura 2417-2026/Invoice 2417-2026.pdf"',
      },
    })
  })

  it('renders the readable refusal for a traversal above the folder', async () => {
    const rows = await mounted.source.candidates(session, request('../anything/'))
    expect(rows).toEqual([{ name: en['listing.error.outsideWorkspace'], section: en['section.files'], note: true }])
    expect(rows[0]?.value).toBeUndefined()
  })

  it('reads a real image\'s bytes through the attach row of a drilled folder', async () => {
    const rows = await mounted.source.candidates(session, request('DUA/'))
    const row = rows.find(entry => entry.name === 'Attach Captura de pantalla 2026-05-06 070631.png')!
    expect(row).toBeDefined()
    expect(pick(mounted.source, row, 'pick')).toBe('handled')
    await vi.waitFor(() => { expect(mounted.attach).toHaveBeenCalledOnce() })
    const onDisk = readFileSync(join(FOLDER!, 'DUA', 'Captura de pantalla 2026-05-06 070631.png'))
    const [name, data] = mounted.attach.mock.calls[0] as [string, Uint8Array]
    expect(name).toBe('Captura de pantalla 2026-05-06 070631.png')
    expect(Buffer.from(data).equals(onDisk)).toBe(true)
    expect([...data.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })
})
