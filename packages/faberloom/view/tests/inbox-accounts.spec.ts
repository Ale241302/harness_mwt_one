/**
 * O4-01 · the inbox across every account: one failing mailbox is visible and
 * never hides the other, and the window is the owner's backlog, not a fixed 25.
 */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { FaberLoomViewService } from '../src/index.ts'

/** The minimal service graph the inbox remote touches. */
function harness(inbound: unknown, connections: unknown): FaberLoomViewService {
  const ctx = {
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => {
      if (name === 'faberloomInbound') return inbound
      if (name === 'faberloomConnections') return connections
      return undefined
    },
    faberloomInbound: inbound,
    faberloomConnections: connections,
  } as unknown as Context
  return new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
}

/** One envelope the stubbed receiver returns. */
function message(uid: number, subject: string) {
  return { uid, messageId: `<${String(uid)}@x>`, from: 'a@x', subject, date: '2026-09-18T10:00:00Z' }
}

describe('FaberLoomViewService inbox accounts', () => {
  it('lists both accounts and reports the one that failed', async () => {
    const connections = {
      list: vi.fn(async () => [
        { id: 'conn-a', kind: 'imap', label: 'Cuenta A', username: 'cuenta-a@x' },
        { id: 'conn-b', kind: 'imap', label: 'Cuenta B', username: 'cuenta-b@x' },
      ]),
    }
    const listInbox = vi.fn(async (_owner: string, _limit: number, id?: string) => {
      if (id === 'conn-b') throw new Error('ECONNRESET')
      return [message(1, 'Factura A')]
    })
    const view = harness({ listInbox }, connections)

    const page = await view.emailInbox(100)

    expect(page.rows).toHaveLength(1)
    expect(page.rows[0]?.connectionId).toBe('conn-a')
    expect(page.failures).toEqual([{ account: 'cuenta-b@x', connectionId: 'conn-b', message: 'ECONNRESET' }])
    expect(listInbox).toHaveBeenCalledWith('owner@muitowork.com', 100, 'conn-a')
    expect(listInbox).toHaveBeenCalledWith('owner@muitowork.com', 100, 'conn-b')
  })

  it('uses the whole mailbox when no account is configured', async () => {
    const listInbox = vi.fn(async () => [message(7, 'Suelta')])
    const view = harness({ listInbox }, { list: vi.fn(async () => []) })

    const page = await view.emailInbox()

    expect(page.failures).toEqual([])
    expect(page.rows[0]?.id).toBe('7')
    expect(listInbox).toHaveBeenCalledWith('owner@muitowork.com', 50, undefined)
  })

  it('returns more than the newest 25 per account', async () => {
    const connections = {
      list: vi.fn(async () => [
        { id: 'conn-a', kind: 'imap', label: 'A', username: 'a@x' },
        { id: 'conn-b', kind: 'imap', label: 'B', username: 'b@x' },
      ]),
    }
    const listInbox = vi.fn(async (_owner: string, limit: number, id?: string) => {
      const base = id === 'conn-b' ? 100 : 0
      return Array.from({ length: Math.min(40, limit) }, (_, index) => message(base + index + 1, `m${String(index)}`))
    })
    const view = harness({ listInbox }, connections)

    const page = await view.emailInbox()

    expect(page.rows).toHaveLength(80)
    expect(page.rows.filter(row => row.connectionId === 'conn-a')).toHaveLength(40)
    expect(page.rows.filter(row => row.connectionId === 'conn-b')).toHaveLength(40)
    expect(listInbox).toHaveBeenCalledWith('owner@muitowork.com', 50, 'conn-a')
  })

  it('clamps the window instead of trusting the caller', async () => {
    const listInbox = vi.fn(async () => [])
    const view = harness({ listInbox }, { list: vi.fn(async () => [{ id: 'conn-a', kind: 'imap', label: 'A', username: 'a@x' }]) })

    await view.emailInbox(0)
    expect(listInbox).toHaveBeenLastCalledWith('owner@muitowork.com', 1, 'conn-a')
    await view.emailInbox(10_000)
    expect(listInbox).toHaveBeenLastCalledWith('owner@muitowork.com', 500, 'conn-a')
  })
})
