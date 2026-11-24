/**
 * Program process owner: spawns a fresh Node process with an empty environment,
 * one IPC channel, an output bound, and a wall-clock deadline, then hands it to
 * the event driver.
 *
 * The child never receives credentials: upstream dispatch (and every header it
 * needs) stays in the parent, so a program can only reach data by calling a
 * declared binding.
 * @module @deepseek-ai/dsh-mcp-codemode/src/executor
 */

import { spawn } from 'node:child_process'
import { CHILD_BOOTSTRAP } from './child.ts'
import { driveProgram } from './drive.ts'
import type { ProgramOutcome } from './types.ts'

/** Inputs for one program run. */
export interface ExecuteProgramRequest {
  /** Body of an async function; erasable TypeScript only. */
  readonly code: string
  /** Binding names and the parent-owned call each one dispatches. */
  readonly bindings: ReadonlyMap<string, (args: unknown) => Promise<unknown>>
  /** Elapsed deadline for the complete run. */
  readonly timeoutMs: number
  /** Cap on captured output (console lines plus result JSON) in UTF-8 bytes. */
  readonly maxOutputBytes: number
  /** Cap on upstream calls in flight from this program. */
  readonly maxPendingCalls: number
  /** V8 old-generation heap limit for the program process, in MiB. */
  readonly maxOldGenerationSizeMb: number
  /** Node executable that runs the program. */
  readonly nodeExecutable: string
  /** Working directory of the program process. */
  readonly cwd: string
  /** Cancellation of the enclosing MCP request, when the client supplied one. */
  readonly signal?: AbortSignal
}

/**
 * Run one program in a fresh Node process and settle with its logs and value.
 *
 * Resolves, never rejects: every substrate failure (spawn error, crash, deadline,
 * cancellation, malformed frame, oversized output) becomes a {@link ProgramOutcome}
 * that names its kind. The process is terminated before this promise settles.
 * @param request - Program, bindings, limits, and cancellation.
 * @returns Logs, the lossless JSON return value, or a named failure.
 */
export async function executeProgram(request: ExecuteProgramRequest): Promise<ProgramOutcome> {
  const startedAt = Date.now()
  const child = spawn(
    request.nodeExecutable,
    [`--max-old-space-size=${String(request.maxOldGenerationSizeMb)}`, '--disable-warning=ExperimentalWarning', '-e', CHILD_BOOTSTRAP],
    { cwd: request.cwd, env: {}, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'advanced', windowsHide: true },
  )
  return driveProgram(child, request, startedAt)
}
