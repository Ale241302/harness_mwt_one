import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomSessionShares from '../src/index.ts'

const OWNER = { id: 'duenio@sondelsa.com' }
const MEMBER = { id: 'miembro@sondelsa.com' }

/** One console shared-Session row used by the import tests. */
interface ConsoleRow {
  id: string
  space_id: string
  session_id: string
  owner_email: string
  title: string
  content: string
  message_count: number
}

afterEach(() => { vi.unstubAllGlobals() })

/** Boot storage plus the session-shares service over fake spaces and shares. */
async function harness(options: { console?: boolean; owner?: string; allowed?: boolean; spaces?: boolean; shares?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  if (options.spaces !== false) {
    ctx.provide('faberloomSpaces', { get: vi.fn(async () => ({ id: 'sp-1', title: 'SICOP', ownerId: options.owner ?? OWNER.id })) } as never)
  }
  if (options.shares !== false) {
    ctx.provide('faberloomShares', { can: vi.fn(async () => options.allowed === true) } as never)
  }
  const fiber = await ctx.plugin(FaberLoomSessionShares, options.console === true
    ? { consoleBase: 'https://console.test', consoleToken: 'tok' }
    : {})
  return { ctx, service: ctx.faberloomSessionShares, fiber }
}

describe('FaberLoomSessionShares capture, list, and content', () => {
  it('F11 · captures a Session, lists it, and returns its snapshot', async () => {
    const { service } = await harness({ owner: OWNER.id })
    const row = await service.capture(OWNER, { spaceId: 'sp-1', sessionId: 's1', title: 'Consulta', content: '{"events":[]}', messageCount: 3 })
    expect(row).toMatchObject({ sessionId: 's1', ownerId: OWNER.id, spaceId: 'sp-1', title: 'Consulta', messageCount: 3, origin: 'owner' })
    expect(await service.list(OWNER, 'sp-1')).toEqual([expect.objectContaining({ sessionId: 's1' })])
    expect(await service.content(OWNER, 'sp-1', OWNER.id, 's1')).toMatchObject({ content: '{"events":[]}' })
    await expect(service.content(OWNER, 'sp-1', OWNER.id, 'missing')).rejects.toThrow('no encontrada')
  })

  it('F11 · a member reads only with an active view grant', async () => {
    const denied = await harness({ owner: OWNER.id, allowed: false })
    await expect(denied.service.list(MEMBER, 'sp-1')).rejects.toThrow('no tienes acceso')
    const allowed = await harness({ owner: OWNER.id, allowed: true })
    expect(await allowed.service.list(MEMBER, 'sp-1')).toEqual([])
  })

  it('F11 · removes a row for its author or the Space owner only', async () => {
    const { service } = await harness({ owner: OWNER.id, allowed: true })
    await service.capture(MEMBER, { spaceId: 'sp-1', sessionId: 's2', title: 'Del invitado', content: 'x' })
    // The Space owner may drop a member's row.
    await expect(service.remove(OWNER, 'sp-1', MEMBER.id, 's2')).resolves.toBe(true)
    // A member may drop its own row.
    await service.capture(MEMBER, { spaceId: 'sp-1', sessionId: 's3', title: 'Otra', content: 'x' })
    await expect(service.remove(MEMBER, 'sp-1', MEMBER.id, 's3')).resolves.toBe(true)
    // A member may not drop the owner's row.
    await service.capture(OWNER, { spaceId: 'sp-1', sessionId: 's4', title: 'Del dueño', content: 'x' })
    await expect(service.remove(MEMBER, 'sp-1', OWNER.id, 's4')).rejects.toThrow('solo el autor')
  })
})

describe('FaberLoomSessionShares console transport', () => {
  it('F11 · publishes a capture and stores the console id', async () => {
    const calls: { url: string; method: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method ?? 'GET' })
      return { ok: true, status: 200, json: async () => ({ id: 'c-1' }) }
    }))
    const { service } = await harness({ console: true, owner: OWNER.id })
    await service.capture(OWNER, { spaceId: 'sp-1', sessionId: 's1', title: 'Consulta', content: 'x', messageCount: 1 })
    expect(calls).toEqual([{ url: 'https://console.test/harness/sessions/', method: 'POST' }])
    // Removing the row retracts the console mirror.
    await service.remove(OWNER, 'sp-1', OWNER.id, 's1')
    expect(calls.at(-1)).toEqual({ url: 'https://console.test/harness/sessions/c-1/', method: 'DELETE' })
  })

  it('F11 · sync imports the console rows for a member and prunes the removed ones', async () => {
    const incoming: ConsoleRow[] = [
      { id: 'c-1', space_id: 'sp-1', session_id: 's9', owner_email: OWNER.id, title: 'Del jefe', content: '{"events":[1]}', message_count: 3 },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ incoming }) })))
    const { service } = await harness({ console: true, owner: OWNER.id, allowed: true })

    await service.sync(MEMBER.id)
    const rows = await service.list(MEMBER, 'sp-1')
    expect(rows).toEqual([expect.objectContaining({ sessionId: 's9', ownerId: OWNER.id, origin: 'console' })])
    expect(await service.content(MEMBER, 'sp-1', OWNER.id, 's9')).toMatchObject({ content: '{"events":[1]}' })

    incoming.length = 0
    await service.sync(MEMBER.id)
    expect(await service.list(MEMBER, 'sp-1')).toEqual([])
  })

  it('F11 · sync is a no-op without the console, and a console failure is loud', async () => {
    const bare = await harness({ owner: OWNER.id, allowed: true })
    await expect(bare.service.sync(MEMBER.id)).resolves.toBeUndefined()

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })))
    const wired = await harness({ console: true, owner: OWNER.id, allowed: true })
    await expect(wired.service.capture(OWNER, { spaceId: 'sp-1', sessionId: 's1', title: 'T', content: 'x' })).rejects.toThrow('la consola rechazó')
  })
})

describe('FaberLoomSessionShares lifecycle and edge cases', () => {
  it('F11 · trusts the actor without spaces or shares and rejects a member without a grant', async () => {
    const noSpaces = await harness({ spaces: false })
    expect(await noSpaces.service.list(OWNER, 'sp-1')).toEqual([])
    const noShares = await harness({ shares: false, owner: 'otro@x' })
    await expect(noShares.service.list(OWNER, 'sp-1')).rejects.toThrow('no tienes acceso')
  })

  it('F11 · lists newest first and ignores other Spaces', async () => {
    const { service } = await harness({ owner: OWNER.id })
    await service.capture(OWNER, { spaceId: 'sp-1', sessionId: 'a', title: 'A', content: 'x', updatedAt: '2020-01-01T00:00:00Z' })
    await service.capture(OWNER, { spaceId: 'sp-1', sessionId: 'b', title: 'B', content: 'x', updatedAt: '2021-01-01T00:00:00Z' })
    await service.capture(OWNER, { spaceId: 'sp-2', sessionId: 'c', title: 'C', content: 'x' })
    expect((await service.list(OWNER, 'sp-1')).map(row => row.sessionId)).toEqual(['b', 'a'])
  })

  it('F11 · closes the opened domain when the fiber unloads', async () => {
    const cold = await harness()
    await cold.fiber.dispose()
    const warm = await harness()
    await warm.service.list(OWNER, 'sp-1')
    await warm.fiber.dispose()
  })

  it('F11 · tolerates a 204 console answer and defaults missing row fields', async () => {
    const answers: unknown[] = [
      { ok: true, status: 204 },
      { ok: true, status: 200, json: async () => ({ incoming: [{ id: 'c-2', space_id: 'sp-1', session_id: 's2', owner_email: OWNER.id }] }) },
      { ok: true, status: 200, json: async () => ({}) },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => answers.shift() ?? { ok: true, status: 200, json: async () => ({}) }))
    const { service } = await harness({ console: true, owner: OWNER.id, allowed: true })
    expect((await service.capture(OWNER, { spaceId: 'sp-1', sessionId: 's1', title: 'T', content: 'x' })).sessionId).toBe('s1')
    await service.sync(MEMBER.id)
    expect((await service.list(MEMBER, 'sp-1')).find(row => row.sessionId === 's2'))
      .toMatchObject({ title: 's2', workspaceId: null, messageCount: 0 })
    expect((await service.content(MEMBER, 'sp-1', OWNER.id, 's2')).content).toBe('')
    await service.sync(MEMBER.id)
    expect((await service.list(MEMBER, 'sp-1')).some(row => row.sessionId === 's2')).toBe(false)
  })

  it('F11 · remove is false for a missing row and a rejected console delete is swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') throw new Error('down')
      return { ok: true, status: 200, json: async () => ({ id: 'c-1' }) }
    }))
    const { service } = await harness({ console: true, owner: OWNER.id })
    await service.capture(OWNER, { spaceId: 'sp-1', sessionId: 's1', title: 'T', content: 'x' })
    await expect(service.remove(OWNER, 'sp-1', OWNER.id, 's1')).resolves.toBe(true)
    await expect(service.remove(OWNER, 'sp-1', OWNER.id, 'nope')).resolves.toBe(false)
  })
})
