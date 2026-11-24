/**
 * Event wiring for one program process: timers, the IPC channel, stderr capture,
 * and teardown. The spawn itself lives in {@link module:@deepseek-ai/dsh-mcp-codemode/src/executor};
 * the decisions about frames and settlement live in the protocol state machine.
 * This module is the seam that turns a child's events into those decisions.
 * @module @deepseek-ai/dsh-mcp-codemode/src/drive
 */

import type { ChildProcess } from 'node:child_process'
import { sendFrame, terminateProcess } from './channel.ts'
import type { FrameTarget } from './channel.ts'
import { messageOf } from './errors.ts'
import { ProgramProtocol } from './protocol.ts'
import type { ProtocolEffect, ProtocolSettlement } from './protocol.ts'
import type { ProgramOutcome } from './types.ts'
import type { ExecuteProgramRequest } from './executor.ts'

/** Child stderr retained for a worker-exit diagnostic, in UTF-8 bytes. */
const MAX_STDERR_BYTES = 8192

/** Grace period between a soft kill and a hard kill of the program process. */
const KILL_GRACE_MS = 2000

/**
 * Drive one spawned program to a terminal outcome.
 *
 * Resolves, never rejects: every substrate failure (crash, deadline,
 * cancellation, malformed frame, oversized output, closed channel) becomes a
 * {@link ProgramOutcome} that names its kind. The process is terminated before
 * the promise settles.
 * @param child - Spawned program process with a piped stderr and one IPC channel.
 * @param request - Program, bindings, limits, and cancellation.
 * @param startedAt - `Date.now()` sampled before the spawn, for the reported duration.
 * @returns Logs, the lossless JSON return value, or a named failure.
 */
export async function driveProgram(
  child: ChildProcess,
  request: ExecuteProgramRequest,
  startedAt: number,
): Promise<ProgramOutcome> {
  const completion = Promise.withResolvers<ProgramOutcome>()
  const protocol = new ProgramProtocol({
    bindings: request.bindings,
    maxOutputBytes: request.maxOutputBytes,
    maxPendingCalls: request.maxPendingCalls,
  })
  let stderr = ''

  const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
  const channel: FrameTarget = { send: frame => child.send(frame) }

  const settle = (settlement: ProtocolSettlement): void => {
    clearTimeout(deadline)
    request.signal?.removeEventListener('abort', onAbort)
    child.off('message', onMessage)
    const durationMs = Date.now() - startedAt
    void terminateProcess(child, exited, KILL_GRACE_MS).then(() => {
      completion.resolve(settlement.ok
        ? { ok: true, logs: settlement.logs, durationMs, ...settlement.value === undefined ? {} : { value: settlement.value } }
        : { ok: false, kind: settlement.kind, message: settlement.message, logs: settlement.logs, durationMs })
    })
  }

  const apply = (effects: readonly ProtocolEffect[]): void => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'settle':
          settle(effect.settlement)
          return
        case 'reply': {
          const failure = sendFrame(channel, effect.frame)
          if (failure !== undefined) apply(protocol.channelFailure(failure))
          break
        }
        case 'dispatch': {
          void (async () => {
            let value: unknown
            try {
              value = await effect.binding(effect.args)
            } catch (error: unknown) {
              apply(protocol.failed(effect.id, messageOf(error)))
              return
            }
            apply(protocol.completed(effect.id, value))
          })()
          break
        }
      }
    }
  }

  const onAbort = (): void => {
    apply(protocol.aborted(messageOf(request.signal?.reason ?? 'cancelled')))
  }

  const deadline = setTimeout(() => {
    apply(protocol.timedOut(request.timeoutMs))
  }, request.timeoutMs)

  const onMessage = (raw: unknown): void => {
    apply(protocol.receive(raw))
  }

  child.on('message', onMessage)
  // The spawn requests a piped stderr, so Node always provides the stream.
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderr.length >= MAX_STDERR_BYTES) return
    stderr = (stderr + chunk.toString('utf8')).slice(0, MAX_STDERR_BYTES)
  })
  child.on('error', (error: Error) => { apply(protocol.childError(messageOf(error))) })
  child.once('exit', (code) => {
    // Let queued IPC frames settle first: a program that prints and exits on the
    // same turn still reports its output instead of a bare exit code.
    setImmediate(() => {
      apply(protocol.exited(code, stderr))
    })
  })
  if (request.signal !== undefined) {
    if (request.signal.aborted) onAbort()
    else request.signal.addEventListener('abort', onAbort, { once: true })
  }
  if (!protocol.settled) {
    const failure = sendFrame(channel, {
      type: 'boot',
      code: request.code,
      bindings: [...request.bindings.keys()],
      maxOutputBytes: request.maxOutputBytes,
    })
    if (failure !== undefined) apply(protocol.childError(`could not start the program process: ${failure}`))
  }
  return completion.promise
}
