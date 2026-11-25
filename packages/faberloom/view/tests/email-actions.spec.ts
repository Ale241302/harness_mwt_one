/** The view's mailbox write gestures: mark read, and move to Trash with a learned pattern. */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { FaberLoomViewService } from '../src/index.ts'

/** The minimal service graph the mailbox and connection remotes touch. */
function harness(
  inbound: unknown,
  memory: unknown,
  extra: { agents?: unknown; connections?: unknown; routines?: unknown; spaces?: unknown; tools?: unknown } = {},
  role = 'admin',
): FaberLoomViewService {
  const ctx = {
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => {
      if (name === 'faberloomInbound') return inbound
      if (name === 'faberloomMemory') return memory
      if (name === 'faberloomAgents') return extra.agents
      if (name === 'faberloomConnections') return extra.connections
      if (name === 'tools') return extra.tools
      return undefined
    },
    faberloomInbound: inbound,
    faberloomMemory: memory,
    faberloomAgents: extra.agents,
    faberloomConnections: extra.connections,
    faberloomRoutines: extra.routines,
    faberloomSpaces: extra.spaces,
  } as unknown as Context
  return new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role, readOnly: false })
}

describe('FaberLoomViewService mailbox writes', () => {
  it('marks one message read, or unread, in the folder the panel names', async () => {
    const inbound = {
      markSeenFromOwner: vi.fn(async () => true),
      trashFromOwner: vi.fn(async () => 'Trash'),
      moveFromOwner: vi.fn(async () => 'Archive'),
      restoreFromOwner: vi.fn(async () => 'INBOX'),
    }
    const memory = { createTeaching: vi.fn(async () => ({})) }
    const view = harness(inbound, memory)

    await expect(view.emailMarkSeen('42')).resolves.toBe(true)
    expect(inbound.markSeenFromOwner).toHaveBeenCalledWith('owner@muitowork.com', 42, {}, true)
    await view.emailMarkSeen('42', false, 'Sent')
    expect(inbound.markSeenFromOwner).toHaveBeenLastCalledWith('owner@muitowork.com', 42, { mailbox: 'Sent' }, false)

    await expect(view.emailTrash('42', 'spam@x.com', 'Oferta')).resolves.toEqual({ movedTo: 'Trash' })
    expect(inbound.trashFromOwner).toHaveBeenCalledWith('owner@muitowork.com', 42, {})
    expect(memory.createTeaching).toHaveBeenCalledWith(
      'owner@muitowork.com',
      expect.objectContaining({ task: 'email-trash', source: 'email-trash' }),
    )
  })

  it('moves one message to a named folder and restores it from Trash', async () => {
    const inbound = {
      markSeenFromOwner: vi.fn(async () => true),
      trashFromOwner: vi.fn(async () => 'Trash'),
      moveFromOwner: vi.fn(async () => 'Archive'),
      restoreFromOwner: vi.fn(async () => 'INBOX'),
    }
    const view = harness(inbound, { createTeaching: vi.fn(async () => ({})) })

    await expect(view.emailMove('7:42', 'Archive', 'INBOX')).resolves.toEqual({ movedTo: 'Archive' })
    expect(inbound.moveFromOwner).toHaveBeenCalledWith('owner@muitowork.com', 42, 'Archive', { connectionId: '7', mailbox: 'INBOX' })
    await expect(view.emailRestore('7:42', 'Trash')).resolves.toEqual({ movedTo: 'INBOX' })
    expect(inbound.restoreFromOwner).toHaveBeenCalledWith('owner@muitowork.com', 42, { connectionId: '7', mailbox: 'Trash' })
  })

  it('rejects an invalid id and survives a capture failure', async () => {
    const inbound = {
      markSeenFromOwner: vi.fn(async () => true),
      trashFromOwner: vi.fn(async () => 'Trash'),
    }
    const recordCaptureFailure = vi.fn(async () => ({}))
    const memory = { createTeaching: vi.fn(async () => { throw new Error('nope') }), recordCaptureFailure }
    const view = harness(inbound, memory)

    await expect(view.emailMarkSeen('not-a-uid')).rejects.toThrow('invalid message id')
    await expect(view.emailTrash('0')).rejects.toThrow('invalid message id')
    await expect(view.emailTrash('7')).resolves.toEqual({ movedTo: 'Trash' })
    expect(inbound.markSeenFromOwner).not.toHaveBeenCalled()
    // The move succeeded; the failed capture is visible instead of only logged.
    expect(recordCaptureFailure).toHaveBeenCalledWith('owner@muitowork.com', expect.objectContaining({ task: 'email-trash', detail: 'nope' }))
  })

  it('fails loud when the receiver is not mounted', async () => {
    const view = harness(undefined, undefined)
    await expect(view.emailTrash('42')).rejects.toThrow('not mounted')
  })

  it('lists only drafts, never a draft that was already sent', async () => {
    const base = {
      cc: [], bcc: [], account: null, attachments: [], inReplyTo: null, references: [],
      aiText: null, spaceId: null, createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z',
    }
    const connections = {
      listDrafts: vi.fn(async () => [
        { ...base, id: 'd1', status: 'draft', to: ['a@b'], subject: 'Pendiente', text: 'x' },
        { ...base, id: 'd2', status: 'sent', to: ['a@b'], subject: 'Enviado', text: 'y' },
      ]),
    }
    const view = harness({ markSeenFromOwner: vi.fn(), trashFromOwner: vi.fn() }, undefined, { connections })

    const rows = await view.emailDrafts()
    expect(rows.map(row => row.id)).toEqual(['d1'])
  })

  it('delegates signature reads and writes to the connections service', async () => {
    const row = { account: '506@muitowork.com', text: 'Álvaro', html: '<p>Álvaro</p>', auto: true, updatedAt: '2026-11-20T00:00:00Z' }
    const connections = {
      listSignatures: vi.fn(async () => [row]),
      saveSignature: vi.fn(async () => row),
      deleteSignature: vi.fn(async () => true),
    }
    const view = harness({ markSeenFromOwner: vi.fn(), trashFromOwner: vi.fn() }, undefined, { connections })

    await expect(view.emailSignatures()).resolves.toEqual([row])
    await expect(view.saveEmailSignature('506@muitowork.com', 'Álvaro', true, '<p>Álvaro</p>')).resolves.toEqual(row)
    expect(connections.saveSignature).toHaveBeenCalledWith('owner@muitowork.com', {
      account: '506@muitowork.com',
      text: 'Álvaro',
      auto: true,
      html: '<p>Álvaro</p>',
    })
    await expect(view.deleteEmailSignature('506@muitowork.com')).resolves.toBe(true)
    expect(connections.deleteSignature).toHaveBeenCalledWith('owner@muitowork.com', '506@muitowork.com')
  })

  it('provisions and activates the live mail routine once IMAP and SMTP exist', async () => {
    const connections = {
      list: vi.fn(async () => [{ kind: 'imap' }, { kind: 'smtp' }]),
      save: vi.fn(async () => ({})),
    }
    const routines = {
      listRoutines: vi.fn(async () => []),
      createRoutine: vi.fn(async () => ({ id: 'r1', name: 'Vigía de correo', status: 'draft' })),
      updateRoutine: vi.fn(async () => ({})),
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
    const routines = {
      listRoutines: vi.fn(async () => []),
      createRoutine: vi.fn(),
      updateRoutine: vi.fn(async () => ({})),
      activateRoutine: vi.fn(),
    }
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
      updateRoutine: vi.fn(async () => ({})),
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
      updateRoutine: vi.fn(async () => ({})),
      activateRoutine: vi.fn(async () => ({})),
    }
    const tools = { schemas: () => [{ name: 'mcp__mwt__expediente_listar' }] }
    const view = harness(undefined, undefined, { connections, routines, tools })

    await view.saveConnection({} as never)

    expect(routines.createRoutine).toHaveBeenCalledWith('owner@muitowork.com', expect.objectContaining({ name: 'Vigía MWT.ONE' }))
    expect(routines.activateRoutine).toHaveBeenCalledWith('owner@muitowork.com', 'g1')
  })

  it('uses the Marluvas operator for a privileged owner of the operations mailboxes', async () => {
    const connections = {
      list: vi.fn(async () => [
        { kind: 'imap', username: '506@muitowork.com' },
        { kind: 'smtp', username: '506@muitowork.com' },
      ]),
      save: vi.fn(async () => ({})),
    }
    const agents = { listAgents: vi.fn(async () => [{ id: 'a1', name: 'Operador Marluvas' }]) }
    const routines = {
      listRoutines: vi.fn(async () => []),
      createRoutine: vi.fn(async (_owner: string, input: { name: string }) => ({ id: 'r1', name: input.name, status: 'draft' })),
      updateRoutine: vi.fn(async () => ({})),
      activateRoutine: vi.fn(async () => ({})),
    }
    const view = harness(undefined, undefined, { agents, connections, routines })

    await view.saveConnection({} as never)

    const inputs = routines.createRoutine.mock.calls.map(call => call[1]) as Array<{
      name: string
      definition: { intent: string; steps: readonly { config?: Readonly<Record<string, unknown>> }[] }
    }>
    const reply = inputs.find(input => input.name === 'Vigía de correo')
    const operator = inputs.find(input => input.name === 'Operadora Marluvas')
    expect(reply?.definition.intent).toContain('borrador')
    expect(reply?.definition.steps.every(step => step.config?.['agentName'] === undefined)).toBe(true)
    expect(operator?.definition.intent).toContain('Marluvas')
    expect(operator?.definition.steps.every(step => step.config?.['agentName'] === 'Operador Marluvas')).toBe(true)
    expect(routines.activateRoutine).toHaveBeenCalledWith('owner@muitowork.com', 'r1')
  })

  it('keeps the generic live mail routine for a mailbox outside the operations allowlist', async () => {
    const connections = {
      list: vi.fn(async () => [
        { kind: 'imap', username: 'otro@muitowork.com' },
        { kind: 'smtp', username: 'otro@muitowork.com' },
      ]),
      save: vi.fn(async () => ({})),
    }
    const agents = { listAgents: vi.fn(async () => [{ id: 'a1', name: 'Operador Marluvas' }]) }
    const routines = {
      listRoutines: vi.fn(async () => []),
      createRoutine: vi.fn(async (_owner: string, input: { name: string }) => ({ id: 'r1', name: input.name, status: 'draft' })),
      updateRoutine: vi.fn(async () => ({})),
      activateRoutine: vi.fn(async () => ({})),
    }
    const view = harness(undefined, undefined, { agents, connections, routines })

    await view.saveConnection({} as never)

    const input = routines.createRoutine.mock.calls[0]?.[1] as {
      definition: { intent: string; steps: readonly { config?: Readonly<Record<string, unknown>> }[] }
    } | undefined
    expect(input?.definition.intent).toContain('borrador')
    expect(input?.definition.steps.every(step => step.config?.['agentName'] === undefined)).toBe(true)
  })

  it('keeps the generic live mail routine for a non-privileged role even on an operations mailbox', async () => {
    const connections = {
      list: vi.fn(async () => [
        { kind: 'imap', username: 'alvaro@muitowork.com' },
        { kind: 'smtp', username: 'alvaro@muitowork.com' },
      ]),
      save: vi.fn(async () => ({})),
    }
    const agents = { listAgents: vi.fn(async () => [{ id: 'a1', name: 'Operador Marluvas' }]) }
    const routines = {
      listRoutines: vi.fn(async () => []),
      createRoutine: vi.fn(async (_owner: string, input: { name: string }) => ({ id: 'r1', name: input.name, status: 'draft' })),
      updateRoutine: vi.fn(async () => ({})),
      activateRoutine: vi.fn(async () => ({})),
    }
    const view = harness(undefined, undefined, { agents, connections, routines }, 'manager')

    await view.saveConnection({} as never)

    const input = routines.createRoutine.mock.calls[0]?.[1] as {
      definition: { intent: string; steps: readonly { config?: Readonly<Record<string, unknown>> }[] }
    } | undefined
    expect(input?.definition.intent).toContain('borrador')
    expect(input?.definition.steps.every(step => step.config?.['agentName'] === undefined)).toBe(true)
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
