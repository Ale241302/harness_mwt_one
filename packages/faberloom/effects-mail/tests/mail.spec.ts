import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { BoardEffectAdapter, BoardEffectDispatch, FaberLoomBoardItem } from '@deepseek-ai/dsh-faberloom-board'
import { apply, approvedMailBody, mailEffectAdapter } from '../src/index.ts'

/** The approved item one dispatch reads. */
const ITEM = {
  id: 'item-1',
  title: 'Proforma PF 2520-2026',
  approvedRevision: 2,
  revisions: [
    { version: 1, summary: 'borrador', evidence: ['oc:1'], documentRef: null },
    { version: 2, summary: 'Proforma aprobada', evidence: ['oc:505288', 'expediente:PF 2520-2026'], documentRef: 'artifact:9f2c' },
  ],
} as unknown as FaberLoomBoardItem

/** One dispatch the board hands to the adapter. */
const DISPATCH: BoardEffectDispatch = {
  effectKey: 'e'.repeat(64),
  executionId: 'exec-1',
  itemId: 'item-1',
  ownerId: 'owner@test',
  companyId: 'co-sonepart',
  actionType: 'mail.send',
  destination: 'A@Eguisa.com, b@eguisa.com',
  idempotencyKey: 'idem-1',
  attempt: 1,
}

/** A board and a connections service whose answers the test controls. */
function services(item: FaberLoomBoardItem = ITEM) {
  const get = vi.fn(async () => item)
  const sendMail = vi.fn(async () => ({ messageId: '<mail-1@eguisa>' }))
  return {
    board: { get },
    connections: { sendMail },
    get,
    sendMail,
  }
}

describe('mail effect adapter', () => {
  it('sends the approved revision to the normalised recipients through the owner connection', async () => {
    const { board, connections, get, sendMail } = services()
    const adapter = mailEffectAdapter(board, connections, 'mail.send')

    const result = await adapter.send(DISPATCH, { signal: new AbortController().signal })

    expect(result).toEqual({ status: 'CONFIRMADO', ref: '<mail-1@eguisa>', detail: 'sent to A@Eguisa.com, b@eguisa.com' })
    expect(get).toHaveBeenCalledWith({ id: 'owner@test', companyId: 'co-sonepart' }, 'item-1')
    expect(sendMail).toHaveBeenCalledWith('owner@test', {
      to: ['A@Eguisa.com', 'b@eguisa.com'],
      subject: 'Proforma PF 2520-2026',
      text: 'Proforma aprobada\n\nEvidencia:\n- oc:505288\n- expediente:PF 2520-2026\nDocumento: artifact:9f2c',
    })
    expect(adapter.idempotent).toBe(false)
  })

  it('refuses a destination without recipients, another action type, and an item without the approved revision', async () => {
    const { board, connections } = services()
    const adapter = mailEffectAdapter(board, connections, 'mail.send')
    const signal = { signal: new AbortController().signal }

    await expect(adapter.send({ ...DISPATCH, destination: ' , ' }, signal))
      .resolves.toMatchObject({ status: 'FALLIDO', detail: 'EFFECT_DESTINATION_EMPTY' })
    await expect(adapter.send({ ...DISPATCH, actionType: 'shipment.create' }, signal))
      .resolves.toMatchObject({ status: 'FALLIDO' })

    const missing = await services({ ...ITEM, approvedRevision: 9 } as FaberLoomBoardItem)
    const withoutRevision = mailEffectAdapter(missing.board, missing.connections, 'mail.send')
    await expect(withoutRevision.send(DISPATCH, signal))
      .resolves.toMatchObject({ status: 'FALLIDO' })
  })

  it('lets a provider failure reach the board as a throw, never as sent', async () => {
    const { board, connections, sendMail } = services()
    sendMail.mockRejectedValueOnce(new Error('smtp down'))
    const adapter = mailEffectAdapter(board, connections, 'mail.send')
    await expect(adapter.send(DISPATCH, { signal: new AbortController().signal })).rejects.toThrow('smtp down')
  })

  it('builds a body from evidence the revision may not have', () => {
    expect(approvedMailBody({
      ...ITEM,
      approvedRevision: 1,
    } as FaberLoomBoardItem)).toEqual({ subject: 'Proforma PF 2520-2026', text: 'borrador\n\nEvidencia:\n- oc:1' })
    const bare = {
      ...ITEM,
      approvedRevision: 3,
      revisions: [{ version: 3, summary: 'sin evidencia', evidence: [], documentRef: null }],
    } as unknown as FaberLoomBoardItem
    expect(approvedMailBody(bare)).toEqual({ subject: 'Proforma PF 2520-2026', text: 'sin evidencia' })
  })

  it('reads the item without a company scope when the tenant is single', async () => {
    const { board, connections, get } = services()
    const adapter = mailEffectAdapter(board, connections, 'mail.send')
    await adapter.send({ ...DISPATCH, companyId: null }, { signal: new AbortController().signal })
    expect(get).toHaveBeenCalledWith({ id: 'owner@test' }, 'item-1')
  })

  it('registers nothing when the deployment did not accept the action type', () => {
    const ctx = new Context()
    const provide = (name: string, value: unknown): void => {
      ;(ctx.provide as (n: string, v: unknown) => void)(name, value)
    }
    const register = vi.fn()
    provide('faberloomBoard', { effectPolicy: () => ({ actionTypes: [] }), registerEffectAdapter: register })
    provide('faberloomConnections', { sendMail: vi.fn() })
    apply(ctx, {})
    expect(register).not.toHaveBeenCalled()
  })
  it('registers the adapter on the board and removes it with the fiber', async () => {
    const registered: BoardEffectAdapter[] = []
    const ctx = new Context()
    const provide = (name: string, value: unknown): void => {
      ;(ctx.provide as (n: string, v: unknown) => void)(name, value)
    }
    provide('faberloomBoard', {
      get: vi.fn(async () => ITEM),
      effectPolicy: () => ({ actionTypes: ['mail.send'] }),
      registerEffectAdapter: (_type: string, adapter: BoardEffectAdapter) => {
        registered.push(adapter)
        return () => { registered.splice(registered.indexOf(adapter), 1) }
      },
    })
    provide('faberloomConnections', { sendMail: vi.fn(async () => ({ messageId: '<mail-1>' })) })
    apply(ctx, {})
    expect(registered).toHaveLength(1)
    await ctx.fiber.dispose()
    expect(registered).toHaveLength(0)
  })
})
