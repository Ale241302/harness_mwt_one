/**
 * Native product connections (`ctx.faberloomConnections`): the per-user IMAP,
 * SMTP, and knowledge-backup settings the owner enters. They are FaberLoom's
 * own data and never an MWT.ONE MCP operation: each identity keeps its own
 * rows, the password is stored but never returned, and `probe` checks the
 * configuration for real (an IMAP or SMTP login, or a writable backup
 * destination). `sendMail` delivers a message through the owner's SMTP row.
 * @module @deepseek-ai/dsh-faberloom-connections
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { connect as connectTcp, type Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'
import { Context, Service } from '@deepseek-ai/cordis'
import { connectionsDomainSpec, type ConnectionRecord, type DraftRecord, type DraftRevisionRecord, type EmailPolicyRecord, type SendIntentRecord, type SignatureRecord } from './spec.ts'
import { DomainError, type Domain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { probeSmtp, sendSmtp, SmtpDeliveryError } from './smtp.ts'
import { assertEgressAllowed, checkEgress, egressPolicyFromEnv } from './egress.ts'
import { mwtServerName, requestMwtDeviceToken, signInMwtConsole } from './mwt-onboarding.ts'
import type { ConnectionInput, ConnectionProbe, EmailAutoPolicy, EmailAutoPolicyInput, EmailDraftInput, EmailSignatureInput, FaberLoomConnection, FaberLoomEmailDraft, FaberLoomEmailDraftRevision, FaberLoomEmailSignature, FaberLoomSendIntent, DraftAttachment, DraftRevisionWriteResult, ImapCredentials, OutgoingMail, RecordDraftRevisionInput, RestoreDraftRevisionResult, SentMail, SmtpCredentials } from './types.ts'

export type * from './types.ts'
export * from './mwt-oauth.ts'
export * from './mwt-onboarding.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomConnections: FaberLoomConnections
  }
}

/** Largest single file a draft may carry, in decoded bytes. */
const MAX_ATTACHMENT_BYTES = 15_000_000

/** Largest attachment set a draft may carry, in decoded bytes. */
const MAX_DRAFT_ATTACHMENT_BYTES = 30_000_000

/** Draft update and send failures the panel distinguishes. */
export type SendErrorCode =
  | 'DRAFT_CHANGED'
  | 'SNAPSHOT_CHANGED'
  | 'SEND_IN_FLIGHT'
  | 'SEND_RESULT_UNKNOWN'
  | 'NO_SENDER_FOR_ACCOUNT'
  | 'NOT_FOUND'
  | 'NOT_DRAFT'

/** A draft update or send refused or left unknown with a stable reason. */
export class FaberLoomSendError extends Error {
  /**
   * @param code - stable reason the panel maps to copy and a decision.
   * @param message - human-readable detail.
   */
  constructor(readonly code: SendErrorCode, message: string) {
    super(message)
    this.name = 'FaberLoomSendError'
  }
}

/** SHA-256 of one string, hex. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * The exact restorable state one edit or approval covers: envelope, headers,
 * body, file bytes, origin, Space, and AI baseline. Session binding stays out.
 * @param record - the stored draft.
 * @returns the revision hash.
 */
function draftRevision(record: DraftRecord): string {
  return sha256(JSON.stringify({
    from: record.account,
    to: record.to,
    cc: record.cc,
    bcc: record.bcc,
    subject: record.subject,
    text: record.text,
    inReplyTo: record.inReplyTo,
    references: record.references,
    aiText: record.aiText,
    spaceId: record.spaceId,
    originUid: record.originUid,
    originMailbox: record.originMailbox,
    originReason: record.originReason,
    attachments: record.attachments.map(attachment => ({
      name: attachment.name,
      mediaType: attachment.mediaType,
      sha256: sha256(attachment.contentBase64),
    })),
  }))
}

/** Map one durable draft record to the consumer-facing draft. */
function toDraft(id: string, record: DraftRecord): FaberLoomEmailDraft {
  return {
    id,
    to: record.to,
    cc: record.cc,
    bcc: record.bcc,
    subject: record.subject,
    text: record.text,
    account: record.account ?? null,
    attachments: record.attachments,
    revision: draftRevision(record),
    status: record.status,
    aiText: record.aiText ?? null,
    inReplyTo: record.inReplyTo,
    references: record.references,
    spaceId: record.spaceId,
    originUid: record.originUid,
    originReason: record.originReason,
    originMailbox: record.originMailbox,
    agentSessionId: record.agentSessionId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sentAt: record.sentAt,
  }
}

/** Build a complete draft write, retaining fields whose input contract says omission preserves them. */
function buildDraftRecord(
  ownerId: string,
  input: EmailDraftInput,
  existing: DraftRecord | undefined,
  now: string,
): DraftRecord {
  // Omitted attachments keep the stored set; a provided list is the exact set
  // the reviewer sees. Bytes stay with the draft so the send uses what was read.
  const previous = existing?.attachments ?? []
  let attachments: readonly DraftAttachment[]
  if (input.attachments === undefined) {
    attachments = previous
  } else {
    const next: DraftAttachment[] = []
    for (const item of input.attachments) {
      if (item.contentBase64 === undefined) {
        const kept = previous.find(candidate => candidate.name === item.name)
        if (kept !== undefined) next.push(kept)
        continue
      }
      const size = Buffer.byteLength(item.contentBase64, 'base64')
      if (size > MAX_ATTACHMENT_BYTES) {
        throw new Error(`faberloom: el adjunto '${item.name}' supera el límite de 15 MB`)
      }
      next.push({ name: item.name, mediaType: item.mediaType, contentBase64: item.contentBase64, size })
    }
    const total = next.reduce((sum, attachment) => sum + attachment.size, 0)
    if (total > MAX_DRAFT_ATTACHMENT_BYTES) {
      throw new Error('faberloom: los adjuntos del borrador superan el límite de 30 MB')
    }
    attachments = next
  }
  return {
    ownerId,
    to: [...input.to],
    cc: input.cc === undefined ? [] : [...input.cc],
    bcc: input.bcc === undefined ? [] : [...input.bcc],
    subject: input.subject,
    text: input.text,
    status: 'draft',
    account: input.account === undefined ? existing?.account ?? null : input.account,
    attachments: [...attachments],
    aiText: input.aiText ?? null,
    inReplyTo: input.inReplyTo ?? null,
    references: input.references === undefined ? existing?.references ?? [] : [...input.references],
    spaceId: input.spaceId ?? null,
    originUid: input.originUid === undefined ? existing?.originUid ?? null : input.originUid,
    originReason: input.originReason === undefined ? existing?.originReason ?? null : input.originReason,
    originMailbox: input.originMailbox === undefined ? existing?.originMailbox ?? null : input.originMailbox,
    agentSessionId: existing?.agentSessionId ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    sentAt: null,
  }
}

/** Copy every restorable draft field; the agent binding remains only on the draft. */
function snapshotOfDraft(draft: FaberLoomEmailDraft): DraftRevisionRecord['snapshot'] {
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
    originReason: draft.originReason,
    originMailbox: draft.originMailbox,
  }
}

/** Map one durable record to the consumer-facing connection (secret omitted). */
function toConnection(id: string, record: ConnectionRecord): FaberLoomConnection {
  return {
    id,
    kind: record.kind,
    label: record.label,
    host: record.host,
    port: record.port,
    secure: record.secure,
    starttls: record.starttls === true,
    primary: record.primary === true,
    username: record.username,
    hasSecret: record.secret !== null && record.secret.length > 0,
    destination: record.destination,
    retentionDays: record.retentionDays,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** How one IMAP probe reaches the server. */
interface ImapTarget {
  readonly host: string
  readonly port: number
  /** Implicit TLS from the first byte (993). */
  readonly secure: boolean
  /** Upgrade a plaintext connection with STARTTLS after the greeting (143). */
  readonly starttls: boolean
  readonly user: string
  readonly password: string
}

/** Logs in over IMAP (implicit TLS, STARTTLS, or plaintext) and reports the outcome. */
async function probeImap(target: ImapTarget): Promise<ConnectionProbe> {
  const { host, port, secure, starttls, user, password } = target
  const insecure = !secure && !starttls
  return await new Promise<ConnectionProbe>((resolve) => {
    let settled = false
    let socket: Socket
    try {
      socket = secure
        ? connectTls({ host, port, servername: host, timeout: 8000 })
        : connectTcp({ host, port, timeout: 8000 })
    } catch (error) {
      resolve({ ok: false, detail: String(error) })
      return
    }
    const finish = (result: ConnectionProbe): void => {
      if (settled) return
      settled = true
      try { socket.destroy() } catch { /* the socket may already be gone */ }
      resolve(result)
    }
    let stage: 'greeting' | 'starttls' | 'login' = 'greeting'
    let buffer = ''
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      if (stage === 'greeting' && /^\* OK/m.test(buffer)) {
        buffer = ''
        if (starttls) {
          stage = 'starttls'
          socket.write('a0 STARTTLS\r\n')
          return
        }
        stage = 'login'
        socket.write(`a1 LOGIN "${user}" "${password}"\r\n`)
        return
      }
      if (stage === 'starttls' && /^a0 (OK|NO|BAD)/m.test(buffer)) {
        if (!/^a0 OK/m.test(buffer)) {
          finish({ ok: false, detail: 'el servidor no aceptó STARTTLS' })
          return
        }
        buffer = ''
        // Stop reading the plaintext stream before handing the socket to TLS.
        socket.off('data', onData)
        const encrypted = connectTls({ socket, servername: host })
        encrypted.setTimeout(8000, () => { finish({ ok: false, detail: 'tiempo de espera agotado' }) })
        encrypted.on('error', (error: Error) => { finish({ ok: false, detail: error.message }) })
        encrypted.on('data', onData)
        socket = encrypted
        stage = 'login'
        socket.write(`a1 LOGIN "${user}" "${password}"\r\n`)
        return
      }
      if (stage === 'login' && /^a1 (OK|NO|BAD)/m.test(buffer)) {
        finish(/^a1 OK/m.test(buffer)
          ? { ok: true, detail: insecure ? 'inicio de sesión IMAP correcto (sin cifrado)' : 'inicio de sesión IMAP correcto' }
          : { ok: false, detail: 'el servidor rechazó las credenciales' })
      }
    }
    socket.setTimeout(8000, () => { finish({ ok: false, detail: 'tiempo de espera agotado' }) })
    socket.on('error', (error: Error) => { finish({ ok: false, detail: error.message }) })
    socket.on('data', onData)
  })
}

/** Verifies a backup destination is writable when it is a host path. */
async function probeBackup(destination: string): Promise<ConnectionProbe> {
  if (!destination.startsWith('/')) {
    return { ok: false, detail: 'un destino remoto (rclone) se comprueba desde el flujo de respaldo, no aquí' }
  }
  const probe = join(destination, `.faberloom-probe-${randomUUID().slice(0, 8)}`)
  try {
    await mkdir(destination, { recursive: true })
    await writeFile(probe, 'ok', 'utf8')
    await rm(probe, { force: true })
    return { ok: true, detail: 'destino escribible' }
  } catch (error) {
    return { ok: false, detail: `no se puede escribir en el destino: ${String(error)}` }
  }
}

/** One company a console sign-in connected. */
export interface MwtConnectedCompany {
  /** Console company key used in the MCP server name. */
  readonly key: string
  /** Company display name. */
  readonly name: string
}

/** Result of one MWT.ONE sign-in and device-token onboarding. */
export interface MwtConnectResult {
  /** Console account email. */
  readonly email: string
  /** Companies whose MCP servers were saved. */
  readonly companies: readonly MwtConnectedCompany[]
}

/** The MCP registry face the onboarding writes to. */
interface MwtMcpRegistry {
  list(ownerId: string): Promise<readonly { readonly name: string }[]>
  save(ownerId: string, input: {
    readonly name: string
    readonly transport: { readonly transport: 'streamable-http'; readonly url: string }
    readonly headers?: Readonly<Record<string, string>>
    readonly enabled?: boolean
  }): Promise<unknown>
  remove(ownerId: string, name: string): Promise<boolean>
}

/**
 * The product connections service: per-user integrations owned by FaberLoom.
 */
export class FaberLoomConnections extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof connectionsDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   */
  /** Egress policy read once at load: the servers this deployment authorizes. */
  private readonly egress = egressPolicyFromEnv()

  constructor(ctx: Context) {
    super(ctx, 'faberloomConnections')
  }

  private domain(): Promise<Domain<typeof connectionsDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(connectionsDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.connectionsDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async table(): Promise<KvTable<string, ConnectionRecord>> { return (await this.domain()).table('connections') }

  /** The owner's email-draft table handle. */
  private async draftTable(): Promise<KvTable<string, DraftRecord>> { return (await this.domain()).table('drafts') }

  /** The durable draft-history table handle. */
  private async draftRevisionTable(): Promise<KvTable<string, DraftRevisionRecord>> { return (await this.domain()).table('draft_revisions') }

  /** Per-service history tails; operations for different drafts remain independent. */
  private readonly draftHistoryChains = new Map<string, Promise<void>>()

  /** The send-intent table handle. */
  private async intentTable(): Promise<KvTable<string, SendIntentRecord>> { return (await this.domain()).table('send_intents') }

  /** Drafts with a live send in this process; a second click refuses. */
  private readonly sending = new Set<string>()

  /** The auto-send policy table handle. */
  private async policyTable(): Promise<KvTable<string, EmailPolicyRecord>> { return (await this.domain()).table('policies') }

  /** Stable policy key for one owner and optional space. */
  private policyKey(ownerId: string, spaceId: string | null): string {
    return `${ownerId}|${spaceId ?? ''}`
  }

  /**
   * Read the auto-send policy for one owner (and space, when scoped).
   * @param ownerId - the owning identity.
   * @param spaceId - the space, or null for the owner-wide policy.
   * @returns the policy, defaulting to disabled with a threshold of three.
   */
  async emailPolicy(ownerId: string, spaceId: string | null = null): Promise<EmailAutoPolicy> {
    const record = (await this.policyTable()).get(this.policyKey(ownerId, spaceId))
    if (record === undefined) return { enabled: false, threshold: 3, cleanSends: 0 }
    return { enabled: record.enabled, threshold: record.threshold, cleanSends: record.cleanSends }
  }

  /**
   * Save the auto-send policy, preserving the accumulated clean-send count.
   * @param ownerId - the owning identity.
   * @param input - the policy fields.
   * @returns the stored policy.
   */
  async saveEmailPolicy(ownerId: string, input: EmailAutoPolicyInput): Promise<EmailAutoPolicy> {
    const spaceId = input.spaceId ?? null
    const existing = (await this.policyTable()).get(this.policyKey(ownerId, spaceId))
    return await this.putPolicy(ownerId, spaceId, {
      enabled: input.enabled,
      threshold: input.threshold,
      cleanSends: existing?.cleanSends ?? 0,
    })
  }

  /** Write one policy record wholesale. */
  private async putPolicy(
    ownerId: string,
    spaceId: string | null,
    policy: EmailAutoPolicy,
  ): Promise<EmailAutoPolicy> {
    const key = this.policyKey(ownerId, spaceId)
    const record: EmailPolicyRecord = {
      ownerId,
      spaceId,
      enabled: policy.enabled,
      threshold: policy.threshold,
      cleanSends: policy.cleanSends,
      updatedAt: new Date().toISOString(),
    }
    const table = await this.policyTable()
    if (table.get(key) === undefined) await table.put(key, record)
    else await table.update(key, () => record)
    return { enabled: record.enabled, threshold: record.threshold, cleanSends: record.cleanSends }
  }

  /** The signature table handle. */
  private async signatureTable(): Promise<KvTable<string, SignatureRecord>> { return (await this.domain()).table('signatures') }

  /** Stable signature key for one owner and optional account. */
  private signatureKey(ownerId: string, account: string | null): string {
    return `${ownerId}|${account ?? ''}`
  }

  /**
   * List the owner's signatures, one per configured account.
   * @param ownerId - the owning identity.
   * @returns the signatures, newest change first.
   */
  async listSignatures(ownerId: string): Promise<FaberLoomEmailSignature[]> {
    const out: FaberLoomEmailSignature[] = []
    for (const [, record] of (await this.signatureTable()).entries()) {
      if (record.ownerId !== ownerId) continue
      out.push({ account: record.account, text: record.text, auto: record.auto, updatedAt: record.updatedAt })
    }
    out.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    return out
  }

  /**
   * Save the signature of one outgoing account. An empty text deletes it, so a
   * cleared editor never leaves a stale signature behind.
   * @param ownerId - the owning identity.
   * @param input - account, body and whether it starts automatically.
   * @returns the stored signature, or null when the body was empty.
   */
  async saveSignature(ownerId: string, input: EmailSignatureInput): Promise<FaberLoomEmailSignature | null> {
    const account = input.account ?? null
    const key = this.signatureKey(ownerId, account)
    const table = await this.signatureTable()
    const text = input.text.trim()
    if (text.length === 0) {
      await table.delete(key)
      return null
    }
    const record: SignatureRecord = {
      ownerId,
      account,
      text,
      auto: input.auto ?? true,
      updatedAt: new Date().toISOString(),
    }
    if (table.get(key) === undefined) await table.put(key, record)
    else await table.update(key, () => record)
    return { account: record.account, text: record.text, auto: record.auto, updatedAt: record.updatedAt }
  }

  /**
   * Remove one signature.
   * @param ownerId - the owning identity.
   * @param account - outgoing mailbox; null is the primary account.
   * @returns true when a signature existed.
   */
  async deleteSignature(ownerId: string, account: string | null): Promise<boolean> {
    return await (await this.signatureTable()).delete(this.signatureKey(ownerId, account))
  }

  /**
   * Resolve the signature a send from one account starts with: the account's
   * own signature, or the primary one when the account has none.
   * @param ownerId - the owning identity.
   * @param account - outgoing mailbox; null is the primary account.
   * @returns the signature text, or null when none applies.
   */
  async signatureFor(ownerId: string, account: string | null): Promise<string | null> {
    const table = await this.signatureTable()
    const own = table.get(this.signatureKey(ownerId, account))
    if (own !== undefined && own.auto) return own.text
    if (account === null) return null
    const primary = table.get(this.signatureKey(ownerId, null))
    return primary !== undefined && primary.auto ? primary.text : null
  }

  /**
   * List one owner's email drafts, newest first.
   * @param ownerId - the owning identity.
   * @returns the drafts.
   */
  async listDrafts(ownerId: string): Promise<FaberLoomEmailDraft[]> {
    const out: FaberLoomEmailDraft[] = []
    for (const [id, record] of (await this.draftTable()).entries()) {
      if (record.ownerId === ownerId) out.push(toDraft(id, record))
    }
    out.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    return out
  }

  /**
   * Read one draft only when it belongs to the owner.
   * @param ownerId - the owning identity.
   * @param id - the draft id.
   * @returns the draft, or null when it is absent or owned by another identity.
   */
  async getDraft(ownerId: string, id: string): Promise<FaberLoomEmailDraft | null> {
    const record = (await this.draftTable()).get(id)
    if (record === undefined || record.ownerId !== ownerId) return null
    return toDraft(id, record)
  }

  /**
   * Bind an agent session without changing the reviewed message or its update instant.
   * @param ownerId - the owning identity.
   * @param id - the draft id.
   * @param sessionId - agent session to associate with the draft.
   * @param expectedSessionId - binding the caller reviewed; null reserves the first binding.
   * @param expectedRevision - exact restorable state used to build the session context, when seeded.
   * @returns the draft with its new binding.
   * @throws when the draft is absent, settled, foreign, or either expectation is stale.
   */
  async bindDraftSession(
    ownerId: string, id: string, sessionId: string, expectedSessionId: string | null, expectedRevision?: string,
  ): Promise<FaberLoomEmailDraft> {
    const table = await this.draftTable()
    const record = table.get(id)
    if (record === undefined || record.ownerId !== ownerId) throw new Error(`faberloom: draft ${id} not found`)
    const next = await table.update(id, (current) => {
      if (current.ownerId !== ownerId) throw new Error(`faberloom: draft ${id} not found`)
      if (current.status !== 'draft') throw new FaberLoomSendError('NOT_DRAFT', `faberloom: draft ${id} is already ${current.status}`)
      if ((current.agentSessionId ?? null) !== expectedSessionId) {
        throw new Error('faberloom: DRAFT_SESSION_CHANGED: another session was bound; reopen the draft')
      }
      if (expectedRevision !== undefined && draftRevision(current) !== expectedRevision) {
        throw new FaberLoomSendError('DRAFT_CHANGED', 'faberloom: DRAFT_CHANGED: the draft changed while its session was prepared')
      }
      return { ...current, agentSessionId: sessionId }
    })
    return toDraft(id, next)
  }

  /**
   * Create one new email draft. Existing ids are refused so every replacement
   * goes through the CAS and history operation.
   * @param ownerId - the owning identity.
   * @param input - the draft fields; `id` reserves a new id when supplied.
   * @returns the stored draft.
   * @throws when the supplied id already exists or belongs to another owner.
   */
  async saveDraft(ownerId: string, input: EmailDraftInput): Promise<FaberLoomEmailDraft> {
    const table = await this.draftTable()
    const now = new Date().toISOString()
    const id = input.id ?? randomUUID()
    const existing = table.get(id)
    if (existing !== undefined && existing.ownerId !== ownerId) throw new Error('faberloom: draft belongs to another owner')
    if (existing !== undefined) {
      throw new Error(`faberloom: draft ${id} already exists; use updateDraft with expectedRevision`)
    }
    const record = buildDraftRecord(ownerId, input, undefined, now)
    await table.put(id, record)
    return toDraft(id, record)
  }

  /**
   * Update a draft by compare-and-swap on its exact message revision. Ownership,
   * lifecycle, and the expected hash are checked against the record current at
   * the write-chain slot, before the replacement is constructed.
   * @param ownerId - the owning identity.
   * @param id - the draft id.
   * @param expectedRevision - message hash read by the caller before editing.
   * @param input - replacement fields; `input.id` does not select another record.
   * @returns the updated draft.
   * @throws {FaberLoomSendError} `NOT_FOUND` for an absent or foreign draft,
   *   `NOT_DRAFT` for a settled draft, or `DRAFT_CHANGED` for a stale hash.
   */
  async updateDraft(
    ownerId: string,
    id: string,
    expectedRevision: string,
    input: EmailDraftInput,
  ): Promise<FaberLoomEmailDraft> {
    const table = await this.draftTable()
    try {
      const next = await table.update(id, (current) => {
        if (current.ownerId !== ownerId) throw new FaberLoomSendError('NOT_FOUND', `faberloom: draft ${id} not found`)
        if (current.status !== 'draft') throw new FaberLoomSendError('NOT_DRAFT', `faberloom: draft ${id} is already ${current.status}`)
        if (draftRevision(current) !== expectedRevision) {
          throw new FaberLoomSendError('DRAFT_CHANGED', 'faberloom: DRAFT_CHANGED — el borrador cambió desde que lo revisaste; vuelve a revisarlo')
        }
        return buildDraftRecord(ownerId, input, current, new Date().toISOString())
      })
      return toDraft(id, next)
    } catch (error) {
      if (error instanceof DomainError && error.code === 'missing-key') {
        throw new FaberLoomSendError('NOT_FOUND', `faberloom: draft ${id} not found`)
      }
      throw error
    }
  }

  /**
   * Update and capture one draft in the same per-draft history chain, preventing
   * another product write from interleaving between its CAS and history append.
   * @param ownerId - the owning identity.
   * @param id - the draft id.
   * @param expectedRevision - exact restorable state the caller reviewed.
   * @param input - replacement fields.
   * @param history - source and instruction for the appended snapshot.
   * @returns the write result and its appended revision.
   */
  async updateDraftAndRecord(
    ownerId: string,
    id: string,
    expectedRevision: string,
    input: EmailDraftInput,
    history: RecordDraftRevisionInput,
  ): Promise<DraftRevisionWriteResult> {
    return await this.serializeDraftHistory(id, async () => {
      const draft = await this.updateDraft(ownerId, id, expectedRevision, input)
      const revision = await this.appendDraftRevision(ownerId, draft, history)
      return { draft, revision }
    })
  }

  /**
   * Run history operations for one draft in call order so their numbers cannot overlap.
   * @param draftId - draft whose history is serialized.
   * @param operation - capture or restore to run after earlier history operations.
   * @returns the operation result.
   */
  private async serializeDraftHistory<T>(draftId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.draftHistoryChains.get(draftId) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.draftHistoryChains.set(draftId, tail)
    try {
      return await result
    } finally {
      if (this.draftHistoryChains.get(draftId) === tail) this.draftHistoryChains.delete(draftId)
    }
  }

  /** Append the supplied write result under the next owner-scoped history number. */
  private async appendDraftRevision(
    ownerId: string,
    draft: FaberLoomEmailDraft,
    input: RecordDraftRevisionInput,
  ): Promise<FaberLoomEmailDraftRevision> {
    const table = await this.draftRevisionTable()
    let revision = 1
    for (const [, existing] of table.entries()) {
      if (existing.ownerId === ownerId && existing.draftId === draft.id) revision = Math.max(revision, existing.revision + 1)
    }
    const record: DraftRevisionRecord = {
      draftId: draft.id,
      ownerId,
      revision,
      createdAt: new Date().toISOString(),
      source: input.source,
      instruction: input.instruction ?? null,
      snapshot: snapshotOfDraft(draft),
    }
    await table.put(JSON.stringify([ownerId, draft.id, revision]), record)
    return record
  }

  /**
   * Capture the exact draft returned by one write as the next durable revision.
   * @param ownerId - the owning identity.
   * @param draft - write result to snapshot; a later write never replaces this value.
   * @param input - source attribution and an optional instruction, stored as null when omitted.
   * @returns the appended revision.
   * @throws when the draft is absent or belongs to another owner.
   */
  async recordDraftRevision(
    ownerId: string,
    draft: FaberLoomEmailDraft,
    input: RecordDraftRevisionInput,
  ): Promise<FaberLoomEmailDraftRevision> {
    return await this.serializeDraftHistory(draft.id, async () => {
      const record = (await this.draftTable()).get(draft.id)
      if (record === undefined || record.ownerId !== ownerId) throw new Error(`faberloom: draft ${draft.id} not found`)
      return await this.appendDraftRevision(ownerId, draft, input)
    })
  }

  /**
   * List only the requested owner's revisions for one draft, oldest first.
   * @param ownerId - the owning identity.
   * @param draftId - the draft whose history is read.
   * @returns revisions in ascending numeric order, or an empty list when none are visible.
   */
  async listDraftRevisions(ownerId: string, draftId: string): Promise<FaberLoomEmailDraftRevision[]> {
    const out: FaberLoomEmailDraftRevision[] = []
    for (const [, record] of (await this.draftRevisionTable()).entries()) {
      if (record.ownerId === ownerId && record.draftId === draftId) out.push(record)
    }
    out.sort((left, right) => left.revision - right.revision)
    return out
  }

  /**
   * Restore a snapshot as a new `restore` revision, retaining all earlier entries and the current agent binding.
   * @param ownerId - the owning identity.
   * @param draftId - the draft to restore.
   * @param revision - existing revision number belonging to this owner and draft.
   * @param expectedRevision - current restorable-state hash read by the host; a stale value refuses the restore.
   * @param instruction - owner instruction retained with the restore, when supplied.
   * @returns the restored draft and its newly appended revision.
   * @throws {FaberLoomSendError} `NOT_FOUND`, `NOT_DRAFT`, or `DRAFT_CHANGED`
   *   when the atomic update rejects; also throws when the requested history entry is absent.
   */
  async restoreDraftRevision(
    ownerId: string,
    draftId: string,
    revision: number,
    expectedRevision: string,
    instruction?: string,
  ): Promise<RestoreDraftRevisionResult> {
    return await this.serializeDraftHistory(draftId, async () => {
      const revisions = await this.draftRevisionTable()
      let selected: DraftRevisionRecord | undefined
      for (const [, candidate] of revisions.entries()) {
        if (candidate.ownerId === ownerId && candidate.draftId === draftId && candidate.revision === revision) {
          selected = candidate
          break
        }
      }
      if (selected === undefined) throw new Error(`faberloom: draft revision ${revision} not found`)
      const snapshot = selected.snapshot
      const draft = await this.updateDraft(ownerId, draftId, expectedRevision, {
        to: snapshot.to,
        cc: snapshot.cc,
        bcc: snapshot.bcc,
        subject: snapshot.subject,
        text: snapshot.text,
        account: snapshot.account,
        attachments: snapshot.attachments,
        aiText: snapshot.aiText,
        inReplyTo: snapshot.inReplyTo,
        references: snapshot.references,
        spaceId: snapshot.spaceId,
        originUid: snapshot.originUid,
        originReason: snapshot.originReason,
        originMailbox: snapshot.originMailbox,
      })
      const created = await this.appendDraftRevision(ownerId, draft, { source: 'restore', ...instruction === undefined ? {} : { instruction } })
      return { draft, revision: created }
    })
  }

  /**
   * Remove one draft the owner may discard.
   * @param ownerId - the owning identity.
   * @param id - the draft id.
   * @returns true when a record was removed.
   */
  async removeDraft(ownerId: string, id: string): Promise<boolean> {
    const table = await this.draftTable()
    const record = table.get(id)
    if (record === undefined || record.ownerId !== ownerId) return false
    return await table.delete(id)
  }

  /**
   * Send one draft through the owner's SMTP connection and record the attempt.
   *
   * The approval covers the exact revision: any field, file byte or recipient
   * change makes `seenRevision` stale and refuses. The attempt is persisted
   * before transmission, so a crash or a lost reply leaves an `unknown` result
   * that a person resolves instead of a blind retry.
   * @param ownerId - the owning identity.
   * @param id - the draft id.
   * @param seenUpdatedAt - the `updatedAt` the person reviewed.
   * @param seenRevision - the revision hash the person approved; when omitted,
   *   only the timestamp guard applies.
   * @returns the sent draft.
   * @throws {FaberLoomSendError} when the draft changed, another attempt is in
   *   flight, the result is unknown, or the named mailbox has no sender.
   */
  async sendDraft(ownerId: string, id: string, seenUpdatedAt: string, seenRevision?: string): Promise<FaberLoomEmailDraft> {
    if (this.sending.has(id)) {
      throw new FaberLoomSendError('SEND_IN_FLIGHT', 'faberloom: ya hay un envío en curso para este borrador')
    }
    this.sending.add(id)
    try {
      const table = await this.draftTable()
      const record = table.get(id)
      if (record === undefined || record.ownerId !== ownerId) throw new Error(`faberloom: draft ${id} not found`)
      if (record.status !== 'draft') throw new FaberLoomSendError('NOT_DRAFT', `faberloom: draft ${id} is already ${record.status}`)
      if (seenUpdatedAt !== record.updatedAt) {
        throw new FaberLoomSendError('DRAFT_CHANGED', 'faberloom: DRAFT_CHANGED — el borrador cambió desde que lo revisaste; vuelve a revisarlo')
      }
      const revision = draftRevision(record)
      if (seenRevision !== undefined && seenRevision !== revision) {
        throw new FaberLoomSendError('SNAPSHOT_CHANGED', 'faberloom: SNAPSHOT_CHANGED — el contenido cambió desde la aprobación; vuelve a revisarlo')
      }
      // The draft names the mailbox it leaves from. A named mailbox without an
      // outgoing row refuses instead of silently sending from another account.
      const sender = record.account === null ? undefined : await this.smtpIdForAccount(ownerId, record.account)
      if (record.account !== null && sender === undefined) {
        throw new FaberLoomSendError(
          'NO_SENDER_FOR_ACCOUNT',
          `faberloom: no hay un servidor de salida para la cuenta '${record.account}'; configúralo en Conexiones`,
        )
      }
      const intents = await this.intentTable()
      const previous = intents.get(id)
      if (previous !== undefined && (previous.status === 'sending' || previous.status === 'unknown')) {
        throw new FaberLoomSendError(
          'SEND_RESULT_UNKNOWN',
          `faberloom: el intento anterior sigue sin confirmarse (${previous.status}); decide si salió antes de reintentar`,
        )
      }
      const now = new Date().toISOString()
      const intent: SendIntentRecord = {
        ownerId,
        draftId: id,
        revision,
        status: 'prepared',
        from: record.account,
        to: record.to,
        cc: record.cc,
        bcc: record.bcc,
        subject: record.subject,
        textHash: sha256(record.text),
        attachmentHashes: record.attachments.map(attachment => ({
          name: attachment.name,
          sha256: sha256(attachment.contentBase64),
        })),
        inReplyTo: record.inReplyTo,
        references: record.references,
        messageId: null,
        error: null,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      }
      await intents.put(id, intent)
      await intents.update(id, current => ({ ...current, status: 'sending', updatedAt: new Date().toISOString() }))
      try {
        const sent = await this.sendMail(ownerId, {
          to: record.to,
          cc: record.cc,
          bcc: record.bcc,
          subject: record.subject,
          text: record.text,
          attachments: record.attachments.map(attachment => ({
            name: attachment.name,
            mediaType: attachment.mediaType,
            contentBase64: attachment.contentBase64,
          })),
          inReplyTo: record.inReplyTo,
          references: record.references,
        }, sender)
        const sentAt = new Date().toISOString()
        await intents.update(id, current => ({
          ...current,
          status: 'sent',
          messageId: sent.messageId,
          updatedAt: sentAt,
        }))
        const next: DraftRecord = { ...record, status: 'sent', sentAt, updatedAt: sentAt }
        await table.update(id, () => next)
        // The message already left: a Sent-folder copy is best effort and never
        // turns a confirmed send into a failure.
        const inbound = this.ctx.get('faberloomInbound') as {
          appendSent?: (owner: string, raw: string, account?: string) => Promise<string | null>
        } | undefined
        if (inbound?.appendSent !== undefined && sent.raw !== undefined) {
          try {
            await inbound.appendSent(ownerId, sent.raw, record.account ?? undefined)
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error)
            this.ctx.logger.warn(`faberloom: sent copy failed for draft ${id}: ${detail}`)
          }
        }
        // The streak counters stay for the historical record; the pilot no
        // longer reads them to send anything automatically.
        if (record.aiText !== null) {
          const policy = await this.emailPolicy(ownerId, record.spaceId)
          const clean = record.aiText.trim() === record.text.trim()
          await this.putPolicy(ownerId, record.spaceId, { ...policy, cleanSends: clean ? policy.cleanSends + 1 : 0 })
        }
        return toDraft(id, next)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        const mayHaveSent = error instanceof SmtpDeliveryError && error.mayHaveSent
        await intents.update(id, current => ({
          ...current,
          status: mayHaveSent ? 'unknown' : 'failed',
          error: detail,
          updatedAt: new Date().toISOString(),
        }))
        if (mayHaveSent) {
          throw new FaberLoomSendError(
            'SEND_RESULT_UNKNOWN',
            `faberloom: el transporte no confirmó el envío (${detail}); decide si salió antes de reintentar`,
          )
        }
        throw error
      }
    } finally {
      this.sending.delete(id)
    }
  }

  /**
   * Record the owner's decision about an attempt whose result was lost.
   * `sent` settles the draft; `failed` lets the owner retry the same revision.
   * @param ownerId - the owning identity.
   * @param draftId - the draft whose attempt is open.
   * @param resolution - `sent` or `failed`.
   * @returns the updated attempt.
   * @throws {FaberLoomSendError} while the same process still has that transmission in flight.
   */
  async resolveSend(ownerId: string, draftId: string, resolution: 'sent' | 'failed'): Promise<FaberLoomSendIntent> {
    if (this.sending.has(draftId)) {
      throw new FaberLoomSendError('SEND_IN_FLIGHT', 'faberloom: el envío sigue activo; espera su resultado antes de conciliar')
    }
    const intents = await this.intentTable()
    const intent = intents.get(draftId)
    if (intent === undefined || intent.ownerId !== ownerId) throw new Error(`faberloom: no send attempt for draft ${draftId}`)
    if (intent.status !== 'unknown' && intent.status !== 'sending') {
      throw new Error(`faberloom: the attempt is already ${intent.status}`)
    }
    const now = new Date().toISOString()
    const next: SendIntentRecord = { ...intent, status: resolution, updatedAt: now }
    await intents.update(draftId, () => next)
    if (resolution === 'sent') {
      const table = await this.draftTable()
      const draft = table.get(draftId)
      if (draft !== undefined && draft.status === 'draft') {
        await table.update(draftId, () => ({ ...draft, status: 'sent', sentAt: now, updatedAt: now }))
      }
    }
    return {
      draftId,
      revision: next.revision,
      status: next.status,
      to: next.to,
      cc: next.cc,
      bcc: next.bcc,
      subject: next.subject,
      messageId: next.messageId,
      error: next.error,
      createdAt: next.createdAt,
      updatedAt: next.updatedAt,
    }
  }

  /**
   * List the owner's send attempts, newest first.
   * @param ownerId - the owning identity.
   * @param draftId - restrict to one draft.
   * @returns the attempts the panel reads for conciliation.
   */
  async listSendIntents(ownerId: string, draftId?: string): Promise<FaberLoomSendIntent[]> {
    const out: FaberLoomSendIntent[] = []
    for (const [, intent] of (await this.intentTable()).entries()) {
      if (intent.ownerId !== ownerId) continue
      if (draftId !== undefined && intent.draftId !== draftId) continue
      out.push({
        draftId: intent.draftId,
        revision: intent.revision,
        status: intent.status,
        to: intent.to,
        cc: intent.cc,
        bcc: intent.bcc,
        subject: intent.subject,
        messageId: intent.messageId,
        error: intent.error,
        createdAt: intent.createdAt,
        updatedAt: intent.updatedAt,
      })
    }
    out.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    return out
  }

  /**
   * List one owner's connections.
   * @param ownerId - the owning identity.
   * @returns the connections, oldest first.
   */
  async list(ownerId: string): Promise<FaberLoomConnection[]> {
    const out: FaberLoomConnection[] = []
    for (const [id, record] of (await this.table()).entries()) {
      if (record.ownerId === ownerId) out.push(toConnection(id, record))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }

  /**
   * Create or replace one connection. An omitted secret keeps the stored one.
   * @param ownerId - the owning identity.
   * @param input - the configuration to store.
   * @returns the stored connection.
   */
  async save(ownerId: string, input: ConnectionInput): Promise<FaberLoomConnection> {
    const table = await this.table()
    const existing = input.id === undefined ? undefined : table.get(input.id)
    if (existing !== undefined && existing.ownerId !== ownerId) throw new Error('faberloom: connection belongs to another owner')
    const now = new Date().toISOString()
    const id = existing === undefined ? randomUUID() : input.id as string
    const record: ConnectionRecord = {
      ownerId,
      kind: input.kind,
      label: input.label,
      host: input.host === undefined ? existing?.host ?? null : input.host,
      port: input.port === undefined ? existing?.port ?? null : input.port,
      secure: input.secure === undefined ? existing?.secure ?? null : input.secure,
      starttls: input.starttls === undefined ? existing?.starttls ?? false : input.starttls === true,
      primary: input.primary === undefined ? existing?.primary ?? false : input.primary,
      username: input.username === undefined ? existing?.username ?? null : input.username,
      secret: input.secret === undefined || input.secret === null || input.secret.length === 0
        ? existing?.secret ?? null
        : input.secret,
      destination: input.destination === undefined ? existing?.destination ?? null : input.destination,
      retentionDays: input.retentionDays === undefined ? existing?.retentionDays ?? null : input.retentionDays,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await table.put(id, record)
    // Only one row per kind is the default: one mailbox feeds the inbound
    // receiver and one SMTP server carries outbound mail, so making this row
    // primary clears the flag only on the owner's rows of the same kind.
    if (record.primary === true) {
      for (const [otherId, other] of table.entries()) {
        if (otherId === id || other.ownerId !== ownerId || other.kind !== record.kind || other.primary !== true) continue
        await table.update(otherId, current => ({ ...current, primary: false, updatedAt: now }))
      }
    }
    return toConnection(id, record)
  }

  /**
   * Remove one connection.
   * @param ownerId - the owning identity.
   * @param id - connection id.
   * @returns true when it existed.
   */
  async remove(ownerId: string, id: string): Promise<boolean> {
    const table = await this.table()
    const record = table.get(id)
    if (record === undefined || record.ownerId !== ownerId) return false
    return await table.delete(id)
  }

  /**
   * Check one connection for real: an IMAP or SMTP login, or a writable backup destination.
   * @param ownerId - the owning identity.
   * @param id - connection id.
   * @returns the probe outcome.
   */
  async probe(ownerId: string, id: string): Promise<ConnectionProbe> {
    const record = (await this.table()).get(id)
    if (record === undefined || record.ownerId !== ownerId) return { ok: false, detail: 'conexión no encontrada' }
    // A probe opens a socket with the stored secret: it answers to the same
    // policy as a send, or the deny list is one button away from being bypassed.
    if (record.kind !== 'backup') {
      const decision = checkEgress(this.egress, record.host ?? '')
      if (!decision.allowed) return { ok: false, detail: `destino no autorizado (${decision.reason})` }
    }
    if (record.kind === 'imap') {
      if (record.host === null || record.port === null || record.username === null || record.secret === null) {
        return { ok: false, detail: 'faltan host, puerto, usuario o contraseña' }
      }
      return await probeImap({
        host: record.host,
        port: record.port,
        secure: record.secure === true,
        starttls: record.starttls === true,
        user: record.username,
        password: record.secret,
      })
    }
    if (record.kind === 'smtp') {
      const credentials = await this.smtp(ownerId, id)
      if (credentials === undefined) return { ok: false, detail: 'faltan host, puerto, usuario o contraseña' }
      return await probeSmtp(credentials)
    }
    if (record.destination === null) return { ok: false, detail: 'falta el destino del respaldo' }
    return await probeBackup(record.destination)
  }

  /**
   * Read one of the owner's outgoing-server credentials.
   *
   * Like {@link imap}, this accessor returns a stored secret and exists for
   * host-side consumers that send mail as the owner; the browser never sees it.
   * @param ownerId - the owning identity.
   * @param id - a specific connection, or undefined for the primary SMTP row
   *   (the owner's flagged one, otherwise the first complete row).
   * @returns the credentials, or undefined when the owner has no usable server.
   */
  async smtp(ownerId: string, id?: string): Promise<SmtpCredentials | undefined> {
    const picked = await this.smtpUnchecked(ownerId, id)
    if (picked === undefined) return undefined
    assertEgressAllowed(this.egress, picked.host, 'smtp')
    return picked
  }

  /**
   * Find the outgoing connection whose login matches a mailbox address.
   * @param ownerId - the owning identity.
   * @param account - the mailbox address stored on the draft.
   * @returns the SMTP connection id, or undefined when the deployment sends
   *   through its primary row.
   */
  private async smtpIdForAccount(ownerId: string, account: string): Promise<string | undefined> {
    for (const [id, record] of (await this.table()).entries()) {
      if (record.ownerId !== ownerId || record.kind !== 'smtp') continue
      if (record.username === account) return id
    }
    return undefined
  }

  /**
   * Read the owner's outgoing-server row without consulting the egress policy.
   * @param ownerId - the owning identity.
   * @param id - a specific connection, or undefined for the primary SMTP row.
   * @returns the credentials, or undefined when the owner has no usable server.
   */
  private async smtpUnchecked(ownerId: string, id?: string): Promise<SmtpCredentials | undefined> {
    const rows: { readonly credentials: SmtpCredentials; readonly primary: boolean }[] = []
    for (const [key, record] of (await this.table()).entries()) {
      if (record.ownerId !== ownerId || record.kind !== 'smtp') continue
      if (id !== undefined && key !== id) continue
      if (record.host === null || record.port === null || record.username === null || record.secret === null) continue
      rows.push({
        credentials: {
          id: key,
          label: record.label,
          host: record.host,
          port: record.port,
          secure: record.secure === true,
          starttls: record.starttls === true,
          username: record.username,
          password: record.secret,
        },
        primary: record.primary === true,
      })
    }
    const chosen = rows.find(row => row.primary) ?? rows.at(0)
    return chosen?.credentials
  }

  /**
   * Deliver one message through the owner's outgoing server.
   * @param ownerId - the owning identity.
   * @param mail - the message to send.
   * @param connectionId - a specific SMTP connection, or undefined for the
   *   primary (or first complete) one.
   * @returns the generated `Message-ID` and the accepted recipients.
   */
  async sendMail(ownerId: string, mail: OutgoingMail, connectionId?: string): Promise<SentMail> {
    if (mail.to.length === 0) throw new Error('faberloom: el mensaje no tiene destinatarios')
    const credentials = await this.smtp(ownerId, connectionId)
    if (credentials === undefined) throw new Error('faberloom: no hay un servidor SMTP configurado; añádelo en Conexiones')
    assertEgressAllowed(this.egress, credentials.host, 'smtp')
    const sent = await sendSmtp(credentials, mail)
    return { messageId: sent.messageId, accepted: sent.accepted, via: credentials.label, raw: sent.raw }
  }
  /**
   * Read one of the owner's mailbox credentials.
   *
   * This is the only accessor that returns a stored secret, and it exists for
   * the inbound receiver, which has to log in to the owner's mailbox. The
   * browser never sees it: the panel reads {@link list}, which omits the secret.
   * @param ownerId - the owning identity.
   * @param id - a specific connection, or undefined for the primary mailbox
   *   (the owner's flagged one, otherwise the first complete row).
   * @returns the credentials, or undefined when the owner has no usable mailbox.
   */
  /* jscpd:ignore-start -- the IMAP accessor mirrors the SMTP one; the two connection kinds are independently owned */
  async imap(ownerId: string, id?: string): Promise<ImapCredentials | undefined> {
    const picked = await this.imapUnchecked(ownerId, id)
    if (picked === undefined) return undefined
    assertEgressAllowed(this.egress, picked.host, 'imap')
    return picked
  }

  /**
   * Read the owner's mailbox row without consulting the egress policy.
   * @param ownerId - the owning identity.
   * @param id - a specific connection, or undefined for the primary mailbox.
   * @returns the credentials, or undefined when the owner has no usable mailbox.
   */
  private async imapUnchecked(ownerId: string, id?: string): Promise<ImapCredentials | undefined> {
    const rows: { readonly credentials: ImapCredentials; readonly primary: boolean }[] = []
    for (const [key, record] of (await this.table()).entries()) {
      if (record.ownerId !== ownerId || record.kind !== 'imap') continue
      if (id !== undefined && key !== id) continue
      if (record.host === null || record.port === null || record.username === null || record.secret === null) continue
      rows.push({
        credentials: {
          id: key,
          label: record.label,
          host: record.host,
          port: record.port,
          secure: record.secure === true,
          starttls: record.starttls === true,
          username: record.username,
          password: record.secret,
        },
        primary: record.primary === true,
      })
    }
    const chosen = rows.find(row => row.primary) ?? rows.at(0)
    return chosen?.credentials
  }
  /* jscpd:ignore-end */

  /**
   * Sign in to the MWT.ONE console and mount one MCP server per company the
   * account can reach. The console issues a device-bound token per company;
   * the password is used only for the console login and is never stored.
   * @param ownerId - the product owner whose MCP registry rows receive the servers.
   * @param usuario - console user or email.
   * @param password - console password from the host form.
   * @returns the console email and the companies that were mounted.
   * @throws when the console refuses the login, returns no MCP company, or the MCP registry is absent.
   */
  async connectMwt(ownerId: string, usuario: string, password: string): Promise<MwtConnectResult> {
    const registry = this.ctx.get('faberloomMcpRegistry') as MwtMcpRegistry | undefined
    if (registry === undefined) throw new Error('faberloom: the MCP registry is not mounted')
    const consolaBase = (process.env.CONSOLA_API_BASE ?? 'https://consola.mwt.one/api').trim()
    const session = await signInMwtConsole(fetch, consolaBase, usuario, password)
    const deviceId = await this.deviceId()
    const credentials = await requestMwtDeviceToken(fetch, consolaBase, session.token, deviceId)
    if (credentials.length === 0) {
      throw new Error('La consola no devolvió ninguna empresa con MCP para esta cuenta.')
    }
    for (const credential of credentials) {
      await registry.save(ownerId, {
        name: mwtServerName(credential.key),
        transport: { transport: 'streamable-http', url: credential.mcpUrl },
        headers: { Authorization: `DeviceToken ${credential.token}` },
        enabled: true,
      })
    }
    return {
      email: session.email,
      companies: credentials.map(credential => ({ key: credential.key, name: credential.name })),
    }
  }

  /**
   * Remove every MWT.ONE MCP server this installation mounted for the owner.
   * @param ownerId - the product owner whose rows are removed.
   * @returns how many server rows were removed.
   */
  async disconnectMwt(ownerId: string): Promise<number> {
    const registry = this.ctx.get('faberloomMcpRegistry') as MwtMcpRegistry | undefined
    if (registry === undefined) throw new Error('faberloom: the MCP registry is not mounted')
    let removed = 0
    for (const row of await registry.list(ownerId)) {
      if (!row.name.startsWith('mwt-')) continue
      if (await registry.remove(ownerId, row.name)) removed += 1
    }
    return removed
  }

  /** Stable device id this installation presents to the console. */
  private deviceIdPromise: Promise<string> | undefined

  /**
   * Read the installation's device id, creating it once.
   * @returns the stable id.
   */
  private async deviceId(): Promise<string> {
    this.deviceIdPromise ??= (async () => {
      const home = process.env.DSH_HOME?.trim() ?? join(homedir(), '.dsh')
      const path = join(home, 'device-id')
      try {
        const existing = (await readFile(path, 'utf8')).trim()
        if (existing.length > 0) return existing
      } catch {
        // A missing device id is the first run; the id is created below.
      }
      const created = randomUUID()
      await mkdir(home, { recursive: true })
      await writeFile(path, `${created}\n`, { mode: 0o600 })
      return created
    })()
    return this.deviceIdPromise
  }
}

export default FaberLoomConnections
