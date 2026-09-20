/**
 * Native product access (`ctx.faberloomAccess`): elective autonomy grants
 * scoped to one action, agent, and context. A grant is issued explicitly by the
 * human and checked before every effect; revoking it denies the next check.
 * Records are durable through `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-faberloom-access
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { accessDomainSpec, type GrantRecord } from './spec.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { FaberLoomGrant, GrantCheck, GrantDecision, GrantInput } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomAccess: FaberLoomAccess
  }
}

/** Map one durable grant to the consumer-facing grant. */
function toGrant(id: string, record: GrantRecord): FaberLoomGrant {
  return { id, ...record }
}

/**
 * The product access service: action-scoped, revocable autonomy grants.
 */
export class FaberLoomAccess extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof accessDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   */
  constructor(ctx: Context) {
    super(ctx, 'faberloomAccess')
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
    if (record === undefined) throw new Error(`faberloom: grant ${id} not found`)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can revoke this grant')
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
}

export default FaberLoomAccess
