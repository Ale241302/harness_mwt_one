/**
 * Notices replace the automatic emails E1 retires: durable, owner-scoped, and
 * never sent. These specs cover the three properties the replacement needs:
 * persistence, per-owner isolation, and a dedupe key that collapses an unread
 * duplicate instead of piling one row per failure.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomNotices from '../src/index.ts'

const OWNER = 'alvaro@muitowork.com'
const OTHER = 'otra@muitowork.com'

/** Boot the storage/domain composition plus the notices service. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomNotices)
  return { ctx, notices: ctx.faberloomNotices }
}

describe('FaberLoomNotices', () => {
  it('stores a notice and reads it back for its owner', async () => {
    const { notices } = await harness()
    const created = await notices.publish({
      ownerId: OWNER,
      kind: 'routine-review',
      title: 'Una rutina necesita revisión',
      body: 'La ejecución 42 agotó sus intentos.',
      source: 'routine:7',
    })
    expect(created.readAt).toBeNull()
    const listed = await notices.list(OWNER)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.title).toBe('Una rutina necesita revisión')
    expect(await notices.unreadCount(OWNER)).toBe(1)
  })

  it('keeps one owner out of another owner\'s notices', async () => {
    const { notices } = await harness()
    await notices.publish({ ownerId: OWNER, kind: 'share-invitation', title: 'Te compartieron un Space', body: 'enlace' })
    expect(await notices.list(OTHER)).toEqual([])
    expect(await notices.unreadCount(OTHER)).toBe(0)
  })

  it('marks one notice read without touching the rest', async () => {
    const { notices } = await harness()
    const first = await notices.publish({ ownerId: OWNER, kind: 'a', title: 'uno', body: '1' })
    await notices.publish({ ownerId: OWNER, kind: 'b', title: 'dos', body: '2' })
    const read = await notices.markRead(OWNER, first.id)
    expect(read?.readAt).not.toBeNull()
    expect(await notices.unreadCount(OWNER)).toBe(1)
    expect(await notices.markRead(OTHER, first.id)).toBeUndefined()
  })

  it('marks every unread notice read at once', async () => {
    const { notices } = await harness()
    await notices.publish({ ownerId: OWNER, kind: 'a', title: 'uno', body: '1' })
    await notices.publish({ ownerId: OWNER, kind: 'b', title: 'dos', body: '2' })
    expect(await notices.markAllRead(OWNER)).toBe(2)
    expect(await notices.unreadCount(OWNER)).toBe(0)
  })

  it('collapses an unread duplicate with the same dedupe key', async () => {
    const { notices } = await harness()
    const first = await notices.publish({
      ownerId: OWNER,
      kind: 'routine-review',
      title: 'Rutina en revisión',
      body: 'causa: saldo agotado',
      dedupeKey: 'routine:7:balance',
    })
    const second = await notices.publish({
      ownerId: OWNER,
      kind: 'routine-review',
      title: 'Rutina en revisión',
      body: 'causa: saldo agotado',
      dedupeKey: 'routine:7:balance',
    })
    expect(second.id).toBe(first.id)
    expect(await notices.list(OWNER)).toHaveLength(1)

    await notices.markRead(OWNER, first.id)
    const third = await notices.publish({
      ownerId: OWNER,
      kind: 'routine-review',
      title: 'Rutina en revisión',
      body: 'causa: saldo agotado',
      dedupeKey: 'routine:7:balance',
    })
    expect(third.id).not.toBe(first.id)
    expect(await notices.list(OWNER)).toHaveLength(2)
  })

  it('refuses a notice with no owner', async () => {
    const { notices } = await harness()
    await expect(notices.publish({ ownerId: '  ', kind: 'a', title: 't', body: 'b' }))
      .rejects.toThrow(/needs an owner/u)
  })
})
