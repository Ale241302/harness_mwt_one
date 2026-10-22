import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomSpaces from '../../spaces/src/index.ts'
import FaberLoomShares from '../src/index.ts'
import type { SpaceActor, FaberLoomSpaceId } from '../../spaces/src/index.ts'

const OWNER = 'alvaro@muitowork.com'
const GUEST = 'proveedor@sonepar.com'

/** Boot storage, the spaces service, and the shares service over one pool. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const sendMail = vi.fn(async (_ownerId: string, _message: { to: readonly string[]; subject: string; text: string }) => ({ messageId: 'm-1' }))
  ctx.provide('faberloomConnections', { sendMail } as never)
  await ctx.plugin(FaberLoomShares, { acceptBase: 'https://app.test/accept' })
  await ctx.plugin(FaberLoomSpaces)
  return { ctx, spaces: ctx.faberloomSpaces, shares: ctx.faberloomShares, sendMail }
}

const owner: SpaceActor = { id: OWNER, role: 'admin', companyId: undefined, readOnly: false }
const guest: SpaceActor = { id: GUEST, role: 'user', companyId: undefined, readOnly: false }

describe('F7 — share a Space with a guest end to end', () => {
  it('emails the link, lets the accepted guest read but not manage, and revoking removes access', async () => {
    const { spaces, shares, sendMail } = await harness()
    const space = await spaces.create(owner, { title: 'Marluvas' })

    const grant = await shares.create(OWNER, {
      resource: { kind: 'space', id: space.id },
      resourceName: space.title,
      granteeEmail: GUEST,
      permissions: ['view'],
    })
    expect(sendMail).toHaveBeenCalledTimes(1)
    const [recipient, message] = sendMail.mock.calls[0] as [string, { to: readonly string[]; text: string }]
    expect(recipient).toBe(OWNER)
    expect(message.to).toEqual([GUEST])
    expect(message.text).toContain(`https://app.test/accept?grant=${grant.id}`)

    // The guest is denied until the grant is accepted.
    await expect(spaces.get(guest, space.id)).rejects.toThrow('space access denied')
    await expect(spaces.list(guest)).resolves.toEqual([])

    await shares.accept(GUEST, grant.id)
    expect((await spaces.get(guest, space.id)).title).toBe('Marluvas')
    expect((await spaces.list(guest)).map(entry => entry.id)).toEqual([space.id])
    // `view` authorizes reading, not managing or guessing another space.
    await expect(spaces.update(guest, space.id, { title: 'Robado' })).rejects.toThrow('cannot manage')
    await expect(spaces.get(guest, 'missing' as FaberLoomSpaceId)).rejects.toThrow('not found')

    await shares.revoke(OWNER, grant.id)
    await expect(spaces.get(guest, space.id)).rejects.toThrow('space access denied')
    expect((await spaces.get(owner, space.id)).title).toBe('Marluvas')
  })

  it('lets the grantee create and move sub-spaces only with the explicit hierarchy permissions', async () => {
    const { spaces, shares } = await harness()
    const parent = await spaces.create(owner, { title: 'Padre' })
    const source = await spaces.create(owner, { title: 'Origen', parentId: parent.id })
    const target = await spaces.create(owner, { title: 'Destino' })

    const parentGrant = await shares.create(OWNER, {
      resource: { kind: 'space', id: parent.id },
      resourceName: parent.title,
      granteeEmail: GUEST,
      permissions: ['view', 'create-subspace'],
    })
    const sourceGrant = await shares.create(OWNER, {
      resource: { kind: 'space', id: source.id },
      resourceName: source.title,
      granteeEmail: GUEST,
      permissions: ['view', 'move-space'],
    })
    const targetGrant = await shares.create(OWNER, {
      resource: { kind: 'space', id: target.id },
      resourceName: target.title,
      granteeEmail: GUEST,
      permissions: ['view', 'create-subspace'],
    })
    for (const grant of [parentGrant, sourceGrant, targetGrant]) await shares.accept(GUEST, grant.id)

    const child = await spaces.create(guest, { title: 'Sub-espacio del invitado', parentId: parent.id })
    expect(child).toMatchObject({ ownerId: GUEST, parentId: parent.id })

    const moved = await spaces.update(guest, source.id, { parentId: target.id })
    expect(moved.parentId).toBe(target.id)

    // Downgrading to view-only removes each capability independently.
    await shares.create(OWNER, {
      resource: { kind: 'space', id: source.id },
      resourceName: source.title,
      granteeEmail: GUEST,
      permissions: ['view'],
    })
    await expect(spaces.update(guest, source.id, { parentId: parent.id }))
      .rejects.toThrow('cannot move this space')
    await shares.create(OWNER, {
      resource: { kind: 'space', id: target.id },
      resourceName: target.title,
      granteeEmail: GUEST,
      permissions: ['view'],
    })
    await expect(spaces.create(guest, { title: 'Sin permiso', parentId: target.id }))
      .rejects.toThrow('cannot create a sub-space here')
  })

  it('rejects Space-only hierarchy permissions on a Work Flow grant', async () => {
    const { shares } = await harness()
    await expect(shares.create(OWNER, {
      resource: { kind: 'workflow', id: 'wf-1' },
      resourceName: 'Work Flow',
      granteeEmail: GUEST,
      permissions: ['view', 'move-space'],
    })).rejects.toThrow('move-space only applies to a Space')
  })
})
