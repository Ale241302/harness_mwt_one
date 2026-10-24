/**
 * The home store on its own: the medium's documents under `<root>`, the open
 * domain that wins over them, and the table surface the traversal reads and
 * writes. These specs pin the shapes a foreign medium can take, everything the
 * store must refuse rather than guess, and the write path that lands a row in a
 * document the medium did not hold.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MirrorHomeStore, renameWithRetry } from '../src/store.ts'
import type { MirrorDomainSource } from '../src/sync.ts'
import { FABERLOOM_MIRROR_FORMAT_VERSION } from '../src/document.ts'
import type { FaberLoomMirrorDocument } from '../src/types.ts'
import { FakeDomains } from './fake-domains.ts'

let home: string | undefined

afterEach(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
  delete process.env.DSH_HOME
})

/** A fresh home with its `storages` directory, and the store over it. */
async function store(facility?: MirrorDomainSource): Promise<{ store: MirrorHomeStore; root: string }> {
  home = await mkdtemp(join(tmpdir(), 'faberloom-mirror-store-'))
  const root = join(home, 'storages')
  await mkdir(root, { recursive: true })
  return {
    store: new MirrorHomeStore({ storagesRoot: root, ...facility === undefined ? {} : { facility } }),
    root,
  }
}

/** Write one document the way the JSON backend would. */
async function writeDocument(root: string, name: string, text: string): Promise<void> {
  await writeFile(join(root, `${name}.json`), text, 'utf8')
}

describe('MirrorHomeStore', () => {
  it('reads a domain from the medium and reports what it cannot read', async () => {
    const { store: homeStore, root } = await store()
    await writeDocument(root, 'faberloom_spaces', JSON.stringify({
      unit: { name: 'faberloom_spaces', version: 5 },
      global: { seen: true },
      tables: {
        spaces: { s1: { id: 's1', title: 'Prueba' } },
        private_notes: { n1: { body: 'no viaja' } },
      },
    }))
    // Every shape the store refuses: not JSON, not an object, no header, a
    // foreign header, a version that is not an integer, tables that are not an
    // object, and a table whose records are not an object.
    await writeDocument(root, 'faberloom_board', '{ esto no es json')
    await writeDocument(root, 'faberloom_agents', '5')
    await writeDocument(root, 'faberloom_workflows', '{"tables":{}}')
    await writeDocument(root, 'faberloom_context', '{"unit":{"name":"otro","version":1},"tables":{}}')
    await writeDocument(root, 'faberloom_memory', '{"unit":{"name":"faberloom_memory","version":"1"},"tables":{}}')
    await writeDocument(root, 'faberloom_routines', '{"unit":{"name":"faberloom_routines","version":1},"tables":[]}')
    await writeDocument(root, 'faberloom_shares', '{"unit":{"name":"faberloom_shares","version":1},"tables":{"grants":[]}}')

    const skipped = await homeStore.load()
    expect(skipped).toEqual([
      { domain: 'faberloom_agents', table: '*', reason: 'malformed-medium' },
      { domain: 'faberloom_board', table: '*', reason: 'malformed-medium' },
      { domain: 'faberloom_routines', table: '*', reason: 'malformed-medium' },
      { domain: 'faberloom_memory', table: '*', reason: 'malformed-medium' },
      { domain: 'faberloom_workflows', table: '*', reason: 'malformed-medium' },
      { domain: 'faberloom_context', table: '*', reason: 'malformed-medium' },
      { domain: 'faberloom_shares', table: '*', reason: 'malformed-medium' },
    ])
    expect(homeStore.get('faberloom_board')).toBeUndefined()
    expect(homeStore.get('faberloom_agents')).toBeUndefined()

    // The one document it can read answers every table the mirror carries, and
    // nothing else: a table the medium holds but the mirror does not carry is
    // not reachable through this store.
    const spaces = homeStore.get('faberloom_spaces')
    expect(spaces?.table('spaces').get('s1')).toEqual({ id: 's1', title: 'Prueba' })
    expect([...(spaces?.table('spaces').keys() ?? [])]).toEqual(['s1'])
    expect(spaces?.table('spaces').size).toBe(1)
    expect([...(spaces?.table('spaces').entries() ?? [])]).toEqual([['s1', { id: 's1', title: 'Prueba' }]])
    expect(() => spaces?.table('private_notes')).toThrow('does not declare table private_notes')
    expect(homeStore.versionOf('faberloom_spaces')).toBe(5)
    expect(homeStore.versionOf('faberloom_agents')).toBeUndefined()
    expect(homeStore.documentPath('faberloom_spaces')).toBe(join(root, 'faberloom_spaces.json'))
  })

  it('reads and writes the medium documents where the deployment put them', async () => {
    home = await mkdtemp(join(tmpdir(), 'faberloom-mirror-store-defaults-'))
    process.env.DSH_HOME = home
    const configured = new MirrorHomeStore()
    expect(configured.root()).toBe(join(home, 'storages'))
    delete process.env.DSH_HOME
    expect(configured.root()).toBe(join(process.cwd(), 'storages'))
    const overridden = new MirrorHomeStore({ storagesRoot: join(home, 'otro') })
    expect(overridden.root()).toBe(join(home, 'otro'))
  })

  it('creates a document only for a domain the peer stamped and the medium lacks', async () => {
    const domains = new FakeDomains()
    domains.openTable('faberloom_grants', 'grants')
    const { store: homeStore, root } = await store(domains)
    await writeDocument(root, 'faberloom_spaces', JSON.stringify({
      unit: { name: 'faberloom_spaces', version: 5 },
      global: null,
      tables: { spaces: { s1: { id: 's1' } } },
    }))
    const incoming: FaberLoomMirrorDocument = {
      version: FABERLOOM_MIRROR_FORMAT_VERSION,
      platform: 'web',
      domains: {
        // Created: the medium does not hold it and the peer stamped it.
        faberloom_context: { version: 2, tables: {} },
        // Held: the medium's own document wins, so its rows stay.
        faberloom_spaces: { version: 5, tables: {} },
        // Refused: no version, a version that is not a non-negative integer, a
        // domain the mirror does not carry, and a domain the facility holds.
        faberloom_board: { tables: {} },
        faberloom_workflows: { version: -1, tables: {} },
        not_a_product_domain: { version: 1, tables: {} },
        faberloom_grants: { version: 3, tables: {} },
      },
      skills: {},
    }
    homeStore.materialize(incoming)
    // The second call has nothing left to create, which is the same branch a
    // peer's repeat document takes.
    homeStore.materialize(incoming)

    expect(homeStore.versionOf('faberloom_context')).toBe(2)
    expect(homeStore.versionOf('faberloom_board')).toBeUndefined()
    expect(homeStore.versionOf('faberloom_workflows')).toBeUndefined()
    expect(homeStore.get('not_a_product_domain')).toBeUndefined()
    expect(homeStore.versionOf('faberloom_grants')).toBeUndefined()

    const context = homeStore.get('faberloom_context')
    const entries = context?.table('entries')
    await entries?.put('e1', { id: 'e1', title: 'Contexto' })
    const written = JSON.parse(await readFile(join(root, 'faberloom_context.json'), 'utf8')) as {
      unit: { name: string; version: number }
      global: unknown
      tables: Record<string, Record<string, unknown>>
    }
    expect(written.unit).toEqual({ name: 'faberloom_context', version: 2 })
    expect(written.global).toBeNull()
    expect(written.tables['entries']).toEqual({ e1: { id: 'e1', title: 'Contexto' } })

    // A table the mirror carries has no handle until the medium holds it, and
    // the row it wrote is readable again on the next cycle.
    await homeStore.load()
    expect(homeStore.get('faberloom_context')?.table('entries').get('e1')).toEqual({ id: 'e1', title: 'Contexto' })
  })

  it('answers from the open domain when the facility holds one', async () => {
    const domains = new FakeDomains()
    const rows = domains.openTable('faberloom_grants', 'grants')
    await rows.put('g1', { id: 'abierto' })
    // Un dominio que el alcance no lleva no es alcanzable aunque el proceso lo
    // tenga abierto: el registro de Workspaces es local a una maquina.
    domains.openTable('workspace', 'workspaces')
    const { store: homeStore, root } = await store(domains)
    await writeDocument(root, 'faberloom_grants', JSON.stringify({
      unit: { name: 'faberloom_grants', version: 3 },
      global: null,
      tables: { grants: { g1: { id: 'g1' } } },
    }))
    // The facility's domain answers, not the medium's document, and the load
    // does not read a document it does not need: an open domain has no medium
    // version to report either.
    expect(homeStore.get('faberloom_grants')?.table('grants').get('g1')).toEqual({ id: 'abierto' })
    expect(await homeStore.load()).toEqual([])
    expect(homeStore.versionOf('faberloom_grants')).toBeUndefined()
    expect(homeStore.get('faberloom_spaces')).toBeUndefined()
    expect(homeStore.get('workspace')).toBeUndefined()
  })

  it('removes and rewrites one record of a medium document', async () => {
    const { store: homeStore, root } = await store()
    await writeDocument(root, 'faberloom_grants', JSON.stringify({
      unit: { name: 'faberloom_grants', version: 3 },
      global: { seen: true },
      tables: { grants: { g1: { id: 'g1' }, g2: { id: 'g2' } } },
    }))
    await homeStore.load()
    const grants = homeStore.get('faberloom_grants')?.table('grants')
    expect(grants?.delete('ausente')).toBeInstanceOf(Promise)
    expect(await grants?.delete('ausente')).toBe(false)
    expect(await grants?.delete('g2')).toBe(true)
    expect(grants?.size).toBe(1)
    expect(await grants?.update('g1', current => ({ ...(current as { id: string }), role: 'owner' })))
      .toEqual({ id: 'g1', role: 'owner' })
    await expect(grants?.update('nada', current => current)).rejects.toThrow('no record nada in faberloom_grants')
    const written = JSON.parse(await readFile(join(root, 'faberloom_grants.json'), 'utf8')) as {
      global: unknown
      tables: Record<string, Record<string, unknown>>
    }
    // The global the document carried is preserved: the mirror moves rows and
    // leaves the rest of the document alone.
    expect(written.global).toEqual({ seen: true })
    expect(written.tables['grants']).toEqual({ g1: { id: 'g1', role: 'owner' } })
  })

  it('refuses to read a medium it cannot read', async () => {
    const { store: homeStore, root } = await store()
    // A directory where a document belongs is neither a document nor absent:
    // the read fails and the cycle reports it instead of treating it as empty.
    await mkdir(join(root, 'faberloom_spaces.json'))
    await expect(homeStore.load()).rejects.toThrow(/EISDIR|EPERM|EBADF|UNKNOWN/u)
  })

  it('publishes through one write and cleans up a document it could not replace', async () => {
    const { store: homeStore, root } = await store()
    const incoming: FaberLoomMirrorDocument = {
      version: FABERLOOM_MIRROR_FORMAT_VERSION,
      platform: 'web',
      domains: { faberloom_grants: { version: 3, tables: {} } },
      skills: {},
    }
    homeStore.materialize(incoming)
    const grants = homeStore.get('faberloom_grants')?.table('grants')
    await grants?.put('g1', { id: 'g1' })
    // A directory where the document belongs makes the publish fail after the
    // temporary document was written, so the store removes it instead of
    // leaving it behind.
    await rm(join(root, 'faberloom_grants.json'), { force: true })
    await mkdir(join(root, 'faberloom_grants.json'))
    await expect(grants?.put('g2', { id: 'g2' })).rejects.toThrow()
    const names = await readdir(root)
    expect(names.some(name => name.endsWith('.tmp'))).toBe(false)
  })
})

describe('renameWithRetry', () => {
  it('retries a transient Windows refusal and then replaces the file', async () => {
    let calls = 0
    await renameWithRetry('from', 'to', async () => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('busy'), { code: 'EPERM' })
    })
    expect(calls).toBe(2)
  })

  it('stops at a refusal a retry cannot fix', async () => {
    let waited = false
    await expect(renameWithRetry('from', 'to', async () => {
      throw Object.assign(new Error('gone'), { code: 'ENOENT' })
    }, async () => { waited = true })).rejects.toThrow('gone')
    expect(waited).toBe(false)
  })

  it('gives up after the bounded number of attempts', async () => {
    const waits: number[] = []
    let calls = 0
    await expect(renameWithRetry('from', 'to', async () => {
      calls += 1
      throw Object.assign(new Error('locked'), { code: 'EBUSY' })
    }, async (ms) => { waits.push(ms) })).rejects.toThrow('locked')
    expect(calls).toBe(9)
    expect(waits).toHaveLength(8)
  })
})
