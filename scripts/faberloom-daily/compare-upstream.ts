/**
 * Diagnóstico read-only de la relación entre el fork FaberLoom y el upstream
 * de deepseek-harness.
 *
 * No hace fetch, no escribe, no cambia ramas. Solo lee referencias locales y
 * responde tres preguntas: cuál es la base común, cuánto se separó el fork y
 * en qué áreas vive esa separación. Si falta un objeto, lo dice en vez de
 * estimar el número.
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export interface AreaCount {
  area: string
  files: number
}

export interface UpstreamReport {
  repo: string
  head: string
  branch: string
  upstreamRef: string
  upstreamSha: string | null
  mergeBase: string | null
  ahead: number | null
  behind: number | null
  dirty: boolean
  changedFiles: number
  insertions: number
  deletions: number
  byArea: AreaCount[]
  missingObject: string | null
  limitations: string[]
}

export interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
}

export type GitRunner = (args: string[]) => GitResult

const AREA_RULES: { area: string; prefix: string }[] = [
  { area: 'core', prefix: 'packages/core/' },
  { area: 'faberloom', prefix: 'packages/faberloom/' },
  { area: 'client', prefix: 'packages/client/' },
  { area: 'apps', prefix: 'apps/' },
  { area: 'gateway', prefix: 'gateway/' },
  { area: 'scripts', prefix: 'scripts/' },
  { area: 'docs', prefix: 'docs/' },
  { area: 'deploy', prefix: 'deploy/' },
  { area: 'website', prefix: 'website/' },
  { area: 'native', prefix: 'native/' },
  { area: 'packages', prefix: 'packages/' },
]

export const classifyPath = (path: string): string => {
  const normalized = path.replace(/\\/g, '/')
  for (const rule of AREA_RULES) {
    if (normalized.startsWith(rule.prefix)) return rule.area
  }
  const top = normalized.split('/')[0]
  return top && top.length > 0 ? `raiz:${top}` : 'desconocido'
}

export const classifyPaths = (paths: string[]): AreaCount[] => {
  const counts = new Map<string, number>()
  for (const path of paths) {
    const area = classifyPath(path)
    counts.set(area, (counts.get(area) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([area, files]) => ({ area, files }))
    .sort((a, b) => b.files - a.files || a.area.localeCompare(b.area))
}

export const parseNumstat = (numstat: string): { changedFiles: number; insertions: number; deletions: number; paths: string[] } => {
  let insertions = 0
  let deletions = 0
  const paths: string[] = []
  for (const line of numstat.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    const [added, removed, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (!path) continue
    paths.push(path)
    insertions += Number.parseInt(added ?? '0', 10) || 0
    deletions += Number.parseInt(removed ?? '0', 10) || 0
  }
  return { changedFiles: paths.length, insertions, deletions, paths }
}

export const toMarkdown = (report: UpstreamReport): string => {
  const lines = [
    '# Relación con el upstream',
    '',
    `- Repositorio: \`${report.repo}\``,
    `- HEAD: \`${report.head}\` en \`${report.branch}\``,
    `- Referencia upstream: \`${report.upstreamRef}\` = \`${report.upstreamSha ?? 'ausente'}\``,
    `- Base común: \`${report.mergeBase ?? 'no calculable'}\``,
    `- Separación: ${report.ahead === null ? 'desconocida' : `${String(report.ahead)} commits por delante`}; ${report.behind === null ? 'desconocida' : `${String(report.behind)} por detrás`}`,
    `- Árbol de trabajo: ${report.dirty ? 'con cambios sin confirmar' : 'limpio'}`,
    `- Diferencia: ${String(report.changedFiles)} archivos, +${String(report.insertions)} / -${String(report.deletions)}`,
    '',
    '| Área | Archivos |',
    '|---|---:|',
    ...report.byArea.map(row => `| ${row.area} | ${String(row.files)} |`),
  ]
  if (report.missingObject) lines.push('', `- Objeto histórico ausente: \`${report.missingObject}\``)
  if (report.limitations.length > 0) {
    lines.push('', '## Limitaciones', '', ...report.limitations.map(item => `- ${item}`))
  }
  return lines.join('\n')
}

const makeRunner = (cwd: string): GitRunner => (args: string[]) => {
  try {
    const stdout = execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, stdout, stderr: '' }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string }
    return { ok: false, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

const int = (value: string): number | null => {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) ? parsed : null
}

export const inspectUpstream = (
  repo: string,
  options: { upstreamRef?: string; historicalObject?: string; run?: GitRunner } = {},
): UpstreamReport => {
  const run = options.run ?? makeRunner(repo)
  const upstreamRef = options.upstreamRef ?? 'origin/master'
  const limitations: string[] = []

  const head = run(['rev-parse', 'HEAD']).stdout.trim()
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
  const status = run(['status', '--porcelain']).stdout.trim()
  const upstreamShaRaw = run(['rev-parse', '--verify', '--quiet', upstreamRef])
  const upstreamSha = upstreamShaRaw.ok ? upstreamShaRaw.stdout.trim() : null
  if (!upstreamSha) limitations.push(`la referencia ${upstreamRef} no existe localmente; no se hizo fetch`)

  let mergeBase: string | null = null
  let ahead: number | null = null
  let behind: number | null = null
  if (upstreamSha) {
    const base = run(['merge-base', 'HEAD', upstreamRef])
    mergeBase = base.ok ? base.stdout.trim() : null
    const counts = run(['rev-list', '--left-right', '--count', `${upstreamRef}...HEAD`])
    if (counts.ok) {
      const [left, right] = counts.stdout.trim().split(/\s+/)
      behind = int(left ?? '')
      ahead = int(right ?? '')
    } else {
      limitations.push('no se pudo contar la separación con rev-list')
    }
  }

  let changedFiles = 0
  let insertions = 0
  let deletions = 0
  let byArea: AreaCount[] = []
  if (upstreamSha) {
    const numstat = run(['diff', '--numstat', `${upstreamRef}...HEAD`])
    if (numstat.ok) {
      const parsed = parseNumstat(numstat.stdout)
      changedFiles = parsed.changedFiles
      insertions = parsed.insertions
      deletions = parsed.deletions
      byArea = classifyPaths(parsed.paths)
    } else {
      limitations.push('no se pudo obtener el numstat del diff')
    }
  }

  let missingObject: string | null = null
  if (options.historicalObject) {
    const exists = run(['cat-file', '-e', `${options.historicalObject}^{commit}`])
    if (!exists.ok) {
      missingObject = options.historicalObject
      limitations.push(`el objeto ${options.historicalObject} no está disponible localmente; los conteos antiguos no se reproducen`)
    }
  }

  if (behind !== null && behind > 0) {
    limitations.push('el fork está por detrás del upstream; la base común no es el HEAD del upstream')
  }

  return {
    repo,
    head,
    branch,
    upstreamRef,
    upstreamSha,
    mergeBase,
    ahead,
    behind,
    dirty: status.length > 0,
    changedFiles,
    insertions,
    deletions,
    byArea,
    missingObject,
    limitations,
  }
}

const isMain = (): boolean => {
  const entry = process.argv[1]
  if (!entry) return false
  return resolve(entry) === resolve(fileURLToPath(import.meta.url))
}

if (isMain()) {
  const repo = process.argv[2] ?? resolve(fileURLToPath(import.meta.url), '..', '..', '..')
  const report = inspectUpstream(repo, { historicalObject: '39163dd30f703a79079e2d2446545cff3c453738' })
  process.stdout.write(`${toMarkdown(report)}\n`)
}
