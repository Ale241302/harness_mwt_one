/** Durable origin, agent binding, and revision history for owner-approved drafts. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomConnections from '../src/index.ts'
import { connectionsDomainSpec, draftRecord } from '../src/spec.ts'

const OWNER = 'owner@muitowork.com'
const OTHER_OWNER = 'other@muitowork.com'

/** Boot storage plus the connections service over one reusable medium. */
async function harness(pool = new MemoryMediaPool()) {
  const backend = new MemoryStorageBackend(pool)
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', backend)
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const fiber = await ctx.plugin(FaberLoomConnections)
  return {
    connections: ctx.faberloomConnections,
    /** Close the domain and service so the same pool can be reopened. */
    dispose: async () => {
      await facility.closeAll()
      await fiber.dispose()
    },
  }
}

/** One complete version-1 draft, before origin and session metadata existed. */
function legacyDraft() {
  return {
    ownerId: OWNER,
    to: ['legacy@example.com'],
    cc: [],
    bcc: [],
    subject: 'Legacy',
    text: 'Stored before the revision table',
    status: 'draft',
    account: null,
    aiText: null,
    inReplyTo: null,
    references: [],
    attachments: [],
    spaceId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sentAt: null,
  }
}

describe('draft origin and agent binding', () => {
  it('keeps omitted origin fields on update without changing the message revision', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'],
      subject: 'Origin',
      text: 'Same message',
      originUid: 'imap-uid-42',
      originReason: 'reply-requested',
      originMailbox: 'ventas@muitowork.com',
    })

    expect(draft).toMatchObject({
      originUid: 'imap-uid-42',
      originReason: 'reply-requested',
      originMailbox: 'ventas@muitowork.com',
      agentSessionId: null,
    })
    const updated = await connections.updateDraft(OWNER, draft.id, draft.revision, {
      to: draft.to,
      subject: draft.subject,
      text: draft.text,
    })

    expect(updated).toMatchObject({
      originUid: 'imap-uid-42',
      originReason: 'reply-requested',
      originMailbox: 'ventas@muitowork.com',
    })
    expect(updated.revision).toBe(draft.revision)
    expect(await connections.getDraft(OWNER, draft.id)).toEqual(updated)
    expect(await connections.getDraft(OTHER_OWNER, draft.id)).toBeNull()
    expect(await connections.getDraft(OWNER, 'missing')).toBeNull()
  })

  it('allows exactly one first binding when two openings race from an unbound draft', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Concurrent binding', text: 'Message',
    })

    const results = await Promise.allSettled([
      connections.bindDraftSession(OWNER, draft.id, 'session-a', null),
      connections.bindDraftSession(OWNER, draft.id, 'session-b', null),
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(['session-a', 'session-b']).toContain((await connections.getDraft(OWNER, draft.id))?.agentSessionId)
  })

  it('binds only the owner session without changing updatedAt or the message revision', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Binding', text: 'Message',
      originMailbox: 'ventas@muitowork.com',
    })

    const bound = await connections.bindDraftSession(OWNER, draft.id, 'agent-session-1', null)

    expect(bound.agentSessionId).toBe('agent-session-1')
    expect(bound.originMailbox).toBe('ventas@muitowork.com')
    expect(bound.updatedAt).toBe(draft.updatedAt)
    expect(bound.revision).toBe(draft.revision)
    expect((await connections.getDraft(OWNER, draft.id))?.agentSessionId).toBe('agent-session-1')
    await expect(connections.bindDraftSession(OTHER_OWNER, draft.id, 'intruder', null)).rejects.toThrow(/not found|another owner/u)
    expect((await connections.getDraft(OWNER, draft.id))?.agentSessionId).toBe('agent-session-1')
  })
})

describe('atomic draft updates', () => {
  it('lets exactly one of two concurrent updates with the same expected revision write', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Before CAS', text: 'Original',
    })

    const results = await Promise.allSettled([
      connections.updateDraft(OWNER, draft.id, draft.revision, {
        to: ['client@example.com'], subject: 'First update', text: 'First body',
      }),
      connections.updateDraft(OWNER, draft.id, draft.revision, {
        to: ['client@example.com'], subject: 'Second update', text: 'Second body',
      }),
    ])

    const fulfilled = results.filter(result => result.status === 'fulfilled')
    const rejected = results.filter(result => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toMatchObject({ code: 'DRAFT_CHANGED' })
    expect(fulfilled[0]?.value.subject).toBe((await connections.getDraft(OWNER, draft.id))?.subject)
    expect(['First update', 'Second update']).toContain((await connections.getDraft(OWNER, draft.id))?.subject)
  })

  it('refuses a second create for an existing id instead of a blind replacement', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Create only', text: 'Original',
    })

    await expect(connections.saveDraft(OWNER, {
      id: draft.id, to: draft.to, subject: 'Blind replacement', text: 'No',
    })).rejects.toThrow('already exists')
    expect((await connections.getDraft(OWNER, draft.id))?.subject).toBe('Create only')
  })

  it('reports NOT_FOUND for absent or foreign drafts and NOT_DRAFT for settled drafts', async () => {
    const pool = new MemoryMediaPool()
    pool.media.set('faberloom_connections', {
      global: null,
      tables: new Map([['drafts', new Map<string, unknown>([['sent-draft', { ...legacyDraft(), status: 'sent' }]])]]),
    })
    const { connections } = await harness(pool)
    const input = { to: ['client@example.com'], subject: 'Cannot update', text: 'No' }

    await expect(connections.updateDraft(OWNER, 'missing', 'any-revision', input))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(connections.updateDraft(OTHER_OWNER, 'sent-draft', 'any-revision', input))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(connections.updateDraft(OWNER, 'sent-draft', 'any-revision', input))
      .rejects.toMatchObject({ code: 'NOT_DRAFT' })
    await expect(connections.saveDraft(OWNER, { ...input, id: 'sent-draft' }))
      .rejects.toThrow('already exists')
  })
})

describe('durable draft revisions', () => {
  it('returns and stores the same exact snapshot from a chained update', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Before chained write', text: 'Original',
    })

    const written = await connections.updateDraftAndRecord(OWNER, draft.id, draft.revision, {
      to: draft.to, subject: 'Chained write', text: 'Changed',
    }, { source: 'agent', instruction: 'write and capture' })
    const history = await connections.listDraftRevisions(OWNER, draft.id)

    expect(written.draft.subject).toBe('Chained write')
    expect(written.revision.snapshot.subject).toBe('Chained write')
    expect(history).toEqual([written.revision])
  })

  it('captures the exact value returned by each write when another update interleaves', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Before writes', text: 'Original',
    })
    const first = await connections.updateDraft(OWNER, draft.id, draft.revision, {
      to: draft.to, subject: 'First write', text: 'First body',
    })
    const second = await connections.updateDraft(OWNER, draft.id, first.revision, {
      to: draft.to, subject: 'Second write', text: 'Second body',
    })

    await connections.recordDraftRevision(OWNER, first, { source: 'agent', instruction: 'first write' })
    await connections.recordDraftRevision(OWNER, second, { source: 'human', instruction: 'second write' })
    const history = await connections.listDraftRevisions(OWNER, draft.id)

    expect(history.map(row => row.snapshot.subject)).toEqual(['First write', 'Second write'])
    expect(history.map(row => row.source)).toEqual(['agent', 'human'])
  })

  it('changes the CAS revision when restorable metadata changes without touching the body', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Metadata', text: 'Same body', spaceId: 'old-space', originMailbox: 'INBOX',
    })
    const changed = await connections.updateDraft(OWNER, draft.id, draft.revision, {
      to: draft.to, subject: draft.subject, text: draft.text, spaceId: 'new-space', originMailbox: 'Archive',
    })

    expect(changed.revision).not.toBe(draft.revision)
    await expect(connections.updateDraft(OWNER, draft.id, draft.revision, {
      to: draft.to, subject: 'Stale write', text: 'No',
    })).rejects.toMatchObject({ code: 'DRAFT_CHANGED' })
    expect((await connections.getDraft(OWNER, draft.id))?.spaceId).toBe('new-space')
  })

  it('measures attachment bytes instead of trusting the caller-declared size', async () => {
    const { connections } = await harness()
    const contentBase64 = Buffer.alloc(15_000_001, 1).toString('base64')

    await expect(connections.saveDraft(OWNER, {
      to: ['client@example.com'],
      subject: 'Declared small',
      text: 'Body',
      attachments: [{ name: 'big.bin', mediaType: 'application/octet-stream', contentBase64, size: 1 }],
    })).rejects.toThrow('15 MB')
    expect(await connections.listDrafts(OWNER)).toEqual([])
  })

  it('persists ordered snapshots with source, instruction, origin, and attachment bytes', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const bytes = Buffer.from([0, 255, 1, 128, 42])
    const contentBase64 = bytes.toString('base64')
    const draft = await first.connections.saveDraft(OWNER, {
      to: ['client@example.com'],
      cc: ['copy@example.com'],
      bcc: ['blind@example.com'],
      subject: 'Complete snapshot',
      text: 'Initial text',
      html: '<div><p>Initial text</p></div>',
      account: 'ventas@muitowork.com',
      attachments: [{ name: 'evidence.bin', mediaType: 'application/octet-stream', contentBase64 }],
      aiText: 'AI original',
      inReplyTo: '<root@example.com>',
      references: ['<root@example.com>', '<parent@example.com>'],
      spaceId: 'space-1',
      originUid: 'uid-1',
      originReason: 'inbound-question',
      originMailbox: 'ventas@muitowork.com',
    })
    await first.connections.recordDraftRevision(OWNER, draft, { source: 'initial', instruction: 'Capture the received request' })
    await first.connections.recordDraftRevision(OWNER, draft, { source: 'human' })

    await first.dispose()
    const second = await harness(pool)
    const revisions = await second.connections.listDraftRevisions(OWNER, draft.id)

    expect(revisions.map(revision => revision.revision)).toEqual([1, 2])
    expect(revisions.map(revision => revision.source)).toEqual(['initial', 'human'])
    expect(revisions[0]?.instruction).toBe('Capture the received request')
    expect(revisions[1]?.instruction).toBeNull()
    expect(revisions[0]?.createdAt).toEqual(expect.any(String))
    expect(revisions[0]).toMatchObject({ draftId: draft.id, ownerId: OWNER })
    expect(revisions[0]?.snapshot).toEqual({
      to: ['client@example.com'],
      cc: ['copy@example.com'],
      bcc: ['blind@example.com'],
      subject: 'Complete snapshot',
      text: 'Initial text',
      html: '<div><p>Initial text</p></div>',
      account: 'ventas@muitowork.com',
      attachments: [{ name: 'evidence.bin', mediaType: 'application/octet-stream', contentBase64, size: bytes.length }],
      aiText: 'AI original',
      inReplyTo: '<root@example.com>',
      references: ['<root@example.com>', '<parent@example.com>'],
      spaceId: 'space-1',
      originUid: 'uid-1',
      originReason: 'inbound-question',
      originMailbox: 'ventas@muitowork.com',
    })
    expect(Buffer.from(revisions[0]?.snapshot.attachments[0]?.contentBase64 ?? '', 'base64').equals(bytes)).toBe(true)
    expect(await second.connections.listDraftRevisions(OTHER_OWNER, draft.id)).toEqual([])
  })

  it('serializes history writes so concurrent captures receive unique monotonic numbers', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Concurrent history', text: 'Message',
    })

    await Promise.all(Array.from({ length: 8 }, (_, index) => connections.recordDraftRevision(OWNER, draft, {
      source: index % 2 === 0 ? 'agent' : 'human',
      instruction: `operation-${index}`,
    })))
    const revisions = await connections.listDraftRevisions(OWNER, draft.id)

    expect(revisions.map(revision => revision.revision)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(new Set(revisions.map(revision => revision.instruction)).size).toBe(8)
    expect(revisions.map(revision => revision.source)).toEqual(['agent', 'human', 'agent', 'human', 'agent', 'human', 'agent', 'human'])
  })

  it('restores every snapshot byte as a new restore revision and preserves the agent binding', async () => {
    const { connections } = await harness()
    const originalBytes = Buffer.from([0, 255, 254, 0, 7, 11])
    const originalBase64 = originalBytes.toString('base64')
    const draft = await connections.saveDraft(OWNER, {
      to: ['original@example.com'],
      cc: ['original-copy@example.com'],
      bcc: ['original-blind@example.com'],
      subject: 'Original subject',
      text: 'Original body',
      account: 'original-account@muitowork.com',
      attachments: [{ name: 'original.bin', mediaType: 'application/octet-stream', contentBase64: originalBase64 }],
      aiText: 'Original AI text',
      inReplyTo: '<original@example.com>',
      references: ['<root@example.com>', '<original@example.com>'],
      spaceId: 'original-space',
      originUid: 'original-uid',
      originReason: 'original-reason',
      originMailbox: 'original-mailbox@muitowork.com',
    })
    const initial = await connections.recordDraftRevision(OWNER, draft, { source: 'initial', instruction: 'Original snapshot' })
    await connections.bindDraftSession(OWNER, draft.id, 'agent-session-restore', null)
    const edited = await connections.updateDraft(OWNER, draft.id, draft.revision, {
      to: ['edited@example.com'],
      subject: 'Edited subject',
      text: 'Edited body',
      attachments: [],
      aiText: null,
      inReplyTo: null,
      references: [],
      spaceId: null,
    })
    await connections.recordDraftRevision(OWNER, edited, { source: 'human', instruction: 'Temporary edit' })

    const restored = await connections.restoreDraftRevision(OWNER, draft.id, initial.revision, edited.revision, 'Restore the original reviewed draft')

    expect(restored.draft).toMatchObject(initial.snapshot)
    expect(restored.draft.agentSessionId).toBe('agent-session-restore')
    expect(restored.draft.revision).toBe(draft.revision)
    expect(restored.draft.attachments).toHaveLength(1)
    expect(restored.draft.attachments[0]?.contentBase64).toBe(originalBase64)
    expect(Buffer.from(restored.draft.attachments[0]?.contentBase64 ?? '', 'base64').equals(originalBytes)).toBe(true)
    expect(restored.revision).toMatchObject({ revision: 3, source: 'restore', instruction: 'Restore the original reviewed draft' })
    expect(restored.revision.snapshot).toEqual(initial.snapshot)
    const history = await connections.listDraftRevisions(OWNER, draft.id)
    expect(history.map(revision => revision.revision)).toEqual([1, 2, 3])
    expect(history.map(revision => revision.source)).toEqual(['initial', 'human', 'restore'])
    expect(history[0]).toEqual(initial)
  })

  it('refuses a restore whose expected message revision is stale and appends nothing', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Original', text: 'Original body',
    })
    const initial = await connections.recordDraftRevision(OWNER, draft, { source: 'initial' })
    const edited = await connections.updateDraft(OWNER, draft.id, draft.revision, {
      to: ['client@example.com'], subject: 'Current', text: 'Current body',
    })

    await expect(connections.restoreDraftRevision(OWNER, draft.id, initial.revision, draft.revision))
      .rejects.toMatchObject({ code: 'DRAFT_CHANGED' })

    expect((await connections.getDraft(OWNER, draft.id))?.revision).toBe(edited.revision)
    expect((await connections.getDraft(OWNER, draft.id))?.text).toBe('Current body')
    expect(await connections.listDraftRevisions(OWNER, draft.id)).toEqual([initial])
  })

  it('does not let another owner mutate, record, list, or restore the draft', async () => {
    const { connections } = await harness()
    const draft = await connections.saveDraft(OWNER, {
      to: ['client@example.com'], subject: 'Private', text: 'Owner only', originUid: 'private-uid',
    })
    const initial = await connections.recordDraftRevision(OWNER, draft, { source: 'initial' })

    await expect(connections.saveDraft(OTHER_OWNER, {
      id: draft.id, to: ['attacker@example.com'], subject: 'Stolen', text: 'No',
    })).rejects.toThrow(/another owner/u)
    await expect(connections.recordDraftRevision(OTHER_OWNER, draft, { source: 'agent' })).rejects.toThrow(/not found|another owner/u)
    await expect(connections.restoreDraftRevision(OTHER_OWNER, draft.id, initial.revision, draft.revision))
      .rejects.toThrow(/not found|another owner/u)
    expect(await connections.listDraftRevisions(OTHER_OWNER, draft.id)).toEqual([])
    expect((await connections.getDraft(OWNER, draft.id))?.originUid).toBe('private-uid')
    expect(await connections.listDraftRevisions(OWNER, draft.id)).toHaveLength(1)
  })
})

describe('connections domain compatibility', () => {
  it('opens a stored unit that predates the revision table', async () => {
    const legacy = legacyDraft()
    const parsed = draftRecord.parse(legacy)
    expect(parsed).toMatchObject({ originUid: null, originReason: null, originMailbox: null, agentSessionId: null, html: '' })
    // A new table is additive at the same version; bumping the version would
    // reject the stored unit because the storage backends compare the header.
    expect(connectionsDomainSpec.version).toBe(1)

    const pool = new MemoryMediaPool()
    // Production units written before the revision table carry no
    // draft_revisions map; the medium opens them and that table reads empty.
    pool.media.set('faberloom_connections', {
      global: null,
      tables: new Map([['drafts', new Map<string, unknown>([['legacy-draft', legacy]])]]),
    })
    const { connections } = await harness(pool)

    expect(await connections.getDraft(OWNER, 'legacy-draft')).toMatchObject({
      id: 'legacy-draft',
      text: 'Stored before the revision table',
      originUid: null,
      originReason: null,
      originMailbox: null,
      agentSessionId: null,
    })
    expect(await connections.getDraft(OTHER_OWNER, 'legacy-draft')).toBeNull()
    expect(await connections.listDraftRevisions(OWNER, 'legacy-draft')).toEqual([])
    const draft = await connections.getDraft(OWNER, 'legacy-draft')
    expect(draft).not.toBeNull()
    await connections.recordDraftRevision(OWNER, draft!, { source: 'human' })
    expect(await connections.listDraftRevisions(OWNER, 'legacy-draft')).toHaveLength(1)
  })
})
