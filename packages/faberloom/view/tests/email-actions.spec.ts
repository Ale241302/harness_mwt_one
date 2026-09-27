/** The view's mailbox write gestures: mark read, and move to Trash with a learned pattern. */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { FaberLoomViewService } from '../src/index.ts'

/** The minimal service graph the mailbox remotes touch. */
function harness(inbound: unknown, memory: unknown): FaberLoomViewService {
  const ctx = {
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => (name === 'faberloomInbound' ? inbound : name === 'faberloomMemory' ? memory : undefined),
    faberloomInbound: inbound,
    faberloomMemory: memory,
  } as unknown as Context
  return new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
}

describe('FaberLoomViewService mailbox writes', () => {
  it('marks one message read and moves one to Trash, recording the discard pattern', async () => {
    const inbound = { markSeen: vi.fn(async () => true), moveToTrash: vi.fn(async () => 'Trash') }
    const memory = { createTeaching: vi.fn(async () => ({})) }
    const view = harness(inbound, memory)

    await expect(view.emailMarkSeen('42')).resolves.toBe(true)
    expect(inbound.markSeen).toHaveBeenCalledWith('owner@muitowork.com', 42)

    await expect(view.emailTrash('42', 'spam@x.com', 'Oferta')).resolves.toEqual({ movedTo: 'Trash' })
    expect(inbound.moveToTrash).toHaveBeenCalledWith('owner@muitowork.com', 42)
    expect(memory.createTeaching).toHaveBeenCalledWith(
      'owner@muitowork.com',
      expect.objectContaining({ task: 'email-trash', source: 'email-trash' }),
    )
  })

  it('rejects an invalid id and survives a capture failure', async () => {
    const inbound = { markSeen: vi.fn(async () => true), moveToTrash: vi.fn(async () => 'Trash') }
    const memory = { createTeaching: vi.fn(async () => { throw new Error('nope') }) }
    const view = harness(inbound, memory)

    await expect(view.emailMarkSeen('not-a-uid')).resolves.toBe(false)
    await expect(view.emailTrash('0')).rejects.toThrow('invalid message id')
    await expect(view.emailTrash('7')).resolves.toEqual({ movedTo: 'Trash' })
    expect(inbound.markSeen).not.toHaveBeenCalled()
  })

  it('fails loud when the receiver is not mounted', async () => {
    const view = harness(undefined, undefined)
    await expect(view.emailTrash('42')).rejects.toThrow('not mounted')
  })
})
