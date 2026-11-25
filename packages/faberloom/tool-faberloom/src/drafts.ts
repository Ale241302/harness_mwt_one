/** Owner-scoped agent tools for reviewing and editing drafts without sending them. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { draftHtml } from '@deepseek-ai/dsh-faberloom-connections'
import type {
  DraftAttachment,
  EmailDraftAttachmentInput,
  EmailDraftInput,
  EmailDraftSnapshot,
  FaberLoomConnection,
  FaberLoomConnections,
  FaberLoomEmailDraft,
  FaberLoomEmailDraftRevision,
} from '@deepseek-ai/dsh-faberloom-connections'
import type { FaberLoomInbound, ImapMessage } from '@deepseek-ai/dsh-faberloom-inbound'
// Type-only: resolves the ctx.faberloomSpaces declaration used through ctx.get.
import type { FaberLoomSpaces, SpaceActor } from '@deepseek-ai/dsh-faberloom-spaces'
import type { Config } from './index.ts'

const NULLABLE_STRING = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const
const STRING_LIST = { type: 'array', required: true, items: { type: 'string' } } as const
const ATTACHMENT_METADATA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    mediaType: { type: 'string', required: true },
    size: { type: 'integer', required: true },
  },
} as const
const ATTACHMENT_METADATA_LIST = { type: 'array', required: true, items: ATTACHMENT_METADATA } as const

/** Every source a draft may copy a real document from, shared by create and update. */
const MAIL_ATTACHMENT_SOURCE_PROPERTIES = {
  attachFromUid: { type: 'integer', description: 'Mailbox message uid whose original attachments are copied.' },
  attachFromConnectionId: { type: 'string', description: 'Connection id of the source message; primary mailbox otherwise.' },
  attachFromMailbox: { type: 'string', description: 'Exact IMAP folder of the source message; the configured inbox otherwise.' },
  attachNames: {
    type: 'array',
    items: { type: 'string' },
    description: 'Exact source attachment names to copy. Requires attachFromUid; omitted copies every source attachment.',
  },
  attachFromUrl: {
    type: 'string',
    description: 'HTTPS URL of a signed document to copy as a real attachment, such as the link MWT.ONE returns from documento_descargar or artefacto_archivo_descargar. Never a page URL.',
  },
  attachUrlName: { type: 'string', description: 'File name for attachFromUrl; the last URL segment otherwise.' },
  attachUrlMediaType: { type: 'string', description: 'Media type for attachFromUrl; the response header otherwise.' },
} as const

/** A file of the draft's own Space, available once the draft belongs to one. */
const SPACE_ATTACHMENT_SOURCE_PROPERTY = {
  attachFromSpaceFileId: {
    type: 'string',
    description: 'Space file id whose original bytes are copied. Only a file attached to the draft\'s own Space is accepted.',
  },
} as const

const DRAFT_PROPERTIES = {
  id: { type: 'string', required: true },
  revision: { type: 'string', required: true, description: 'Hash of the exact current draft contents.' },
  account: { ...NULLABLE_STRING, required: true },
  to: STRING_LIST,
  cc: STRING_LIST,
  bcc: STRING_LIST,
  subject: { type: 'string', required: true },
  text: { type: 'string', required: true },
  attachments: ATTACHMENT_METADATA_LIST,
  originUid: { ...NULLABLE_STRING, required: true },
  originMailbox: { ...NULLABLE_STRING, required: true },
  originReason: { ...NULLABLE_STRING, required: true },
  spaceId: { ...NULLABLE_STRING, required: true },
  agentSessionId: { ...NULLABLE_STRING, required: true },
} as const

const DRAFT_READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: DRAFT_PROPERTIES,
} as const
const DRAFT_WRITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...DRAFT_PROPERTIES,
    historyRevision: { type: 'integer', required: true, description: 'Newest durable history entry recorded by this call.' },
  },
} as const
const SNAPSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    to: STRING_LIST,
    cc: STRING_LIST,
    bcc: STRING_LIST,
    subject: { type: 'string', required: true },
    text: { type: 'string', required: true },
    account: { ...NULLABLE_STRING, required: true },
    attachments: ATTACHMENT_METADATA_LIST,
    aiText: { ...NULLABLE_STRING, required: true },
    inReplyTo: { ...NULLABLE_STRING, required: true },
    references: STRING_LIST,
    spaceId: { ...NULLABLE_STRING, required: true },
    originUid: { ...NULLABLE_STRING, required: true },
    originMailbox: { ...NULLABLE_STRING, required: true },
    originReason: { ...NULLABLE_STRING, required: true },
  },
} as const
const REVISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    revision: { type: 'integer', required: true },
    source: { type: 'string', required: true, enum: ['initial', 'human', 'agent', 'restore'] },
    instruction: { ...NULLABLE_STRING, required: true },
    createdAt: { type: 'string', required: true },
    snapshot: { ...SNAPSHOT_SCHEMA, required: true },
  },
} as const

/** Resolve the authenticated owner and the read-only restriction for one call. */
function draftActor(config: Config): { id: string; readOnly: boolean } {
  const id = config.ownerId
  if (id === undefined || id.length === 0) {
    throw new Error('faberloom: no authenticated identity (the gateway must inject tool-faberloom ownerId)')
  }
  return { id, readOnly: config.readOnly === true }
}

/** Resolve the mounted connections service at call time. */
function connections(ctx: Context): FaberLoomConnections {
  const service = ctx.get('faberloomConnections')
  if (service === undefined) throw new Error('faberloom: the connections service is not mounted')
  return service
}

/** Resolve the mounted inbound receiver at call time. */
function inbound(ctx: Context): FaberLoomInbound {
  const service = ctx.get('faberloomInbound')
  if (service === undefined) throw new Error('faberloom: the inbound receiver is not mounted')
  return service
}

function addresses(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(item => item.length > 0)
}

/** Append an automatic signature unless the body already ends with that exact text. */
function signedText(text: string, signature: string | null): string {
  const body = text.trimEnd()
  if (signature === null || signature.length === 0 || body.endsWith(signature)) return body
  return body.length === 0 ? signature : `${body}\n\n${signature}`
}

/** Remove only the automatic signature suffix supplied by the previous account. */
function withoutSignatureSuffix(text: string, signature: string | null): string {
  if (signature === null || signature.length === 0 || !text.endsWith(signature)) return text
  return text.slice(0, -signature.length).trimEnd()
}

function attachmentMetadata(attachment: DraftAttachment): { name: string; mediaType: string; size: number } {
  return { name: attachment.name, mediaType: attachment.mediaType, size: attachment.size }
}

/** Project a draft without attachment bytes or lifecycle fields that imply a send. */
function draftOutput(draft: FaberLoomEmailDraft) {
  return {
    id: draft.id,
    revision: draft.revision,
    account: draft.account,
    to: [...draft.to],
    cc: [...draft.cc],
    bcc: [...draft.bcc],
    subject: draft.subject,
    text: draft.text,
    attachments: draft.attachments.map(attachmentMetadata),
    originUid: draft.originUid,
    originMailbox: draft.originMailbox,
    originReason: draft.originReason,
    spaceId: draft.spaceId,
    agentSessionId: draft.agentSessionId,
  }
}

function snapshotOutput(snapshot: EmailDraftSnapshot) {
  return {
    to: [...snapshot.to],
    cc: [...snapshot.cc],
    bcc: [...snapshot.bcc],
    subject: snapshot.subject,
    text: snapshot.text,
    account: snapshot.account,
    attachments: snapshot.attachments.map(attachmentMetadata),
    aiText: snapshot.aiText,
    inReplyTo: snapshot.inReplyTo,
    references: [...snapshot.references],
    spaceId: snapshot.spaceId,
    originUid: snapshot.originUid,
    originMailbox: snapshot.originMailbox,
    originReason: snapshot.originReason,
  }
}

function revisionOutput(revision: FaberLoomEmailDraftRevision) {
  return {
    revision: revision.revision,
    source: revision.source,
    instruction: revision.instruction,
    createdAt: revision.createdAt,
    snapshot: snapshotOutput(revision.snapshot),
  }
}

function notFound(id: string): Error {
  return new Error(`faberloom: NOT_FOUND: draft ${id} is not available to this owner`)
}

function readOnly(): Error {
  return new Error('faberloom: READ_ONLY: this identity cannot change email drafts')
}

/**
 * The acting Space identity, so a Space file read runs under the same owner,
 * company, and read-only policy as every other Space tool.
 */
function spaceActor(config: Config): SpaceActor {
  const companyId = config.companyId
  return {
    id: draftActor(config).id,
    role: config.role ?? 'client_b2b',
    companyId: companyId === undefined || companyId.length === 0 ? undefined : companyId,
    readOnly: config.readOnly === true,
  }
}

/** Resolve the mounted Spaces service at call time. */
function spaces(ctx: Context): FaberLoomSpaces {
  const service = ctx.get('faberloomSpaces')
  if (service === undefined) throw new Error('faberloom: the spaces service is not mounted')
  return service
}

/** Source arguments one draft write may carry. */
interface AttachmentSourceArgs {
  /** Message uid whose original attachments are copied. */
  readonly attachFromUid?: number
  /** Connection of that message. */
  readonly attachFromConnectionId?: string
  /** Exact folder of that message. */
  readonly attachFromMailbox?: string
  /** Exact source attachment names. */
  readonly attachNames?: readonly string[]
  /** File of any Space the owner may read whose bytes are copied. */
  readonly attachFromSpaceFileId?: string
  /** Signed HTTPS URL whose bytes are copied. */
  readonly attachFromUrl?: string
  /** File name for `attachFromUrl`. */
  readonly attachUrlName?: string
  /** Media type for `attachFromUrl`. */
  readonly attachUrlMediaType?: string
}

/** Largest single document copied from a signed URL, in decoded bytes. */
const URL_ATTACHMENT_MAX_BYTES = 15_000_000

/** Media types a signed document may declare; anything else is refused. */
const URL_ATTACHMENT_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/octet-stream',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
])

/** Whether a host resolves to this machine or a private network. */
function privateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host.endsWith('.local')) return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host)
  if (v4 !== null) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return true
  }
  return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')
}

/**
 * Copy one document from the signed URL an MWT.ONE read returned. Only HTTPS is
 * accepted, private networks are refused, and the media type must be one of the
 * documents a reply carries; the bytes are re-measured after download.
 * @param url - signed HTTPS URL.
 * @param name - file name, or the last URL segment.
 * @param mediaType - explicit media type, or the response header.
 * @returns the document with its bytes.
 */
async function fetchUrlAttachment(url: string, name?: string, mediaType?: string): Promise<DraftAttachment> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('faberloom: ATTACHMENT_URL_INVALID: the URL is not absolute')
  }
  if (parsed.protocol !== 'https:') throw new Error('faberloom: ATTACHMENT_URL_INVALID: only HTTPS URLs are accepted')
  if (privateHost(parsed.hostname)) throw new Error('faberloom: ATTACHMENT_URL_INVALID: a private network address is refused')
  const response = await fetch(parsed, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`faberloom: ATTACHMENT_URL_FAILED: the document answered ${String(response.status)}`)
  const declared = mediaType ?? response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!URL_ATTACHMENT_MEDIA_TYPES.has(declared)) {
    throw new Error(`faberloom: ATTACHMENT_URL_UNSUPPORTED: the document declares '${declared || 'no media type'}'`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > URL_ATTACHMENT_MAX_BYTES) {
    throw new Error('faberloom: ATTACHMENT_URL_TOO_LARGE: the document exceeds 15 MB')
  }
  const segment = parsed.pathname.split('/').filter(part => part.length > 0).at(-1) ?? 'adjunto'
  const filename = name?.trim() || decodeURIComponent(segment)
  return { name: filename, mediaType: declared, contentBase64: bytes.toString('base64'), size: bytes.byteLength }
}

/**
 * Read every requested document as real bytes, keyed by name so a later source
 * replaces an earlier one with the same name. Mail attachments keep the stored
 * bytes; a Space file is read only when it belongs to the draft's own Space.
 * @param ctx - context carrying the inbound reader and Spaces.
 * @param config - deployment identity and policy.
 * @param owner - draft owner.
 * @param args - source message, Space file, or signed URL selection.
 * @returns the selected documents, already converted to stored bytes.
 */
async function sourceAttachments(
  ctx: Context,
  config: Config,
  owner: string,
  args: AttachmentSourceArgs,
): Promise<Map<string, DraftAttachment>> {
  if (args.attachNames !== undefined && args.attachFromUid === undefined) {
    throw new Error('faberloom: attachNames requires attachFromUid')
  }
  const added = new Map<string, DraftAttachment>()
  if (args.attachFromUid !== undefined) {
    const content = await inbound(ctx).readEmail(owner, args.attachFromUid, args.attachFromConnectionId, args.attachFromMailbox)
    const selected = args.attachNames === undefined
      ? content.attachments
      : args.attachNames.map((name) => {
        const attachment = content.attachments.find(candidate => candidate.name === name)
        if (attachment === undefined) throw new Error(`faberloom: ATTACHMENT_NOT_FOUND: ${name}`)
        return attachment
      })
    for (const attachment of selected) {
      added.set(attachment.name, {
        name: attachment.name,
        mediaType: attachment.mediaType,
        contentBase64: attachment.contentBase64,
        size: Buffer.byteLength(attachment.contentBase64, 'base64'),
      })
    }
  }
  if (args.attachFromSpaceFileId !== undefined) {
    const file = await spaces(ctx).readFile(spaceActor(config), args.attachFromSpaceFileId)
    added.set(file.name, {
      name: file.name,
      mediaType: file.mediaType,
      contentBase64: file.contentBase64,
      size: file.size,
    })
  }
  if (args.attachFromUrl !== undefined) {
    const fetched = await fetchUrlAttachment(args.attachFromUrl, args.attachUrlName, args.attachUrlMediaType)
    added.set(fetched.name, fetched)
  }
  return added
}

/** Project stored attachments into the write input. */
function attachmentInputs(files: readonly DraftAttachment[]): EmailDraftAttachmentInput[] {
  return files.map(attachment => ({
    name: attachment.name,
    mediaType: attachment.mediaType,
    contentBase64: attachment.contentBase64,
    size: attachment.size,
  }))
}

/**
 * Build the exact attachment list for an update. Existing files keep their
 * stored bytes; source files carry the original bytes and later names replace
 * earlier entries with the same name.
 */
async function draftAttachments(
  ctx: Context,
  config: Config,
  owner: string,
  draft: FaberLoomEmailDraft,
  args: AttachmentSourceArgs & { readonly keepAttachments?: readonly string[] },
): Promise<EmailDraftAttachmentInput[] | undefined> {
  if (args.attachNames !== undefined && args.attachFromUid === undefined) {
    throw new Error('faberloom: attachNames requires attachFromUid')
  }
  const noSource = args.keepAttachments === undefined
    && args.attachFromUid === undefined
    && args.attachFromSpaceFileId === undefined
    && args.attachFromUrl === undefined
  if (noSource) return undefined
  const kept = args.keepAttachments === undefined
    ? [...draft.attachments]
    : args.keepAttachments.map((name): DraftAttachment => {
      const attachment = draft.attachments.find(candidate => candidate.name === name)
      if (attachment === undefined) throw new Error(`faberloom: ATTACHMENT_NOT_FOUND: ${name}`)
      return attachment
    })
  const added = await sourceAttachments(ctx, config, owner, args)
  return attachmentInputs([
    ...kept.filter(attachment => !added.has(attachment.name)),
    ...added.values(),
  ])
}

/** One address per entry of a raw header value, lowercased. */
function headerAddresses(value: string | null | undefined): string[] {
  if (value === null || value === undefined) return []
  return [...value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu)].map(match => match[0].toLowerCase())
}

/**
 * The owner's mailbox the message was addressed to: the first `To` address that
 * belongs to an IMAP connection, then the first matching `Cc` address. A message
 * delivered to several mailboxes is answered from the one it names.
 * @param envelope - the message being answered, when its uid was supplied.
 * @param rows - the owner's saved connections.
 * @returns the mailbox address, or undefined when the message names none of them.
 */
function addressedMailbox(envelope: ImapMessage | undefined, rows: readonly FaberLoomConnection[]): string | undefined {
  if (envelope === undefined) return undefined
  const mailboxes = rows.filter(row => row.kind === 'imap' && typeof row.username === 'string')
  for (const field of [envelope.to, envelope.cc]) {
    for (const address of headerAddresses(field)) {
      const row = mailboxes.find(candidate => candidate.username?.toLowerCase() === address)
      if (row?.username !== undefined && row.username !== null) return row.username
    }
  }
  return undefined
}

/**
 * Root `Message-ID` of the thread a message belongs to: the first id of its
 * `References` chain, or the answered id when the message carries no chain.
 * @param envelope - the message being answered, when its uid was supplied.
 * @param inReplyTo - the id the draft answers.
 * @returns the thread key, or null when no id is available.
 */
function threadRoot(envelope: ImapMessage | undefined, inReplyTo: string | undefined): string | null {
  const first = envelope?.references === null || envelope?.references === undefined
    ? undefined
    : /<[^>]+>/u.exec(envelope.references)?.[0]
  return first ?? inReplyTo ?? envelope?.messageId ?? null
}

/**
 * Register initial, read, CAS update, history, and CAS restore tools. None of
 * them calls a mail transport or changes mailbox contents.
 * @param ctx - Cordis context carrying tools, connections, and inbound services.
 * @param config - deployment identity and read-only policy.
 */export function registerEmailDraftTools(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'faberloom_email_draft',
    description: 'Prepare an email draft for the owner to review, written in the owner\'s voice. Never sends: the owner approves it in the Email panel. Pass the uid of the message it answers so the draft keeps its account and thread. When the email must carry a document that already exists in the mailbox (an invoice, a packing list, a proforma), copy it with attachFromUid and attachNames instead of writing that it will be sent separately.',
    parameters: {
      to: { type: 'string', required: true, description: 'Recipient addresses, comma-separated.' },
      subject: { type: 'string', required: true, description: 'Subject line.' },
      text: { type: 'string', required: true, description: 'Plain-text body, in the owner\'s voice.' },
      cc: { type: 'string', description: 'Carbon-copy addresses, comma-separated.' },
      bcc: { type: 'string', description: 'Blind carbon-copy addresses, comma-separated.' },
      uid: { type: 'integer', description: 'The message uid this draft answers (from faberloom_mail_search); preserves its account and Message-ID.' },
      connectionId: { type: 'string', description: 'The connectionId returned with that message; the primary mailbox otherwise.' },
      account: { type: 'string', description: 'Mailbox address the draft leaves from; inferred from uid when omitted.' },
      inReplyTo: { type: 'string', description: 'Message-ID this draft answers, when it is not the uid message.' },
      ...MAIL_ATTACHMENT_SOURCE_PROPERTIES,
    },
    output: {
      schema: DRAFT_WRITE_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Draft "${value.subject}" (${value.id}) is ready for owner review at revision ${value.revision}; initial history revision ${String(value.historyRevision)}. No mail was sent.`,
      }],
    },
    execute: async (args) => {
      const identity = draftActor(config)
      if (identity.readOnly) throw readOnly()
      const owner = identity.id
      const service = connections(ctx)
      const rows = await service.list(owner)
      const mailbox = args.connectionId === undefined
        ? rows.find(row => row.kind === 'imap' && row.primary) ?? rows.find(row => row.kind === 'imap')
        : rows.find(row => row.id === args.connectionId)
      const envelope = args.uid === undefined
        ? undefined
        : (await inbound(ctx).listInbox(owner, 200, args.connectionId)).find(message => message.uid === args.uid)
      const inReplyTo = args.inReplyTo ?? envelope?.messageId ?? undefined
      // The mailbox a reply leaves from is the one the message was addressed to,
      // not the watcher that happened to report it: the same message reaches
      // several mailboxes, and answering from the wrong one exposes another.
      const account = args.account
        ?? addressedMailbox(envelope, rows)
        ?? mailbox?.username
        ?? undefined
      const threadKey = threadRoot(envelope, inReplyTo)
      if (args.uid !== undefined && threadKey !== null && inReplyTo !== undefined) {
        const state = await service.mailThread(owner, account ?? null, threadKey)
        if (state !== null && state.messageKey === inReplyTo) {
          if (state.status === 'sent') throw new Error(`faberloom: MAIL_ALREADY_ANSWERED: the message ${inReplyTo} was already answered`)
          if (state.status === 'dismissed') throw new Error('faberloom: MAIL_THREAD_DISMISSED: the owner discarded this reply')
        }
        if (state !== null && state.status === 'drafted' && state.draftId !== null && await service.getDraft(owner, state.draftId) !== null) {
          throw new Error(`faberloom: MAIL_DRAFT_EXISTS: the thread already has draft ${state.draftId}`)
        }
      }
      const signatureText = await service.signatureFor(owner, account ?? null)
      const text = signedText(args.text, signatureText)
      const signature = signatureText === null ? null : await service.signatureContent(owner, account ?? null)
      const originUid = args.uid === undefined
        ? null
        : args.connectionId === undefined ? String(args.uid) : `${args.connectionId}:${String(args.uid)}`
      const attached = await sourceAttachments(ctx, config, owner, args)
      const draft = await service.saveDraft(owner, {
        to: addresses(args.to),
        ...args.cc === undefined ? {} : { cc: addresses(args.cc) },
        ...args.bcc === undefined ? {} : { bcc: addresses(args.bcc) },
        subject: args.subject,
        text,
        html: draftHtml(text, signature),
        aiText: text,
        ...attached.size === 0 ? {} : { attachments: attachmentInputs([...attached.values()]) },
        ...account === undefined ? {} : { account },
        ...inReplyTo === undefined ? {} : {
          inReplyTo,
          references: threadKey === null || threadKey === inReplyTo ? [inReplyTo] : [threadKey, inReplyTo],
        },
        originUid,
        originMailbox: null,
        originReason: args.uid === undefined ? 'agent-draft' : 'agent-reply',
      })
      const revision = await service.recordDraftRevision(owner, draft, { source: 'initial' })
      if (threadKey !== null && inReplyTo !== undefined) {
        await service.rememberMailThread(owner, {
          account: account ?? null,
          threadKey,
          messageKey: inReplyTo,
          status: 'drafted',
          draftId: draft.id,
        })
      }
      return { ...draftOutput(draft), historyRevision: revision.revision }
    },
    presentCall: args => ({ card: 'generic', title: 'Draft email', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_email_draft_read',
    description: 'Read one draft owned by the current actor: recipients, body, account, origin, session binding, current content revision, and attachment metadata without bytes. Read-only and never sends.',
    parameters: {
      draftId: { type: 'string', required: true, description: 'Draft id returned by faberloom_email_draft.' },
    },
    output: {
      schema: DRAFT_READ_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Draft "${value.subject}" (${value.id}) is at revision ${value.revision}, with ${String(value.attachments.length)} attachments. No mail was sent by this read.`,
      }],
    },
    execute: async (args) => {
      const owner = draftActor(config).id
      const draft = await connections(ctx).getDraft(owner, args.draftId)
      if (draft === null) throw notFound(args.draftId)
      return draftOutput(draft)
    },
    presentCall: args => ({ card: 'generic', title: 'Read email draft', kind: 'read', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_email_draft_update',
    description: 'Edit one owned draft with an atomic expectedRevision check. Omitted fields stay unchanged. Records a new agent history revision and returns the actual saved draft. Never sends. Read the draft again after DRAFT_CHANGED. Copy a document the email must carry with the attachment arguments instead of promising to send it apart.',
    parameters: {
      draftId: { type: 'string', required: true },
      expectedRevision: { type: 'string', required: true, description: 'The exact revision returned by draft read or the previous update.' },
      instruction: { type: 'string', required: true, description: 'User instruction this edit applies; stored with the agent history revision.' },
      to: { type: 'string', description: 'Replacement recipient addresses, comma-separated.' },
      cc: { type: 'string', description: 'Replacement carbon-copy addresses, comma-separated.' },
      bcc: { type: 'string', description: 'Replacement blind carbon-copy addresses, comma-separated.' },
      account: { type: 'string', description: 'Replacement outgoing mailbox; empty string selects the primary account.' },
      subject: { type: 'string', description: 'Replacement subject.' },
      text: { type: 'string', description: 'Replacement plain-text body.' },
      keepAttachments: { type: 'array', items: { type: 'string' }, description: 'Exact names of existing attachments to retain. Omitted keeps all except same-name replacements.' },
      ...MAIL_ATTACHMENT_SOURCE_PROPERTIES,
      ...SPACE_ATTACHMENT_SOURCE_PROPERTY,
    },
    output: {
      schema: DRAFT_WRITE_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Draft "${value.subject}" (${value.id}) is now at revision ${value.revision}; agent history revision ${String(value.historyRevision)} was recorded. No mail was sent.`,
      }],
    },
    execute: async (args) => {
      const identity = draftActor(config)
      if (identity.readOnly) throw readOnly()
      const service = connections(ctx)
      const draft = await service.getDraft(identity.id, args.draftId)
      if (draft === null) throw notFound(args.draftId)
      const account = args.account === undefined ? draft.account : args.account.length === 0 ? null : args.account
      let text = args.text ?? draft.text
      if (account !== draft.account) {
        text = withoutSignatureSuffix(text, await service.signatureFor(identity.id, draft.account))
      }
      const signatureText = await service.signatureFor(identity.id, account)
      text = signedText(text, signatureText)
      const signature = signatureText === null ? null : await service.signatureContent(identity.id, account)
      const html = args.text === undefined && account === draft.account ? undefined : draftHtml(text, signature)
      const attachments = await draftAttachments(ctx, config, identity.id, draft, args)
      const input: EmailDraftInput = {
        to: args.to === undefined ? draft.to : addresses(args.to),
        cc: args.cc === undefined ? draft.cc : addresses(args.cc),
        bcc: args.bcc === undefined ? draft.bcc : addresses(args.bcc),
        subject: args.subject ?? draft.subject,
        text,
        ...html === undefined ? {} : { html },
        account,
        ...attachments === undefined ? {} : { attachments },
        aiText: draft.aiText,
        inReplyTo: draft.inReplyTo,
        references: draft.references,
        spaceId: draft.spaceId,
        originUid: draft.originUid,
        originMailbox: draft.originMailbox,
        originReason: draft.originReason,
      }
      const written = await service.updateDraftAndRecord(identity.id, args.draftId, args.expectedRevision, input, {
        source: 'agent', instruction: args.instruction,
      })
      return { ...draftOutput(written.draft), historyRevision: written.revision.revision }
    },
    presentCall: args => ({ card: 'generic', title: 'Update email draft', kind: 'edit', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_email_draft_history',
    description: 'List one owned draft\'s durable revisions oldest first, including source, instruction, date, and complete snapshots with attachment metadata but no bytes. Read-only and never sends.',
    parameters: {
      draftId: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { revisions: { type: 'array', required: true, items: REVISION_SCHEMA } },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Draft ${args.draftId} has ${String(value.revisions.length)} recorded revisions, oldest first. No mail was sent by this read.`,
      }],
    },
    execute: async (args) => {
      const owner = draftActor(config).id
      const service = connections(ctx)
      const draft = await service.getDraft(owner, args.draftId)
      if (draft === null) throw notFound(args.draftId)
      const revisions = await service.listDraftRevisions(owner, args.draftId)
      return { revisions: revisions.map(revisionOutput).sort((left, right) => left.revision - right.revision) }
    },
    presentCall: args => ({ card: 'generic', title: 'Read email draft history', kind: 'read', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_email_draft_restore',
    description: 'Restore one owned draft to a historical revision using atomic expectedRevision validation. The restore appends history instead of deleting later revisions and returns the actual restored draft. Never sends.',
    parameters: {
      draftId: { type: 'string', required: true },
      expectedRevision: { type: 'string', required: true, description: 'Current content revision read immediately before restore.' },
      revision: { type: 'integer', required: true, description: 'One-based history revision number to restore.' },
      instruction: { type: 'string', required: true, description: 'User instruction that authorizes this restore.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          draft: { ...DRAFT_READ_SCHEMA, required: true },
          revision: { ...REVISION_SCHEMA, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Draft "${value.draft.subject}" (${value.draft.id}) is at restored content revision ${value.draft.revision}; restore history revision ${String(value.revision.revision)} was appended. No mail was sent.`,
      }],
    },
    execute: async (args) => {
      const identity = draftActor(config)
      if (identity.readOnly) throw readOnly()
      const service = connections(ctx)
      const draft = await service.getDraft(identity.id, args.draftId)
      if (draft === null) throw notFound(args.draftId)
      const restored = await service.restoreDraftRevision(identity.id, args.draftId, args.revision, args.expectedRevision, args.instruction)
      return { draft: draftOutput(restored.draft), revision: revisionOutput(restored.revision) }
    },
    presentCall: args => ({ card: 'generic', title: 'Restore email draft', kind: 'edit', rawInput: args }),
  }))
}
