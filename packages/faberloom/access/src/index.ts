/**
 * Native product access (`ctx.faberloomAccess`): elective autonomy grants
 * scoped to one action, agent, and context, and the CEO signatures that money,
 * inventory, and external shipments require per action type (§7.4, W-16). A
 * grant is issued explicitly by the human and checked before every effect;
 * revoking it denies the next check. A protected action type has no default
 * signature: without an active one, the check refuses instead of warning.
 * Records are durable through `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-faberloom-access
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Context, Service } from '@deepseek-ai/cordis'
import { accessDomainSpec, type GrantRecord, type SignatureRecord } from './spec.ts'
import { FaberLoomAccessRefusal } from './refusal.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  FaberLoomGrant,
  FaberLoomSignature,
  FaberLoomSignatureId,
  GrantCheck,
  GrantDecision,
  GrantInput,
  SignatureActor,
  SignatureCheckOptions,
  SignatureInput,
  SignatureState,
  SignatureStatus,
} from './types.ts'

export type * from './types.ts'
export { FaberLoomAccessRefusal } from './refusal.ts'
export type { AccessRefusalCode } from './refusal.ts'

/** Access configuration accepted by the plugin row. */
export interface Config {
  /**
   * Action types money, inventory, and external shipments route through (§7.4).
   * The specification names the classes, not the strings, so a deployment
   * declares them. Empty, nothing is protected and the service warns at load.
   */
  readonly protectedActionTypes?: readonly string[]
  /**
   * Whether a signature may cover every protected action type at once. The
   * specification signs a signature per `action_type`, so the default refuses
   * wildcards; a deployment may allow them explicitly.
   */
  readonly allowWildcardSignatures?: boolean
  /**
   * Seconds a signature stays valid when `issueSignature` receives no
   * `expiresAt`. `null` keeps it valid until revocation. The specification
   * leaves signature validity open (§7.4, §13).
   */
  readonly signatureValiditySeconds?: number | null
  /**
   * Identities allowed to issue a signature. Empty refuses issuance instead of
   * letting any authenticated actor sign: the CEO identity is a business
   * decision the specification does not make.
   */
  readonly signingAuthorities?: readonly string[]
  /**
   * Extra identities allowed to revoke any signature of their tenant. The
   * signer may always revoke their own; the default adds nobody.
   */
  readonly revocationAuthorities?: readonly string[]
  /**
   * Identities, besides the signer, allowed to read the signer identity in
   * `signatureStatus`. The default shows it to the signer only.
   */
  readonly signerIdentityAudience?: readonly string[]
}

/** Validated access configuration. */
export const Config = z.object({
  protectedActionTypes: z.array(z.string().min(1)).default([]),
  allowWildcardSignatures: z.boolean().default(false),
  signatureValiditySeconds: z.number().int().positive().nullable().default(null),
  signingAuthorities: z.array(z.string().min(1)).default([]),
  revocationAuthorities: z.array(z.string().min(1)).default([]),
  signerIdentityAudience: z.array(z.string().min(1)).default([]),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomAccess: FaberLoomAccess
  }
}

/** States `requireSignature` refuses; `ACTIVE` and `NOT_REQUIRED` authorize. */
type SignatureRefusalState = Exclude<SignatureState, 'ACTIVE' | 'NOT_REQUIRED'>

/** One stored signature covering a checked action type. */
interface SignatureMatch {
  /** Storage key of the signature. */
  readonly id: string
  /** Stored record. */
  readonly record: SignatureRecord
}

/** Which signature state the reader's tenant reaches for one action type. */
type SignatureResolution =
  | { readonly state: 'ACTIVE'; readonly match: SignatureMatch }
  | { readonly state: SignatureRefusalState; readonly match: SignatureMatch | null }

/** Refusal code per refusing signature state. */
const REFUSAL_CODES: Record<SignatureRefusalState,
  'SIGNATURE_REQUIRED' | 'SIGNATURE_REVOKED' | 'SIGNATURE_EXPIRED'> = {
  MISSING: 'SIGNATURE_REQUIRED',
  REVOKED: 'SIGNATURE_REVOKED',
  EXPIRED: 'SIGNATURE_EXPIRED',
}

/** Refusal detail per refusing signature state. */
const REFUSAL_DETAILS: Record<SignatureRefusalState, (actionType: string) => string> = {
  MISSING: actionType => `no active CEO signature covers '${actionType}' for this tenant`,
  REVOKED: actionType => `the CEO signature covering '${actionType}' is revoked`,
  EXPIRED: actionType => `the CEO signature covering '${actionType}' is expired`,
}

/** Map one durable grant to the consumer-facing grant. */
function toGrant(id: string, record: GrantRecord): FaberLoomGrant {
  return { id, ...record }
}

/** Map one durable signature to the consumer-facing signature. */
function toSignature(id: string, record: SignatureRecord): FaberLoomSignature {
  return { id, ...record }
}

/** Tenant an actor belongs to; an actor without a company has the unscoped tenant. */
function tenantOf(actor: SignatureActor): string | null {
  return actor.companyId ?? null
}

/**
 * Whether a stored signature expired at `now`. ISO-8601 UTC instants compare
 * lexicographically, the convention `check` already uses for grant expiry.
 */
function isExpired(record: SignatureRecord, now: string): boolean {
  return record.expiresAt !== null && record.expiresAt <= now
}

/** Order accepted signatures: exact coverage before wildcard, then oldest, then id. */
function preferActive(left: SignatureMatch, right: SignatureMatch): number {
  if (left.record.wildcard !== right.record.wildcard) return left.record.wildcard ? 1 : -1
  if (left.record.signedAt !== right.record.signedAt) return left.record.signedAt < right.record.signedAt ? -1 : 1
  return left.id.localeCompare(right.id)
}

/** Order signatures for display: newest first, then id. */
function preferRecent(left: SignatureMatch, right: SignatureMatch): number {
  if (left.record.signedAt !== right.record.signedAt) return left.record.signedAt > right.record.signedAt ? -1 : 1
  return left.id.localeCompare(right.id)
}

/**
 * The product access service: action-scoped, revocable autonomy grants plus the
 * tenant signatures protected action types require before approval.
 */
export class FaberLoomAccess extends Service {
  static inject = ['storageDomain']

  /**
   * Action types that require a CEO signature in this deployment. Empty means
   * the deployment protects nothing, and the constructor warns about it.
   */
  readonly protectedActionTypes: readonly string[]

  private readonly allowWildcardSignatures: boolean
  private readonly signatureValiditySeconds: number | null
  private readonly signingAuthorities: readonly string[]
  private readonly revocationAuthorities: readonly string[]
  private readonly signerIdentityAudience: readonly string[]
  private domainPromise: Promise<Domain<typeof accessDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - protected action types, signature scope, validity, and the
   * identities allowed to sign, revoke, or read the signer.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'faberloomAccess')
    const resolved = Config.parse(config)
    this.protectedActionTypes = resolved.protectedActionTypes
    this.allowWildcardSignatures = resolved.allowWildcardSignatures
    this.signatureValiditySeconds = resolved.signatureValiditySeconds
    this.signingAuthorities = resolved.signingAuthorities
    this.revocationAuthorities = resolved.revocationAuthorities
    this.signerIdentityAudience = resolved.signerIdentityAudience
    if (this.protectedActionTypes.length === 0) {
      this.ctx.logger.warn(
        'faberloom: faberloom-access protects no action type; money, inventory, and external shipments '
        + 'approve without a CEO signature until the row declares protectedActionTypes (§7.4, W-16)',
      )
    }
  }

  private domain(): Promise<Domain<typeof accessDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(accessDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.accessDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async grants(): Promise<KvTable<string, GrantRecord>> { return (await this.domain()).table('grants') }

  private async signatures(): Promise<KvTable<string, SignatureRecord>> {
    return (await this.domain()).table('signatures')
  }

  /**
   * Issue one grant.
   * @param ownerId - the identity granting autonomy.
   * @param input - action, optional agent/context scopes, note, and expiry.
   * @returns the created grant.
   */
  async grant(ownerId: string, input: GrantInput): Promise<FaberLoomGrant> {
    const id = randomUUID()
    const record: GrantRecord = {
      ownerId,
      action: input.action,
      agentId: input.agentId ?? null,
      context: input.context ?? null,
      note: input.note ?? null,
      grantedAt: new Date().toISOString(),
      expiresAt: input.expiresAt ?? null,
      revoked: false,
    }
    await (await this.grants()).put(id, record)
    return toGrant(id, record)
  }

  /**
   * List one owner's grants.
   * @param ownerId - the owning identity.
   * @param options - `activeOnly` skips revoked grants.
   * @returns the grants.
   */
  async listGrants(ownerId: string, options: { activeOnly?: boolean } = {}): Promise<FaberLoomGrant[]> {
    const out: FaberLoomGrant[] = []
    for (const [id, record] of (await this.grants()).entries()) {
      if (record.ownerId !== ownerId) continue
      if (options.activeOnly === true && record.revoked) continue
      out.push(toGrant(id, record))
    }
    return out
  }

  /**
   * Revoke one grant; the next check denies it.
   * @param ownerId - the acting identity.
   * @param id - grant id.
   * @returns the revoked grant.
   */
  async revokeGrant(ownerId: string, id: string): Promise<FaberLoomGrant> {
    const table = await this.grants()
    const record = table.get(id)
    if (record === undefined) {
      throw new FaberLoomAccessRefusal('GRANT_NOT_FOUND', `grant ${id} not found`)
    }
    if (record.ownerId !== ownerId) {
      throw new FaberLoomAccessRefusal('GRANT_NOT_OWNER', 'only the owner can revoke this grant')
    }
    const next: GrantRecord = { ...record, revoked: true }
    await table.update(id, () => next)
    return toGrant(id, next)
  }

  /**
   * Check whether an action is authorized before running it.
   * @param request - owner, action, optional agent/context, and instant.
   * @returns the decision and the grant that decided it.
   */
  async check(request: GrantCheck): Promise<GrantDecision> {
    const now = request.now ?? new Date().toISOString()
    let sawRevoked = false
    let sawExpired = false
    for (const [id, record] of (await this.grants()).entries()) {
      if (record.ownerId !== request.ownerId || record.action !== request.action) continue
      if (record.agentId !== null && record.agentId !== request.agentId) continue
      if (record.context !== null && record.context !== request.context) continue
      if (record.revoked) {
        sawRevoked = true
        continue
      }
      if (record.expiresAt !== null && record.expiresAt <= now) {
        sawExpired = true
        continue
      }
      return { allowed: true, reason: 'GRANTED', grantId: id }
    }
    return { allowed: false, reason: sawRevoked ? 'REVOKED' : sawExpired ? 'EXPIRED' : 'NO_GRANT', grantId: null }
  }

  /**
   * Issue one CEO signature for the acting identity's tenant.
   *
   * Only a configured `signingAuthorities` identity may sign; with none
   * configured, issuance refuses (`SIGNATURE_AUTHORITY_UNCONFIGURED`) instead of
   * letting any actor sign. The signature is repeatable: it authorizes every
   * approval of a covered action type until it expires or is revoked, and issuing
   * it does not mark it used.
   * @param actor - the authenticated signer, which also supplies the tenant.
   * @param input - covered action types or a wildcard, and an optional expiry.
   * @param options - instant the signature is dated; defaults to now.
   * @returns the stored signature.
   */
  async issueSignature(
    actor: SignatureActor,
    input: SignatureInput,
    options: SignatureCheckOptions = {},
  ): Promise<FaberLoomSignature> {
    if (!this.signingAuthorities.includes(actor.id)) {
      throw this.signingAuthorities.length === 0
        ? new FaberLoomAccessRefusal(
          'SIGNATURE_AUTHORITY_UNCONFIGURED',
          'no signingAuthorities are configured, so no actor may sign',
        )
        : new FaberLoomAccessRefusal('SIGNATURE_NOT_PERMITTED', `${actor.id} is not a configured signing authority`)
    }
    const wildcard = input.wildcard === true
    const requested = input.actionTypes ?? []
    if (wildcard && requested.length > 0) {
      throw new FaberLoomAccessRefusal('SIGNATURE_SCOPE_INVALID', 'a wildcard signature lists no action types')
    }
    if (wildcard && !this.allowWildcardSignatures) {
      throw new FaberLoomAccessRefusal(
        'SIGNATURE_WILDCARD_DISALLOWED',
        'this deployment signs one signature per action type and refuses wildcards',
      )
    }
    const actionTypes = [...new Set(requested)]
    if (!wildcard && actionTypes.length === 0) {
      throw new FaberLoomAccessRefusal(
        'SIGNATURE_SCOPE_REQUIRED',
        'a signature must cover at least one action type or be a wildcard',
      )
    }
    const now = options.now ?? new Date().toISOString()
    const expiresAt = input.expiresAt === undefined ? this.defaultExpiry(now) : input.expiresAt
    if (expiresAt !== null && expiresAt <= now) {
      throw new FaberLoomAccessRefusal('SIGNATURE_EXPIRED', `the expiry ${expiresAt} is not after ${now}`)
    }
    const id = randomUUID()
    const record: SignatureRecord = {
      tenantId: tenantOf(actor),
      signedBy: actor.id,
      signedAt: now,
      active: true,
      expiresAt,
      actionTypes,
      wildcard,
      revokedBy: null,
      revokedAt: null,
    }
    await (await this.signatures()).put(id, record)
    return toSignature(id, record)
  }

  /**
   * Revoke one signature of the acting identity's tenant. The next check refuses
   * from this instant and the record keeps the revoking identity and instant. The
   * signer may always revoke their own signature; `revocationAuthorities` adds
   * others. Revoking an already-revoked signature returns it unchanged and keeps
   * the first revocation.
   * @param actor - the acting identity.
   * @param id - signature id.
   * @param options - instant of revocation; defaults to now.
   * @returns the revoked signature.
   */
  async revokeSignature(
    actor: SignatureActor,
    id: FaberLoomSignatureId,
    options: SignatureCheckOptions = {},
  ): Promise<FaberLoomSignature> {
    const table = await this.signatures()
    const record = table.get(id)
    if (record === undefined || record.tenantId !== tenantOf(actor)) {
      throw new FaberLoomAccessRefusal('SIGNATURE_NOT_FOUND', `signature ${id} not found`)
    }
    if (!record.active) return toSignature(id, record)
    if (actor.id !== record.signedBy && !this.revocationAuthorities.includes(actor.id)) {
      throw new FaberLoomAccessRefusal(
        'SIGNATURE_NOT_PERMITTED',
        `${actor.id} may neither sign nor revoke signature ${id}`,
      )
    }
    const next: SignatureRecord = {
      ...record,
      active: false,
      revokedBy: actor.id,
      revokedAt: options.now ?? new Date().toISOString(),
    }
    await table.update(id, () => next)
    return toSignature(id, next)
  }

  /**
   * Require an active CEO signature before approving a protected action type.
   *
   * Refuses, never warns: a protected action type with no active signature throws
   * `SIGNATURE_REQUIRED`, a revoked one `SIGNATURE_REVOKED`, an expired one
   * `SIGNATURE_EXPIRED` — all as {@link FaberLoomAccessRefusal}, the family the
   * other access refusals use. Signatures of another tenant are never consulted.
   * The accepted signature stays valid for further approvals (§7.4 states no
   * single use); callers must not consume or mutate it.
   * @param actor - the approving identity; its `companyId` is the tenant.
   * @param actionType - the action type the approval would run.
   * @param options - instant the check evaluates; defaults to now.
   * @returns the accepted signature, or `null` when the action type is unprotected.
   */
  async requireSignature(
    actor: SignatureActor,
    actionType: string,
    options: SignatureCheckOptions = {},
  ): Promise<FaberLoomSignature | null> {
    if (!this.protectedActionTypes.includes(actionType)) return null
    const resolution = await this.resolve(actor, actionType, options.now ?? new Date().toISOString())
    if (resolution.state === 'ACTIVE') {
      return toSignature(resolution.match.id, resolution.match.record)
    }
    throw new FaberLoomAccessRefusal(REFUSAL_CODES[resolution.state], REFUSAL_DETAILS[resolution.state](actionType))
  }

  /**
   * Report whether the acting identity's tenant holds a signature for one action
   * type, so a panel or tool can show the state before approval. The signer
   * identity appears only to the signer or to `signerIdentityAudience`; another
   * tenant's signature is never visible.
   * @param actor - the reading identity; its `companyId` is the tenant.
   * @param actionType - the action type to report.
   * @param options - instant the state evaluates; defaults to now.
   * @returns the signature state for this reader.
   */
  async signatureStatus(
    actor: SignatureActor,
    actionType: string,
    options: SignatureCheckOptions = {},
  ): Promise<SignatureStatus> {
    if (!this.protectedActionTypes.includes(actionType)) {
      return {
        actionType,
        protected: false,
        state: 'NOT_REQUIRED',
        signatureId: null,
        signedAt: null,
        expiresAt: null,
        signedBy: null,
      }
    }
    const resolution = await this.resolve(actor, actionType, options.now ?? new Date().toISOString())
    const record = resolution.match?.record ?? null
    const visible = record !== null && (actor.id === record.signedBy || this.signerIdentityAudience.includes(actor.id))
    return {
      actionType,
      protected: true,
      state: resolution.state,
      signatureId: resolution.match?.id ?? null,
      signedAt: record?.signedAt ?? null,
      expiresAt: record?.expiresAt ?? null,
      signedBy: visible ? record.signedBy : null,
    }
  }

  /**
   * Resolve which signature of the actor's tenant covers one action type. Active
   * and unexpired wins; otherwise the newest revoked, then expired, signature is
   * reported so a reader can say why approval would refuse.
   * @param actor - the reading identity.
   * @param actionType - the action type to resolve.
   * @param now - ISO-8601 instant the expiry compares against.
   * @returns the state and the signature that decided it.
   */
  private async resolve(actor: SignatureActor, actionType: string, now: string): Promise<SignatureResolution> {
    const tenantId = tenantOf(actor)
    const matches: SignatureMatch[] = []
    for (const [id, record] of (await this.signatures()).entries()) {
      if (record.tenantId !== tenantId) continue
      const covers = record.wildcard ? this.allowWildcardSignatures : record.actionTypes.includes(actionType)
      if (!covers) continue
      matches.push({ id, record })
    }
    const active = matches
      .filter(match => match.record.active && !isExpired(match.record, now))
      .sort(preferActive)
    const accepted = active[0]
    if (accepted !== undefined) return { state: 'ACTIVE', match: accepted }
    const revoked = matches.filter(match => !match.record.active).sort(preferRecent)
    const latestRevoked = revoked[0]
    if (latestRevoked !== undefined) return { state: 'REVOKED', match: latestRevoked }
    const expired = matches.filter(match => isExpired(match.record, now)).sort(preferRecent)
    const latestExpired = expired[0]
    if (latestExpired !== undefined) return { state: 'EXPIRED', match: latestExpired }
    return { state: 'MISSING', match: null }
  }

  /**
   * ISO-8601 expiry for a signature dated `now`, from the configured validity
   * window. `null` means no window is configured, so the signature stays valid
   * until revocation.
   * @param now - ISO-8601 instant the signature is dated.
   * @returns the expiry, or `null` when no window is configured.
   */
  private defaultExpiry(now: string): string | null {
    if (this.signatureValiditySeconds === null) return null
    const at = Date.parse(now)
    if (Number.isNaN(at)) {
      throw new FaberLoomAccessRefusal('SIGNATURE_INVALID_INSTANT', `'${now}' is not an ISO-8601 instant`)
    }
    return new Date(at + this.signatureValiditySeconds * 1000).toISOString()
  }
}

export default FaberLoomAccess
