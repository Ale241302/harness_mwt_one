/**
 * Authored draft HTML: the markup round-trips through storage, counts toward the
 * approved revision, and supplies the plain text when the body carries no prose.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomConnections from '../src/index.ts'
import { DRAFT_HTML_MAX_CHARS } from '../src/signature.ts'

const OWNER = 'owner@muitowork.com'

/** Boot storage plus the connections service. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomConnections)
  return ctx.faberloomConnections
}

const MARKUP = '<div><p><strong>Hola.</strong></p><p data-email-signature="">Álvaro</p></div>'

describe('authored draft HTML', () => {
  it('round-trips the markup and changes the revision on a markup-only edit', async () => {
    const connections = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Con formato', text: 'Hola.\n\nÁlvaro', html: MARKUP,
    })
    expect(draft.html).toBe(MARKUP)
    expect((await connections.getDraft(OWNER, draft.id))?.html).toBe(MARKUP)

    const restyled = '<div><p><em>Hola.</em></p><p data-email-signature="">Álvaro</p></div>'
    const edited = await connections.updateDraft(OWNER, draft.id, draft.revision, {
      to: draft.to, subject: draft.subject, text: draft.text, html: restyled,
    })

    expect(edited.html).toBe(restyled)
    // A markup edit alone is a new message: the approval hash must move with it.
    expect(edited.revision).not.toBe(draft.revision)
    await expect(connections.updateDraft(OWNER, draft.id, draft.revision, {
      to: draft.to, subject: draft.subject, text: draft.text,
    })).rejects.toMatchObject({ code: 'DRAFT_CHANGED' })
  })

  it('preserves the stored markup when an update omits it', async () => {
    const connections = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Sin cambios', text: 'Hola.', html: MARKUP,
    })

    const edited = await connections.updateDraft(OWNER, draft.id, draft.revision, {
      to: draft.to, subject: 'Otro asunto', text: draft.text,
    })

    expect(edited.html).toBe(MARKUP)
    expect(edited.subject).toBe('Otro asunto')
  })

  it('refuses raw markup above the draft ceiling and accepts the exact limit', async () => {
    const connections = await harness()
    const oversized = 'x'.repeat(DRAFT_HTML_MAX_CHARS + 1)

    await expect(connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Enorme', text: 'Hola.', html: oversized,
    })).rejects.toThrow('faberloom: el HTML del borrador supera el límite de 256 000 caracteres')
    expect(await connections.listDrafts(OWNER)).toEqual([])

    const exact = await connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Al límite', text: 'Hola.', html: 'x'.repeat(DRAFT_HTML_MAX_CHARS),
    })
    expect(exact.html).toHaveLength(DRAFT_HTML_MAX_CHARS)
  })

  it('derives the plain text when only markup is authored', async () => {
    const connections = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'],
      subject: 'Solo HTML',
      text: '   ',
      html: '<p>Álvaro Alfaro</p><p>Muito Work</p>',
    })

    expect(draft.html).toBe('<p>Álvaro Alfaro</p><p>Muito Work</p>')
    expect(draft.text).toBe('Álvaro Alfaro\nMuito Work')
  })

  it('carries the markup back when a revision is restored', async () => {
    const connections = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Original', text: 'Hola.\n\nÁlvaro', html: MARKUP,
    })
    const initial = await connections.recordDraftRevision(OWNER, draft, { source: 'initial' })
    const rewritten = await connections.updateDraft(OWNER, draft.id, draft.revision, {
      to: draft.to, subject: 'Reescrito', text: 'Otra cosa.', html: '<p>Otra cosa.</p>',
    })

    const restored = await connections.restoreDraftRevision(OWNER, draft.id, initial.revision, rewritten.revision)

    expect(restored.draft.html).toBe(MARKUP)
    expect(restored.draft.text).toBe('Hola.\n\nÁlvaro')
    expect(restored.revision.snapshot.html).toBe(MARKUP)
  })
})
