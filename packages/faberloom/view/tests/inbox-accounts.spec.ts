/**
 * O4-01 · the inbox across every account: one failing mailbox is visible and
 * never hides the other, and the panel pages by position instead of growing a
 * "show more" window.
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
  return { uid, messageId: `<${String(uid)}@x>`, from: 'a@x', subject, date: '2026-09-18T10:00:00Z', seen: false }
}

/** The page shape the receiver returns: what the mailbox holds and whether there is more. */
function pageOf(messages: readonly unknown[], options: { limit?: number; page?: number }, hasNext = false) {
  return {
    messages,
    total: messages.length,
    page: options.page ?? 1,
    pageSize: options.limit ?? 50,
    hasNext,
  }
}

describe('FaberLoomViewService inbox accounts', () => {
  it('lists both accounts and reports the one that failed', async () => {
    const connections = {
      list: vi.fn(async () => [
        { id: 'conn-a', kind: 'imap', label: 'Cuenta A', username: 'cuenta-a@x' },
        { id: 'conn-b', kind: 'imap', label: 'Cuenta B', username: 'cuenta-b@x' },
      ]),
    }
    const listPage = vi.fn(async (_owner: string, options: { limit?: number; page?: number }, id?: string) => {
      if (id === 'conn-b') throw new Error('ECONNRESET')
      return pageOf([message(1, 'Factura A')], options)
    })
    const view = harness({ listPage }, connections)

    const page = await view.emailInbox(100)

    expect(page.rows).toHaveLength(1)
    expect(page.rows[0]?.connectionId).toBe('conn-a')
    expect(page.failures).toEqual([{ account: 'cuenta-b@x', connectionId: 'conn-b', message: 'ECONNRESET' }])
    expect(listPage).toHaveBeenCalledWith('owner@muitowork.com', { limit: 100, page: 1, filter: 'all' }, 'conn-a')
    expect(listPage).toHaveBeenCalledWith('owner@muitowork.com', { limit: 100, page: 1, filter: 'all' }, 'conn-b')
  })

  it('uses the whole mailbox when no account is configured', async () => {
    const listPage = vi.fn(async (_owner: string, options: { limit?: number; page?: number }) => pageOf([message(7, 'Suelta')], options))
    const view = harness({ listPage }, { list: vi.fn(async () => []) })

    const page = await view.emailInbox()

    expect(page.failures).toEqual([])
    expect(page.rows[0]?.id).toBe('7')
    expect(listPage).toHaveBeenCalledWith('owner@muitowork.com', { limit: 50, page: 1, filter: 'all' }, undefined)
  })

  it('returns more than the newest 25 per account', async () => {
    const connections = {
      list: vi.fn(async () => [
        { id: 'conn-a', kind: 'imap', label: 'A', username: 'a@x' },
        { id: 'conn-b', kind: 'imap', label: 'B', username: 'b@x' },
      ]),
    }
    const listPage = vi.fn(async (_owner: string, options: { limit?: number; page?: number }, id?: string) => {
      const base = id === 'conn-b' ? 100 : 0
      const messages = Array.from({ length: Math.min(40, options.limit ?? 50) }, (_, index) => message(base + index + 1, `m${String(index)}`))
      return pageOf(messages, options)
    })
    const view = harness({ listPage }, connections)

    const page = await view.emailInbox()

    expect(page.rows).toHaveLength(80)
    expect(page.rows.filter(row => row.connectionId === 'conn-a')).toHaveLength(40)
    expect(page.rows.filter(row => row.connectionId === 'conn-b')).toHaveLength(40)
    expect(listPage).toHaveBeenCalledWith('owner@muitowork.com', { limit: 50, page: 1, filter: 'all' }, 'conn-a')
  })

  it('clamps the window instead of trusting the caller', async () => {
    const listPage = vi.fn(async (_owner: string, options: { limit?: number; page?: number }) => pageOf([], options))
    const view = harness({ listPage }, { list: vi.fn(async () => [{ id: 'conn-a', kind: 'imap', label: 'A', username: 'a@x' }]) })

    await view.emailInbox(0)
    expect(listPage).toHaveBeenLastCalledWith('owner@muitowork.com', { limit: 1, page: 1, filter: 'all' }, 'conn-a')
    await view.emailInbox(10_000)
    expect(listPage).toHaveBeenLastCalledWith('owner@muitowork.com', { limit: 500, page: 1, filter: 'all' }, 'conn-a')
  })

  it('reads one account page by position and tells the pager whether there is more', async () => {
    const listPage = vi.fn(async (_owner: string, options: { limit?: number; page?: number }) => pageOf([message(9, 'Viejo')], options, true))
    const view = harness({ listPage }, { list: vi.fn(async () => [{ id: 'conn-a', kind: 'imap', label: 'A', username: 'a@x' }]) })

    const page = await view.emailInbox(50, 2, 'conn-a')

    expect(page.rows.map(row => row.id)).toEqual(['conn-a:9'])
    expect(page.hasNext).toBe(true)
    expect(listPage).toHaveBeenCalledWith('owner@muitowork.com', { limit: 50, page: 2, filter: 'all' }, 'conn-a')
  })

  it('lists the folders of each account and keeps a failure in its own account', async () => {
    const listFolders = vi.fn(async (_owner: string, id?: string) => {
      if (id === 'conn-b') throw new Error('ECONNRESET')
      return [{ name: 'INBOX', specialUse: 'inbox' }, { name: 'Sent', specialUse: 'sent' }]
    })
    const view = harness({ listFolders }, {
      list: vi.fn(async () => [
        { id: 'conn-a', kind: 'imap', label: 'A', username: 'a@x' },
        { id: 'conn-b', kind: 'imap', label: 'B', username: 'b@x' },
      ]),
    })

    const groups = await view.emailFolders()

    expect(groups[0]?.folders).toHaveLength(2)
    expect(groups[1]?.error).toBe('ECONNRESET')
    expect(groups[1]?.folders).toEqual([])
  })
})
