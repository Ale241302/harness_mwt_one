import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { driveProgram } from '../src/drive.ts'
import type { ExecuteProgramRequest } from '../src/executor.ts'
import type { ProgramOutcome } from '../src/types.ts'

/** Stand-in for a spawned program process; every branch of the wiring is reachable from here. */
class FakeChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly stderr = new EventEmitter()
  readonly sent: unknown[] = []
  readonly killed: string[] = []
  sendError: Error | undefined
  stubborn = false

  send(frame: object): boolean {
    if (this.sendError !== undefined) throw this.sendError
    this.sent.push(frame)
    return true
  }

  kill(signal: string = 'SIGTERM'): boolean {
    this.killed.push(signal)
    if (this.stubborn) return true
    this.exitCode = 0
    this.emit('exit', 0)
    return true
  }
}

function request(overrides: Partial<ExecuteProgramRequest> = {}): ExecuteProgramRequest {
  return {
    code: 'return 1',
    bindings: new Map<string, (args: unknown) => Promise<unknown>>(),
    timeoutMs: 10_000,
    maxOutputBytes: 1024,
    maxPendingCalls: 2,
    maxOldGenerationSizeMb: 64,
    nodeExecutable: 'node',
    cwd: '.',
    ...overrides,
  }
}

function start(child: FakeChild, overrides: Partial<ExecuteProgramRequest> = {}): Promise<ProgramOutcome> {
  return driveProgram(child as unknown as ChildProcess, request(overrides), Date.now())
}

function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

function replies(child: FakeChild): unknown[] {
  return child.sent.filter(frame => (frame as { type?: string }).type === 'reply')
}

afterEach(() => { vi.useRealTimers() })

describe('program driver', () => {
  it('boots, logs, dispatches a binding, and settles with the returned value', async () => {
    const child = new FakeChild()
    const outcome = start(child, {
      bindings: new Map([['mcp__fx__add', async () => ({ content: [{ type: 'text', text: '5' }] })]]),
    })
    expect(child.sent[0]).toEqual({
      type: 'boot',
      code: 'return 1',
      bindings: ['mcp__fx__add'],
      maxOutputBytes: 1024,
    })
    child.emit('message', { type: 'log', level: 'log', text: 'working' })
    child.emit('message', { type: 'call', id: 1, name: 'mcp__fx__add', args: { a: 2 } })
    await flush()
    expect(replies(child)).toEqual([{
      type: 'reply',
      id: 1,
      ok: true,
      value: { content: [{ type: 'text', text: '5' }] },
    }])
    child.emit('message', { type: 'done', value: { sum: '5' } })
    await expect(outcome).resolves.toMatchObject({
      ok: true,
      value: { sum: '5' },
      logs: [{ level: 'log', text: 'working' }],
    })
  })

  it('answers a rejected binding with the rejection message', async () => {
    const child = new FakeChild()
    const outcome = start(child, {
      bindings: new Map([['mcp__fx__fail', async () => { throw new Error('boom') }]]),
    })
    child.emit('message', { type: 'call', id: 1, name: 'mcp__fx__fail', args: {} })
    await flush()
    expect(replies(child)).toEqual([{ type: 'reply', id: 1, ok: false, message: 'boom' }])
    child.emit('message', { type: 'done' })
    await expect(outcome).resolves.toMatchObject({ ok: true })
  })

  it('settles on its deadline and kills the process', async () => {
    const child = new FakeChild()
    const outcome = start(child, { timeoutMs: 5 })
    await expect(outcome).resolves.toMatchObject({
      ok: false,
      kind: 'timeout',
      message: 'execution deadline reached (5ms)',
    })
    expect(child.killed).toEqual(['SIGTERM'])
  })

  it('escalates to SIGKILL when the process ignores the soft kill', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    child.stubborn = true
    const outcome = start(child, { timeoutMs: 5 })
    await vi.advanceTimersByTimeAsync(5)
    await vi.advanceTimersByTimeAsync(2000)
    await expect(outcome).resolves.toMatchObject({ ok: false, kind: 'timeout' })
    expect(child.killed).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('settles on cancellation while running, removing its listener', async () => {
    const controller = new AbortController()
    const child = new FakeChild()
    const outcome = start(child, { signal: controller.signal })
    expect(controller.signal).toBeDefined()
    controller.abort(new Error('client cancelled'))
    await expect(outcome).resolves.toMatchObject({
      ok: false,
      kind: 'aborted',
      message: 'client cancelled',
    })
    expect(child.killed).toEqual(['SIGTERM'])
  })

  it('settles before boot when the request arrives already cancelled', async () => {
    const signal = {
      aborted: true,
      reason: undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as AbortSignal
    const child = new FakeChild()
    const outcome = start(child, { signal })
    expect(child.sent).toEqual([])
    await expect(outcome).resolves.toMatchObject({ ok: false, kind: 'aborted', message: 'cancelled' })
  })

  it('settles when the process cannot start', async () => {
    const child = new FakeChild()
    const outcome = start(child)
    child.emit('error', new Error('spawn ENOENT'))
    await expect(outcome).resolves.toMatchObject({
      ok: false,
      kind: 'worker-exit',
      message: 'spawn ENOENT',
    })
  })

  it('settles when the boot frame cannot be sent', async () => {
    const child = new FakeChild()
    child.sendError = new Error('channel closed')
    await expect(start(child)).resolves.toMatchObject({
      ok: false,
      kind: 'worker-exit',
      message: 'could not start the program process: channel closed',
    })
  })

  it('settles when a reply cannot be sent and names the channel error', async () => {
    const child = new FakeChild()
    const outcome = start(child, {
      bindings: new Map([['mcp__fx__add', async () => ({ content: [] })]]),
    })
    child.sendError = new Error('channel closed')
    child.emit('message', { type: 'call', id: 1, name: 'mcp__fx__add', args: {} })
    await flush()
    await expect(outcome).resolves.toMatchObject({
      ok: false,
      kind: 'protocol',
      message: 'could not answer the program: channel closed',
    })
  })

  it('reports an exit before completion with the captured stderr', async () => {
    const child = new FakeChild()
    const outcome = start(child)
    child.stderr.emit('data', Buffer.from('boom\n'))
    child.emit('exit', 2)
    await expect(outcome).resolves.toMatchObject({
      ok: false,
      kind: 'worker-exit',
      message: 'program process exited before completing (2): boom',
    })
  })

  it('reports a bare exit code when stderr stayed empty', async () => {
    const child = new FakeChild()
    const outcome = start(child)
    child.emit('exit', 0)
    await expect(outcome).resolves.toMatchObject({
      ok: false,
      kind: 'worker-exit',
      message: 'program process exited before completing (0)',
    })
  })

  it('keeps stderr bounded at eight KiB', async () => {
    const child = new FakeChild()
    const outcome = start(child)
    child.stderr.emit('data', Buffer.from('a'.repeat(9000)))
    child.stderr.emit('data', Buffer.from('tail'))
    child.emit('exit', 1)
    const settled = await outcome
    expect(settled.ok).toBe(false)
    if (settled.ok) throw new Error('expected a failure')
    expect(settled.message).toBe(`program process exited before completing (1): ${'a'.repeat(8192)}`)
  })
})
