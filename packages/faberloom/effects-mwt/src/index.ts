/**
 * Expediente writes against MWT.ONE (`ctx.faberloomMwt`).
 *
 * One proposal names the exact expediente, the fields with units, the documents
 * with their bytes and digest, and the version it was prepared against. One
 * single-use authorization covers that revision only. The executor re-reads the
 * destination, refuses a changed version, writes once with an idempotency key,
 * reads the result back, and leaves a lost answer as `unknown` for a person to
 * reconcile. The destination arrives through {@link FaberLoomMwt.useTransport};
 * this package embeds no MWT.ONE credential or endpoint.
 * @module @deepseek-ai/dsh-faberloom-effects-mwt
 */

import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { BoardEffectResult } from '@deepseek-ai/dsh-faberloom-board'
import { mwtDomainSpec, type AuthorizationRecord, type ProposalRecord } from './spec.ts'
import {
  FaberLoomMwtRefusal,
  MwtDeliveryUnknown,
  type FaberLoomMwtAuthorization,
  type FaberLoomMwtProposal,
  type MwtActor,
  type MwtDocumentChange,
  type MwtFieldChange,
  type MwtProposalInput,
  type MwtTransport,
} from './types.ts'

export type * from './types.ts'
export { mwtDomainSpec } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomMwt: FaberLoomMwt
  }
}

/** SHA-256 of one string, hex. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Values that are money or a total: they must state their unit. */
const UNIT_REQUIRED = /precio|importe|monto|total|costo|flete|descuento/iu

/** What blocks authorization, in panel-readable codes. */
function judge(
  input: MwtProposalInput,
  fields: readonly MwtFieldChange[],
  documents: readonly MwtDocumentChange[],
): string[] {
  const out: string[] = []
  if (input.target.expedienteId.trim().length === 0) out.push('TARGET_MISSING')
  if (input.target.collection.trim().length === 0) out.push('DESTINATION_MISSING')
  const seen = new Set<string>()
  for (const entry of fields) {
    if (seen.has(entry.field)) out.push(`FIELD_DUPLICATED:${entry.field}`)
    seen.add(entry.field)
    if (entry.after.length === 0) out.push(`FIELD_EMPTY:${entry.field}`)
    if (entry.unit === null && UNIT_REQUIRED.test(entry.label)) out.push(`UNIT_MISSING:${entry.field}`)
  }
  for (const entry of documents) {
    if (entry.operation === 'replace' && entry.replaces === null) out.push(`DOCUMENT_REPLACES_MISSING:${entry.name}`)
  }
  if (fields.length === 0 && documents.length === 0) out.push('NO_CHANGES')
  return out.sort((left, right) => left.localeCompare(right))
}

/** Map one stored row to the panel shape. */
function toProposal(id: string, record: ProposalRecord): FaberLoomMwtProposal {
  return {
    id,
    itemId: record.itemId,
    target: record.target,
    revision: record.revision,
    versionBefore: record.versionBefore,
    fields: record.fields,
    documents: record.documents,
    ambiguities: record.ambiguities,
    sources: record.sources,
    reason: record.reason,
    status: record.status,
    ref: record.ref,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Map one stored authorization to the panel shape. */
function toAuthorization(id: string, record: AuthorizationRecord): FaberLoomMwtAuthorization {
  return {
    id,
    proposalId: record.proposalId,
    revision: record.revision,
    scope: record.scope,
    expiresAt: record.expiresAt,
    usedAt: record.usedAt,
    createdAt: record.createdAt,
  }
}

/** The MWT.ONE write service. */
export default class FaberLoomMwt extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof mwtDomainSpec>> | undefined
  private transport: MwtTransport | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   */
  constructor(ctx: Context) {
    super(ctx, 'faberloomMwt')
    // The board is the S4 executor: an item approved with action `mwt.write`
    // reaches this adapter, which consumes the authorization a person recorded.
    ctx.inject(['faberloomBoard'], (scope: Context) => {
      const board = scope.faberloomBoard
      scope.effect(() => board.registerEffectAdapter('mwt.write', {
        idempotent: false,
        send: async (dispatch): Promise<BoardEffectResult> => {
          const actor: MwtActor = { id: dispatch.ownerId, companyId: dispatch.companyId ?? undefined }
          const proposals = await this.list(actor, dispatch.itemId)
          const proposal = proposals.find(entry => entry.status === 'proposed' && entry.ambiguities.length === 0)
          if (proposal === undefined) {
            return { status: 'FALLIDO', detail: 'no hay una propuesta autorizable para este expediente' }
          }
          const authorizations = await this.listAuthorizations(actor, proposal.id)
          const authorization = authorizations.find(entry => entry.usedAt === null && Date.parse(entry.expiresAt) > Date.now())
          if (authorization === undefined) {
            return { status: 'FALLIDO', detail: 'falta AUTH-MWT-WRITE para esta propuesta' }
          }
          try {
            const done = await this.execute(actor, proposal.id, authorization.id)
            return done.ref === null ? { status: 'CONFIRMADO' } : { status: 'CONFIRMADO', ref: done.ref }
          } catch (error) {
            if (error instanceof FaberLoomMwtRefusal && error.code === 'RESULT_UNKNOWN') {
              return { status: 'DESCONOCIDO', detail: error.message }
            }
            return { status: 'FALLIDO', detail: error instanceof Error ? error.message : String(error) }
          }
        },
      }), 'faberloom.mwtBoardAdapter')
    })
  }

  private domain(): Promise<Domain<typeof mwtDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(mwtDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.mwtDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async proposals(): Promise<KvTable<string, ProposalRecord>> { return (await this.domain()).table('proposals') }
  private async authorizations(): Promise<KvTable<string, AuthorizationRecord>> { return (await this.domain()).table('authorizations') }

  /**
   * Register the destination implementation for this process.
   * @param transport - reader and writer of the destination.
   * @returns the disposer that removes it.
   */
  useTransport(transport: MwtTransport): () => void {
    this.transport = transport
    return () => { if (this.transport === transport) this.transport = undefined }
  }

  /** Whether a destination is registered, so a panel can say so before preparing. */
  get transportReady(): boolean {
    return this.transport !== undefined
  }

  private requireTransport(): MwtTransport {
    if (this.transport === undefined) {
      throw new FaberLoomMwtRefusal('NO_TRANSPORT', 'faberloom: no hay un destino MWT.ONE registrado en este proceso')
    }
    return this.transport
  }

  /** Read one proposal of this owner, or refuse. */
  private async require(actor: MwtActor, id: string): Promise<ProposalRecord> {
    const record = (await this.proposals()).get(id)
    if (record === undefined || record.ownerId !== actor.id) {
      throw new Error(`faberloom: la propuesta ${id} no existe`)
    }
    return record
  }

  /**
   * Prepare a proposal from the current destination state: fields with their
   * before values, document digests, and every ambiguity that blocks approval.
   * @param actor - identity preparing it.
   * @param input - target, fields, documents, reason and sources.
   * @returns the stored proposal.
   */
  async prepare(actor: MwtActor, input: MwtProposalInput): Promise<FaberLoomMwtProposal> {
    const transport = this.requireTransport()
    const remote = await transport.read(input.target)
    const fields: MwtFieldChange[] = input.fields.map(entry => ({
      field: entry.field,
      label: entry.label,
      before: remote.fields[entry.field] ?? null,
      after: entry.value.trim(),
      unit: entry.unit ?? null,
    }))
    const documents: MwtDocumentChange[] = (input.documents ?? []).map((entry) => {
      const bytes = Buffer.from(entry.contentBase64, 'base64')
      return {
        name: entry.name,
        mediaType: entry.mediaType,
        sha256: sha256(bytes.toString('base64')),
        bytes: bytes.byteLength,
        operation: entry.operation ?? 'add',
        replaces: entry.replaces ?? null,
      }
    })
    const ambiguities = judge(input, fields, documents)
    const revision = sha256(JSON.stringify({
      target: input.target,
      versionBefore: remote.version,
      fields: fields.map(entry => [entry.field, entry.after, entry.unit]),
      documents: documents.map(entry => [entry.name, entry.sha256, entry.operation, entry.replaces]),
    }))
    const now = new Date().toISOString()
    const id = randomUUID()
    const record: ProposalRecord = {
      ownerId: actor.id,
      companyId: actor.companyId ?? null,
      itemId: input.itemId ?? null,
      target: input.target,
      revision,
      versionBefore: remote.version,
      fields,
      documents,
      documentBytes: (input.documents ?? []).map(entry => ({ name: entry.name, contentBase64: entry.contentBase64 })),
      ambiguities,
      sources: [...input.sources],
      reason: input.reason,
      status: 'proposed',
      ref: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    }
    await (await this.proposals()).put(id, record)
    return toProposal(id, record)
  }

  /**
   * Record the single-use authorization for one proposal revision.
   * @param actor - identity recording it.
   * @param id - proposal id.
   * @param input - scope the approver states and when the authorization expires.
   * @returns the stored authorization.
   * @throws {FaberLoomMwtRefusal} when the proposal has ambiguities or is settled.
   */
  async authorize(
    actor: MwtActor,
    id: string,
    input: { scope: string; expiresAt?: string },
  ): Promise<FaberLoomMwtAuthorization> {
    const proposal = await this.require(actor, id)
    if (proposal.status !== 'proposed') {
      throw new FaberLoomMwtRefusal('ALREADY_SETTLED', `faberloom: la propuesta está ${proposal.status}`)
    }
    if (proposal.ambiguities.length > 0) {
      throw new FaberLoomMwtRefusal('AMBIGUOUS', `faberloom: resuelve antes de autorizar: ${proposal.ambiguities.join(', ')}`)
    }
    const scope = input.scope.trim()
    if (scope.length === 0) {
      throw new FaberLoomMwtRefusal('AMBIGUOUS', 'faberloom: la autorización debe declarar su alcance')
    }
    const now = new Date()
    const record: AuthorizationRecord = {
      ownerId: actor.id,
      proposalId: id,
      revision: proposal.revision,
      scope,
      expiresAt: input.expiresAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      usedAt: null,
      createdAt: now.toISOString(),
    }
    const authorizationId = randomUUID()
    await (await this.authorizations()).put(authorizationId, record)
    return toAuthorization(authorizationId, record)
  }

  /**
   * Execute one authorized revision: revalidate, write once, read back.
   * @param actor - identity executing it.
   * @param id - proposal id.
   * @param authorizationId - the single-use authorization to consume.
   * @returns the proposal after the attempt.
   * @throws {FaberLoomMwtRefusal} when the authorization, revision or version refuse,
   *   or when the result is unknown.
   */
  async execute(actor: MwtActor, id: string, authorizationId: string): Promise<FaberLoomMwtProposal> {
    const transport = this.requireTransport()
    const proposal = await this.require(actor, id)
    if (proposal.status !== 'proposed' && proposal.status !== 'failed') {
      throw new FaberLoomMwtRefusal('ALREADY_SETTLED', `faberloom: la propuesta está ${proposal.status}`)
    }
    const authorizationTable = await this.authorizations()
    const authorization = authorizationTable.get(authorizationId)
    if (authorization === undefined || authorization.proposalId !== id || authorization.ownerId !== actor.id) {
      throw new FaberLoomMwtRefusal('NO_AUTHORIZATION', 'faberloom: no hay una autorización para esta propuesta')
    }
    if (authorization.usedAt !== null) {
      throw new FaberLoomMwtRefusal('AUTHORIZATION_CONSUMED', 'faberloom: la autorización ya se usó')
    }
    if (Date.parse(authorization.expiresAt) <= Date.now()) {
      throw new FaberLoomMwtRefusal('AUTHORIZATION_EXPIRED', 'faberloom: la autorización venció')
    }
    if (authorization.revision !== proposal.revision) {
      throw new FaberLoomMwtRefusal('REVISION_CHANGED', 'faberloom: la propuesta cambió desde la autorización')
    }
    const current = await transport.read(proposal.target)
    if (current.version !== proposal.versionBefore) {
      throw new FaberLoomMwtRefusal(
        'VERSION_CONFLICT',
        `faberloom: el expediente cambió (${proposal.versionBefore} → ${current.version}); vuelve a preparar la propuesta`,
      )
    }
    const table = await this.proposals()
    const now = new Date().toISOString()
    await table.update(id, record => ({ ...record, status: 'executing', updatedAt: now }))
    await authorizationTable.update(authorizationId, record => ({ ...record, usedAt: now }))
    const bytesOf = (name: string): string => proposal.documentBytes.find(entry => entry.name === name)?.contentBase64 ?? ''
    const body = {
      fields: proposal.fields.map(entry => ({ field: entry.field, value: entry.after, unit: entry.unit })),
      documents: proposal.documents.map(entry => ({
        name: entry.name,
        mediaType: entry.mediaType,
        contentBase64: bytesOf(entry.name),
        operation: entry.operation,
        replaces: entry.replaces,
      })),
      expectedVersion: proposal.versionBefore,
    }
    try {
      const written = await transport.write(proposal.target, body, { idempotencyKey: id })
      // Reading back confirms the destination kept the approved revision.
      await transport.read(proposal.target)
      await table.update(id, record => ({
        ...record,
        status: 'written',
        ref: written.ref,
        error: null,
        updatedAt: new Date().toISOString(),
      }))
      return toProposal(id, table.get(id) as ProposalRecord)
    } catch (error) {
      const unknown = error instanceof MwtDeliveryUnknown
      const detail = error instanceof Error ? error.message : String(error)
      await table.update(id, record => ({
        ...record,
        status: unknown ? 'unknown' : 'failed',
        error: detail,
        updatedAt: new Date().toISOString(),
      }))
      if (unknown) {
        throw new FaberLoomMwtRefusal(
          'RESULT_UNKNOWN',
          `faberloom: el destino no confirmó la escritura (${detail}); reconcilia antes de reintentar`,
        )
      }
      throw error
    }
  }

  /**
   * Settle a write whose answer was lost, after the owner checked the destination.
   * @param actor - identity settling it.
   * @param id - proposal id.
   * @param resolution - `written` or `not-written`.
   * @param ref - destination reference, when the owner has it.
   * @returns the settled proposal.
   */
  async reconcile(
    actor: MwtActor,
    id: string,
    resolution: 'written' | 'not-written',
    ref?: string,
  ): Promise<FaberLoomMwtProposal> {
    const proposal = await this.require(actor, id)
    if (proposal.status !== 'unknown') {
      throw new FaberLoomMwtRefusal('ALREADY_SETTLED', `faberloom: la propuesta está ${proposal.status}`)
    }
    const table = await this.proposals()
    await table.update(id, record => ({
      ...record,
      status: resolution === 'written' ? 'written' : 'failed',
      ref: resolution === 'written' ? ref ?? record.ref : null,
      error: resolution === 'written' ? null : 'no se escribió',
      updatedAt: new Date().toISOString(),
    }))
    return toProposal(id, table.get(id) as ProposalRecord)
  }

  /**
   * Discard a proposal that was never written.
   * @param actor - identity discarding it.
   * @param id - proposal id.
   * @returns the discarded proposal.
   */
  async discard(actor: MwtActor, id: string): Promise<FaberLoomMwtProposal> {
    const proposal = await this.require(actor, id)
    if (proposal.status !== 'proposed' && proposal.status !== 'failed') {
      throw new FaberLoomMwtRefusal('ALREADY_SETTLED', `faberloom: la propuesta está ${proposal.status}`)
    }
    const table = await this.proposals()
    await table.update(id, record => ({ ...record, status: 'discarded', updatedAt: new Date().toISOString() }))
    return toProposal(id, table.get(id) as ProposalRecord)
  }

  /**
   * Read one proposal.
   * @param actor - identity reading it.
   * @param id - proposal id.
   * @returns the proposal.
   */
  async get(actor: MwtActor, id: string): Promise<FaberLoomMwtProposal> {
    return toProposal(id, await this.require(actor, id))
  }

  /**
   * List the owner's proposals, newest first.
   * @param actor - identity listing them.
   * @param itemId - restrict to one board item.
   * @returns the proposals.
   */
  async list(actor: MwtActor, itemId?: string): Promise<FaberLoomMwtProposal[]> {
    const out: FaberLoomMwtProposal[] = []
    for (const [id, record] of (await this.proposals()).entries()) {
      if (record.ownerId !== actor.id) continue
      if (itemId !== undefined && record.itemId !== itemId) continue
      out.push(toProposal(id, record))
    }
    out.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    return out
  }

  /**
   * List the authorizations of one owner, newest first.
   * @param actor - identity listing them.
   * @param proposalId - restrict to one proposal.
   * @returns the authorizations.
   */
  async listAuthorizations(actor: MwtActor, proposalId?: string): Promise<FaberLoomMwtAuthorization[]> {
    const out: FaberLoomMwtAuthorization[] = []
    for (const [id, record] of (await this.authorizations()).entries()) {
      if (record.ownerId !== actor.id) continue
      if (proposalId !== undefined && record.proposalId !== proposalId) continue
      out.push(toAuthorization(id, record))
    }
    out.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    return out
  }
}
