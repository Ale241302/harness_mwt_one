/** The floating mail assistant: reads one message and answers, never writes. */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { FaberLoomViewService } from '../src/index.ts'

const OWNER = 'owner@muitowork.com'

/** Boot the view with a recording model and a read-only inbox fixture. */
function harness() {
  const requests: { system: string; prompt: string }[] = []
  const llm = {
    listProviders: () => [{ id: 'deepseek' }],
    listModels: async () => [{ id: 'deepseek-chat' }],
    stream: async function* (input: { system: string; messages: { content: { text: string }[] }[] }) {
      requests.push({ system: input.system, prompt: input.messages.map(message => message.content.map(part => part.text).join('')).join('\n') })
      yield { type: 'text-delta', text: 'El monto es 1.264,18 y vence el 25.' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const inbound = {
    readEmail: vi.fn(async () => ({
      text: 'Su tarjeta tiene un saldo de 1.264,18 y vence el 2026-11-25.',
      html: null,
      attachments: [],
    })),
    markSeen: vi.fn(async () => true),
    moveToTrash: vi.fn(async () => 'Trash'),
  }
  const spaces = {
    listMemory: vi.fn(async () => [] as { text: string }[]),
    effectiveMemory: vi.fn(async () => [] as { text: string }[]),
    get: vi.fn(async () => ({ title: 'Marluvas' })),
  }
  const agents = { listAgents: vi.fn(async () => [] as { id: string; name: string; responsibility: string }[]) }
  const ctx = {
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => {
      if (name === 'llm') return llm
      if (name === 'faberloomInbound') return inbound
      if (name === 'faberloomSpaces') return spaces
      if (name === 'faberloomAgents') return agents
      return undefined
    },
    faberloomInbound: inbound,
    faberloomSpaces: spaces,
    faberloomAgents: agents,
  } as unknown as Context
  return {
    view: new FaberLoomViewService(ctx, { ownerId: OWNER, role: 'admin', readOnly: false }),
    inbound, requests, agents, spaces,
  }
}

describe('FaberLoomViewService emailChat', () => {
  it('answers from the open message and never writes to the mailbox', async () => {
    const { view, inbound, requests } = harness()
    const answer = await view.emailChat('conn-1:42', [{ role: 'user', content: '¿Cuánto debo y cuándo vence?' }], 'Estado de cuenta', 'banco@example.com')
    expect(answer).toBe('El monto es 1.264,18 y vence el 25.')
    expect(inbound.readEmail).toHaveBeenCalledWith(OWNER, 42, 'conn-1')
    expect(inbound.markSeen).not.toHaveBeenCalled()
    expect(inbound.moveToTrash).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
    expect(requests[0]?.prompt).toContain('Su tarjeta tiene un saldo de 1.264,18')
    expect(requests[0]?.prompt).toContain('¿Cuánto debo y cuándo vence?')
    expect(requests[0]?.system).toContain('You never send, move, delete or mark mail')
  })

  it('uses the chosen model, the @agent persona, and the /skill instructions', async () => {
    const { view, requests, agents } = harness()
    agents.listAgents.mockResolvedValue([{ id: 'a1', name: 'Comercial', responsibility: 'Cotizaciones y condiciones comerciales' }])
    vi.spyOn(view, 'skillMarkdown').mockResolvedValue('Reglas de cotización: incoterm, flete y precios.')
    await view.emailChat('42', [{ role: 'user', content: 'Resume' }], undefined, undefined, {
      provider: 'deepseek', model: 'deepseek-chat', agentId: 'a1', skills: ['cotizar'],
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.system).toContain('Act as the agent Comercial')
    expect(requests[0]?.system).toContain('Cotizaciones y condiciones comerciales')
    expect(requests[0]?.system).toContain('Skill /cotizar')
    expect(requests[0]?.system).toContain('Reglas de cotización')
  })

  it('refuses an agent the owner does not have', async () => {
    const { view } = harness()
    await expect(view.emailChat('42', [{ role: 'user', content: 'Hola' }], undefined, undefined, { agentId: 'inexistente' }))
      .rejects.toThrow('the chosen agent does not exist')
  })

  it('grounds a linked Space in its own memory and offers the Space inventory', async () => {
    const { view, requests, spaces } = harness()
    spaces.effectiveMemory.mockResolvedValue([{ text: 'Cliente Marluvas, SKU 4410, talla 42.' }])
    await view.emailChat('42', [{ role: 'user', content: 'Resume' }], 'OC 4711', 'compras@marluvas.com', {
      spaceId: 'sp1', spaces: ['Marluvas', 'Eguisa'],
    })
    expect(spaces.effectiveMemory).toHaveBeenCalledWith(expect.objectContaining({ id: OWNER }), 'sp1')
    expect(requests[0]?.prompt).toContain('Space del correo: Marluvas')
    expect(requests[0]?.prompt).toContain('Cliente Marluvas, SKU 4410')
    expect(requests[0]?.system).toContain('Spaces del owner: Marluvas · Eguisa')
    expect(requests[0]?.system).toContain('vinculado al Space «Marluvas»')
  })
})
