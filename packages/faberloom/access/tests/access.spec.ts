import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess, { FaberLoomAccessRefusal, type Config, type SignatureActor } from '../src/index.ts'

const OWNER = 'alvaro@muitowork.com'
const CEO = 'ceo@muitowork.com'
const TENANT = 'eguisa'
const OTHER_TENANT = 'sondel'
const MONEY = 'money.payout'
const INVENTORY = 'inventory.adjust'
const SHIPMENT = 'shipment.dispatch'

/** Deployment the specs run against: the three §7.4 classes are protected. */
const SIGNED_DEPLOYMENT: Config = {
  protectedActionTypes: [MONEY, INVENTORY, SHIPMENT],
  signingAuthorities: [CEO],
  signerIdentityAudience: [OWNER],
}

/** The tenant owner reading and approving. */
const owner: SignatureActor = { id: OWNER, companyId: TENANT }

/** The CEO of the tenant. */
const ceo: SignatureActor = { id: CEO, companyId: TENANT }

/** An identity of another tenant that must never reach this tenant's signatures. */
const foreignCeo: SignatureActor = { id: CEO, companyId: OTHER_TENANT }

/** Boot the storage/domain composition plus the access service. */
async function harness(config: Config = SIGNED_DEPLOYMENT) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess, config)
  return { ctx, access: ctx.faberloomAccess }
}

describe('FaberLoomAccess', () => {
  it('grants, checks, and scopes by action, agent, and context', async () => {
    const { access } = await harness()
    const grant = await access.grant(OWNER, { action: 'mail.send', agentId: 'a1', context: 'eguisa' })
    expect(grant).toMatchObject({ action: 'mail.send', revoked: false })
    expect(await access.check({ ownerId: OWNER, action: 'mail.send', agentId: 'a1', context: 'eguisa' }))
      .toMatchObject({ allowed: true, reason: 'GRANTED', grantId: grant.id })
    expect(await access.check({ ownerId: OWNER, action: 'mail.send', agentId: 'a2', context: 'eguisa' }))
      .toMatchObject({ allowed: false, reason: 'NO_GRANT' })
    expect(await access.check({ ownerId: OWNER, action: 'mail.send', agentId: 'a1', context: 'sondel' }))
      .toMatchObject({ allowed: false, reason: 'NO_GRANT' })
    expect(await access.check({ ownerId: OWNER, action: 'order.create' })).toMatchObject({ allowed: false, reason: 'NO_GRANT' })
    expect(await access.check({ ownerId: 'otro', action: 'mail.send', agentId: 'a1', context: 'eguisa' }))
      .toMatchObject({ allowed: false, reason: 'NO_GRANT' })
  })

  it('a wildcard grant authorizes any agent or context of that action', async () => {
    const { access } = await harness()
    await access.grant(OWNER, { action: 'mail.send' })
    expect((await access.check({ ownerId: OWNER, action: 'mail.send', agentId: 'a9', context: 'x' })).allowed).toBe(true)
  })

  it('F17 · revoking denies the next check and the grant disappears from the active list', async () => {
    const { access } = await harness()
    const grant = await access.grant(OWNER, { action: 'mail.send' })
    await access.revokeGrant(OWNER, grant.id)
    expect(await access.check({ ownerId: OWNER, action: 'mail.send' })).toMatchObject({ allowed: false, reason: 'REVOKED' })
    expect(await access.listGrants(OWNER)).toHaveLength(1)
    expect(await access.listGrants(OWNER, { activeOnly: true })).toEqual([])
  })

  it('refuses an expired grant', async () => {
    const { access } = await harness()
    await access.grant(OWNER, { action: 'mail.send', expiresAt: '2026-01-01T00:00:00.000Z' })
    expect(await access.check({ ownerId: OWNER, action: 'mail.send', now: '2026-01-02T00:00:00.000Z' }))
      .toMatchObject({ allowed: false, reason: 'EXPIRED' })
  })

  it('guards ownership and missing grants', async () => {
    const { access } = await harness()
    const grant = await access.grant(OWNER, { action: 'mail.send' })
    await expect(access.revokeGrant('otro', grant.id)).rejects.toThrow('only the owner')
    await expect(access.revokeGrant(OWNER, 'missing')).rejects.toThrow('not found')
  })
})

describe('FaberLoomAccess CEO signatures', () => {
  it('W-16 · refuses a protected action type that has no signature', async () => {
    const { access } = await harness()
    await expect(access.requireSignature(owner, MONEY)).rejects.toMatchObject({ code: 'SIGNATURE_REQUIRED' })
    expect(await access.signatureStatus(owner, MONEY)).toMatchObject({
      protected: true, state: 'MISSING', signatureId: null, signedBy: null,
    })
  })

  it('allows a protected action type while the signature is active', async () => {
    const { access } = await harness()
    const signature = await access.issueSignature(ceo, { actionTypes: [MONEY] })
    expect(signature).toMatchObject({
      tenantId: TENANT, signedBy: CEO, active: true, expiresAt: null, wildcard: false,
    })
    expect(await access.requireSignature(owner, MONEY)).toMatchObject({ id: signature.id, signedBy: CEO })
    expect(await access.signatureStatus(owner, MONEY)).toMatchObject({
      protected: true, state: 'ACTIVE', signatureId: signature.id, signedBy: CEO,
    })
  })

  it('covers only the action types the CEO named', async () => {
    const { access } = await harness()
    await access.issueSignature(ceo, { actionTypes: [MONEY] })
    await expect(access.requireSignature(owner, INVENTORY)).rejects.toMatchObject({ code: 'SIGNATURE_REQUIRED' })
  })

  it('refuses from the instant of revocation and keeps who revoked it', async () => {
    const { access } = await harness()
    const signature = await access.issueSignature(ceo, { actionTypes: [MONEY] })
    const revoked = await access.revokeSignature(ceo, signature.id, { now: '2026-02-01T00:00:00.000Z' })
    expect(revoked).toMatchObject({ active: false, revokedBy: CEO, revokedAt: '2026-02-01T00:00:00.000Z' })
    await expect(access.requireSignature(owner, MONEY, { now: '2026-02-01T00:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'SIGNATURE_REVOKED' })
    expect(await access.signatureStatus(owner, MONEY)).toMatchObject({ state: 'REVOKED', signatureId: signature.id })
  })

  it('refuses a revocation the actor has no authority for', async () => {
    const { access } = await harness()
    const signature = await access.issueSignature(ceo, { actionTypes: [MONEY] })
    await expect(access.revokeSignature(owner, signature.id)).rejects.toMatchObject({ code: 'SIGNATURE_NOT_PERMITTED' })
    expect((await access.requireSignature(owner, MONEY))?.id).toBe(signature.id)
  })

  it('lets a configured revocation authority revoke and records that identity', async () => {
    const { access } = await harness({ ...SIGNED_DEPLOYMENT, revocationAuthorities: [OWNER] })
    const signature = await access.issueSignature(ceo, { actionTypes: [MONEY] })
    expect(await access.revokeSignature(owner, signature.id)).toMatchObject({ revokedBy: OWNER, active: false })
  })

  it('refuses at and after expiry, and accepts before it', async () => {
    const { access } = await harness()
    await access.issueSignature(
      ceo,
      { actionTypes: [INVENTORY], expiresAt: '2026-03-01T00:00:00.000Z' },
      { now: '2026-02-01T00:00:00.000Z' },
    )
    expect(await access.requireSignature(owner, INVENTORY, { now: '2026-02-28T23:59:59.999Z' })).not.toBeNull()
    await expect(access.requireSignature(owner, INVENTORY, { now: '2026-03-01T00:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'SIGNATURE_EXPIRED' })
    expect(await access.signatureStatus(owner, INVENTORY, { now: '2026-04-01T00:00:00.000Z' }))
      .toMatchObject({ state: 'EXPIRED' })
  })

  it('dates a signature from the configured validity window', async () => {
    const { access } = await harness({ ...SIGNED_DEPLOYMENT, signatureValiditySeconds: 3600 })
    const signature = await access.issueSignature(ceo, { actionTypes: [SHIPMENT] }, { now: '2026-02-01T00:00:00.000Z' })
    expect(signature.expiresAt).toBe('2026-02-01T01:00:00.000Z')
    await expect(access.requireSignature(owner, SHIPMENT, { now: '2026-02-01T01:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'SIGNATURE_EXPIRED' })
  })

  it('needs no signature for an unprotected action type', async () => {
    const { access } = await harness()
    expect(await access.requireSignature(owner, 'mail.send')).toBeNull()
    expect(await access.signatureStatus(owner, 'mail.send')).toEqual({
      actionType: 'mail.send', protected: false, state: 'NOT_REQUIRED',
      signatureId: null, signedAt: null, expiresAt: null, signedBy: null,
    })
  })

  it('keeps another tenant signature invisible and unusable', async () => {
    const { access } = await harness()
    const foreign = await access.issueSignature(foreignCeo, { actionTypes: [MONEY] })
    await expect(access.requireSignature(owner, MONEY)).rejects.toMatchObject({ code: 'SIGNATURE_REQUIRED' })
    expect(await access.signatureStatus(owner, MONEY)).toMatchObject({ state: 'MISSING', signatureId: null })
    await expect(access.revokeSignature(owner, foreign.id)).rejects.toMatchObject({ code: 'SIGNATURE_NOT_FOUND' })
  })

  it('refuses the same refusal family as the other access refusals', async () => {
    const { access } = await harness()
    const refusal = await access.requireSignature(owner, MONEY).catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(Error)
    expect(refusal).toBeInstanceOf(FaberLoomAccessRefusal)
    expect(refusal).toMatchObject({ code: 'SIGNATURE_REQUIRED' })
    expect((refusal as Error).message).toBe(
      "faberloom: SIGNATURE_REQUIRED — no active CEO signature covers 'money.payout' for this tenant",
    )
    const grantRefusal = await access.revokeGrant(OWNER, 'missing').catch((error: unknown) => error)
    expect(grantRefusal).toBeInstanceOf(FaberLoomAccessRefusal)
    expect(grantRefusal).toMatchObject({ code: 'GRANT_NOT_FOUND' })
    expect((grantRefusal as Error).message.startsWith('faberloom: GRANT_NOT_FOUND — ')).toBe(true)
  })

  it('accepts the same signature for a second approval', async () => {
    const { access } = await harness()
    const signature = await access.issueSignature(ceo, { actionTypes: [MONEY] })
    const first = await access.requireSignature(owner, MONEY, { now: '2026-02-01T00:00:00.000Z' })
    const second = await access.requireSignature(owner, MONEY, { now: '2026-02-02T00:00:00.000Z' })
    expect(first?.id).toBe(signature.id)
    expect(second?.id).toBe(signature.id)
    expect(second).toMatchObject({ active: true, revokedBy: null })
  })

  it('hides the signer identity outside the configured audience', async () => {
    const { access } = await harness({ ...SIGNED_DEPLOYMENT, signerIdentityAudience: [] })
    const signature = await access.issueSignature(ceo, { actionTypes: [MONEY] })
    expect(await access.signatureStatus(owner, MONEY)).toMatchObject({
      state: 'ACTIVE', signatureId: signature.id, signedBy: null,
    })
    expect(await access.signatureStatus(ceo, MONEY)).toMatchObject({ signedBy: CEO })
  })

  it('refuses a wildcard signature unless the deployment allows it', async () => {
    const { access } = await harness()
    await expect(access.issueSignature(ceo, { wildcard: true }))
      .rejects.toMatchObject({ code: 'SIGNATURE_WILDCARD_DISALLOWED' })
  })

  it('covers every protected action type with an allowed wildcard', async () => {
    const { access } = await harness({ ...SIGNED_DEPLOYMENT, allowWildcardSignatures: true })
    await access.issueSignature(ceo, { wildcard: true })
    for (const actionType of [MONEY, INVENTORY, SHIPMENT]) {
      expect(await access.requireSignature(owner, actionType)).not.toBeNull()
    }
  })

  it('protects nothing when the deployment declares no protected action type', async () => {
    const { access } = await harness({})
    expect(access.protectedActionTypes).toEqual([])
    expect(await access.requireSignature(owner, MONEY)).toBeNull()
    expect(await access.signatureStatus(owner, MONEY)).toMatchObject({ protected: false, state: 'NOT_REQUIRED' })
  })

  it('refuses issuance when no signing authority is configured', async () => {
    const { access } = await harness({ protectedActionTypes: [MONEY] })
    await expect(access.issueSignature(ceo, { actionTypes: [MONEY] }))
      .rejects.toMatchObject({ code: 'SIGNATURE_AUTHORITY_UNCONFIGURED' })
  })

  it('refuses issuance to an identity outside the signing authorities', async () => {
    const { access } = await harness()
    await expect(access.issueSignature(owner, { actionTypes: [MONEY] }))
      .rejects.toMatchObject({ code: 'SIGNATURE_NOT_PERMITTED' })
  })

  it('refuses a signature with no scope', async () => {
    const { access } = await harness()
    await expect(access.issueSignature(ceo, { actionTypes: [] }))
      .rejects.toMatchObject({ code: 'SIGNATURE_SCOPE_REQUIRED' })
    await expect(access.issueSignature(ceo, { wildcard: true, actionTypes: [MONEY] }))
      .rejects.toMatchObject({ code: 'SIGNATURE_SCOPE_INVALID' })
  })

  it('keeps the first revocation when revoked twice', async () => {
    const { access } = await harness({ ...SIGNED_DEPLOYMENT, revocationAuthorities: [OWNER] })
    const signature = await access.issueSignature(ceo, { actionTypes: [MONEY] })
    await access.revokeSignature(ceo, signature.id, { now: '2026-02-01T00:00:00.000Z' })
    const again = await access.revokeSignature(owner, signature.id, { now: '2026-02-02T00:00:00.000Z' })
    expect(again).toMatchObject({ revokedBy: CEO, revokedAt: '2026-02-01T00:00:00.000Z' })
  })
})
