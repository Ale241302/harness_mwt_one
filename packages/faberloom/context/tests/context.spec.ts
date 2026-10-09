import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomContext from '../src/index.ts'

const OWNER = { id: 'duenio@sondelsa.com' }
const MEMBER = { id: 'miembro@sondelsa.com' }

/** One console context row used by the import tests. */
interface ConsoleRow {
  id: string
  space_id: string
  author_email: string
  title?: string
  body?: string
  version?: number
  status?: string
}

/** Boot the storage/domain composition plus the context service, with fakes. */
async function harness(options: {
  spaceOwner?: string
  canIndex?: boolean
  console?: boolean
  spaceDenied?: boolean
  spaceReaders?: readonly string[]
} = {}) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  if (options.spaceOwner !== undefined) {
    ctx.provide('faberloomSpaces', {
      get: vi.fn(async (actor: { id: string }) => {
        if (options.spaceDenied === true) throw new Error('faberloom: space access denied')
        if (options.spaceReaders !== undefined && !options.spaceReaders.includes(actor.id)) throw new Error('faberloom: space access denied')
        return { id: 'sp-1', ownerId: options.spaceOwner }
      }),
    } as never)
  }
  ctx.provide('faberloomShares', { can: vi.fn(async () => options.canIndex === true) } as never)
  const fiber = await ctx.plugin(FaberLoomContext, options.console === true ? { consoleBase: 'https://console.test', consoleToken: 'tok' } : {})
  return { ctx, context: ctx.faberloomContext, fiber }
}

describe('FaberLoomContext', () => {
  it('F10 · creates a personal entry, visible only to the author', async () => {
    const { context } = await harness()
    const entry = await context.create(OWNER, { title: 'Reglas', body: 'El precio se consulta.' })
    expect(entry).toMatchObject({ spaceId: null, visibility: 'local', version: 1, authorId: OWNER.id })
    expect((await context.list(OWNER)).map(row => row.id)).toEqual([entry.id])
    expect(await context.list(MEMBER)).toEqual([])
  })

  it('F10 · lists only the entries attached to the requested Space', async () => {
    const { context } = await harness()
    const inA = await context.create(OWNER, { title: 'A', body: 'x', spaceId: 'sp-a' })
    await context.create(OWNER, { title: 'B', body: 'y', spaceId: 'sp-b' })
    await context.create(OWNER, { title: 'Personal', body: 'z' })
    expect((await context.listForSpace(OWNER, 'sp-a')).map(entry => entry.id)).toEqual([inA.id])
    expect(await context.listForSpace(OWNER, 'sp-c')).toEqual([])
  })

  it('F10 · appends versions on update and restores an earlier one', async () => {
    const { context } = await harness()
    const entry = await context.create(OWNER, { title: 'v1', body: 'uno' })
    const updated = await context.update(OWNER, entry.id, { title: 'v2', body: 'dos' })
    expect(updated).toMatchObject({ version: 2, title: 'v2' })
    expect((await context.versions(OWNER, entry.id)).map(row => row.version)).toEqual([2, 1])
    const restored = await context.restore(OWNER, entry.id, 1)
    expect(restored).toMatchObject({ version: 3, title: 'v1', body: 'uno' })
  })

  it('F10 · an owner writes to the shared context and reviews a member contribution', async () => {
    const { context } = await harness({ spaceOwner: OWNER.id })
    const owned = await context.create(OWNER, { title: 'Compartido', body: 'x', spaceId: 'sp-1' })
    expect(owned.visibility).toBe('shared')

    const pending = await context.create(MEMBER, { title: 'Aporta', body: 'y', spaceId: 'sp-1' })
    expect(pending).toMatchObject({ visibility: 'pending', ownerId: OWNER.id })
    const memberView = (await context.list(MEMBER)).map(row => row.id)
    expect(memberView).toContain(pending.id)
    expect(memberView).toContain(owned.id)
    expect((await context.list(OWNER)).map(row => row.id).sort()).toEqual([owned.id, pending.id].sort())

    const approved = await context.approve(OWNER, pending.id)
    expect(approved.visibility).toBe('shared')
    await expect(context.approve(MEMBER, pending.id)).rejects.toThrow('only the Space owner')
  })

  it('F10 · a member with index-context writes shared directly and a member edit returns to pending', async () => {
    const { context } = await harness({ spaceOwner: OWNER.id, canIndex: true })
    const shared = await context.create(MEMBER, { title: 'Directo', body: 'z', spaceId: 'sp-1' })
    expect(shared.visibility).toBe('shared')
    const edited = await context.update(MEMBER, shared.id, { body: 'z2' })
    expect(edited.visibility).toBe('pending')
  })

  it('F10 · rejects an entry back to its author and removes it with its history', async () => {
    const { context } = await harness({ spaceOwner: OWNER.id })
    const pending = await context.create(MEMBER, { title: 'P', body: 'b', spaceId: 'sp-1' })
    expect((await context.reject(OWNER, pending.id)).visibility).toBe('local')
    await context.remove(MEMBER, pending.id)
    expect(await context.list(MEMBER)).toEqual([])
    await expect(context.get(MEMBER, pending.id)).rejects.toThrow('not found')
  })
})

describe('FaberLoomContext console transport', () => {
  it('F11 · publishes a member Space entry and retracts it on removal', async () => {
    const calls: { url: string; method: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method ?? 'GET' })
      return { ok: true, status: 200, json: async () => ({ id: 'c1' }) }
    }))
    const { context } = await harness({ spaceOwner: OWNER.id, console: true })
    const entry = await context.create(MEMBER, { title: 'Aporta', body: 'x', spaceId: 'sp-1' })
    expect(calls[0]).toEqual({ url: 'https://console.test/harness/context/', method: 'POST' })
    // The owner's own entry never crosses hosts.
    await context.create(OWNER, { title: 'Propio', body: 'y', spaceId: 'sp-1' })
    expect(calls).toHaveLength(1)
    await context.approve(OWNER, entry.id)
    expect(calls.at(-1)?.url).toBe('https://console.test/harness/context/c1/')
    await context.remove(OWNER, entry.id)
    expect(calls.at(-1)).toEqual({ url: 'https://console.test/harness/context/c1/', method: 'DELETE' })
  })

  it('F11 · sync imports the console context as pending and prunes it', async () => {
    const incoming: ConsoleRow[] = [
      { id: 'c2', space_id: 'sp-1', author_email: MEMBER.id, title: 'Del invitado', body: 'y', version: 2, status: 'pending' },
      { id: 'c3', space_id: 'sp-1', author_email: MEMBER.id, title: 'Ya compartido', body: 'z', status: 'shared' },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ incoming }) })))
    const { context } = await harness({ spaceOwner: OWNER.id, console: true })
    await context.sync(OWNER.id)
    const rows = await context.list(OWNER)
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Del invitado', visibility: 'pending', authorId: MEMBER.id, spaceId: 'sp-1', version: 2 }),
      expect.objectContaining({ title: 'Ya compartido', visibility: 'shared', version: 1 }),
    ]))
    const pendingEntry = rows.find(entry => entry.title === 'Del invitado')!
    expect((await context.approve(OWNER, pendingEntry.id)).visibility).toBe('shared')
    incoming.length = 0
    await context.sync(OWNER.id)
    expect(await context.list(OWNER)).toEqual([])
  })

  it('F11 · a bare context has no console and a console failure is loud', async () => {
    const bare = await harness({ spaceOwner: OWNER.id })
    await expect(bare.context.sync(OWNER.id)).resolves.toBeUndefined()
    const entry = await bare.context.create(MEMBER, { title: 'x', body: 'y', spaceId: 'sp-1' })
    expect(entry.visibility).toBe('pending')

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const wired = await harness({ spaceOwner: OWNER.id, console: true })
    await expect(wired.context.create(MEMBER, { title: 'x', body: 'y', spaceId: 'sp-1' })).rejects.toThrow('la consola rechazó')
  })

  it('F11 · reads the console from the environment, defaults a row, and keeps createdAt across syncs', async () => {
    vi.stubEnv('CONSOLA_API_BASE', 'https://console.test')
    vi.stubEnv('CONSOLA_TOKEN', 'tok')
    const answers: unknown[] = [
      { ok: true, status: 204 },
      { ok: true, status: 200, json: async () => ({ incoming: [
        { id: 'c4', space_id: 'sp-1', author_email: MEMBER.id, status: 'local' },
      ] }) },
      { ok: true, status: 200, json: async () => ({ incoming: [
        { id: 'c4', space_id: 'sp-1', author_email: MEMBER.id, title: 'Luego', status: 'pending' },
      ] }) },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => answers.shift() ?? { ok: true, status: 200, json: async () => ({}) }))
    // No config: the environment carries the console, and a 204 publish leaves no console id.
    const { context } = await harness({ spaceOwner: OWNER.id })
    const created = await context.create(MEMBER, { title: 'x', body: 'y', spaceId: 'sp-1' })
    expect(created.visibility).toBe('pending')

    await context.sync(OWNER.id)
    const imported = (await context.list(OWNER)).find(row => row.authorId === MEMBER.id && row.spaceId === 'sp-1')!
    expect(imported.visibility).toBe('local')
    expect(imported.title).toBe('')

    await context.sync(OWNER.id)
    const updated = (await context.list(OWNER)).find(row => row.authorId === MEMBER.id && row.spaceId === 'sp-1')!
    expect(updated.title).toBe('Luego')
    expect(updated.createdAt).toBe(imported.createdAt)
    vi.unstubAllEnvs()
  })
})

describe('FaberLoomContext export/import/replace', () => {
  it('exports JSON with versions and imports idempotently', async () => {
    const { context } = await harness()
    const entry = await context.create(OWNER, { title: 'Regla', body: 'Uno' })
    await context.update(OWNER, entry.id, { body: 'Dos' })
    const exported = await context.export(OWNER, { format: 'json' })
    expect(exported.entries).toBe(1)
    const parsed = JSON.parse(exported.content) as { entries: { title: string; versions: unknown[] }[] }
    expect(parsed.entries[0]?.title).toBe('Regla')
    expect(parsed.entries[0]?.versions).toHaveLength(2)

    const other = await harness()
    expect(await other.context.import(OWNER, exported.content)).toEqual({ created: 1, skipped: 0 })
    expect(await other.context.import(OWNER, exported.content)).toEqual({ created: 0, skipped: 1 })
  })

  it('exports Markdown and rejects a malformed payload', async () => {
    const { context } = await harness()
    await context.create(OWNER, { title: 'Regla', body: 'Uno' })
    const exported = await context.export(OWNER, { format: 'markdown' })
    expect(exported.content).toContain('## Regla (v1)')
    expect(exported.filename).toContain('.md')
    await expect(context.import(OWNER, 'not json')).rejects.toThrow('no es JSON válido')
    await expect(context.import(OWNER, JSON.stringify({ schemaVersion: 99 }))).rejects.toThrow('no está soportado')
  })

  it('replaces a Space record wholesale for the owner only', async () => {
    const { context } = await harness({ spaceOwner: OWNER.id })
    await context.create(OWNER, { title: 'A', body: '1', spaceId: 'sp-1' })
    await context.create(OWNER, { title: 'B', body: '1', spaceId: 'sp-1' })
    const after = await context.replace(OWNER, 'sp-1', [{ title: 'A', body: '2' }, { title: 'C', body: '3' }])
    expect(after.map(entry => entry.title).sort()).toEqual(['A', 'C'])
    const rows = await context.list(OWNER)
    expect(rows.find(entry => entry.title === 'A')?.body).toBe('2')
    expect(rows.find(entry => entry.title === 'B')).toBeUndefined()
    await expect(context.replace(MEMBER, 'sp-1', [])).rejects.toThrow('only the Space owner')
  })

  it('refuses to place or replace context in a Space the actor cannot read', async () => {
    const { context } = await harness({ spaceOwner: OWNER.id, spaceDenied: true })
    await expect(context.create(MEMBER, { title: 'x', body: 'y', spaceId: 'sp-1' })).rejects.toThrow('access denied')
    await expect(context.replace(MEMBER, 'sp-1', [{ title: 'x', body: 'y' }])).rejects.toThrow('access denied')
  })

  it('scopes a shared Space entry to the readers of that Space', async () => {
    const { context } = await harness({ spaceOwner: OWNER.id, spaceReaders: [OWNER.id] })
    const shared = await context.create(OWNER, { title: 'Del Space', body: 'x', spaceId: 'sp-1' })
    expect(shared.visibility).toBe('shared')
    expect((await context.list(OWNER)).map(entry => entry.id)).toContain(shared.id)
    expect((await context.list(MEMBER)).map(entry => entry.id)).not.toContain(shared.id)
    expect((await context.export(MEMBER)).entries).toBe(0)
    await expect(context.get(MEMBER, shared.id)).rejects.toThrow('access denied')
  })

  it('imports a payload that repeats a title once', async () => {
    const { context } = await harness()
    const payload = JSON.stringify({ schemaVersion: 1, entries: [
      { title: 'Repetido', body: 'a', spaceId: null },
      { title: 'Repetido', body: 'b', spaceId: null },
    ] })
    expect(await context.import(OWNER, payload)).toEqual({ created: 1, skipped: 1 })
  })
})
