/**
 * Credential custody for E1 (`ctx.faberloomCredentials`).
 *
 * The mediator is the only place that reads a stored mailbox secret, and it never
 * returns one: a caller runs its work inside {@link FaberLoomCredentialMediator.withSecret}
 * and receives the result, not the password. Descriptions, refusal messages and
 * rotation answers carry no secret, which is what "absence of secrets in the
 * contract" means in practice.
 *
 * Default is denial: an unknown connection, another owner's connection, a revoked
 * one, or an empty secret all refuse before any socket opens.
 *
 * At-rest encryption is a deployment concern this module does not claim: it stores
 * what the storage domain is configured to protect. Rotation and revocation are
 * enforced here.
 * @module @deepseek-ai/dsh-faberloom-access/src/credentials
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineDomain, domainTable, type Domain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { FaberLoomAccessRefusal } from './refusal.ts'

/** Durable secret record: one connection of one owner. */
export const credentialRecord = z.object({
  ownerId: z.string(),
  connectionId: z.string(),
  secret: z.string(),
  updatedAt: z.string(),
  revoked: z.boolean(),
})

/** One stored credential, inferred from {@link credentialRecord}. */
export type CredentialRecord = z.infer<typeof credentialRecord>

/**
 * The credential domain: one `secrets` table.
 *
 * Version 1 is the first layout; nothing is migrated.
 */
export const credentialDomainSpec = defineDomain({
  name: 'faberloom_credentials',
  version: 1,
  tables: {
    secrets: domainTable<string, CredentialRecord>(credentialRecord),
  },
})

/** What a caller may know about a credential. */
export interface CredentialDescription {
  /** Connection the secret belongs to. */
  readonly connectionId: string
  /** Whether a secret is stored. */
  readonly present: boolean
  /** When it was last written, or null. */
  readonly updatedAt: string | null
  /** Whether it was revoked and cannot be used. */
  readonly revoked: boolean
}

/** Key of one connection inside the table. */
function keyOf(ownerId: string, connectionId: string): string {
  return `${ownerId}\u0000${connectionId}`
}

/**
 * Remove a known secret from text that is about to leave the process.
 * @param text - message that may quote the secret.
 * @param secret - the value to remove.
 * @returns the text with every occurrence replaced.
 */
export function redactSecret(text: string, secret: string): string {
  if (secret.length === 0) return text
  return text.split(secret).join('[redacted]')
}

/** Credential custody for E1. */
export class FaberLoomCredentialMediator extends Service {
  static inject = ['storageDomain'] as const

  private domainPromise: Promise<Domain<typeof credentialDomainSpec>> | undefined

  constructor(ctx: Context) {
    super(ctx, 'faberloomCredentials')
  }

  private domain(): Promise<Domain<typeof credentialDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(credentialDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.credentialsDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async secrets(): Promise<KvTable<string, CredentialRecord>> {
    return (await this.domain()).table('secrets')
  }

  /**
   * Store or replace one connection's secret.
   * @param ownerId - owning identity.
   * @param connectionId - connection the secret belongs to.
   * @param secret - the value; it is never echoed back.
   * @returns the description, which carries no secret.
   * @throws FaberLoomAccessRefusal `CREDENTIAL_SCOPE_REQUIRED` when a scope is empty.
   * @throws FaberLoomAccessRefusal `CREDENTIAL_EMPTY` when the value is blank.
   */
  async put(ownerId: string, connectionId: string, secret: string): Promise<CredentialDescription> {
    if (ownerId.trim() === '' || connectionId.trim() === '') {
      throw new FaberLoomAccessRefusal('CREDENTIAL_SCOPE_REQUIRED', 'a credential needs an owner and a connection')
    }
    if (secret.trim() === '') {
      throw new FaberLoomAccessRefusal('CREDENTIAL_EMPTY', 'a credential cannot be blank')
    }
    const record: CredentialRecord = {
      ownerId,
      connectionId,
      secret,
      updatedAt: new Date().toISOString(),
      revoked: false,
    }
    await (await this.secrets()).put(keyOf(ownerId, connectionId), record)
    return describe(record)
  }

  /**
   * Describe one connection without reading its secret.
   * @param ownerId - owning identity.
   * @param connectionId - connection to describe.
   * @returns the description; `present` is false when nothing is stored.
   */
  async describe(ownerId: string, connectionId: string): Promise<CredentialDescription> {
    const record = (await this.secrets()).get(keyOf(ownerId, connectionId))
    return record === undefined
      ? { connectionId, present: false, updatedAt: null, revoked: false }
      : describe(record)
  }

  /**
   * List one owner's connections, never their secrets.
   * @param ownerId - owning identity.
   * @returns one description per stored connection of that owner.
   */
  async list(ownerId: string): Promise<CredentialDescription[]> {
    const out: CredentialDescription[] = []
    for (const record of (await this.secrets()).entries()) {
      if (record[1].ownerId !== ownerId) continue
      out.push(describe(record[1]))
    }
    return out
  }

  /**
   * Revoke one connection; the next use refuses.
   * @param ownerId - owning identity.
   * @param connectionId - connection to revoke.
   * @returns the description after revocation.
   * @throws FaberLoomAccessRefusal `CREDENTIAL_NOT_FOUND` when it does not exist for that owner.
   */
  async revoke(ownerId: string, connectionId: string): Promise<CredentialDescription> {
    const table = await this.secrets()
    const key = keyOf(ownerId, connectionId)
    const record = table.get(key)
    if (record === undefined) {
      throw new FaberLoomAccessRefusal('CREDENTIAL_NOT_FOUND', 'no stored credential for that connection')
    }
    const next: CredentialRecord = { ...record, secret: '', revoked: true, updatedAt: new Date().toISOString() }
    await table.update(key, () => next)
    return describe(next)
  }

  /**
   * Answer whether a candidate is the stored secret, without returning it.
   * @param ownerId - owning identity.
   * @param connectionId - connection to check.
   * @param candidate - value to compare.
   * @returns false for an unknown, revoked, or different secret.
   */
  async verify(ownerId: string, connectionId: string, candidate: string): Promise<boolean> {
    const record = (await this.secrets()).get(keyOf(ownerId, connectionId))
    if (record === undefined || record.revoked || record.secret === '') return false
    return record.secret === candidate
  }

  /**
   * Run one operation with the secret in scope, and never hand it out.
   *
   * The callback receives the secret and its return value is the caller's. A
   * failure leaves the process as a refusal whose message has the secret removed,
   * so a transport error cannot carry the password into a log or a UI.
   * @param ownerId - owning identity.
   * @param connectionId - connection to use.
   * @param purpose - short label for the refusal detail; no secrets.
   * @param run - the operation needing the secret.
   * @returns whatever `run` returns.
   * @throws FaberLoomAccessRefusal when the credential is missing, revoked, or `run` throws.
   */
  async withSecret<T>(
    ownerId: string,
    connectionId: string,
    purpose: string,
    run: (secret: string) => Promise<T>,
  ): Promise<T> {
    if (ownerId.trim() === '' || connectionId.trim() === '') {
      throw new FaberLoomAccessRefusal('CREDENTIAL_SCOPE_REQUIRED', 'a credential needs an owner and a connection')
    }
    const record = (await this.secrets()).get(keyOf(ownerId, connectionId))
    if (record === undefined) {
      throw new FaberLoomAccessRefusal('CREDENTIAL_NOT_FOUND', 'no stored credential for that connection')
    }
    if (record.revoked) {
      throw new FaberLoomAccessRefusal('CREDENTIAL_REVOKED', 'the credential was revoked; store a new one to use this connection')
    }
    if (record.secret === '') {
      throw new FaberLoomAccessRefusal('CREDENTIAL_NOT_FOUND', 'no stored credential for that connection')
    }
    try {
      return await run(record.secret)
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new FaberLoomAccessRefusal('CREDENTIAL_USE_FAILED', `${purpose}: ${redactSecret(detail, record.secret)}`)
    }
  }
}

/** Public view of a stored record. */
function describe(record: CredentialRecord): CredentialDescription {
  return {
    connectionId: record.connectionId,
    present: record.secret !== '',
    updatedAt: record.updatedAt,
    revoked: record.revoked,
  }
}

export default FaberLoomCredentialMediator
