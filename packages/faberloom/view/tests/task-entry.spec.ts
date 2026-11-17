/**
 * O5-04 · one task entry, three origins: a mail, an item/notice, or from zero.
 * The entry key is stable per source, so the same source resolves to one item
 * with one history.
 */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { FaberLoomViewService } from '../src/index.ts'

const OWNER = 'compras2@sondelsa.com'

/** A view over a board whose submit records the request and returns one item. */
function harness(readOnly = false) {
  const submit = vi.fn(async (_writer: unknown, input: Record<string, unknown>) => ({
    id: `item-${String(input['idempotencyKey'])}`,
    status: 'PREPARADO',
  }))
  const ctx = {
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: () => undefined,
    faberloomBoard: { submit },
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: OWNER, role: 'admin', readOnly })
  return { view, submit }
}

/** The request the board received on one call. */
function requestOf(submit: ReturnType<typeof vi.fn>, index = 0): Record<string, unknown> {
  return (submit.mock.calls[index] as [unknown, Record<string, unknown>])[1]
}

describe('O5-04 · task entries', () => {
  it('opens a mail task with the source as evidence and the priority mapped', async () => {
    const { view, submit } = await Promise.resolve(harness())

    const result = await view.openTaskEntry({
      kind: 'email', title: 'OC 4711', ref: 'acc:42', accountRef: 'cuenta-a',
      spaceId: 'sp-1', priority: 'high', summary: 'Pedido del cliente',
    })

    expect(result.origin).toBe('entry:email:acc:42')
    expect(submit).toHaveBeenCalledOnce()
    expect(requestOf(submit)).toMatchObject({
      runId: 'task-entry:email',
      idempotencyKey: 'entry:email:acc:42',
      title: 'OC 4711',
      summary: 'Pedido del cliente',
      evidence: ['mail:cuenta-a:acc:42'],
      artifactType: 'task',
      spaceId: 'sp-1',
      accountRef: 'cuenta-a',
      severity: 'HIGH',
    })
  })

  it('resolves the same mail to the same entry, once', async () => {
    const { view, submit } = await Promise.resolve(harness())
    const input = { kind: 'email' as const, title: 'OC 4711', ref: 'acc:42', accountRef: 'cuenta-a' }

    const first = await view.openTaskEntry(input)
    const second = await view.openTaskEntry(input)

    expect(first.id).toBe(second.id)
    expect(first.origin).toBe(second.origin)
    expect(requestOf(submit, 0)['idempotencyKey']).toBe(requestOf(submit, 1)['idempotencyKey'])
  })

  it('names an item and a notice by their own reference', async () => {
    const { view, submit } = await Promise.resolve(harness())

    await view.openTaskEntry({ kind: 'item', title: 'PF 1000', ref: 'item-1' })
    expect(requestOf(submit, 0)).toMatchObject({
      idempotencyKey: 'entry:item:item-1',
      evidence: ['board:item-1'],
    })

    await view.openTaskEntry({ kind: 'notice', title: 'Rutina en pausa', ref: 'notice-9' })
    expect(requestOf(submit, 1)).toMatchObject({
      idempotencyKey: 'entry:notice:notice-9',
      evidence: ['notice:notice-9'],
    })
  })

  it('keeps a scratch task single when the client sends its id, and new otherwise', async () => {
    const { view, submit } = await Promise.resolve(harness())

    await view.openTaskEntry({ kind: 'scratch', title: 'Revisar precios', ref: 'tab-1' })
    await view.openTaskEntry({ kind: 'scratch', title: 'Revisar precios', ref: 'tab-1' })
    expect(requestOf(submit, 0)['idempotencyKey']).toBe('entry:scratch:tab-1')
    expect(requestOf(submit, 1)['idempotencyKey']).toBe('entry:scratch:tab-1')

    await view.openTaskEntry({ kind: 'scratch', title: 'Idea suelta' })
    await view.openTaskEntry({ kind: 'scratch', title: 'Idea suelta' })
    expect(requestOf(submit, 2)['idempotencyKey']).not.toBe(requestOf(submit, 3)['idempotencyKey'])
  })

  it('refuses an entry without a source, without a title, or from a read-only identity', async () => {
    const { view } = await Promise.resolve(harness())

    await expect(view.openTaskEntry({ kind: 'email', title: 'OC' })).rejects.toThrow('needs its source reference')
    await expect(view.openTaskEntry({ kind: 'item', title: '   ', ref: 'item-1' })).rejects.toThrow('needs a title')
    const readOnly = harness(true).view
    await expect(readOnly.openTaskEntry({ kind: 'scratch', title: 'x' })).rejects.toThrow('read-only')
  })
})
