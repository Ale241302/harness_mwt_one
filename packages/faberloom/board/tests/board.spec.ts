import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomBoard from '../src/index.ts'
import type { FaberLoomBoardItemId } from '../src/index.ts'

/** Boot the storage/domain composition plus the board service. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomBoard)
  return { ctx, board: ctx.faberloomBoard }
}

const OWNER = 'compras2@sondelsa.com'

describe('FaberLoomBoard', () => {
  it('F16 · approving prepares nothing; an effect needs an explicit authorization', async () => {
    const { board } = await harness()
    const item = await board.create(OWNER, { title: 'Proforma Eguisa', summary: 'borrador', evidence: ['mw:price:701414'] })
    expect(item).toMatchObject({ status: 'waiting_approval', version: 1 })
    const approved = await board.review(OWNER, item.id, { decision: 'approve', version: 1 })
    expect(approved.status).toBe('approved')
    expect(approved.approvedRevision).toBe(1)
    expect(approved.effects).toEqual([])

    await expect(board.recordEffect(OWNER, item.id, { ref: 'mail:1' })).rejects.toThrow('NO_AUTHORIZATION')
    const effected = await board.recordEffect(OWNER, item.id, { ref: 'mail:1', authorization: 'user-approved-send', detail: 'enviado' })
    expect(effected.effects).toEqual([{ ref: 'mail:1', detail: 'enviado', authorization: 'user-approved-send', at: expect.any(String) }])
    expect((await board.complete(OWNER, item.id)).status).toBe('completed')
  })

  it('requires real evidence on every revision', async () => {
    const { board } = await harness()
    await expect(board.create(OWNER, { title: 'x', summary: 's', evidence: [] })).rejects.toThrow('NO_EVIDENCE')
    await expect(board.create(OWNER, { title: 'x', summary: 's', evidence: ['  '] })).rejects.toThrow('NO_EVIDENCE')
    const item = await board.create(OWNER, { title: 'x', summary: 's', evidence: ['ev'] })
    await expect(board.submitRevision(OWNER, item.id, { summary: 'v2', evidence: [] })).rejects.toThrow('NO_EVIDENCE')
    await expect(board.submitRevision(OWNER, item.id, { summary: 'v2', evidence: ['ev2'] })).resolves.toMatchObject({ version: 2 })
  })

  it('F05 · approval binds to the exact revision and survives a correction as history', async () => {
    const { board } = await harness()
    const item = await board.create(OWNER, { title: 'x', summary: 'v1', evidence: ['ev'] })
    await board.review(OWNER, item.id, { decision: 'approve', version: 1 })
    const corrected = await board.submitRevision(OWNER, item.id, { summary: 'v2', evidence: ['ev2'] })
    expect(corrected).toMatchObject({ version: 2, status: 'waiting_approval', approvedRevision: 1 })
    await expect(board.review(OWNER, item.id, { decision: 'approve', version: 1 })).rejects.toThrow('STALE_REVISION')
    const approved = await board.review(OWNER, item.id, { decision: 'approve', version: 2 })
    expect(approved.approvedRevision).toBe(2)
  })

  it('F09 · a change after approval goes stale and blocks approval and effects until revalidated', async () => {
    const { board } = await harness()
    const item = await board.create(OWNER, { title: 'x', summary: 'v1', evidence: ['ev'] })
    await board.review(OWNER, item.id, { decision: 'approve', version: 1 })
    const stale = await board.markStale(OWNER, item.id, 'price changed')
    expect(stale).toMatchObject({ stale: true, status: 'needs_review', approvedRevision: null })
    await expect(board.review(OWNER, item.id, { decision: 'approve', version: 1 })).rejects.toThrow('REVALIDATION_REQUIRED')
    await expect(board.recordEffect(OWNER, item.id, { ref: 'mail:1', authorization: 'a' })).rejects.toThrow('REVALIDATION_REQUIRED')
    const revalidated = await board.revalidate(OWNER, item.id, false)
    expect(revalidated).toMatchObject({ stale: false, staleReason: null, status: 'needs_review' })
    const approved = await board.review(OWNER, item.id, { decision: 'approve', version: 1 })
    expect(approved.status).toBe('approved')
  })

  it('walks the exception states and enforces owner-only mutations', async () => {
    const { board } = await harness()
    const item = await board.create(OWNER, { title: 'x', summary: 's', evidence: ['ev'] })
    expect((await board.requestData(OWNER, item.id)).status).toBe('waiting_data')
    expect((await board.fail(OWNER, item.id)).status).toBe('failed')
    expect((await board.reopen(OWNER, item.id)).status).toBe('reopened')
    expect((await board.review(OWNER, item.id, { decision: 'reject', version: 1 })).status).toBe('reopened')

    await expect(board.review('otro', item.id, { decision: 'approve', version: 1 })).rejects.toThrow('only the owner')
    await expect(board.submitRevision('otro', item.id, { summary: 's', evidence: ['e'] })).rejects.toThrow('only the owner')
    await expect(board.recordEffect('otro', item.id, { ref: 'r', authorization: 'a' })).rejects.toThrow('only the owner')
    await expect(board.markStale('otro', item.id, 'x')).rejects.toThrow('only the owner')
    await expect(board.revalidate('otro', item.id, false)).rejects.toThrow('only the owner')
    await expect(board.requestData('otro', item.id)).rejects.toThrow('only the owner')
    await expect(board.complete(OWNER, item.id)).rejects.toThrow('not approved')
    await expect(board.get('missing' as FaberLoomBoardItemId)).rejects.toThrow('not found')
  })

  it('lists items by owner and status', async () => {
    const { board } = await harness()
    const first = await board.create(OWNER, { title: 'a', summary: 's', evidence: ['e'] })
    await board.create('otro', { title: 'b', summary: 's', evidence: ['e'] })
    expect((await board.list({ ownerId: OWNER })).map(item => item.id)).toEqual([first.id])
    expect(await board.list({ status: 'waiting_approval' })).toHaveLength(2)
    expect(await board.list({ ownerId: OWNER, status: 'approved' })).toEqual([])
  })
})
