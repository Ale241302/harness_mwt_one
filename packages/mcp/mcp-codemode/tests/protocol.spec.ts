import { describe, expect, it } from 'vitest'
import { ProgramProtocol } from '../src/protocol.ts'
import type { ProtocolEffect, ProtocolSettlement } from '../src/protocol.ts'

function machine(overrides: { maxOutputBytes?: number; maxPendingCalls?: number } = {}): ProgramProtocol {
  return new ProgramProtocol({
    bindings: new Map<string, (args: unknown) => Promise<unknown>>([
      ['mcp__fx__add', async args => args],
      ['mcp__fx__slow', () => new Promise(() => undefined)],
    ]),
    maxOutputBytes: 1024,
    maxPendingCalls: 2,
    ...overrides,
  })
}

function settlementOf(effects: readonly ProtocolEffect[]): ProtocolSettlement {
  const settle = effects.find(effect => effect.type === 'settle')
  if (settle?.type !== 'settle') throw new Error('expected a settlement effect')
  return settle.settlement
}

function framesOf(effects: readonly ProtocolEffect[]): unknown[] {
  return effects.filter(effect => effect.type === 'reply').map(effect => effect.frame)
}

function isSettled(effects: readonly ProtocolEffect[]): boolean {
  return effects.some(effect => effect.type === 'settle')
}

describe('program protocol: frames', () => {
  it('captures log levels and rejects malformed log frames', () => {
    const protocol = machine()
    expect(protocol.receive({ type: 'log', level: 'log', text: 'one' })).toEqual([])
    expect(protocol.receive({ type: 'log', level: 'error', text: 'two' })).toEqual([])
    expect(protocol.logs).toEqual([{ level: 'log', text: 'one' }, { level: 'error', text: 'two' }])
    expect(settlementOf(protocol.receive({ type: 'log', level: 'warn', text: 'x' })))
      .toMatchObject({ ok: false, kind: 'protocol', message: 'invalid log frame' })
  })

  it('rejects a log without text and a frame that is not an object', () => {
    expect(settlementOf(machine().receive({ type: 'log', level: 'log' })))
      .toMatchObject({ kind: 'protocol', message: 'invalid log frame' })
    expect(settlementOf(machine().receive(null)))
      .toMatchObject({ kind: 'protocol', message: 'invalid control frame' })
    expect(settlementOf(machine().receive({ type: 'nope' })))
      .toMatchObject({ kind: 'protocol', message: 'unknown control frame' })
  })

  it('bounds logs by UTF-8 bytes', () => {
    const protocol = machine({ maxOutputBytes: 5 })
    expect(settlementOf(protocol.receive({ type: 'log', level: 'log', text: 'ñññ' })))
      .toMatchObject({ ok: false, kind: 'output-limit', message: 'program output exceeded 5 bytes' })
    expect(protocol.logs).toEqual([])
  })

  it('dispatches a declared binding and answers it exactly once', () => {
    const protocol = machine()
    const effects = protocol.receive({ type: 'call', id: 1, name: 'mcp__fx__add', args: { a: 1 } })
    expect(effects).toHaveLength(1)
    const dispatch = effects[0]
    if (dispatch?.type !== 'dispatch') throw new Error('expected a dispatch effect')
    expect(dispatch).toMatchObject({ id: 1, name: 'mcp__fx__add', args: { a: 1 } })
    expect(protocol.completed(1, { content: [] }))
      .toEqual([{ type: 'reply', frame: { type: 'reply', id: 1, ok: true, value: { content: [] } } }])
    expect(protocol.completed(1, { content: [] })).toEqual([])
  })

  it('treats missing call arguments as an empty object', () => {
    const dispatch = machine().receive({ type: 'call', id: 1, name: 'mcp__fx__add' })[0]
    expect(dispatch).toMatchObject({ type: 'dispatch', args: {} })
  })

  it('refuses arguments that are not lossless JSON', () => {
    const lossy = machine().receive({ type: 'call', id: 1, name: 'mcp__fx__add', args: { when: new Date(0) } })
    expect(framesOf(lossy)).toEqual([{
      type: 'reply',
      id: 1,
      ok: false,
      message: 'arguments must be lossless JSON (pass an object, for example {})',
    }])
    const throwing = { get boom(): string { throw new Error('getter failed') } }
    expect(framesOf(machine().receive({ type: 'call', id: 1, name: 'mcp__fx__add', args: throwing })))
      .toEqual([{ type: 'reply', id: 1, ok: false, message: 'arguments must be lossless JSON: getter failed' }])
  })

  it('refuses invalid and non-sequential call identities', () => {
    expect(settlementOf(machine().receive({ type: 'call', id: '1', name: 'mcp__fx__add' })))
      .toMatchObject({ kind: 'protocol', message: 'invalid binding call identity' })
    expect(settlementOf(machine().receive({ type: 'call', id: 1, name: 4 })))
      .toMatchObject({ kind: 'protocol', message: 'invalid binding call identity' })
    expect(settlementOf(machine().receive({ type: 'call', id: 2, name: 'mcp__fx__add' })))
      .toMatchObject({ kind: 'protocol', message: 'binding call ids must be sequential' })
  })

  it('answers unknown bindings with the catalog hint', () => {
    expect(framesOf(machine().receive({ type: 'call', id: 1, name: 'mcp__fx__missing' }))).toEqual([{
      type: 'reply',
      id: 1,
      ok: false,
      message: 'tools.mcp__fx__missing is not available; call catalog({ server }) for the exact tool names',
    }])
  })

  it('bounds calls in flight without losing the call identity', () => {
    const protocol = machine({ maxPendingCalls: 1 })
    expect(protocol.receive({ type: 'call', id: 1, name: 'mcp__fx__slow' })[0]).toMatchObject({ type: 'dispatch' })
    expect(framesOf(protocol.receive({ type: 'call', id: 2, name: 'mcp__fx__add' }))).toEqual([{
      type: 'reply',
      id: 2,
      ok: false,
      message: 'more than 1 tool calls are in flight',
    }])
  })

  it('replies to a binding rejection and ignores replies for unknown ids', () => {
    const protocol = machine()
    protocol.receive({ type: 'call', id: 1, name: 'mcp__fx__add', args: {} })
    expect(protocol.failed(1, 'boom')).toEqual([{ type: 'reply', frame: { type: 'reply', id: 1, ok: false, message: 'boom' } }])
    expect(protocol.failed(9, 'late')).toEqual([])
    expect(protocol.completed(9, {})).toEqual([])
  })

  it('refuses a tool result that is not lossless JSON', () => {
    const protocol = machine()
    protocol.receive({ type: 'call', id: 1, name: 'mcp__fx__add', args: {} })
    expect(framesOf(protocol.completed(1, new Date(0)))).toEqual([{
      type: 'reply',
      id: 1,
      ok: false,
      message: 'the tool result is not lossless JSON',
    }])
    const throwing = { get boom(): string { throw new Error('unrenderable') } }
    const second = machine()
    second.receive({ type: 'call', id: 1, name: 'mcp__fx__add', args: {} })
    expect(framesOf(second.completed(1, throwing))).toEqual([{
      type: 'reply',
      id: 1,
      ok: false,
      message: 'unrenderable',
    }])
  })
})

describe('program protocol: terminal frames', () => {
  it('settles a program that returned nothing', () => {
    expect(settlementOf(machine().receive({ type: 'done' })))
      .toEqual({ ok: true, logs: [] })
  })

  it('settles a program that returned JSON', () => {
    const protocol = machine()
    protocol.receive({ type: 'log', level: 'log', text: 'line' })
    expect(settlementOf(protocol.receive({ type: 'done', value: { total: 3 } })))
      .toEqual({ ok: true, logs: [{ level: 'log', text: 'line' }], value: { total: 3 } })
  })

  it('refuses a result that is not JSON and reports the cause', () => {
    expect(settlementOf(machine().receive({ type: 'done', value: new Date(0) })))
      .toMatchObject({ ok: false, kind: 'invalid-output', message: 'program result must be lossless JSON data' })
    const throwing = { get boom(): string { throw new Error('detach failed') } }
    expect(settlementOf(machine().receive({ type: 'done', value: throwing })))
      .toMatchObject({ kind: 'invalid-output', message: 'program result must be lossless JSON data: detach failed' })
  })

  it('bounds the complete output, logs plus result', () => {
    const protocol = machine({ maxOutputBytes: 10 })
    protocol.receive({ type: 'log', level: 'log', text: '12345' })
    expect(settlementOf(protocol.receive({ type: 'done', value: 'abcdef' })))
      .toMatchObject({ kind: 'output-limit', message: 'program output exceeded 10 bytes' })
  })

  it('settles a terminal error with a known kind', () => {
    expect(settlementOf(machine().receive({ type: 'done', error: { kind: 'exception', message: 'bad input' } })))
      .toMatchObject({ ok: false, kind: 'exception', message: 'bad input' })
  })

  it('rejects malformed terminal errors', () => {
    expect(settlementOf(machine().receive({ type: 'done', error: { kind: 'nope', message: 'x' } })))
      .toMatchObject({ kind: 'protocol', message: 'invalid terminal error frame' })
    expect(settlementOf(machine().receive({ type: 'done', error: { kind: 'exception' } })))
      .toMatchObject({ kind: 'protocol', message: 'invalid terminal error frame' })
    expect(settlementOf(machine().receive({ type: 'done', error: 'boom' })))
      .toMatchObject({ kind: 'protocol', message: 'invalid terminal error frame' })
  })
})

describe('program protocol: lifecycle events', () => {
  it('names each substrate failure', () => {
    expect(settlementOf(machine().timedOut(400)))
      .toMatchObject({ kind: 'timeout', message: 'execution deadline reached (400ms)' })
    expect(settlementOf(machine().aborted('client cancelled')))
      .toMatchObject({ kind: 'aborted', message: 'client cancelled' })
    expect(settlementOf(machine().childError('spawn failed')))
      .toMatchObject({ kind: 'worker-exit', message: 'spawn failed' })
    expect(settlementOf(machine().channelFailure('channel closed')))
      .toMatchObject({ kind: 'protocol', message: 'could not answer the program: channel closed' })
  })

  it('reports the exit code and any captured stderr', () => {
    expect(settlementOf(machine().exited(3, '')))
      .toMatchObject({ kind: 'worker-exit', message: 'program process exited before completing (3)' })
    expect(settlementOf(machine().exited(1, 'boom\n')))
      .toMatchObject({ kind: 'worker-exit', message: 'program process exited before completing (1): boom' })
    expect(settlementOf(machine().exited(null, '')))
      .toMatchObject({ kind: 'worker-exit', message: 'program process exited before completing (null)' })
  })

  it('ignores every later frame and event after a settlement', () => {
    const protocol = machine()
    expect(isSettled(protocol.receive({ type: 'done' }))).toBe(true)
    expect(protocol.settled).toBe(true)
    expect(protocol.receive({ type: 'log', level: 'log', text: 'late' })).toEqual([])
    expect(protocol.receive({ type: 'call', id: 1, name: 'mcp__fx__add' })).toEqual([])
    expect(protocol.completed(1, {})).toEqual([])
    expect(protocol.failed(1, 'late')).toEqual([])
    expect(protocol.aborted('late')).toEqual([])
    expect(protocol.timedOut(1)).toEqual([])
    expect(protocol.childError('late')).toEqual([])
    expect(protocol.exited(1, 'late')).toEqual([])
    expect(protocol.channelFailure('late')).toEqual([])
  })
})
