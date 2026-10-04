import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomShares from '../src/index.ts'
import type { Config } from '../src/index.ts'

const OWNER = 'alvaro@muitowork.com'
const GUEST = 'proveedor@sonepar.com'
const OTHER = 'otro@sonepar.com'

/** Boot the storage/domain composition plus the shares service and a fake mail transport. */
async function harness(config: Config = {}, withConnections = true) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const sendMail = vi.fn(async (_ownerId: string, _message: { to: readonly string[]; subject: string; text: string }) => ({ messageId: 'm-1' }))
  if (withConnections) ctx.provide('faberloomConnections', { sendMail } as never)
  const fiber = await ctx.plugin(FaberLoomShares, config)
  return { ctx, shares: ctx.faberloomShares, sendMail, fiber }
}

describe('FaberLoomShares', () => {
  it('creates a pending grant, emails the acceptance link, and sanitizes permissions', async () => {
    const { shares, sendMail } = await harness({ acceptBase: 'https://app.test/accept' })
    const grant = await shares.create(OWNER, {
      resource: { kind: 'space', id: 'sp-1' },
      resourceName: 'Marluvas',
      granteeEmail: 'Proveedor@Sonepar.com',
      permissions: ['view', 'run', 'not-a-permission'],
    })
    expect(grant).toMatchObject({
      resource: { kind: 'space', id: 'sp-1' },
      ownerId: OWNER,
      granteeEmail: GUEST,
      permissions: ['view', 'run'],
      status: 'pending',
      acceptedAt: null,
    })
    expect(sendMail).toHaveBeenCalledTimes(1)
    const [recipient, message] = sendMail.mock.calls[0] as [string, { to: readonly string[]; text: string }]
    expect(recipient).toBe(OWNER)
    expect(message.to).toEqual([GUEST])
    expect(message.text).toContain(`https://app.test/accept?grant=${grant.id}`)
  })

  it('a pending grant authorizes nothing until the grantee accepts', async () => {
    const { shares } = await harness()
    const grant = await shares.create(OWNER, {
      resource: { kind: 'workflow', id: 'wf-1' },
      resourceName: 'Anti-spam',
      granteeEmail: GUEST,
      permissions: ['view', 'run'],
    })
    expect(await shares.can(GUEST, OWNER, { kind: 'workflow', id: 'wf-1' }, 'view')).toBe(false)
    const accepted = await shares.accept(GUEST, grant.id)
    expect(accepted.status).toBe('active')
    expect(accepted.acceptedAt).not.toBeNull()
    expect(await shares.can(GUEST, OWNER, { kind: 'workflow', id: 'wf-1' }, 'view')).toBe(true)
    expect(await shares.can(GUEST, OWNER, { kind: 'workflow', id: 'wf-1' }, 'run')).toBe(true)
    expect(await shares.can(GUEST, OWNER, { kind: 'workflow', id: 'wf-1' }, 'edit-graph')).toBe(false)
  })

  it('only the grantee may accept, and only the grantor may revoke', async () => {
    const { shares } = await harness()
    const grant = await shares.create(OWNER, {
      resource: { kind: 'space', id: 'sp-1' },
      resourceName: 'Marluvas',
      granteeEmail: GUEST,
      permissions: ['view'],
    })
    await expect(shares.accept(OTHER, grant.id)).rejects.toThrow('only the grantee')
    await expect(shares.revoke(GUEST, grant.id)).rejects.toThrow('only the grantor')
    await shares.accept(GUEST, grant.id)
    expect((await shares.revoke(OWNER, grant.id)).status).toBe('revoked')
    expect(await shares.can(GUEST, OWNER, { kind: 'space', id: 'sp-1' }, 'view')).toBe(false)
  })

  it('the owner is always allowed and lists outgoing and incoming grants', async () => {
    const { shares } = await harness()
    expect(await shares.can(OWNER, OWNER, { kind: 'space', id: 'sp-1' }, 'manage-members')).toBe(true)
    const mine = await shares.create(OWNER, { resource: { kind: 'space', id: 'sp-1' }, resourceName: 'Marluvas', granteeEmail: GUEST, permissions: ['view'] })
    await shares.accept(GUEST, mine.id)
    const theirs = await shares.list(GUEST)
    expect(theirs.incoming.map(grant => grant.id)).toEqual([mine.id])
    expect(theirs.outgoing).toEqual([])
    expect((await shares.list(OWNER)).outgoing.map(grant => grant.id)).toEqual([mine.id])
  })

  it('isolates a grant by resource, by kind, and by owner', async () => {
    const { shares } = await harness()
    const grant = await shares.create(OWNER, { resource: { kind: 'space', id: 'sp-1' }, resourceName: 'A', granteeEmail: GUEST, permissions: ['view'] })
    await shares.accept(GUEST, grant.id)
    expect(await shares.can(GUEST, OWNER, { kind: 'space', id: 'sp-2' }, 'view')).toBe(false)
    expect(await shares.can(GUEST, OWNER, { kind: 'workflow', id: 'sp-1' }, 'view')).toBe(false)
    expect(await shares.can(GUEST, OTHER, { kind: 'space', id: 'sp-1' }, 'view')).toBe(false)
    // A grantee of another owner never inherits this grant.
    expect(await shares.can(OTHER, OWNER, { kind: 'space', id: 'sp-1' }, 'view')).toBe(false)
  })

  it('publishes to the console and imports the incoming grant, then prunes it on revoke', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const { shares } = await harness({ consoleBase: 'http://console', consoleToken: 'tok' })
      fetchMock.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'console-1' }) })
      const grant = await shares.create(OWNER, { resource: { kind: 'workflow', id: 'wf-1' }, resourceName: 'Anti-spam', granteeEmail: GUEST, permissions: ['view'] })
      expect(fetchMock).toHaveBeenCalledWith('http://console/harness/shares/', expect.objectContaining({ method: 'POST' }))

      // The console now offers an active grant to the guest; sync imports it.
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          incoming: [{ id: 'console-1', kind: 'workflow', owner_email: OWNER, name: 'Anti-spam', resource_id: 'wf-1', permissions: ['view', 'run'], status: 'active', payload: { intent: 'x' } }],
        }),
      })
      await shares.sync(GUEST)
      expect(await shares.can(GUEST, OWNER, { kind: 'workflow', id: 'wf-1' }, 'run')).toBe(true)

      // Revoking in the console removes the row; sync prunes the local copy.
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ incoming: [] }) })
      await shares.sync(GUEST)
      expect(await shares.can(GUEST, OWNER, { kind: 'workflow', id: 'wf-1' }, 'view')).toBe(false)

      // Revoking locally deletes the console mirror.
      fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: async () => undefined })
      await shares.revoke(OWNER, grant.id)
      expect(fetchMock).toHaveBeenCalledWith('http://console/harness/shares/console-1/', expect.objectContaining({ method: 'DELETE' }))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('requires a grantee email and at least one permission', async () => {
    const { shares } = await harness()
    await expect(shares.create(OWNER, { resource: { kind: 'space', id: 'sp-1' }, resourceName: 'A', granteeEmail: '  ', permissions: ['view'] }))
      .rejects.toThrow('needs a grantee email')
    await expect(shares.create(OWNER, { resource: { kind: 'space', id: 'sp-1' }, resourceName: 'A', granteeEmail: GUEST, permissions: ['nope'] }))
      .rejects.toThrow('at least one permission')
    await expect(shares.accept(GUEST, 'missing')).rejects.toThrow('not found')
    await expect(shares.revoke(OWNER, 'missing')).rejects.toThrow('not found')
  })

  it('skips the email when no mail transport is mounted, and resolves effective permissions', async () => {
    const { shares, sendMail, fiber } = await harness({}, false)
    const grant = await shares.create(OWNER, { resource: { kind: 'space', id: 'sp-1' }, resourceName: 'A', granteeEmail: GUEST, permissions: ['view', 'run'] })
    expect(sendMail).not.toHaveBeenCalled()
    expect(await shares.permissionsFor(GUEST, { kind: 'space', id: 'sp-1' })).toEqual([])
    await shares.accept(GUEST, grant.id)
    expect(await shares.permissionsFor(GUEST, { kind: 'space', id: 'sp-1' })).toEqual(['view', 'run'])
    expect(await shares.permissionsFor(GUEST, { kind: 'space', id: 'sp-9' })).toEqual([])
    // A sync without a console is a no-op, and disposing the fiber closes the domain.
    await shares.sync(GUEST)
    await fiber.dispose()
  })

  it('falls back to the environment console and fails loud when it rejects', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    process.env['CONSOLA_API_BASE'] = 'http://env-console'
    process.env['CONSOLA_TOKEN'] = 'env-token'
    try {
      const { shares } = await harness()
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      await expect(shares.create(OWNER, { resource: { kind: 'space', id: 'sp-1' }, resourceName: 'A', granteeEmail: GUEST, permissions: ['view'] }))
        .rejects.toThrow('la consola rechazó')
      fetchMock.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) })
      const grant = await shares.create(OWNER, { resource: { kind: 'space', id: 'sp-1' }, resourceName: 'A', granteeEmail: GUEST, permissions: ['view'] })
      expect(grant.status).toBe('pending')
      expect(fetchMock).toHaveBeenCalledWith('http://env-console/harness/shares/', expect.anything())
    } finally {
      delete process.env['CONSOLA_API_BASE']
      delete process.env['CONSOLA_TOKEN']
      vi.unstubAllGlobals()
    }
  })

  it('revokes locally even when the console mirror delete fails', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const { shares } = await harness({ consoleBase: 'http://console', consoleToken: 't' })
      fetchMock.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'c1' }) })
      const grant = await shares.create(OWNER, { resource: { kind: 'space', id: 'sp-1' }, resourceName: 'A', granteeEmail: GUEST, permissions: ['view'] })
      fetchMock.mockRejectedValueOnce(new Error('down'))
      await shares.revoke(OWNER, grant.id)
      expect((await shares.list(OWNER)).outgoing[0]?.status).toBe('revoked')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('imports a partial console row, skips other kinds, and prunes by grantee', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const { shares } = await harness({ consoleBase: 'http://console', consoleToken: 't' })
      // A partial space row imports; an agent row of another kind is skipped.
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          incoming: [
            { id: 'c9', kind: 'space', owner_email: OWNER, name: 'SinId', status: 'pending' },
            { id: 'c10', kind: 'agent', owner_email: OWNER, name: 'Agente' },
          ],
        }),
      })
      await shares.sync(GUEST)
      const incoming = (await shares.list(GUEST)).incoming
      expect(incoming).toHaveLength(1)
      expect(incoming[0]?.resource.id).toBe('SinId')
      expect(incoming[0]?.permissions).toEqual(['view'])
      expect(incoming[0]?.status).toBe('pending')
      // Syncing another grantee leaves the guest's grant alone.
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ incoming: [] }) })
      await shares.sync(OTHER)
      expect((await shares.list(GUEST)).incoming).toHaveLength(1)
      // A response with no `incoming` prunes the stale guest grant.
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
      await shares.sync(GUEST)
      expect((await shares.list(GUEST)).incoming).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sorts multiple outgoing and incoming grants', async () => {
    const { shares } = await harness()
    await shares.create(OWNER, { resource: { kind: 'space', id: 'sp-1' }, resourceName: 'A', granteeEmail: GUEST, permissions: ['view'] })
    await shares.create(OWNER, { resource: { kind: 'space', id: 'sp-2' }, resourceName: 'B', granteeEmail: OTHER, permissions: ['view'] })
    await shares.create(OTHER, { resource: { kind: 'space', id: 'sp-3' }, resourceName: 'C', granteeEmail: GUEST, permissions: ['view'] })
    expect((await shares.list(OWNER)).outgoing).toHaveLength(2)
    expect((await shares.list(GUEST)).incoming).toHaveLength(2)
  })

  it('closes cleanly when no domain was ever opened', async () => {
    const { fiber } = await harness()
    await fiber.dispose()
  })
})
