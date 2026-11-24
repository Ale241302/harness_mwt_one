/**
 * Transport primitives around one program process: sending a frame on the IPC
 * channel and ending the process. Both are separated from the protocol state
 * machine so their failure branches are exercised against a fake target rather
 * than a live child process.
 * @module @deepseek-ai/dsh-mcp-codemode/src/channel
 */

import { messageOf } from './errors.ts'

/** The part of a spawned child the facade sends frames to. */
export interface FrameTarget {
  /** `child.send` of the program process, when the channel is open. */
  readonly send?: (message: ChildFrameLike) => unknown
}

/** A frame is an ordinary JSON-serializable object on this channel. */
export type ChildFrameLike = object

/** The part of a spawned child the facade terminates. */
export interface TerminableTarget {
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  kill(signal?: NodeJS.Signals): boolean
}

/**
 * Send one frame without letting a closed channel reject the run.
 * @param target - Sender, or an object without one when the channel never opened.
 * @param frame - Frame to send.
 * @returns The channel error text, or `undefined` after a successful send.
 */
export function sendFrame(target: FrameTarget, frame: ChildFrameLike): string | undefined {
  if (typeof target.send !== 'function') return 'no IPC channel'
  try {
    target.send(frame)
    return undefined
  } catch (error: unknown) {
    return messageOf(error)
  }
}

/**
 * End the program process and wait for it to exit.
 *
 * A live process gets one soft kill; a process still alive after `graceMs` gets
 * a hard kill. A process that already exited needs nothing.
 * @param target - Process to end.
 * @param exited - Resolves when the process' `exit` event fires.
 * @param graceMs - Delay before escalating to `SIGKILL`.
 * @returns Resolves once the process exited or the hard kill was issued.
 */
export async function terminateProcess(target: TerminableTarget, exited: Promise<void>, graceMs: number): Promise<void> {
  if (target.exitCode !== null || target.signalCode !== null) return
  target.kill()
  let timer: NodeJS.Timeout | undefined
  const forced = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      target.kill('SIGKILL')
      resolve()
    }, graceMs)
  })
  await Promise.race([exited, forced])
  clearTimeout(timer)
}
