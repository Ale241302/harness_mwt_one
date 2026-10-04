import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomContext from '../src/index.ts'

const OWNER = { id: 'duenio@sondelsa.com' }
const MEMBER = { id: 'miembro@sondelsa.com' }

/** Boot the storage/domain composition plus the context service, with fakes. */
async function harness(options: { spaceOwner?: string; canIndex?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  if (options.spaceOwner !== undefined) {
    ctx.provide('faberloomSpaces', { get: vi.fn(async () => ({ id: 'sp-1', ownerId: options.spaceOwner })) } as never)
  }
  ctx.provide('faberloomShares', { can: vi.fn(async () => options.canIndex === true) } as never)
  const fiber = await ctx.plugin(FaberLoomContext)
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
