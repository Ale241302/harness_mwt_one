/** The view's mailbox write gestures: mark read, and move to Trash with a learned pattern. */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { FaberLoomViewService } from '../src/index.ts'

/** The minimal service graph the mailbox and connection remotes touch. */
function harness(
  inbound: unknown,
  memory: unknown,
  extra: { connections?: unknown; routines?: unknown; spaces?: unknown; tools?: unknown } = {},
): FaberLoomViewService {
  const ctx = {
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => {
      if (name === 'faberloomInbound') return inbound
      if (name === 'faberloomMemory') return memory
      if (name === 'faberloomConnections') return extra.connections
      if (name === 'tools') return extra.tools
      return undefined
    },
    faberloomInbound: inbound,
    faberloomMemory: memory,
    faberloomConnections: extra.connections,
    faberloomRoutines: extra.routines,
    faberloomSpaces: extra.spaces,
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

  it('provisions and activates the live mail routine once IMAP and SMTP exist', async () => {
    const connections = {
      list: vi.fn(async () => [{ kind: 'imap' }, { kind: 'smtp' }]),
      save: vi.fn(async () => ({})),
    }
    const routines = {
      listRoutines: vi.fn(async () => []),
      createRoutine: vi.fn(async () => ({ id: 'r1', name: 'Vigía de correo', status: 'draft' })),
      activateRoutine: vi.fn(async () => ({})),
    }
    const view = harness(undefined, undefined, { connections, routines })

    await view.saveConnection({} as never)

    expect(connections.save).toHaveBeenCalledOnce()
    expect(routines.createRoutine).toHaveBeenCalledOnce()
    expect(routines.activateRoutine).toHaveBeenCalledWith('owner@muitowork.com', 'r1')
  })

  it('does not provision the live mail routine while a mail half is missing', async () => {
    const connections = { list: vi.fn(async () => [{ kind: 'imap' }]), save: vi.fn(async () => ({})) }
    const routines = { listRoutines: vi.fn(async () => []), createRoutine: vi.fn(), activateRoutine: vi.fn() }
    const view = harness(undefined, undefined, { connections, routines })

    await view.saveConnection({} as never)

    expect(routines.createRoutine).not.toHaveBeenCalled()
    expect(routines.activateRoutine).not.toHaveBeenCalled()
  })

  it('activates an existing paused live mail routine instead of duplicating it', async () => {
    const connections = { list: vi.fn(async () => [{ kind: 'imap' }, { kind: 'smtp' }]), save: vi.fn(async () => ({})) }
    const routines = {
      listRoutines: vi.fn(async () => [{ id: 'r9', name: 'Vigía de correo', status: 'paused' }]),
      createRoutine: vi.fn(),
      activateRoutine: vi.fn(async () => ({})),
    }
    const view = harness(undefined, undefined, { connections, routines })

    await view.saveConnection({} as never)

    expect(routines.createRoutine).not.toHaveBeenCalled()
    expect(routines.activateRoutine).toHaveBeenCalledWith('owner@muitowork.com', 'r9')
  })

  it('provisions the MWT.ONE guard while the mwt MCP tools are mounted', async () => {
    const connections = { list: vi.fn(async () => []), save: vi.fn(async () => ({})) }
    const routines = {
      listRoutines: vi.fn(async () => []),
      createRoutine: vi.fn(async (_owner: string, input: { name: string }) => ({ id: 'g1', name: input.name, status: 'draft' })),
      activateRoutine: vi.fn(async () => ({})),
    }
    const tools = { schemas: () => [{ name: 'mcp__mwt__expediente_listar' }] }
    const view = harness(undefined, undefined, { connections, routines, tools })

    await view.saveConnection({} as never)

    expect(routines.createRoutine).toHaveBeenCalledWith('owner@muitowork.com', expect.objectContaining({ name: 'Vigía MWT.ONE' }))
    expect(routines.activateRoutine).toHaveBeenCalledWith('owner@muitowork.com', 'g1')
  })

  it('deletes one space-memory entry and returns the refreshed list', async () => {
    const spaces = {
      forgetMemory: vi.fn(async () => true),
      listMemory: vi.fn(async () => [{ id: 'm2', text: 'otra', spaceIds: [], createdAt: '2026-01-01T00:00:00Z' }]),
    }
    const view = harness(undefined, undefined, { spaces })

    await expect(view.deleteSpaceMemory('m1')).resolves.toEqual([
      { id: 'm2', text: 'otra', spaceIds: [], createdAt: '2026-01-01T00:00:00Z' },
    ])
    expect(spaces.forgetMemory).toHaveBeenCalledWith(expect.objectContaining({ id: 'owner@muitowork.com' }), 'm1')
  })
})
