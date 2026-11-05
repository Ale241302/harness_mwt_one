import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { reportedTests, runPlan, type PlanCommand } from './run.ts'

let dir: string | undefined
function workspace(): string {
  dir ??= mkdtempSync(join(tmpdir(), 'faberloom-run-'))
  return dir
}

function node(script: string, extra: Partial<PlanCommand> = {}): PlanCommand {
  return { id: 'case', argv: [process.execPath, '-e', script], ...extra }
}

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

describe('harness run document', () => {
  it('records one outcome per command and writes run.json and results.json', async () => {
    const outDir = join(workspace(), 'out')
    const document = await runPlan({
      root: workspace(),
      waveId: '1.1',
      outDir,
      commands: [
        node('console.log("Tests  2 passed")', { id: 'HAR-01' }),
        { id: 'typecheck', argv: [process.execPath, '-e', 'process.exit(0)'] },
      ],
    })
    expect(document.results).toEqual([
      { id: 'HAR-01', state: 'demostrada' },
      { id: 'typecheck', state: 'demostrada' },
    ])
    expect(document.commands[0]?.testsReported).toBe(2)
    expect(JSON.parse(readFileSync(join(outDir, 'run.json'), 'utf8'))).toMatchObject({ runId: document.runId, waveId: '1.1' })
    expect(JSON.parse(readFileSync(join(outDir, 'results.json'), 'utf8'))).toMatchObject({
      runId: document.runId, results: document.results,
    })
  })

  it('refuses a run with no commands', async () => {
    await expect(runPlan({ root: workspace(), waveId: '1.1', outDir: join(workspace(), 'out'), commands: [] }))
      .rejects.toThrow('NO_COMMANDS')
  })

  it('records a non-zero exit as refuted', async () => {
    const document = await runPlan({
      root: workspace(),
      waveId: '1.1',
      outDir: join(workspace(), 'out'),
      commands: [node('process.exit(3)')],
    })
    expect(document.commands[0]).toMatchObject({ exitCode: 3, state: 'refutada' })
  })

  it('records a killed command as unproven (HAR-02)', async () => {
    const document = await runPlan({
      root: workspace(),
      waveId: '1.1',
      outDir: join(workspace(), 'out'),
      commands: [node('setTimeout(() => {}, 5000)', { timeoutMs: 50 })],
    })
    expect(document.commands[0]).toMatchObject({ timedOut: true, state: 'no-comprobada' })
  })

  it('never accepts zero reported tests', async () => {
    const document = await runPlan({
      root: workspace(),
      waveId: '1.1',
      outDir: join(workspace(), 'out'),
      commands: [node('console.log("Tests  0 passed")')],
    })
    expect(document.commands[0]).toMatchObject({ testsReported: 0, state: 'no-comprobada' })
  })

  it('refuses a count that disagrees with the expectation', async () => {
    const document = await runPlan({
      root: workspace(),
      waveId: '1.1',
      outDir: join(workspace(), 'out'),
      commands: [node('console.log("Tests  3 passed")', { testsExpected: 4 })],
    })
    expect(document.commands[0]).toMatchObject({ testsReported: 3, state: 'no-comprobada' })
  })
})

describe('test summary parsing', () => {
  it('takes the last reported count and ignores lines without a summary', () => {
    expect(reportedTests('Tests  1 passed\nTests  9 passed')).toBe(9)
    expect(reportedTests('no summary here')).toBeNull()
  })
})
