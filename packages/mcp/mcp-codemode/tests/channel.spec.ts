import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendFrame, terminateProcess } from '../src/channel.ts'
import type { TerminableTarget } from '../src/channel.ts'

function target(overrides: Partial<TerminableTarget> = {}): TerminableTarget & { killed: string[] } {
  const killed: string[] = []
  return {
    exitCode: null,
    signalCode: null,
    killed,
    kill(signal = 'SIGTERM') {
      killed.push(signal)
      return true
    },
    ...overrides,
  }
}

afterEach(() => { vi.useRealTimers() })

describe('sendFrame', () => {
  it('reports a channel that never opened and a send that throws', () => {
    expect(sendFrame({}, { type: 'boot' })).toBe('no IPC channel')
    expect(sendFrame({ send: () => { throw new Error('channel closed') } }, { type: 'boot' })).toBe('channel closed')
    expect(sendFrame({ send: () => { throw 'plain string' } }, { type: 'boot' })).toBe('plain string')
  })

  it('sends the frame and reports success', () => {
    const sent: unknown[] = []
    expect(sendFrame({ send: (frame) => { sent.push(frame) } }, { type: 'reply', id: 1 })).toBeUndefined()
    expect(sent).toEqual([{ type: 'reply', id: 1 }])
  })
})

describe('terminateProcess', () => {
  it('leaves a process that already exited alone', async () => {
    const exited = target({ exitCode: 0 })
    await terminateProcess(exited, Promise.resolve(), 10)
    expect(exited.killed).toEqual([])
  })

  it('leaves a process that already died from a signal alone', async () => {
    const signaled = target({ signalCode: 'SIGTERM' })
    await terminateProcess(signaled, Promise.resolve(), 10)
    expect(signaled.killed).toEqual([])
  })

  it('soft-kills a live process and waits for its exit', async () => {
    const live = target()
    const finished = Promise.withResolvers<undefined>()
    const ending = terminateProcess(live, finished.promise, 1000)
    finished.resolve(undefined)
    await ending
    expect(live.killed).toEqual(['SIGTERM'])
  })

  it('escalates to SIGKILL when the process outlives the grace period', async () => {
    vi.useFakeTimers()
    const stubborn = target()
    const ending = terminateProcess(stubborn, new Promise(() => undefined), 50)
    await vi.advanceTimersByTimeAsync(50)
    await ending
    expect(stubborn.killed).toEqual(['SIGTERM', 'SIGKILL'])
  })
})
