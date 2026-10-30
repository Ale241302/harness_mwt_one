import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import FaberLoomSessionAgent from '../src/index.ts'
import { appendInstructionExchange, instructionReply } from '../src/instruction.ts'

/** One event the fake session recorded. */
interface Appended {
  readonly type: string
  readonly data: unknown
}

/** A pre-step handler the plugin installed on the fake agent. */
type PreStep = (
  payload: { messages: readonly unknown[]; turn: number; step: number },
  next: () => Promise<unknown>,
) => Promise<unknown>

/** Mount the plugin over a fake agent and capture its pre-step handler. */
async function harness(board?: Record<string, unknown>) {
  const appended: Appended[] = []
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const agent = {
    session: {
      id: 'session-1',
      header: { cwd: undefined, parentSession: undefined },
      append: (type: string, data: unknown) => { appended.push({ type, data }); return { type, data } },
    },
    ctx: {
      on: vi.fn((event: string, handler: (...args: never[]) => unknown) => {
        handlers.set(event, handler)
        return vi.fn()
      }),
      inject: vi.fn(() => ({ dispose: vi.fn(async () => {}) })),
    },
  }
  const ctx = new Context()
  const provide = (name: string, value: unknown): void => {
    ;(ctx.provide as (n: string, v: unknown) => void)(name, value)
  }
  provide('sessionProjections', { register: () => () => {} })
  provide('agents', { list: () => [agent] })
  if (board !== undefined) provide('faberloomBoard', board)
  await ctx.plugin(FaberLoomSessionAgent as never, { ownerId: 'owner@test' } as never)
  return { ctx, agent, appended, preStep: handlers.get('agent/pre-step') as PreStep, handlers }
}

/** One real user message with the text the instruction carries. */
function message(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } as never })
}

describe('iteration-chat field instruction (§9.7)', () => {
  it('applies the instruction and answers without a model call', async () => {
    const applyIterationInstruction = vi.fn(async () => ({
      applied: true,
      changes: [{ field: 'summary', value: 'Listo' }],
    }))
    const { appended, preStep } = await harness({ applyIterationInstruction })
    const next = vi.fn(async () => ({ kind: 'enter', messages: [] }))

    const decision = await preStep({ messages: [message('@summary = Listo')], turn: 1, step: 1 }, next)

    expect(applyIterationInstruction).toHaveBeenCalledWith('session-1', '@summary = Listo')
    expect(decision).toEqual({ kind: 'enter', messages: [] })
    expect(next).not.toHaveBeenCalled()
    expect(appended.map(entry => entry.type)).toEqual([
      'step/start', 'user/message', 'assistant/message', 'step/end',
    ])
    const reply = appended[2]?.data as { message: { content: { text: string }[] } }
    expect(reply.message.content[0]?.text).toContain('router determinista')
  })

  it('delegates every sentence the board does not route', async () => {
    const applyIterationInstruction = vi.fn(async () => undefined)
    const { appended, preStep } = await harness({ applyIterationInstruction })
    const next = vi.fn(async () => ({ kind: 'enter', messages: [] }))

    await preStep({ messages: [message('hacé lo que puedas')], turn: 1, step: 1 }, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(appended).toHaveLength(0)

    // Later steps of a turn are never intercepted.
    await preStep({ messages: [message('@summary = Listo')], turn: 1, step: 2 }, next)
    expect(next).toHaveBeenCalledTimes(2)

    // A turn with no user text, and a deployment without the board, delegate too.
    await preStep({ messages: [], turn: 1, step: 1 }, next)
    expect(next).toHaveBeenCalledTimes(3)
    const bare = await harness()
    await bare.preStep({ messages: [message('@summary = Listo')], turn: 1, step: 1 }, next)
    expect(next).toHaveBeenCalledTimes(4)
  })

  it('turns a failed deterministic write into a delegated turn', async () => {
    const board = { applyIterationInstruction: vi.fn(async () => { throw new Error('storage down') }) }
    const { preStep } = await harness(board)
    const next = vi.fn(async () => ({ kind: 'enter', messages: [] }))
    await preStep({ messages: [message('@summary = Listo')], turn: 1, step: 1 }, next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('installs one instruction listener per agent even when the agent is announced twice', async () => {
    const { ctx, agent, handlers } = await harness()
    const before = (agent.ctx.on as unknown as { mock: { calls: [string, unknown][] } }).mock.calls
      .filter(([event]) => event === 'agent/pre-step').length
    ctx.emit('agent/created', { agent: agent as never, source: 'startup' })
    const after = (agent.ctx.on as unknown as { mock: { calls: [string, unknown][] } }).mock.calls
      .filter(([event]) => event === 'agent/pre-step').length
    expect(after).toBe(before)
    expect(handlers.get('agent/pre-step')).toBeDefined()
  })
  it('answers a dead attempt without claiming it wrote', () => {
    expect(instructionReply({ applied: false, changes: [{ field: 'total', value: 2 }] }))
      .toContain('el intento ya no está vivo')
    expect(instructionReply({ applied: true, changes: [{ field: 'total', value: 2 }] }))
      .toContain('total = 2')
  })

  it('writes the exchange with the claimed messages in order', () => {
    const appended: Appended[] = []
    const session = {
      append: (type: string, data: unknown) => { appended.push({ type, data }); return { type, data } },
    }
    appendInstructionExchange(session as never, [message('uno'), message('dos')], 3, 1, 'listo')
    expect(appended.map(entry => entry.type)).toEqual([
      'step/start', 'user/message', 'user/message', 'assistant/message', 'step/end',
    ])
    expect((appended[0]?.data as { turn: number }).turn).toBe(3)
  })
})
