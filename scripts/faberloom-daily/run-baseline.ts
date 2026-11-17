/**
 * Baseline reproducible del árbol de trabajo.
 *
 * Ejecuta pasos reales y deriva el veredicto del código de salida, no de una
 * impresión. Guarda las últimas líneas de cada salida y escribe `baseline.json`,
 * que `check-plan.ts` valida. Un paso que falla se registra como FAIL con su
 * limitación; no se corrige ni se reintenta para que quede verde.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BaselineEntry, BaselineFile } from './check-plan.ts'

export interface Step {
  id: string
  area: string
  command: string
  args: string[]
  expected: string
  timeoutMs: number
  jsonReport?: string
}

export interface StepResult {
  entry: BaselineEntry
  output: string
  structured?: { headline: string; perFile: string }
}

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const bin = (name: string): string => join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.CMD` : name)

export const STEPS: Step[] = [
  {
    id: 'B1',
    area: 'scripts/faberloom-daily',
    command: bin('vitest'),
    args: ['run', 'scripts/faberloom-daily', '--project', 'thread-safe'],
    expected: 'las 76 pruebas de los tres validadores en verde',
    timeoutMs: 300_000,
  },
  {
    id: 'B2',
    area: 'tipos de los validadores',
    command: bin('tsc'),
    args: [
      '--ignoreConfig',
      '--noEmit',
      '--target',
      'es2022',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--strict',
      '--skipLibCheck',
      '--types',
      'node',
      '--allowImportingTsExtensions',
      'scripts/faberloom-daily/check-plan.ts',
      'scripts/faberloom-daily/compare-upstream.ts',
      'scripts/faberloom-daily/check-closure.ts',
      'scripts/faberloom-daily/check-plan.spec.ts',
      'scripts/faberloom-daily/compare-upstream.spec.ts',
      'scripts/faberloom-daily/check-closure.spec.ts',
    ],
    expected: 'sin errores de tipo en modo strict',
    timeoutMs: 300_000,
  },
  {
    id: 'B3',
    area: 'presupuesto documental',
    command: bin('tsx'),
    args: ['scripts/verify-doc-budgets.ts'],
    expected: 'ocho documentos dentro de su techo de palabras',
    timeoutMs: 180_000,
  },
  {
    id: 'B4',
    area: 'configuración OpenCode',
    command: bin('tsx'),
    args: ['scripts/faberloom-daily/check-closure.ts'],
    expected: 'once agentes, siete comandos y los dieciséis expedientes sin incidencias',
    timeoutMs: 120_000,
  },
  {
    id: 'B5',
    area: 'matriz de requisitos',
    command: bin('tsx'),
    args: ['scripts/faberloom-daily/check-plan.ts'],
    expected: 'modelo y documentos coherentes',
    timeoutMs: 120_000,
  },
  {
    id: 'B6',
    area: 'packages/faberloom (producto existente)',
    command: bin('vitest'),
    args: [
      'run',
      'packages/faberloom',
      '--project',
      'thread-safe',
      '--reporter=json',
      `--outputFile=${join(here, 'baseline-b6.json')}`,
    ],
    expected: 'el producto existente conserva su suite en verde',
    timeoutMs: 900_000,
    jsonReport: join(here, 'baseline-b6.json'),
  },
]

interface VitestJson {
  numTotalTestSuites?: number
  numFailedTestSuites?: number
  numTotalTests?: number
  numFailedTests?: number
  numPassedTests?: number
  numPendingTests?: number
  testResults?: {
    name?: string
    assertionResults?: { status?: string; fullName?: string }[]
  }[]
}

export interface StructuredReport {
  headline: string
  perFile: string
  extract: {
    revision_note: string
    suites_total: number | null
    suites_failed: number | null
    tests_total: number | null
    tests_failed: number | null
    tests_passed: number | null
    tests_skipped: number | null
    per_file: { file: string; failed: number }[]
    failed_tests: string[]
    source_sha256: string
    source_bytes: number
  }
}

const readJsonReport = (path: string): StructuredReport | null => {
  try {
    const raw = readFileSync(path)
    const sha256 = createHash('sha256').update(raw).digest('hex')
    const report = JSON.parse(raw.toString('utf8')) as VitestJson
    const headline = [
      `suites=${String(report.numTotalTestSuites ?? '?')} con fallos=${String(report.numFailedTestSuites ?? '?')}`,
      `pruebas=${String(report.numTotalTests ?? '?')} fallan=${String(report.numFailedTests ?? '?')} pasan=${String(report.numPassedTests ?? '?')} omitidas=${String(report.numPendingTests ?? '?')}`,
    ].join(' | ')

    const perFile: { file: string; failed: number }[] = []
    const failedTests: string[] = []
    for (const suite of report.testResults ?? []) {
      const failedItems = (suite.assertionResults ?? []).filter(item => item.status === 'failed')
      const file = (suite.name ?? 'desconocido')
        .replace(/\\/g, '/')
        .replace(/^.*?packages\/faberloom\//, '')
      for (const item of failedItems) failedTests.push(`${file} > ${item.fullName ?? '(sin nombre)'}`)
      if (failedItems.length > 0) perFile.push({ file, failed: failedItems.length })
    }
    perFile.sort((a, b) => b.failed - a.failed || a.file.localeCompare(b.file))
    failedTests.sort()

    const total = perFile.reduce((sum, row) => sum + row.failed, 0)
    const perFileText = [
      'pruebas fallidas por archivo (totales del archivo):',
      ...perFile.map(row => `  ${String(row.failed).padStart(4)}  ${row.file}`),
      `  ${String(total).padStart(4)}  TOTAL`,
    ].join('\n')

    return {
      headline,
      perFile: perFileText,
      extract: {
        revision_note: 'cifras del reporter JSON de vitest; el archivo crudo se descarta tras extraer y verificar su sha256',
        suites_total: report.numTotalTestSuites ?? null,
        suites_failed: report.numFailedTestSuites ?? null,
        tests_total: report.numTotalTests ?? null,
        tests_failed: report.numFailedTests ?? null,
        tests_passed: report.numPassedTests ?? null,
        tests_skipped: report.numPendingTests ?? null,
        per_file: perFile,
        failed_tests: failedTests,
        source_sha256: sha256,
        source_bytes: raw.byteLength,
      },
    }
  } catch {
    return null
  }
}

const summarize = (output: string): string => {
  const lines = output.split(/\r?\n/).filter(line => line.trim().length > 0)
  const interesting = lines.filter(line => /Test Files|Tests\s|error TS|Error:|failed|✗/i.test(line))
  const chosen = (interesting.length > 0 ? interesting : lines).slice(-6)
  return chosen.join(' | ').slice(0, 600)
}

export const runStep = (step: Step): StepResult => {
  const startedAt = Date.now()
  const result = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: step.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  })
  const durationMs = Date.now() - startedAt
  const output = `${result.stdout}\n${result.stderr}`
  const exitCode = result.status ?? -1
  const verdict: 'PASS' | 'FAIL' = exitCode === 0 ? 'PASS' : 'FAIL'
  const structured = step.jsonReport ? readJsonReport(step.jsonReport) : null
  if (step.jsonReport && structured) rmSync(step.jsonReport, { force: true })

  const result_: StepResult = {
    entry: {
      id: step.id,
      area: step.area,
      command: [step.command, ...step.args]
        .join(' ')
        .replace(repoRoot, '<repo>')
        .replace(/--outputFile=\S+/, '--outputFile=<tmp>'),
      expected: step.expected,
      observed: `exit=${String(exitCode)} en ${String(Math.round(durationMs / 1000))}s. ${structured?.headline ?? summarize(output)}`,
      verdict,
      limitation:
        verdict === 'FAIL'
          ? 'fallo registrado en el baseline sobre la revisión medida; no se corrigió dentro de O0-05'
          : `cubre solo ${step.area}; no sustituye la suite completa del monorepo`,
    },
    output,
  }
  return structured === null ? result_ : { ...result_, structured }
}

export const runBaseline = (steps: Step[] = STEPS): {
  file: BaselineFile
  logs: { id: string; tail: string; summary: string }[]
  reports: { id: string; report: StructuredReport }[]
} => {
  const results = steps.map(runStep)
  const revision = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
  return {
    file: {
      revision,
      executed_at_utc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      runtime: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        cwd: '<repo>',
      },
      entries: results.map(result => result.entry),
    },
    logs: results.map((result, index) => {
      const nonEmpty = result.output.split(/\r?\n/).filter(line => line.trim().length > 0)
      return {
        id: steps[index]?.id ?? `step-${String(index)}`,
        tail: result.output.split(/\r?\n/).slice(-400).join('\n'),
        summary: result.structured
          ? `${result.structured.headline}\n${result.structured.perFile}`
          : nonEmpty.length > 0
            ? nonEmpty.slice(-20).join('\n')
            : '(sin salida: el comando terminó sin imprimir nada)',
      }
    }),
    reports: results
      .map((result, index) => ({ id: steps[index]?.id ?? `step-${String(index)}`, report: result.structured }))
      .filter((item): item is { id: string; report: StructuredReport } => Boolean(item.report)),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const { file, logs, reports } = runBaseline()
  const logDir = resolve(repoRoot, 'docs', 'scratch', 'faberloom-daily-work', 'evidence', 'O0', 'logs')
  mkdirSync(logDir, { recursive: true })
  for (const report of reports) {
    const payload = `${JSON.stringify(report.report.extract, null, 2)}\n`
    writeFileSync(join(logDir, `${report.id}.report.json`), payload, 'utf8')
  }
  for (const log of logs) {
    writeFileSync(join(logDir, `${log.id}.log`), `${log.tail}\n`, 'utf8')
    writeFileSync(join(logDir, `${log.id}.summary.txt`), `${log.summary}\n`, 'utf8')
  }
  writeFileSync(join(here, 'baseline.json'), `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  for (const entry of file.entries) {
    process.stdout.write(`${entry.verdict} ${entry.id} ${entry.area}\n  ${entry.observed.slice(0, 300)}\n`)
  }
  process.exitCode = file.entries.every(entry => entry.verdict === 'PASS') ? 0 : 1
}
