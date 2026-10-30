/**
 * The mirror over a real medium, through the real Loader: a package-owned
 * `cordis.yml` boots the storage hub, the JSON backend rooted at the home's
 * `storages` directory, the domain form, and the mirror row, with no product
 * service mounted.
 *
 * The case these specs pin is the one that made the mirror blind: a product
 * domain no mounted service has opened reads `domain-not-open` to a traversal
 * that only asks the facility, while its records sit on the medium. The export
 * must carry them, the import must be able to create a document the medium
 * does not hold yet, and a write must leave a document the domain layer opens.
 */

import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as storagePlugin from '@deepseek-ai/dsh-storage'
import * as storageJsonPlugin from '@deepseek-ai/dsh-storage-json'
import * as storageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as mirrorPlugin from '../src/index.ts'
import { FABERLOOM_MIRROR_FORMAT_VERSION, MIRROR_STATUS_FILE } from '../src/index.ts'
import type { FaberLoomMirrorDocument } from '../src/types.ts'

/** Poll a condition up to two seconds, so a spec waits for the boot's own cycle. */
async function waitFor(condition: () => boolean | Promise<boolean>): Promise<boolean> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await condition()) return true
    await new Promise((resolve) => { setTimeout(resolve, 10) })
  }
  return false
}

/** One `single`-layout document exactly as the JSON backend writes it. */
function documentText(name: string, version: number, tables: Record<string, unknown>, global: unknown = null): string {
  return `${JSON.stringify({ unit: { name, version }, global, tables }, null, 2)}\n`
}

let context: Context | undefined
let root: string | undefined
let gateway: Server | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (gateway !== undefined) await new Promise<void>((resolve) => { gateway?.close(() => { resolve() }) })
  gateway = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  root = undefined
  delete process.env.MIRROR_FAKE_GATEWAY
  delete process.env.MIRROR_FAKE_STORAGES
  delete process.env.MIRROR_FAKE_SKILLS
})

/**
 * Boot the composition over a fresh home and answer the storage root it uses.
 * The fake gateway answers an empty document, so the boot's own cycle is a
 * clean pull and the specs below drive every row themselves.
 */
async function boot(): Promise<{ storagesRoot: string; skillsRoot: string; mirror: Context['faberloomMirror'] }> {
  root = await mkdtemp(join(tmpdir(), 'faberloom-mirror-medium-'))
  const storagesRoot = join(root, 'storages')
  const skillsRoot = join(root, 'skills')
  await mkdir(storagesRoot, { recursive: true })
  gateway = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      version: FABERLOOM_MIRROR_FORMAT_VERSION,
      platform: 'web',
      domains: {},
      skills: {},
      applied: [],
      skillsApplied: [],
      skipped: [],
    }))
  })
  await new Promise<void>((resolve) => { gateway?.listen(0, '127.0.0.1', resolve) })
  const address = gateway.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  process.env.MIRROR_FAKE_GATEWAY = `http://127.0.0.1:${String(port)}`
  process.env.MIRROR_FAKE_STORAGES = storagesRoot
  process.env.MIRROR_FAKE_SKILLS = skillsRoot

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, await readFile(new URL('./fixtures/medium-cordis.yml', import.meta.url), 'utf8'))
  const ctx = context = new Context()
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', storagePlugin],
    ['@deepseek-ai/dsh-storage-json', storageJsonPlugin],
    ['@deepseek-ai/dsh-storage-domain', storageDomainPlugin],
    ['@deepseek-ai/dsh-faberloom-mirror', mirrorPlugin],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('Unexpected Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { storagesRoot, skillsRoot, mirror: ctx.faberloomMirror }
}

describe('mirror over a real medium', () => {
  it('exports the rows of a domain no service has opened', async () => {
    const { storagesRoot, mirror } = await boot()
    await writeFile(join(storagesRoot, 'faberloom_spaces.json'), documentText('faberloom_spaces', 5, {
      spaces: { s1: { id: 's1', title: 'Prueba', ownerId: 'compras2@sondelsa.com' } },
      // A table this mirror does not carry: the traversal must ignore it and a
      // later write must not drop it.
      private_notes: { n1: { body: 'no viaja' } },
    }))

    const exported = await mirror.exportDocument()
    expect(exported.document.domains['faberloom_spaces']?.version).toBe(5)
    expect(exported.document.domains['faberloom_spaces']?.tables['spaces']?.['s1']).toEqual({
      deleted: false,
      value: { id: 's1', title: 'Prueba', ownerId: 'compras2@sondelsa.com' },
    })
    // Only the tables the mirror carries are read; the domain's other tables
    // are the medium's business, not the transfer's.
    expect(exported.document.domains['faberloom_spaces']?.tables['private_notes']).toBeUndefined()
  }, 30_000)

  it('creates a document the medium does not hold and keeps what the medium already has', async () => {
    const { storagesRoot, mirror } = await boot()
    const incoming: FaberLoomMirrorDocument = {
      version: FABERLOOM_MIRROR_FORMAT_VERSION,
      platform: 'web',
      domains: {
        faberloom_context: {
          version: 2,
          tables: { entries: { e1: { deleted: false, value: { id: 'e1', title: 'Contexto' } } } },
        },
        faberloom_spaces: {
          version: 5,
          tables: { spaces: { s2: { deleted: false, value: { id: 's2', title: 'SICOP' } } } },
        },
      },
      skills: { 'informe-diario': '# Informe\n\nCuerpo.' },
    }
    const applied = await mirror.importDocument(incoming)
    expect(applied.applied).toEqual([
      { domain: 'faberloom_context', table: 'entries', key: 'e1' },
      { domain: 'faberloom_spaces', table: 'spaces', key: 's2' },
    ])
    expect(applied.skillsApplied).toEqual(['informe-diario'])

    // A domain the medium did not hold is created with the version its owner
    // stamped in the document, because only the medium knows that version.
    const created = JSON.parse(await readFile(join(storagesRoot, 'faberloom_context.json'), 'utf8')) as {
      unit: { name: string; version: number }
      tables: Record<string, Record<string, unknown>>
    }
    expect(created.unit).toEqual({ name: 'faberloom_context', version: 2 })
    expect(created.tables['entries']).toEqual({ e1: { id: 'e1', title: 'Contexto' } })

    // A domain the medium already held keeps its version and gains the row.
    const held = JSON.parse(await readFile(join(storagesRoot, 'faberloom_spaces.json'), 'utf8')) as {
      unit: { version: number }
      tables: Record<string, Record<string, unknown>>
    }
    expect(held.unit.version).toBe(5)
    expect(held.tables['spaces']).toEqual({ s2: { id: 's2', title: 'SICOP' } })
    expect(await readFile(join(process.env['MIRROR_FAKE_SKILLS'] ?? '', 'informe-diario', 'SKILL.md'), 'utf8'))
      .toBe('# Informe\n\nCuerpo.')
  }, 30_000)

  it('writes a document the storage stack opens, and reports a medium it cannot read', async () => {
    const { storagesRoot, mirror } = await boot()
    await mirror.importDocument({
      version: FABERLOOM_MIRROR_FORMAT_VERSION,
      platform: 'web',
      domains: {
        faberloom_grants: {
          version: 3,
          tables: {
            grants: {
              g1: { deleted: false, value: { id: 'g1', action: 'mail.send' } },
              gone: { deleted: true },
            },
          },
        },
      },
      skills: {},
    })
    // Opening the very document the mirror wrote, through the backend that owns
    // it, is what a product domain does on its first open.
    const backend = context?.storage.backend.get('json')
    const unit = await backend?.kv?.open({
      name: 'faberloom_grants',
      version: 3,
      tables: ['grants'],
      hasGlobal: false,
    })
    const loaded = await unit?.loadAll()
    expect(loaded?.tables['grants']).toEqual({ g1: { id: 'g1', action: 'mail.send' } })
    await unit?.close()

    // A document the backend cannot parse is named, never guessed: the mirror
    // reports the domain instead of reading it as empty.
    await writeFile(join(storagesRoot, 'faberloom_board.json'), '{ esto no es json')
    const exported = await mirror.exportDocument()
    expect(exported.skipped).toContainEqual({ domain: 'faberloom_board', table: '*', reason: 'malformed-medium' })
    expect(exported.document.domains['faberloom_board']).toBeUndefined()
  }, 30_000)

  it('leaves a status document an operator can read', async () => {
    const { mirror } = await boot()
    const statusPath = join(root ?? '', MIRROR_STATUS_FILE)
    const wrote = await waitFor(() => existsSync(statusPath))
    expect(wrote).toBe(true)
    const status = JSON.parse(await readFile(statusPath, 'utf8')) as Record<string, unknown>
    expect(status).toMatchObject({ enabled: true, active: true, missing: [], owner: 'compras2@sondelsa.com' })
    expect(mirror.statusPath()).toBe(statusPath)
    // The boot's own cycle is recorded, which is what makes a failure visible
    // instead of silent.
    const cycled = await waitFor(async () => {
      const now = JSON.parse(await readFile(statusPath, 'utf8')) as { cycles?: number }
      return (now.cycles ?? 0) >= 1
    })
    expect(cycled).toBe(true)
  }, 30_000)
})
