import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../src/index.ts'

/** Boot the storage/domain composition plus the access service. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  return { ctx, access: ctx.faberloomAccess }
}

const OWNER = 'alvaro@muitowork.com'

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
