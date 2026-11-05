/**
 * Execute the commands one wave authorized and record what happened.
 *
 * The run document is evidence, not a claim: every command keeps its argv, cwd,
 * exit code, duration, output digests, and the reported test count. A timeout, a
 * non-zero exit, a count that disagrees with the expectation, or a command that
 * reports zero tests stays `no-comprobada`/`refutada` and never becomes
 * `demostrada` (HAR-02, HAR-07). An empty command list refuses to produce a
 * document at all.
 */

import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** One command the wave allows. */
export interface PlanCommand {
  /** Stable case or task id this command evidences. */
  readonly id: string
  /** Executable and arguments; no shell interpolation. */
  readonly argv: readonly string[]
  /** Working directory; defaults to the run root. */
  readonly cwd?: string
  /** Hard limit; a killed command is `no-comprobada`. */
  readonly timeoutMs?: number
  /** Exact number of passing tests the command must report. */
  readonly testsExpected?: number
}

/** Evidence for one executed command. */
export interface CommandOutcome {
  readonly id: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly exitCode: number | null
  readonly signal: string | null
  readonly durationMs: number
  readonly timedOut: boolean
  readonly stdoutSha256: string
  readonly stderrSha256: string
  readonly testsReported: number | null
  readonly state: 'demostrada' | 'refutada' | 'no-comprobada'
}

/** One execution's evidence. */
export interface RunDocument {
  readonly schemaVersion: 1
  readonly runId: string
  readonly waveId: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly root: string
  readonly checkout: { readonly branch: string; readonly head: string }
  readonly platform: string
  readonly node: string
  readonly commands: readonly CommandOutcome[]
  readonly results: readonly { readonly id: string; readonly state: CommandOutcome['state'] }[]
}

/** Options accepted by {@link runPlan}. */
export interface RunPlanOptions {
  /** Absolute repository root. */
  readonly root: string
  /** Wave or task this run evidences. */
  readonly waveId: string
  /** Commands to execute, in order. */
  readonly commands: readonly PlanCommand[]
  /** Directory that receives `run.json` and `results.json`. */
  readonly outDir: string
  /** Clock override for tests. */
  readonly now?: () => Date
}

/** Read the checkout identity without failing a run on a non-repository root. */
function checkout(root: string): { branch: string; head: string } {
  const git = (...args: string[]): string => execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  try {
    return { branch: git('branch', '--show-current'), head: git('rev-parse', 'HEAD') }
  } catch {
    return { branch: '', head: '' }
  }
}

/**
 * Parse the passing count a test runner printed.
 * @param output - combined stdout and stderr.
 * @returns the count, or null when the command reports no test summary.
 */
export function reportedTests(output: string): number | null {
  const matches = [...output.matchAll(/Tests\s+(\d+)\s+passed/gu)]
  const last = matches.at(-1)
  return last === undefined ? null : Number(last[1])
}

/**
 * Execute one command with a hard timeout, capturing both streams.
 * @param command - command to execute.
 * @param root - default working directory.
 * @returns the outcome.
 */
async function runCommand(command: PlanCommand, root: string): Promise<CommandOutcome> {
  const [executable, ...args] = command.argv
  if (executable === undefined) throw new Error(`faberloom-portable: ${command.id} names no command`)
  const cwd = command.cwd ?? root
  const started = Date.now()
  const chunks: { stdout: Buffer[]; stderr: Buffer[] } = { stdout: [], stderr: [] }
  const child = spawn(executable, args, {
    cwd,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const timing = { timedOut: false }
  const timer = setTimeout(() => {
    timing.timedOut = true
    child.kill('SIGKILL')
  }, command.timeoutMs ?? 600_000)
  child.stdout.on('data', (chunk: Buffer) => { chunks.stdout.push(chunk) })
  child.stderr.on('data', (chunk: Buffer) => { chunks.stderr.push(chunk) })
  const settled = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on('error', () => { resolve({ code: null, signal: null }) })
    child.on('close', (code, signal) => { resolve({ code, signal }) })
  })
  clearTimeout(timer)
  const stdout = Buffer.concat(chunks.stdout)
  const stderr = Buffer.concat(chunks.stderr)
  const output = `${stdout.toString('utf8')}\n${stderr.toString('utf8')}`
  const testsReported = reportedTests(output)
  const state = timing.timedOut || settled.code === null
    ? 'no-comprobada'
    : settled.code !== 0
      ? 'refutada'
      : command.testsExpected !== undefined && testsReported !== command.testsExpected
        ? 'no-comprobada'
        : testsReported === 0
          ? 'no-comprobada'
          : 'demostrada'
  return {
    id: command.id,
    argv: command.argv,
    cwd,
    exitCode: settled.code,
    signal: settled.signal,
    durationMs: Date.now() - started,
    timedOut: timing.timedOut,
    stdoutSha256: createHash('sha256').update(stdout).digest('hex'),
    stderrSha256: createHash('sha256').update(stderr).digest('hex'),
    testsReported,
    state,
  }
}

/**
 * Execute every command of one wave and write its evidence.
 * @param options - root, wave, commands, output directory, and clock.
 * @returns the run document written to disk.
 * @throws {Error} when the command list is empty: a run without evidence is not a pass.
 */
export async function runPlan(options: RunPlanOptions): Promise<RunDocument> {
  if (options.commands.length === 0) {
    throw new Error('faberloom-portable: NO_COMMANDS — a run with no evidence cannot be accepted')
  }
  const now = options.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const outcomes: CommandOutcome[] = []
  for (const command of options.commands) outcomes.push(await runCommand(command, options.root))
  const document: RunDocument = {
    schemaVersion: 1,
    runId: randomUUID(),
    waveId: options.waveId,
    startedAt,
    finishedAt: now().toISOString(),
    root: options.root,
    checkout: checkout(options.root),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    commands: outcomes,
    results: outcomes.map(outcome => ({ id: outcome.id, state: outcome.state })),
  }
  mkdirSync(options.outDir, { recursive: true })
  const write = (name: string, value: unknown): void => {
    const target = join(options.outDir, name)
    const temporary = `${target}.tmp`
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temporary, target)
  }
  write('run.json', document)
  write('results.json', { schemaVersion: 1, runId: document.runId, results: document.results })
  return document
}
