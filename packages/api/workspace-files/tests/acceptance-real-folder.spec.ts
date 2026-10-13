/**
 * Fase 4 acceptance probe: drive the real `workspaceFiles` listing and read
 * verbs against an existing on-disk folder, exactly as the composer's `@` menu
 * and its attach rows reach them.
 *
 * The folder is the Fase 4 acceptance input. It is discovered, never created:
 * the probe self-skips on a host that lacks it (CI), so the suite stays green
 * everywhere while this host pins the real evidence. `DSH_ACCEPTANCE_FOLDER`
 * overrides the discovery when a run needs a different folder.
 *
 * What this file proves, all against the real filesystem:
 * - the root listing returns the folder's direct children only (one level);
 * - a child folder lists on its own, so navigation is lazy per directory;
 * - the entry cap bounds one level and says the level was cut;
 * - a traversal above the root and an absolute directory outside it are refused;
 * - a real text file's bytes and lines come back as they are on disk;
 * - a real image's bytes come back for attachment while text reading refuses it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceFiles, type Config, type WorkspaceFileScope } from '../src/index.ts'

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

/** One mounted service over the acceptance folder, with its own disposal. */
interface Probe {
  readonly endpoint: WorkspaceFiles
  readonly scope: WorkspaceFileScope
}

let probe: Probe
let fiber: Awaited<ReturnType<Context['plugin']>>

beforeEach(async () => {
  const folder = FOLDER
  // skipIf guards the suite; this narrows the type for the body.
  if (folder === undefined) throw new Error('acceptance folder is absent')
  const ctx = new Context()
  fiber = await ctx.plugin(LocalFileSystem, { cwd: folder })
  ctx.provide('sandboxPolicy', {
    workspaceRoot: folder,
    resolve: () => ({ mode: 'workspace-write', workspaceRoot: folder }),
  } as never)
  const caps: Config = { maxBytes: 1_048_576, maxFileBytes: 1_048_576, maxLines: 5000, maxEntries: 2000 }
  probe = {
    endpoint: new WorkspaceFiles(ctx, caps),
    scope: { sessionId: SessionId('acceptance'), workspaceRoot: folder },
  }
})

afterEach(async () => {
  await fiber.dispose()
})

const signal = (): AbortSignal => new AbortController().signal

/** Await an operation expected to fail with a Remote error. */
async function failureOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation
  } catch (error: unknown) {
    const failure = remoteErrorOf(error)
    if (failure === undefined) throw error
    return failure.code
  }
  throw new Error('expected the operation to fail')
}

describe.skipIf(FOLDER === undefined)('Fase 4 acceptance: the real folder through workspaceFiles', () => {
  it('lists the folder\'s direct children only, one level', async () => {
    const folder = FOLDER!
    const listing = await probe.endpoint.list(probe.scope, '.', signal())
    expect(listing.path).toBe('')
    expect(listing.truncated).toBe(false)
    const onDisk = readdirSync(folder, { withFileTypes: true })
    expect(listing.entries.map(entry => entry.name).sort())
      .toEqual(onDisk.map(entry => entry.name).sort())
    // One level: a name never carries a separator, and the nested screenshot
    // under DUA stays out of the root listing.
    expect(listing.entries.every(entry => !entry.name.includes('/') && !entry.name.includes('\\'))).toBe(true)
    const directories = listing.entries.filter(entry => entry.type === 'directory').map(entry => entry.name)
    const files = listing.entries.filter(entry => entry.type === 'file')
    expect(directories).toEqual([
      'DUA', 'Factura 2417-2026', 'Guia 2417-2026', 'OC del Cliente 504802',
      'Packing List Detallado 2417-2026', 'Pago de Impuestos 2417-2026',
      'Proforma 2417-2026', 'SAP 2417-2026',
    ])
    expect(files.map(entry => entry.name).sort())
      .toEqual(['ComprobanteTransferencia407457.pdf', 'plantilla_expediente_llena - copia.csv'])
    expect(files.every(entry => (entry.size ?? 0) > 0)).toBe(true)
  })

  it('lists one child folder on its own, so navigation is lazy per directory', async () => {
    const listing = await probe.endpoint.list(probe.scope, 'DUA', signal())
    expect(listing.path).toBe('DUA')
    expect(listing.truncated).toBe(false)
    expect(listing.entries).toEqual([
      { name: 'Captura de pantalla 2026-05-06 070631.png', type: 'file', size: 177916 },
    ])
  })

  it('bounds one level at the entry cap and says the level was cut', async () => {
    const folder = FOLDER!
    const ctx = new Context()
    const cappedFiber = await ctx.plugin(LocalFileSystem, { cwd: folder })
    ctx.provide('sandboxPolicy', {
      workspaceRoot: folder,
      resolve: () => ({ mode: 'workspace-write', workspaceRoot: folder }),
    } as never)
    const capped = new WorkspaceFiles(ctx, {
      maxBytes: 1_048_576, maxFileBytes: 1_048_576, maxLines: 5000, maxEntries: 3,
    })
    const listing = await capped.list(probe.scope, '.', signal())
    expect(listing.entries).toHaveLength(3)
    expect(listing.truncated).toBe(true)
    await cappedFiber.dispose()
  })

  it('refuses a traversal above the folder and an absolute directory outside it', async () => {
    expect(await failureOf(probe.endpoint.list(probe.scope, '..', signal())))
      .toBe('workspace-file/outside-workspace')
    expect(await failureOf(probe.endpoint.list(probe.scope, 'DUA/../../..', signal())))
      .toBe('workspace-file/outside-workspace')
    // A sibling of the folder (its parent) is a real directory outside the root.
    expect(await failureOf(probe.endpoint.list(probe.scope, dirname(FOLDER!), signal())))
      .toBe('workspace-file/outside-workspace')
  })

  it('reads a real text file\'s bytes and lines exactly as they are on disk', async () => {
    const relative = 'plantilla_expediente_llena - copia.csv'
    const onDisk = readFileSync(join(FOLDER!, relative))
    const bytes = await probe.endpoint.readAll(probe.scope, relative, signal())
    expect(bytes.bytes).toBe(onDisk.byteLength)
    expect(bytes.eof).toBe(true)
    expect(Buffer.from(bytes.data, 'base64').equals(onDisk)).toBe(true)

    const text = await probe.endpoint.read(probe.scope, relative, { offset: 1, limit: 2 }, signal())
    expect(text.lines).toBe(2)
    // Lines keep the file's own terminators; only the comparison strips them.
    const [header, firstRow] = text.text.split('\n').map(line => line.replace(/\r$/, ''))
    expect(header).toBe('SKU o Nombre;Talla (BR/US/UK/EU);Cantidad')
    expect(firstRow).toBe('75BPR29-CLI-MM-E-CPAP;37;10')
  })

  it('returns an image\'s real bytes for attachment and refuses it as text', async () => {
    const relative = join('DUA', 'Captura de pantalla 2026-05-06 070631.png')
    const onDisk = readFileSync(join(FOLDER!, relative))
    const bytes = await probe.endpoint.readAll(probe.scope, relative, signal())
    const data = Buffer.from(bytes.data, 'base64')
    expect(data.byteLength).toBe(onDisk.byteLength)
    expect(data.equals(onDisk)).toBe(true)
    // PNG signature: the attach path carries real image bytes, not a summary.
    expect([...data.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])

    expect(await failureOf(probe.endpoint.read(probe.scope, relative, {}, signal())))
      .toBe('workspace-file/not-text')
  })

  it('names the acceptance folder it actually read', () => {
    // A guard against a stale discovery probing the wrong directory.
    expect(ACCEPTANCE_NAME.test(basename(FOLDER!))).toBe(true)
  })
})
