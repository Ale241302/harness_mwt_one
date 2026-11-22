/** The send refuses a draft that changed after the person reviewed it (effect 8). */
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

describe('sendDraft version guard', () => {
  it('refuses to send a draft edited after the person reviewed it', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, { to: ['a@b.c'], subject: 'Proforma', text: 'Cuerpo revisado' })

    await new Promise(resolve => setTimeout(resolve, 5))
    await connections.updateDraft(OWNER, draft.id, draft.revision, {
      to: ['a@b.c'], subject: 'Proforma', text: 'Cuerpo cambiado',
    })

    await expect(connections.sendDraft(OWNER, draft.id, draft.updatedAt, draft.revision)).rejects.toThrow(/DRAFT_CHANGED/u)
    const after = (await connections.listDrafts(OWNER)).find(entry => entry.id === draft.id)
    expect(after?.status).toBe('draft')
    expect(after?.text).toBe('Cuerpo cambiado')
  })

  it('accepts the current version, so the guard does not block an honest send', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, { to: ['a@b.c'], subject: 'Proforma', text: 'Cuerpo revisado' })
    const current = (await connections.listDrafts(OWNER)).find(entry => entry.id === draft.id)
    expect(current?.updatedAt).toBe(draft.updatedAt)
    // No SMTP connection is stored, so the send fails on the transport: the
    // version guard let it through, which is what this case proves.
    await expect(connections.sendDraft(OWNER, draft.id, current?.updatedAt ?? '', current?.revision ?? ''))
      .rejects.toThrow(/SMTP/u)
  })

  it('refuses when the caller does not state the version it reviewed', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, { to: ['a@b.c'], subject: 'Proforma', text: 'Cuerpo revisado' })

    // Omitting the version is not approving anything: the guard refuses.
    await expect(connections.sendDraft(OWNER, draft.id, undefined as unknown as string))
      .rejects.toThrow(/DRAFT_CHANGED/u)
    const after = (await connections.listDrafts(OWNER)).find(entry => entry.id === draft.id)
    expect(after?.status).toBe('draft')
  })
})
