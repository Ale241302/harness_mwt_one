import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomSpaces from '../src/index.ts'
import type { FaberLoomSpaceId, SpaceActor } from '../src/index.ts'

/** Boot the real storage/domain composition plus the spaces service. */
async function harness() {
  const pool = new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomSpaces)
  return { ctx, spaces: ctx.faberloomSpaces }
}

const ADMIN: SpaceActor = { id: 'admin@muitowork.com', role: 'admin', companyId: undefined, readOnly: false }
const SONDEL: SpaceActor = { id: 'compras2@sondelsa.com', role: 'client_b2b', companyId: 'co-sondel', readOnly: false }
const SONDEL_RO: SpaceActor = { ...SONDEL, readOnly: true }
const SONEPAR: SpaceActor = { id: 'otro@sonepar.com', role: 'client_b2b', companyId: 'co-sonepar', readOnly: false }
const COLLEAGUE: SpaceActor = { id: 'logistica2@sondelsa.com', role: 'client_b2b', companyId: 'co-sondel', readOnly: false }

describe('FaberLoomSpaces', () => {
  it('F01 · creates and lists a client space with no MWT reference', async () => {
    const { spaces } = await harness()
    const studies = await spaces.create(SONDEL, { title: 'Estudios' })
    expect(studies.id).toMatch(/[0-9a-f-]{36}/)
    expect(studies.parentId).toBeUndefined()
    expect(studies.companyId).toBe('co-sondel')
    expect(studies.version).toBe(1)
    expect((await spaces.list(SONDEL)).map(space => space.title)).toEqual(['Estudios'])
    expect(await spaces.list(SONEPAR)).toEqual([])
    expect(await spaces.get(SONDEL, studies.id)).toMatchObject({ title: 'Estudios' })
    await expect(spaces.get(SONDEL, 'missing' as FaberLoomSpaceId)).rejects.toThrow('not found')
  })

  it('creates a sub-space and rejects a missing or unmanageable parent', async () => {
    const { spaces } = await harness()
    const parent = await spaces.create(SONDEL, { title: 'Marluvas' })
    const child = await spaces.create(SONDEL, { title: 'Eguisa', parentId: parent.id })
    expect(child.parentId).toBe(parent.id)
    await expect(spaces.create(SONDEL, { title: 'x', parentId: 'nope' as FaberLoomSpaceId }))
      .rejects.toThrow('parent space nope not found')
    const foreign = await spaces.create(ADMIN, { title: 'Global' })
    await expect(spaces.create(SONDEL, { title: 'y', parentId: foreign.id }))
      .rejects.toThrow('identity cannot manage this space')
  })

  it('stores the responsible agent on the space and shares it across a parent and its sub-space', async () => {
    const { spaces } = await harness()
    const parent = await spaces.create(SONDEL, { title: 'Padre', agentId: 'agent-1' })
    const child = await spaces.create(SONDEL, { title: 'Hijo', parentId: parent.id, agentId: 'agent-1' })
    expect((await spaces.get(SONDEL, parent.id)).agentId).toBe('agent-1')
    expect((await spaces.get(SONDEL, child.id)).agentId).toBe('agent-1')
    expect((await spaces.get(SONDEL, child.id)).parentId).toBe(parent.id)

    expect((await spaces.update(SONDEL, child.id, { agentId: 'agent-2' })).agentId).toBe('agent-2')
    expect((await spaces.update(SONDEL, child.id, { agentId: null })).agentId).toBeUndefined()
  })

  it('remembers space-scoped memory and inherits it into sub-spaces', async () => {
    const { spaces } = await harness()
    const parent = await spaces.create(SONDEL, { title: 'Padre' })
    const child = await spaces.create(SONDEL, { title: 'Hijo', parentId: parent.id })
    await spaces.remember(SONDEL, 'dato del padre', [parent.id])
    await spaces.remember(SONDEL, 'dato solo hijo', [child.id])
    await spaces.remember(SONDEL, 'en los dos', [parent.id, child.id])

    expect((await spaces.listMemory(SONDEL, parent.id)).map(entry => entry.text)).toEqual(['dato del padre', 'en los dos'])
    expect((await spaces.listMemory(SONDEL)).map(entry => entry.text)).toHaveLength(3)
    expect((await spaces.effectiveMemory(SONDEL, child.id)).map(entry => entry.text))
      .toEqual(['dato del padre', 'dato solo hijo', 'en los dos'])

    await spaces.update(SONDEL, child.id, { inheritContext: false })
    expect((await spaces.effectiveMemory(SONDEL, child.id)).map(entry => entry.text))
      .toEqual(['dato solo hijo', 'en los dos'])

    await expect(spaces.effectiveMemory(SONEPAR, child.id)).rejects.toThrow('access denied')
    await expect(spaces.remember(SONEPAR, 'x', [parent.id])).rejects.toThrow('access denied')
  })

  it('F02 · inheritance off omits the parent context; on includes it', async () => {
    const { spaces } = await harness()
    const parent = await spaces.create(SONDEL, { title: 'Marluvas' })
    await spaces.update(SONDEL, parent.id, { context: { catalog: 'marluvas' } })
    const child = await spaces.create(SONDEL, { title: 'Eguisa', parentId: parent.id })

    const inherited = await spaces.effectiveContext(SONDEL, child.id)
    expect(inherited.resolved).toEqual({ catalog: 'marluvas' })
    expect(inherited.sources).toEqual([child.id, parent.id])

    await spaces.update(SONDEL, child.id, { inheritContext: false })
    const isolated = await spaces.effectiveContext(SONDEL, child.id)
    expect(isolated.resolved).toEqual({})
    expect(isolated.sources).toEqual([child.id])
  })

  it('excludes an ancestor explicitly and surfaces conflicts instead of prioritizing', async () => {
    const { spaces } = await harness()
    const parent = await spaces.create(SONDEL, { title: 'Parent' })
    await spaces.update(SONDEL, parent.id, { context: { tone: 'formal', catalog: 'p' } })
    const child = await spaces.create(SONDEL, { title: 'Child', parentId: parent.id })
    await spaces.update(SONDEL, child.id, { context: { tone: 'informal' }, excluded: [parent.id] })

    const excluded = await spaces.effectiveContext(SONDEL, child.id)
    expect(excluded.resolved).toEqual({ tone: 'informal' })
    expect(excluded.excluded).toEqual([parent.id])

    await spaces.update(SONDEL, child.id, { excluded: [] })
    const conflicted = await spaces.effectiveContext(SONDEL, child.id)
    expect(conflicted.conflicts).toEqual([{
      key: 'tone',
      candidates: [
        { spaceId: child.id, value: 'informal' },
        { spaceId: parent.id, value: 'formal' },
      ],
    }])
    expect(conflicted.resolved).toEqual({ catalog: 'p' })
  })

  it('updates title, members, and context; bumps the version; archives', async () => {
    const { spaces } = await harness()
    const space = await spaces.create(SONDEL, { title: 'Draft' })
    const updated = await spaces.update(SONDEL, space.id, { title: 'Marluvas', members: [SONEPAR.id], context: { currency: 'USD' } })
    expect(updated).toMatchObject({ title: 'Marluvas', members: [SONEPAR.id], context: { currency: 'USD' }, version: 2 })
    const archived = await spaces.archive(SONDEL, space.id)
    expect(archived).toMatchObject({ archived: true, version: 3 })
  })

  it('enforces console-role ACL: own spaces writable, tenant scope, and admin override', async () => {
    const { spaces } = await harness()
    const space = await spaces.create(SONDEL, { title: 'Sondel' })

    // A console read-only role still owns and manages its own spaces.
    const own = await spaces.create(SONDEL_RO, { title: 'Propio' })
    expect(own.ownerId).toBe(SONDEL_RO.id)
    expect((await spaces.update(SONDEL_RO, own.id, { title: 'Editado' })).title).toBe('Editado')
    expect((await spaces.archive(SONDEL_RO, own.id)).archived).toBe(true)
    expect(await spaces.remove(SONDEL_RO, own.id)).toBe(true)

    await expect(spaces.effectiveContext(SONEPAR, space.id)).rejects.toThrow('access denied')
    await expect(spaces.resolveWorkdir(SONEPAR, space.id)).rejects.toThrow('access denied')
    await expect(spaces.previewLink(SONEPAR, space.id)).rejects.toThrow('access denied')
    await expect(spaces.get(SONEPAR, space.id)).rejects.toThrow('access denied')

    const members = await spaces.update(SONDEL, space.id, { members: [COLLEAGUE.id, SONEPAR.id] })
    expect(members.members).toEqual([COLLEAGUE.id, SONEPAR.id])
    expect(await spaces.get(COLLEAGUE, space.id)).toMatchObject({ title: 'Sondel' })

    const adminEdited = await spaces.update(ADMIN, space.id, { title: 'Renamed' })
    expect(adminEdited).toMatchObject({ title: 'Renamed', version: 3 })
  })

  it('F37 · personal scope stays isolated per identity', async () => {
    const { spaces } = await harness()
    expect(spaces.personalScope(SONDEL.id)).toEqual({ kind: 'personal', ownerId: SONDEL.id })
    expect(spaces.personalScope(SONEPAR.id)).not.toEqual(spaces.personalScope(SONDEL.id))
  })

  it('resolves an opaque work-directory reference, never a path', async () => {
    const { spaces } = await harness()
    const space = await spaces.create(SONDEL, { title: 'Work' })
    const reference = await spaces.resolveWorkdir(SONDEL, space.id)
    expect(reference.kind).toBe('opaque')
    expect(reference.ref).toMatch(/^fw_[0-9a-f]{16}$/)
    expect(reference.ref).not.toContain('/')
    expect((await spaces.resolveWorkdir(SONDEL, space.id)).ref).toBe(reference.ref)
  })

  it('F41 · previews audience and shared material before linking', async () => {
    const { spaces } = await harness()
    const space = await spaces.create(SONDEL, { title: 'Shared' })
    await spaces.update(SONDEL, space.id, { members: [COLLEAGUE.id], context: { pricing: 'vip' } })
    expect(await spaces.previewLink(SONDEL, space.id)).toEqual({ newlyVisibleTo: [COLLEAGUE.id], sharedContextKeys: ['pricing'] })
  })

  it('registers MWT sources as directives, inherits them, and enforces company scope', async () => {
    const { spaces } = await harness()
    const parent = await spaces.create(SONDEL, { title: 'Marluvas' })
    await spaces.update(SONDEL, parent.id, {
      sources: [{ kind: 'mwt-company', id: 'co-sondel' }, { kind: 'mwt-product', id: 'SKU-1' }],
    })
    const child = await spaces.create(SONDEL, { title: 'Eguisa', parentId: parent.id })

    const context = await spaces.effectiveContext(SONDEL, child.id)
    expect(context.dataSources).toEqual([
      { kind: 'mwt-company', id: 'co-sondel' },
      { kind: 'mwt-product', id: 'SKU-1' },
    ])
    expect(context.directives).toHaveLength(2)
    expect(context.directives[0]).toContain('MWT.ONE')

    await expect(spaces.update(SONDEL, child.id, { sources: [{ kind: 'mwt-company', id: 'co-sonepar' }] }))
      .rejects.toThrow('source company outside the identity scope')
    const adminSet = await spaces.update(ADMIN, child.id, { sources: [{ kind: 'mwt-company', id: 'co-any' }] })
    expect(adminSet.sources).toEqual([{ kind: 'mwt-company', id: 'co-any' }])
  })

  it('attaches, lists, and reads a space file, enforcing ACL and the size cap', async () => {
    const { spaces } = await harness()
    const space = await spaces.create(SONDEL, { title: 'Docs' })
    const content = Buffer.from('hola mundo').toString('base64')
    const file = await spaces.attachFile(SONDEL, space.id, { name: 'nota.txt', mediaType: 'text/plain', contentBase64: content })
    expect(file).toMatchObject({ name: 'nota.txt', mediaType: 'text/plain', size: 10 })
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect((await spaces.listFiles(SONDEL, space.id)).map(entry => entry.name)).toEqual(['nota.txt'])
    expect((await spaces.readFile(SONDEL, file.id)).contentBase64).toBe(content)

    await expect(spaces.listFiles(SONEPAR, space.id)).rejects.toThrow('access denied')
    await expect(spaces.readFile(SONEPAR, file.id)).rejects.toThrow('access denied')
    await expect(spaces.attachFile(SONEPAR, space.id, { name: 'x', mediaType: 'text/plain', contentBase64: '' }))
      .rejects.toThrow('cannot manage')
    await expect(spaces.attachFile(SONDEL, space.id, {
      name: 'big', mediaType: 'text/plain', contentBase64: Buffer.alloc(1_000_001).toString('base64'),
    })).rejects.toThrow('inline limit')
    await expect(spaces.readFile(SONDEL, 'missing-file')).rejects.toThrow('not found')
  })

  it('removes a space permanently with its attached files', async () => {
    const { spaces } = await harness()
    const space = await spaces.create(SONDEL, { title: 'Temporal' })
    const doomed = await spaces.attachFile(SONDEL, space.id, { name: 'nota.txt', mediaType: 'text/plain', contentBase64: Buffer.from('hola').toString('base64') })
    const other = await spaces.create(SONDEL, { title: 'Se queda' })
    const kept = await spaces.attachFile(SONDEL, other.id, { name: 'otro.txt', mediaType: 'text/plain', contentBase64: Buffer.from('queda').toString('base64') })

    expect(await spaces.remove(SONDEL, space.id)).toBe(true)
    expect((await spaces.list(SONDEL)).map(entry => entry.title)).toEqual(['Se queda'])
    await expect(spaces.get(SONDEL, space.id)).rejects.toThrow('not found')
    await expect(spaces.readFile(SONDEL, doomed.id)).rejects.toThrow('not found')
    expect((await spaces.readFile(SONDEL, kept.id)).name).toBe('otro.txt')
    await expect(spaces.remove(SONDEL, space.id)).rejects.toThrow('not found')
  })

  it('real console identity: a read-only client_b2b manages only its own spaces', async () => {
    const { spaces } = await harness()
    const adminSpace = await spaces.create(ADMIN, { title: 'Compartido' })
    const actor: SpaceActor = { id: 'compras2@sondelsa.com', role: 'client_b2b', companyId: 'c588c410-468a-4d54-b676-3bec174eb39d', readOnly: true }
    expect((await spaces.create(actor, { title: 'Propio' })).ownerId).toBe(actor.id)
    await expect(spaces.update(actor, adminSpace.id, { title: 'x' })).rejects.toThrow('cannot manage')
    await expect(spaces.archive(actor, adminSpace.id)).rejects.toThrow('cannot manage')
    await expect(spaces.remove(actor, adminSpace.id)).rejects.toThrow('cannot manage')
  })
})
