/**
 * Pure parent-side state machine for the program IPC protocol. The executor owns
 * the process, timers, and channel; this module owns every decision a frame or a
 * lifecycle event produces: log accounting, binding-call identity, pending-call
 * bounds, JSON-losslessness checks, and exactly one terminal settlement.
 *
 * Keeping the decisions here means an invalid frame, a dead child, a deadline,
 * or a cancellation is exercised by a data-only test instead of a live process.
 * @module @deepseek-ai/dsh-mcp-codemode/src/protocol
 */

import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { messageOf } from './errors.ts'
import type { ProgramErrorKind, ProgramLog } from './types.ts'

/** Failure kinds the child or the executor may report; validated at the IPC boundary. */
const ERROR_KINDS: ReadonlySet<string> = new Set<ProgramErrorKind>([
  'exception', 'type-stripping', 'timeout', 'output-limit', 'invalid-output', 'worker-exit', 'protocol', 'aborted',
])

/** One frame the facade sends to a program process. */
export type ChildFrame =
  | {
    readonly type: 'boot'
    readonly code: string
    readonly bindings: readonly string[]
    readonly maxOutputBytes: number
  }
  | { readonly type: 'reply'; readonly id: number; readonly ok: true; readonly value: JsonValue }
  | { readonly type: 'reply'; readonly id: number; readonly ok: false; readonly message: string }

/** Terminal state of one run, without the duration the executor measures. */
export type ProtocolSettlement =
  | { readonly ok: true; readonly logs: readonly ProgramLog[]; readonly value?: JsonValue }
  | {
    readonly ok: false
    readonly kind: ProgramErrorKind
    readonly message: string
    readonly logs: readonly ProgramLog[]
  }

/** Work the executor performs for one state transition, in order. */
export type ProtocolEffect =
  | { readonly type: 'reply'; readonly frame: ChildFrame }
  | {
    readonly type: 'dispatch'
    readonly id: number
    readonly name: string
    readonly args: JsonValue
    readonly binding: (args: unknown) => Promise<unknown>
  }
  | { readonly type: 'settle'; readonly settlement: ProtocolSettlement }

/** Inputs for one program's protocol machine. */
export interface ProgramProtocolOptions {
  /** Binding names and the parent-owned call each one dispatches. */
  readonly bindings: ReadonlyMap<string, (args: unknown) => Promise<unknown>>
  /** Cap on captured output in UTF-8 bytes. */
  readonly maxOutputBytes: number
  /** Cap on binding calls in flight. */
  readonly maxPendingCalls: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * Decide what one incoming frame or lifecycle event means for a running program.
 *
 * Every method returns the effects the driver must apply, in order, and no
 * method produces work after the run settled. A malformed frame, a reply for an
 * unknown call id, an oversized log, and a terminal frame all settle the run
 * here; the driver only forwards the result.
 */
export class ProgramProtocol {
  readonly #bindings: ReadonlyMap<string, (args: unknown) => Promise<unknown>>
  readonly #maxOutputBytes: number
  readonly #maxPendingCalls: number
  readonly #logs: ProgramLog[] = []
  readonly #pending = new Set<number>()
  #logBytes = 0
  #nextId = 0
  #settled = false

  constructor(options: ProgramProtocolOptions) {
    this.#bindings = options.bindings
    this.#maxOutputBytes = options.maxOutputBytes
    this.#maxPendingCalls = options.maxPendingCalls
  }

  /** Whether the run already reached a terminal state. */
  get settled(): boolean {
    return this.#settled
  }

  /** Captured console lines, in arrival order. */
  get logs(): readonly ProgramLog[] {
    return this.#logs
  }

  /**
   * Interpret one frame from the program process.
   * @param raw - Frame as it arrived on the IPC channel; may be malformed.
   * @returns Reply frames, one dispatch, or the terminal settlement.
   */
  receive(raw: unknown): ProtocolEffect[] {
    if (this.#settled) return []
    if (!isRecord(raw) || typeof raw.type !== 'string') return this.#fail('protocol', 'invalid control frame')
    switch (raw.type) {
      case 'log':
        return this.#receiveLog(raw)
      case 'call':
        return this.#receiveCall(raw)
      case 'done':
        return this.#receiveDone(raw)
      default:
        return this.#fail('protocol', 'unknown control frame')
    }
  }

  /**
   * Report a finished binding call with its value.
   * @param id - Call id the program sent.
   * @param value - Resolved tool value, checked for JSON losslessness here.
   * @returns One reply frame, or nothing when the run already settled.
   */
  completed(id: number, value: unknown): ProtocolEffect[] {
    if (this.#settled || !this.#pending.has(id)) return []
    this.#pending.delete(id)
    let detached: unknown
    try {
      detached = snapshotJsonValue(value)
    } catch (error: unknown) {
      return this.#reply({ type: 'reply', id, ok: false, message: messageOf(error) })
    }
    if (detached === undefined) {
      return this.#reply({ type: 'reply', id, ok: false, message: 'the tool result is not lossless JSON' })
    }
    return this.#reply({ type: 'reply', id, ok: true, value: detached as JsonValue })
  }

  /**
   * Report a rejected binding call.
   * @param id - Call id the program sent.
   * @param message - Rejection message handed to the program.
   * @returns One reply frame, or nothing when the run already settled.
   */
  failed(id: number, message: string): ProtocolEffect[] {
    if (this.#settled || !this.#pending.has(id)) return []
    this.#pending.delete(id)
    return this.#reply({ type: 'reply', id, ok: false, message })
  }

  /**
   * Settle because the enclosing request was cancelled.
   * @param reason - Cancellation reason rendered as the failure message.
   * @returns The terminal settlement.
   */
  aborted(reason: string): ProtocolEffect[] {
    return this.#fail('aborted', reason)
  }

  /**
   * Settle because the run outlived its deadline.
   * @param timeoutMs - Deadline that fired, for the message.
   * @returns The terminal settlement.
   */
  timedOut(timeoutMs: number): ProtocolEffect[] {
    return this.#fail('timeout', `execution deadline reached (${String(timeoutMs)}ms)`)
  }

  /**
   * Settle because the program process failed to start or crashed.
   * @param message - Diagnostic retained for the model.
   * @returns The terminal settlement.
   */
  childError(message: string): ProtocolEffect[] {
    return this.#fail('worker-exit', message)
  }

  /**
   * Settle because the program process exited before sending a terminal frame.
   * @param code - Exit code of the program process.
   * @param stderr - Captured stderr, empty when the process wrote none.
   * @returns The terminal settlement.
   */
  exited(code: number | null, stderr: string): ProtocolEffect[] {
    const detail = stderr.length > 0 ? `: ${stderr.trim()}` : ''
    return this.#fail('worker-exit', `program process exited before completing (${String(code)})${detail}`)
  }

  /**
   * Settle because a reply frame could not reach the program.
   * @param message - Channel error text.
   * @returns The terminal settlement.
   */
  channelFailure(message: string): ProtocolEffect[] {
    return this.#fail('protocol', `could not answer the program: ${message}`)
  }

  #receiveLog(raw: Record<string, unknown>): ProtocolEffect[] {
    const level = raw.level === 'error' ? 'error' : raw.level === 'log' ? 'log' : undefined
    if (level === undefined || typeof raw.text !== 'string') return this.#fail('protocol', 'invalid log frame')
    this.#logBytes += byteLength(raw.text) + 1
    if (this.#logBytes > this.#maxOutputBytes) {
      return this.#fail('output-limit', `program output exceeded ${String(this.#maxOutputBytes)} bytes`)
    }
    this.#logs.push({ level, text: raw.text })
    return []
  }

  #receiveCall(raw: Record<string, unknown>): ProtocolEffect[] {
    if (!Number.isSafeInteger(raw.id) || typeof raw.name !== 'string') {
      return this.#fail('protocol', 'invalid binding call identity')
    }
    const id = raw.id as number
    if (id !== this.#nextId + 1) return this.#fail('protocol', 'binding call ids must be sequential')
    this.#nextId = id
    if (this.#pending.size >= this.#maxPendingCalls) {
      return this.#reply({
        type: 'reply',
        id,
        ok: false,
        message: `more than ${String(this.#maxPendingCalls)} tool calls are in flight`,
      })
    }
    const name = raw.name
    const binding = this.#bindings.get(name)
    if (binding === undefined) {
      return this.#reply({
        type: 'reply',
        id,
        ok: false,
        message: `tools.${name} is not available; call catalog({ server }) for the exact tool names`,
      })
    }
    let args: unknown
    try {
      args = snapshotJsonValue(raw.args === undefined ? {} : raw.args)
    } catch (error: unknown) {
      return this.#reply({ type: 'reply', id, ok: false, message: `arguments must be lossless JSON: ${messageOf(error)}` })
    }
    if (args === undefined) {
      return this.#reply({
        type: 'reply',
        id,
        ok: false,
        message: 'arguments must be lossless JSON (pass an object, for example {})',
      })
    }
    this.#pending.add(id)
    return [{ type: 'dispatch', id, name, args: args as JsonValue, binding }]
  }

  #receiveDone(raw: Record<string, unknown>): ProtocolEffect[] {
    if (raw.error !== undefined) {
      const error = raw.error
      if (!isRecord(error) || typeof error.kind !== 'string' || !ERROR_KINDS.has(error.kind) || typeof error.message !== 'string') {
        return this.#fail('protocol', 'invalid terminal error frame')
      }
      return this.#fail(error.kind as ProgramErrorKind, error.message)
    }
    if (raw.value === undefined) return this.#settle()
    let value: unknown
    try {
      value = snapshotJsonValue(raw.value)
    } catch (error: unknown) {
      return this.#fail('invalid-output', `program result must be lossless JSON data: ${messageOf(error)}`)
    }
    if (value === undefined) return this.#fail('invalid-output', 'program result must be lossless JSON data')
    const resultBytes = byteLength(JSON.stringify(value))
    if (this.#logBytes + resultBytes > this.#maxOutputBytes) {
      return this.#fail('output-limit', `program output exceeded ${String(this.#maxOutputBytes)} bytes`)
    }
    return this.#settle(value as JsonValue)
  }

  #reply(frame: ChildFrame): ProtocolEffect[] {
    return [{ type: 'reply', frame }]
  }

  #fail(kind: ProgramErrorKind, message: string): ProtocolEffect[] {
    return this.#complete({ ok: false, kind, message, logs: this.#logs })
  }

  #settle(value?: JsonValue): ProtocolEffect[] {
    return this.#complete({ ok: true, logs: this.#logs, ...value === undefined ? {} : { value } })
  }

  #complete(settlement: ProtocolSettlement): ProtocolEffect[] {
    if (this.#settled) return []
    this.#settled = true
    return [{ type: 'settle', settlement }]
  }
}
