import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {
  DraftAttachment,
  EmailDraftInput,
  EmailDraftRevisionSource,
  EmailDraftSnapshot,
  FaberLoomEmailDraft,
  FaberLoomEmailDraftRevision,
  RecordDraftRevisionInput,
  RestoreDraftRevisionResult,
} from '@deepseek-ai/dsh-faberloom-connections'
import { apply, type Config } from '../src/index.ts'

const OWNER = 'owner@muitowork.com'
const OTHER_OWNER = 'other@muitowork.com'
const CONFIG: Config = { ownerId: OWNER, role: 'admin', readOnly: false }

/** One in-memory connections double with the same CAS and owner rules as the service. */
class FakeConnections {
  readonly saveCalls: EmailDraftInput[] = []
  readonly updateCalls: { owner: string; id: string; expectedRevision: string; input: EmailDraftInput }[] = []
  readonly restoreCalls: { owner: string; id: string; revision: number; expectedRevision: string }[] = []
  readonly signatures = new Map<string, string | null>()
  readonly mailboxes: { id: string; kind: 'imap'; label: string; username: string; primary: boolean }[] = []
  private readonly drafts = new Map<string, FaberLoomEmailDraft>()
  private readonly histories = new Map<string, FaberLoomEmailDraftRevision[]>()
  private nextId = 0
  private nextRevision = 0

  async list(owner: string) {
    return owner === OWNER ? this.mailboxes : []
  }

  async signatureFor(owner: string, account: string | null): Promise<string | null> {
    return owner === OWNER ? this.signatures.get(account ?? '') ?? null : null
  }

  async saveDraft(owner: string, input: EmailDraftInput): Promise<FaberLoomEmailDraft> {
    this.saveCalls.push(input)
    return this.write(owner, input)
  }

  async updateDraft(owner: string, id: string, expectedRevision: string, input: EmailDraftInput): Promise<FaberLoomEmailDraft> {
    this.updateCalls.push({ owner, id, expectedRevision, input })
    const existing = this.drafts.get(id)
    if (existing === undefined || this.ownerOf(id) !== owner) throw new Error('faberloom: NOT_FOUND draft')
    if (existing.status !== 'draft') throw new Error('faberloom: NOT_DRAFT')
    if (existing.revision !== expectedRevision) throw new Error('faberloom: DRAFT_CHANGED')
    return this.write(owner, { ...input, id })
  }

  async updateDraftAndRecord(
    owner: string, id: string, expectedRevision: string, input: EmailDraftInput, history: RecordDraftRevisionInput,
  ): Promise<RestoreDraftRevisionResult> {
    const draft = await this.updateDraft(owner, id, expectedRevision, input)
    const revision = await this.recordDraftRevision(owner, draft, history)
    return { draft, revision }
  }

  async getDraft(owner: string, id: string): Promise<FaberLoomEmailDraft | null> {
    const draft = this.drafts.get(id)
    return draft !== undefined && this.ownerOf(id) === owner ? draft : null
  }

  async bindDraftSession(owner: string, id: string, agentSessionId: string): Promise<FaberLoomEmailDraft> {
    const draft = await this.requireDraft(owner, id)
    const bound = { ...draft, agentSessionId }
    this.drafts.set(id, bound)
    return bound
  }

  async recordDraftRevision(
    owner: string, draft: FaberLoomEmailDraft, input: RecordDraftRevisionInput,
  ): Promise<FaberLoomEmailDraftRevision> {
    await this.requireDraft(owner, draft.id)
    const history = this.histories.get(draft.id) ?? []
    const revision: FaberLoomEmailDraftRevision = {
      draftId: draft.id,
      ownerId: owner,
      revision: history.length + 1,
      source: input.source,
      instruction: input.instruction ?? null,
      createdAt: `2026-11-21T00:00:${String(history.length).padStart(2, '0')}.000Z`,
      snapshot: snapshotOf(draft),
    }
    this.histories.set(draft.id, [...history, revision])
    return revision
  }

  async listDraftRevisions(owner: string, id: string): Promise<FaberLoomEmailDraftRevision[]> {
    if (this.ownerOf(id) !== owner) return []
    return this.histories.get(id) ?? []
  }

  async restoreDraftRevision(
    owner: string, id: string, revision: number, expectedRevision: string, instruction?: string,
  ): Promise<RestoreDraftRevisionResult> {
    this.restoreCalls.push({ owner, id, revision, expectedRevision })
    const current = await this.requireDraft(owner, id)
    if (current.revision !== expectedRevision) throw new Error('faberloom: DRAFT_CHANGED')
    const snapshot = (this.histories.get(id) ?? []).find(item => item.revision === revision)?.snapshot
    if (snapshot === undefined) throw new Error('faberloom: NOT_FOUND revision')
    const draft = this.write(owner, { ...snapshot, id })
    const created = await this.recordDraftRevision(owner, draft, { source: 'restore', ...instruction === undefined ? {} : { instruction } })
    return { draft, revision: created }
  }

  async seed(owner = OWNER, input: Partial<EmailDraftInput> = {}): Promise<FaberLoomEmailDraft> {
    return this.write(owner, {
      to: ['original@example.com'],
      cc: ['copy@example.com'],
      bcc: ['blind@example.com'],
      subject: 'Original subject',
      text: 'Original body',
      account: 'original@muitowork.com',
      attachments: [],
      aiText: 'Original AI body',
      inReplyTo: '<original@example.com>',
      references: ['<root@example.com>', '<original@example.com>'],
      spaceId: 'space-original',
      originUid: 'c-original:7',
      originMailbox: 'original@muitowork.com',
      originReason: 'agent-reply',
      ...input,
    })
  }

  private readonly owners = new Map<string, string>()

  private ownerOf(id: string): string | undefined {
    return this.owners.get(id)
  }

  private async requireDraft(owner: string, id: string): Promise<FaberLoomEmailDraft> {
    const draft = await this.getDraft(owner, id)
    if (draft === null) throw new Error('faberloom: NOT_FOUND draft')
    return draft
  }

  private write(owner: string, input: EmailDraftInput): FaberLoomEmailDraft {
    const id = input.id ?? `draft-${String(++this.nextId)}`
    const existing = this.drafts.get(id)
    if (existing !== undefined && this.ownerOf(id) !== owner) throw new Error('faberloom: another owner')
    const previous = existing?.attachments ?? []
    const attachments = input.attachments === undefined
      ? previous
      : input.attachments.flatMap((attachment): DraftAttachment[] => {
        if (attachment.contentBase64 !== undefined) {
          const contentBase64 = attachment.contentBase64
          return [{
            name: attachment.name,
            mediaType: attachment.mediaType,
            contentBase64,
            size: attachment.size ?? Buffer.byteLength(contentBase64, 'base64'),
          }]
        }
        const kept = previous.find(candidate => candidate.name === attachment.name)
        return kept === undefined ? [] : [kept]
      })
    const now = '2026-11-21T00:00:00.000Z'
    const draft: FaberLoomEmailDraft = {
      id,
      to: [...input.to],
      cc: [...(input.cc ?? existing?.cc ?? [])],
      bcc: [...(input.bcc ?? existing?.bcc ?? [])],
      subject: input.subject,
      text: input.text,
      account: input.account === undefined ? existing?.account ?? null : input.account,
      attachments,
      revision: `revision-${String(++this.nextRevision)}`,
      status: 'draft',
      aiText: input.aiText === undefined ? existing?.aiText ?? null : input.aiText,
      inReplyTo: input.inReplyTo === undefined ? existing?.inReplyTo ?? null : input.inReplyTo,
      references: [...(input.references ?? existing?.references ?? [])],
      spaceId: input.spaceId === undefined ? existing?.spaceId ?? null : input.spaceId,
      originUid: input.originUid === undefined ? existing?.originUid ?? null : input.originUid,
      originMailbox: input.originMailbox === undefined ? existing?.originMailbox ?? null : input.originMailbox,
      originReason: input.originReason === undefined ? existing?.originReason ?? null : input.originReason,
      agentSessionId: existing?.agentSessionId ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      sentAt: null,
    }
    this.owners.set(id, owner)
    this.drafts.set(id, draft)
    return draft
  }
}

function snapshotOf(draft: FaberLoomEmailDraft): EmailDraftSnapshot {
  return {
    to: [...draft.to],
    cc: [...draft.cc],
    bcc: [...draft.bcc],
    subject: draft.subject,
    text: draft.text,
    account: draft.account,
    attachments: draft.attachments.map(attachment => ({ ...attachment })),
    aiText: draft.aiText,
    inReplyTo: draft.inReplyTo,
    references: [...draft.references],
    spaceId: draft.spaceId,
    originUid: draft.originUid,
    originMailbox: draft.originMailbox,
    originReason: draft.originReason,
  }
}

/** Capture the real registered definitions without mounting unrelated product services. */
function harness(config: Config, services: Record<string, unknown>): Map<string, ToolDefinition> {
  const registered = new Map<string, ToolDefinition>()
  const ctx = {
    tools: {
      register: (definition: ToolDefinition) => {
        registered.set(definition.name, definition)
        return () => {}
      },
    },
    get: (name: string) => services[name],
    effect: (callback: () => unknown) => { callback(); return () => {} },
  }
  apply(ctx as never, config)
  return registered
}

function toolsFor(connections: FakeConnections, inbound: Record<string, unknown> = {}, config: Config = CONFIG) {
  return harness(config, { faberloomConnections: connections, faberloomInbound: inbound })
}

function execute(tool: ToolDefinition, args: Record<string, unknown>, exec?: Record<string, unknown>): Promise<unknown> {
  return tool.execute(args, (exec ?? {}) as never)
}

function render(tool: ToolDefinition, args: Record<string, unknown>, value: unknown): string {
  return tool.output.render(args, value as never).map(block => block.type === 'text' ? block.text : '').join('\n')
}

interface DraftOutput {
  readonly id: string
  readonly revision: string
  readonly historyRevision: number
  readonly account: string | null
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly bcc: readonly string[]
  readonly subject: string
  readonly text: string
  readonly attachments: readonly { name: string; mediaType: string; size: number }[]
  readonly originUid: string | null
  readonly originMailbox: string | null
  readonly originReason: string | null
  readonly spaceId: string | null
  readonly agentSessionId: string | null
}

function source(revision: FaberLoomEmailDraftRevision): EmailDraftRevisionSource {
  return revision.source
}

describe('faberloom draft agent tools', () => {
  it('registers read, update, history, and restore tools', () => {
    const tools = toolsFor(new FakeConnections())
    expect(tools.get('faberloom_email_draft_read')).toBeDefined()
    expect(tools.get('faberloom_email_draft_update')).toBeDefined()
    expect(tools.get('faberloom_email_draft_history')).toBeDefined()
    expect(tools.get('faberloom_email_draft_restore')).toBeDefined()
  })

  it('reads only the actor draft and returns attachment metadata without bytes', async () => {
    const connections = new FakeConnections()
    const draft = await connections.seed(OWNER, {
      subject: 'Private subject',
      text: 'Private body',
      attachments: [{ name: 'evidence.bin', mediaType: 'application/octet-stream', contentBase64: 'AAEC', size: 3 }],
    })
    await connections.bindDraftSession(OWNER, draft.id, 'session-read')
    const tools = toolsFor(connections)
    const read = tools.get('faberloom_email_draft_read')!

    const result = await execute(read, { draftId: draft.id }) as DraftOutput
    expect(result).toMatchObject({
      id: draft.id,
      revision: draft.revision,
      account: draft.account,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: 'Private subject',
      text: 'Private body',
      attachments: [{ name: 'evidence.bin', mediaType: 'application/octet-stream', size: 3 }],
      originUid: 'c-original:7',
      originMailbox: 'original@muitowork.com',
      originReason: 'agent-reply',
      spaceId: 'space-original',
      agentSessionId: 'session-read',
    })
    expect(JSON.stringify(result)).not.toContain('contentBase64')
    expect(JSON.stringify(result)).not.toContain('AAEC')
    expect(render(read, { draftId: draft.id }, result)).toContain(draft.revision)

    const other = toolsFor(connections, {}, Object.assign({}, CONFIG, { ownerId: OTHER_OWNER }))
    await expect(execute(other.get('faberloom_email_draft_read')!, { draftId: draft.id }))
      .rejects.toThrow(/^faberloom: NOT_FOUND/u)
    await expect(execute(read, { draftId: 'missing' })).rejects.toThrow(/^faberloom: NOT_FOUND/u)
  })

  it('updates every editable field and records the resulting agent revision', async () => {
    const connections = new FakeConnections()
    const draft = await connections.seed()
    connections.saveCalls.length = 0
    const tools = toolsFor(connections)
    const update = tools.get('faberloom_email_draft_update')!

    const result = await execute(update, {
      draftId: draft.id,
      expectedRevision: draft.revision,
      instruction: 'Rewrite the complete draft',
      to: 'new@example.com, second@example.com',
      cc: 'new-copy@example.com',
      bcc: 'new-blind@example.com',
      account: '',
      subject: 'New subject',
      text: 'New body',
    }) as DraftOutput

    expect(result).toMatchObject({
      id: draft.id,
      account: null,
      to: ['new@example.com', 'second@example.com'],
      cc: ['new-copy@example.com'],
      bcc: ['new-blind@example.com'],
      subject: 'New subject',
      text: 'New body',
      spaceId: draft.spaceId,
      historyRevision: 1,
    })
    expect(result.revision).not.toBe(draft.revision)
    expect(connections.updateCalls).toHaveLength(1)
    expect(connections.updateCalls[0]).toMatchObject({
      owner: OWNER,
      id: draft.id,
      expectedRevision: draft.revision,
    })
    expect(connections.updateCalls[0]?.input).toMatchObject({
      account: null, subject: 'New subject', text: 'New body', spaceId: draft.spaceId,
    })
    expect(connections.saveCalls).toEqual([])
    const history = await connections.listDraftRevisions(OWNER, draft.id)
    expect(history.map(item => [item.revision, item.source, item.instruction])).toEqual([[1, 'agent', 'Rewrite the complete draft']])
    expect(render(update, { draftId: draft.id }, result)).toMatch(/revision-[\d]+.*No mail was sent/iu)
  })

  it('preserves omitted fields, including aiText, origin, thread, and attachment bytes', async () => {
    const connections = new FakeConnections()
    const draft = await connections.seed(OWNER, {
      attachments: [{ name: 'keep.bin', mediaType: 'application/octet-stream', contentBase64: 'AAH/', size: 3 }],
    })
    const tools = toolsFor(connections)

    const result = await execute(tools.get('faberloom_email_draft_update')!, {
      draftId: draft.id,
      expectedRevision: draft.revision,
      instruction: 'Record an otherwise unchanged revision',
    }) as DraftOutput

    expect(result).toMatchObject({
      account: draft.account,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      text: draft.text,
      spaceId: draft.spaceId,
      originUid: draft.originUid,
      originMailbox: draft.originMailbox,
      originReason: draft.originReason,
      attachments: [{ name: 'keep.bin', mediaType: 'application/octet-stream', size: 3 }],
    })
    const current = await connections.getDraft(OWNER, draft.id)
    expect(current?.aiText).toBe('Original AI body')
    expect(current?.inReplyTo).toBe(draft.inReplyTo)
    expect(current?.references).toEqual(draft.references)
    expect(current?.attachments[0]?.contentBase64).toBe('AAH/')
  })

  it('uses the atomic update for stale revisions and never falls back to saveDraft', async () => {
    const connections = new FakeConnections()
    const draft = await connections.seed()
    connections.saveCalls.length = 0
    const tools = toolsFor(connections)

    await expect(execute(tools.get('faberloom_email_draft_update')!, {
      draftId: draft.id,
      expectedRevision: 'stale-revision',
      instruction: 'Must not write',
      subject: 'Changed',
    })).rejects.toThrow('DRAFT_CHANGED')

    expect(connections.updateCalls).toHaveLength(1)
    expect(connections.updateCalls[0]?.expectedRevision).toBe('stale-revision')
    expect(connections.saveCalls).toEqual([])
    expect(await connections.listDraftRevisions(OWNER, draft.id)).toEqual([])
    expect((await connections.getDraft(OWNER, draft.id))?.subject).toBe('Original subject')
  })

  it('allows only one of two concurrent updates with the same expected revision', async () => {
    const connections = new FakeConnections()
    const draft = await connections.seed()
    connections.saveCalls.length = 0
    const tools = toolsFor(connections)
    const update = tools.get('faberloom_email_draft_update')!
    const call = (subject: string) => execute(update, {
      draftId: draft.id,
      expectedRevision: draft.revision,
      instruction: `Write ${subject}`,
      subject,
    })

    const outcomes = await Promise.allSettled([call('First writer'), call('Second writer')])

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find(outcome => outcome.status === 'rejected')
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status === 'rejected') expect(rejected.reason).toBeInstanceOf(Error)
    if (rejected?.status === 'rejected' && rejected.reason instanceof Error) expect(rejected.reason.message).toContain('DRAFT_CHANGED')
    expect(connections.updateCalls).toHaveLength(2)
    expect(connections.saveCalls).toEqual([])
    expect(await connections.listDraftRevisions(OWNER, draft.id)).toHaveLength(1)
    expect(['First writer', 'Second writer']).toContain((await connections.getDraft(OWNER, draft.id))?.subject)
  })

  it('rejects update and restore before writing for a read-only actor', async () => {
    const connections = new FakeConnections()
    const draft = await connections.seed()
    const initial = await connections.recordDraftRevision(OWNER, draft, { source: 'initial' })
    const tools = toolsFor(connections, {}, Object.assign({}, CONFIG, { readOnly: true }))

    await expect(execute(tools.get('faberloom_email_draft_update')!, {
      draftId: draft.id, expectedRevision: draft.revision, instruction: 'No write', subject: 'No',
    })).rejects.toThrow('READ_ONLY')
    await expect(execute(tools.get('faberloom_email_draft_restore')!, {
      draftId: draft.id, expectedRevision: draft.revision, revision: initial.revision, instruction: 'No write',
    })).rejects.toThrow('READ_ONLY')
    await expect(execute(tools.get('faberloom_email_draft')!, {
      to: 'client@example.com', subject: 'No write', text: 'No',
    })).rejects.toThrow('READ_ONLY')

    expect(connections.updateCalls).toEqual([])
    expect(connections.restoreCalls).toEqual([])
    expect(await connections.listDraftRevisions(OWNER, draft.id)).toHaveLength(1)
  })

  it('does not expose or mutate another owner draft through update, history, or restore', async () => {
    const connections = new FakeConnections()
    const draft = await connections.seed()
    const initial = await connections.recordDraftRevision(OWNER, draft, { source: 'initial' })
    const tools = toolsFor(connections, {}, Object.assign({}, CONFIG, { ownerId: OTHER_OWNER }))

    await expect(execute(tools.get('faberloom_email_draft_update')!, {
      draftId: draft.id, expectedRevision: draft.revision, instruction: 'Intrusion', subject: 'Stolen',
    })).rejects.toThrow(/^faberloom: NOT_FOUND/u)
    await expect(execute(tools.get('faberloom_email_draft_history')!, { draftId: draft.id }))
      .rejects.toThrow(/^faberloom: NOT_FOUND/u)
    await expect(execute(tools.get('faberloom_email_draft_restore')!, {
      draftId: draft.id, expectedRevision: draft.revision, revision: initial.revision, instruction: 'Intrusion',
    })).rejects.toThrow(/^faberloom: NOT_FOUND/u)
    expect(connections.updateCalls).toEqual([])
    expect(connections.restoreCalls).toEqual([])
    expect((await connections.getDraft(OWNER, draft.id))?.subject).toBe('Original subject')
  })

  it('keeps an exact attachment list and adds original bytes with explicit name replacement', async () => {
    const connections = new FakeConnections()
    const draft = await connections.seed(OWNER, {
      attachments: [
        { name: 'report.bin', mediaType: 'application/octet-stream', contentBase64: 'b2xk', size: 3 },
        { name: 'drop.txt', mediaType: 'text/plain', contentBase64: 'ZHJvcA==', size: 4 },
      ],
    })
    const newBytes = Buffer.from([0, 255, 1, 128, 42])
    const readEmail = vi.fn(async () => ({
      text: '', html: null,
      attachments: [
        { name: 'report.bin', mediaType: 'application/x-new-report', size: newBytes.length, contentBase64: newBytes.toString('base64') },
        { name: 'new.txt', mediaType: 'text/plain', size: 3, contentBase64: Buffer.from('new').toString('base64') },
      ],
    }))
    const tools = toolsFor(connections, { readEmail })

    const result = await execute(tools.get('faberloom_email_draft_update')!, {
      draftId: draft.id,
      expectedRevision: draft.revision,
      instruction: 'Replace report and keep only the requested files',
      keepAttachments: ['report.bin'],
      attachFromUid: 44,
      attachFromConnectionId: 'c9',
      attachFromMailbox: 'Archive',
      attachNames: ['report.bin', 'new.txt'],
    }) as DraftOutput

    expect(readEmail).toHaveBeenCalledWith(OWNER, 44, 'c9', 'Archive')
    expect(result.attachments).toEqual([
      { name: 'report.bin', mediaType: 'application/x-new-report', size: newBytes.length },
      { name: 'new.txt', mediaType: 'text/plain', size: 3 },
    ])
    expect(JSON.stringify(result)).not.toContain('contentBase64')
    const current = await connections.getDraft(OWNER, draft.id)
    expect(current?.attachments).toHaveLength(2)
    expect(current?.attachments.find(item => item.name === 'report.bin')?.contentBase64).toBe(newBytes.toString('base64'))
    expect(current?.attachments.find(item => item.name === 'new.txt')?.contentBase64).toBe(Buffer.from('new').toString('base64'))
    expect(current?.attachments.some(item => item.name === 'drop.txt')).toBe(false)
  })

  it('copies every original attachment when attachNames is omitted', async () => {
    const connections = new FakeConnections()
    const draft = await connections.seed()
    const readEmail = vi.fn(async () => ({
      text: '', html: null,
      attachments: [
        { name: 'one.txt', mediaType: 'text/plain', size: 1, contentBase64: 'MQ==' },
        { name: 'two.txt', mediaType: 'text/plain', size: 1, contentBase64: 'Mg==' },
      ],
    }))
    const tools = toolsFor(connections, { readEmail })

    const result = await execute(tools.get('faberloom_email_draft_update')!, {
      draftId: draft.id,
      expectedRevision: draft.revision,
      instruction: 'Copy all attachments',
      attachFromUid: 88,
    }) as DraftOutput

    expect(result.attachments.map(item => item.name)).toEqual(['one.txt', 'two.txt'])
    expect((await connections.getDraft(OWNER, draft.id))?.attachments.map(item => item.contentBase64)).toEqual(['MQ==', 'Mg=='])
  })

  it('rejects a misspelled keepAttachments name before writing', async () => {
    const connections = new FakeConnections()
    const draft = await connections.seed(OWNER, {
      attachments: [{ name: 'present.txt', mediaType: 'text/plain', contentBase64: 'eA==', size: 1 }],
    })
    const tools = toolsFor(connections)

    await expect(execute(tools.get('faberloom_email_draft_update')!, {
      draftId: draft.id, expectedRevision: draft.revision, instruction: 'Keep a missing file', keepAttachments: ['missing.txt'],
    })).rejects.toThrow('ATTACHMENT_NOT_FOUND')
    expect(connections.updateCalls).toEqual([])
  })

  it('rejects attachNames without a uid and a missing source attachment before writing', async () => {
    const connections = new FakeConnections()
    const draft = await connections.seed()
    const readEmail = vi.fn(async () => ({ text: '', html: null, attachments: [
      { name: 'present.txt', mediaType: 'text/plain', size: 1, contentBase64: 'eA==' },
    ] }))
    const tools = toolsFor(connections, { readEmail })
    const update = tools.get('faberloom_email_draft_update')!

    await expect(execute(update, {
      draftId: draft.id, expectedRevision: draft.revision, instruction: 'Invalid source', attachNames: ['present.txt'],
    })).rejects.toThrow('attachFromUid')
    expect(readEmail).not.toHaveBeenCalled()
    await expect(execute(update, {
      draftId: draft.id, expectedRevision: draft.revision, instruction: 'Missing file', attachFromUid: 9, attachNames: ['absent.txt'],
    })).rejects.toThrow('absent.txt')
    expect(connections.updateCalls).toEqual([])
    expect(connections.saveCalls).toEqual([])
  })

  it('replaces an old automatic signature on account change and never duplicates the new one', async () => {
    const connections = new FakeConnections()
    connections.signatures.set('original@muitowork.com', 'Old signature')
    connections.signatures.set('next@muitowork.com', 'New signature')
    const draft = await connections.seed(OWNER, { text: 'Hello\n\nOld signature' })
    const tools = toolsFor(connections)
    const update = tools.get('faberloom_email_draft_update')!

    const changed = await execute(update, {
      draftId: draft.id,
      expectedRevision: draft.revision,
      instruction: 'Use the next account',
      account: 'next@muitowork.com',
    }) as DraftOutput
    expect(changed.text).toBe('Hello\n\nNew signature')
    expect(changed.text.match(/New signature/gu)).toHaveLength(1)
    expect(changed.text).not.toContain('Old signature')
    expect((await connections.getDraft(OWNER, draft.id))?.aiText).toBe('Original AI body')

    const unchanged = await execute(update, {
      draftId: draft.id,
      expectedRevision: changed.revision,
      instruction: 'Keep the already signed body',
      text: changed.text,
    }) as DraftOutput
    expect(unchanged.text).toBe('Hello\n\nNew signature')
    expect(unchanged.text.match(/New signature/gu)).toHaveLength(1)
  })

  it('adds no signature when signatureFor returns null', async () => {
    const connections = new FakeConnections()
    connections.signatures.set('original@muitowork.com', 'Old signature')
    connections.signatures.set('manual@muitowork.com', null)
    const draft = await connections.seed(OWNER, { text: 'Hello\n\nOld signature' })
    const tools = toolsFor(connections)

    const result = await execute(tools.get('faberloom_email_draft_update')!, {
      draftId: draft.id,
      expectedRevision: draft.revision,
      instruction: 'Use an account without an automatic signature',
      account: 'manual@muitowork.com',
    }) as DraftOutput

    expect(result.text).toBe('Hello')
  })

  it('creates an initial revision with composed origin and final signed aiText, leaving dedicated chat binding to the Host', async () => {
    const connections = new FakeConnections()
    connections.mailboxes.push({ id: 'c1', kind: 'imap', label: 'Primary', username: '506@muitowork.com', primary: true })
    connections.signatures.set('506@muitowork.com', 'Soporte\nMuito Work')
    const inbound = {
      listInbox: vi.fn(async () => [{ uid: 7, messageId: '<message@example.com>' }]),
    }
    const tools = toolsFor(connections, inbound)
    const draftTool = tools.get('faberloom_email_draft')!

    const result = await execute(draftTool, {
      to: 'client@example.com', subject: 'Re: Order', text: 'Hello', uid: 7, connectionId: 'c1',
    }, { agent: { session: { id: 'session-draft' } } }) as DraftOutput

    expect(result).toMatchObject({
      originUid: 'c1:7',
      originMailbox: null,
      originReason: 'agent-reply',
      agentSessionId: null,
      historyRevision: 1,
      text: 'Hello\n\nSoporte\nMuito Work',
    })
    expect(connections.saveCalls[0]).toMatchObject({
      account: '506@muitowork.com',
      inReplyTo: '<message@example.com>',
      references: ['<message@example.com>'],
      originUid: 'c1:7',
      originMailbox: null,
      originReason: 'agent-reply',
      text: 'Hello\n\nSoporte\nMuito Work',
      aiText: 'Hello\n\nSoporte\nMuito Work',
    })
    expect(connections.saveCalls[0]?.aiText).toBe(connections.saveCalls[0]?.text)
    const history = await connections.listDraftRevisions(OWNER, result.id)
    expect(history.map(item => [item.revision, source(item)])).toEqual([[1, 'initial']])
    expect(render(draftTool, {}, result)).toMatch(/revision-[\d]+.*No mail was sent/iu)
  })

  it('marks a standalone initial draft and does not duplicate an existing automatic signature', async () => {
    const connections = new FakeConnections()
    connections.mailboxes.push({ id: 'c1', kind: 'imap', label: 'Primary', username: '506@muitowork.com', primary: true })
    connections.signatures.set('506@muitowork.com', 'Signature')
    const tools = toolsFor(connections)

    const result = await execute(tools.get('faberloom_email_draft')!, {
      to: 'client@example.com', subject: 'Standalone', text: 'Hello\n\nSignature',
    }) as DraftOutput

    expect(result.originUid).toBeNull()
    expect(result.originReason).toBe('agent-draft')
    expect(result.text).toBe('Hello\n\nSignature')
    expect(result.text.match(/Signature/gu)).toHaveLength(1)
    expect(connections.saveCalls[0]?.aiText).toBe('Hello\n\nSignature')
  })

  it('appends the automatic signature when the body only mentions its text earlier', async () => {
    const connections = new FakeConnections()
    connections.signatures.set('', 'Álvaro')
    const tools = toolsFor(connections)

    const result = await execute(tools.get('faberloom_email_draft')!, {
      to: 'client@example.com', subject: 'Signature placement', text: 'Hola, Álvaro te comparte esta respuesta.',
    }) as DraftOutput

    expect(result.text).toBe('Hola, Álvaro te comparte esta respuesta.\n\nÁlvaro')
  })

  it('lists history oldest first with complete snapshots but no attachment bytes', async () => {
    const connections = new FakeConnections()
    const draft = await connections.seed(OWNER, {
      attachments: [{ name: 'private.bin', mediaType: 'application/octet-stream', contentBase64: 'U0VDUkVU', size: 6 }],
    })
    await connections.recordDraftRevision(OWNER, draft, { source: 'initial' })
    const second = await connections.updateDraft(OWNER, draft.id, draft.revision, {
      to: draft.to, subject: 'Second subject', text: 'Second body',
    })
    await connections.recordDraftRevision(OWNER, second, { source: 'agent', instruction: 'Second pass' })
    const tools = toolsFor(connections)
    const historyTool = tools.get('faberloom_email_draft_history')!

    const result = await execute(historyTool, { draftId: draft.id }) as {
      revisions: { revision: number; source: string; instruction: string | null; createdAt: string; snapshot: Record<string, unknown> }[]
    }
    expect(result.revisions.map(item => item.revision)).toEqual([1, 2])
    expect(result.revisions.map(item => item.source)).toEqual(['initial', 'agent'])
    expect(result.revisions[1]?.instruction).toBe('Second pass')
    expect(result.revisions[0]?.createdAt).toEqual(expect.any(String))
    expect(result.revisions[0]?.snapshot).toMatchObject({
      subject: 'Original subject',
      originUid: 'c-original:7',
      attachments: [{ name: 'private.bin', mediaType: 'application/octet-stream', size: 6 }],
    })
    expect(JSON.stringify(result)).not.toContain('contentBase64')
    expect(JSON.stringify(result)).not.toContain('U0VDUkVU')
    expect(render(historyTool, { draftId: draft.id }, result)).toContain('2')
  })

  it('restores through the CAS operation, adds restore history, and returns no attachment bytes', async () => {
    const connections = new FakeConnections()
    const draft = await connections.seed(OWNER, {
      attachments: [{ name: 'original.bin', mediaType: 'application/octet-stream', contentBase64: 'AAH/BA==', size: 4 }],
    })
    const initial = await connections.recordDraftRevision(OWNER, draft, { source: 'initial' })
    const edited = await connections.updateDraft(OWNER, draft.id, draft.revision, {
      to: draft.to, subject: 'Edited subject', text: 'Edited body', attachments: [],
    })
    await connections.recordDraftRevision(OWNER, edited, { source: 'agent', instruction: 'Temporary edit' })
    const tools = toolsFor(connections)
    const restore = tools.get('faberloom_email_draft_restore')!

    const result = await execute(restore, {
      draftId: draft.id,
      expectedRevision: edited.revision,
      revision: initial.revision,
      instruction: 'Return to the reviewed version',
    }) as {
      draft: DraftOutput
      revision: { revision: number; source: string; instruction: string | null; snapshot: Record<string, unknown> }
    }

    expect(connections.restoreCalls).toEqual([{ owner: OWNER, id: draft.id, revision: 1, expectedRevision: edited.revision }])
    expect(result.draft).toMatchObject({ subject: 'Original subject', text: 'Original body' })
    expect(result.revision).toMatchObject({ revision: 3, source: 'restore', instruction: 'Return to the reviewed version' })
    expect(result.revision.snapshot).toMatchObject({ subject: 'Original subject' })
    expect(JSON.stringify(result)).not.toContain('contentBase64')
    expect(JSON.stringify(result)).not.toContain('AAH/BA==')
    expect((await connections.listDraftRevisions(OWNER, draft.id)).map(item => item.revision)).toEqual([1, 2, 3])
    expect(render(restore, { draftId: draft.id }, result)).toMatch(/3.*No mail was sent/iu)
  })

  it('passes a stale restore expectation to the atomic operation without adding history', async () => {
    const connections = new FakeConnections()
    const draft = await connections.seed()
    const initial = await connections.recordDraftRevision(OWNER, draft, { source: 'initial' })
    const tools = toolsFor(connections)

    await expect(execute(tools.get('faberloom_email_draft_restore')!, {
      draftId: draft.id,
      expectedRevision: 'stale-revision',
      revision: initial.revision,
      instruction: 'Must not restore',
    })).rejects.toThrow('DRAFT_CHANGED')

    expect(connections.restoreCalls).toEqual([{ owner: OWNER, id: draft.id, revision: 1, expectedRevision: 'stale-revision' }])
    expect(await connections.listDraftRevisions(OWNER, draft.id)).toHaveLength(1)
  })
})
