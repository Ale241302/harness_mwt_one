/** What the live agent remembers about one thread, and how a discard closes it. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomConnections from '../src/index.ts'

const OWNER = 'owner@muitowork.com'

/** Boot storage plus the connections service. */
async function harness() {
  const pool = new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomConnections)
  return { connections: ctx.faberloomConnections }
}

describe('mail thread states', () => {
  it('remembers one outcome per thread and mailbox, keyed by the answered message', async () => {
    const { connections } = await harness()
    const written = await connections.rememberMailThread(OWNER, {
      account: '506@muitowork.com',
      threadKey: '<root@example.com>',
      messageKey: '<message@example.com>',
      status: 'drafted',
      draftId: 'draft-1',
    })
    expect(written).toMatchObject({
      account: '506@muitowork.com',
      threadKey: '<root@example.com>',
      messageKey: '<message@example.com>',
      status: 'drafted',
      draftId: 'draft-1',
    })
    expect(await connections.mailThread(OWNER, '506@muitowork.com', '<root@example.com>')).toMatchObject({ status: 'drafted' })
    // Another mailbox keeps its own state for the same thread.
    expect(await connections.mailThread(OWNER, 'alejandro@muitowork.com', '<root@example.com>')).toBeNull()
  })

  it('marks the thread sent when the approved draft leaves through a delivery', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'],
      subject: 'Re: Factura',
      text: 'Adjunto la factura.',
      inReplyTo: '<message@example.com>',
      references: ['<root@example.com>', '<message@example.com>'],
    })
    const current = (await connections.listDrafts(OWNER)).find(entry => entry.id === draft.id)
    const sent = await connections.sendDraft(OWNER, draft.id, current?.updatedAt ?? '', current?.revision ?? '', {
      deliver: async mail => ({ messageId: '<sent@example.com>', accepted: [...mail.to], via: 'test' }),
    })
    expect(sent.status).toBe('sent')
    expect(await connections.mailThread(OWNER, null, '<root@example.com>')).toMatchObject({
      status: 'sent',
      messageKey: '<message@example.com>',
      draftId: draft.id,
    })
  })

  it('marks the thread dismissed in the act of discarding its draft', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'],
      subject: 'Re: Factura',
      text: 'Adjunto la factura.',
      inReplyTo: '<message@example.com>',
      references: ['<root@example.com>', '<message@example.com>'],
    })
    expect(await connections.removeDraft(OWNER, draft.id, 'No hacía falta responder')).toBe(true)
    expect(await connections.mailThread(OWNER, null, '<root@example.com>')).toMatchObject({
      status: 'dismissed',
      messageKey: '<message@example.com>',
      draftId: null,
      reason: 'No hacía falta responder',
    })
  })
})
