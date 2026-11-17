/**
 * Validador de la matriz de requisitos de FaberLoom Web.
 *
 * Comprueba dos cosas distintas y no las mezcla:
 *  1. Que el modelo de requisitos esté completo y sin duplicados (T, reglas, R2, A, gates, precisiones).
 *  2. Que los documentos `todo.md` y `file-map.md` no se hayan separado del modelo:
 *     cada contrato tiene entrada en el mapa, cada entrada tiene contrato y ningún
 *     contrato excede los cinco archivos nuevos permitidos.
 *
 * No ejecuta pruebas de producto ni declara cierres. Un PASS aquí significa
 * "la matriz es coherente", no "el requisito está cumplido".
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

export interface Contract {
  id: string
  agent: string
  wave: string
}

export interface Part {
  id: string
  wave: string
  gate: string
}

export interface Case {
  id: string
  name: string
  owner: string
  level: string
  global_gate: string
  parts: Part[]
}

export interface Rule {
  id: string
  name: string
  waves: string[]
  owner: string
  gate: string
}

export interface Precision {
  id: string
  name: string
  owner: string
  gate: string
}

export interface Appearance {
  id: string
  name: string
  owner: string
  gates: string[]
}

export interface HumanGate {
  id: string
  wave: string
  decides: string
}

export interface RatifiedPrecision {
  id: string
  declared: boolean
  declared_at: string
  record: string
  signed: boolean
  signed_at?: string
  decides: string
}

export interface PlanModel {
  schema_version: number
  revision: string
  waves: string[]
  contracts: Contract[]
  cases: Case[]
  rules: Rule[]
  precisiones: Precision[]
  appearance: Appearance[]
  human_gates: HumanGate[]
  precisions: RatifiedPrecision[]
}

export interface OwnerAgent {
  contract: string
  writes: string[]
  reviewer: string
  may_approve: boolean
}

export interface OwnersFile {
  agents: Record<string, OwnerAgent>
  external_approver: { id: string; may_approve: boolean; scope: string }
}

export interface BaselineEntry {
  id: string
  area: string
  command: string
  expected: string
  observed: string
  verdict: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN'
  limitation: string
}

export interface BaselineFile {
  revision: string
  executed_at_utc: string
  runtime: Record<string, string>
  entries: BaselineEntry[]
}

export interface Issue {
  code: string
  message: string
}

export interface Result {
  ok: boolean
  issues: Issue[]
  stats: Record<string, number>
}

const ALLOWED_LEVELS = ['C1-L', 'C1-E', 'C1-I', 'C2', 'C3', 'OBSERVADO_REAL']
const REQUIRED_HUMAN_GATES = [
  'PC1',
  'PC2',
  'PC3',
  'PC4',
  'PC5-M',
  'PC5-A',
  'E4',
  'SEMANA',
  'PC6',
  'N3',
  'N9',
  'DC-1',
  'DC-3',
  'DC-4',
]
const MAX_FILES_PER_CONTRACT = 5

const push = (issues: Issue[], code: string, message: string): void => {
  issues.push({ code, message })
}

const duplicates = (ids: string[]): string[] => {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) dup.add(id)
    seen.add(id)
  }
  return [...dup]
}

const range = (prefix: string, from: number, to: number, style: 'plain' | 'r2'): string[] => {
  const out: string[] = []
  for (let i = from; i <= to; i += 1) {
    out.push(style === 'plain' ? `${prefix}${i}` : `${prefix}-${i}`)
  }
  return out
}

const sameSet = (actual: string[], expected: string[], label: string, issues: Issue[]): void => {
  const a = new Set(actual)
  for (const id of expected) {
    if (!a.has(id)) push(issues, 'MISSING_ID', `${label}: falta ${id}`)
  }
  for (const id of a) {
    if (!expected.includes(id)) push(issues, 'UNKNOWN_ID', `${label}: ${id} no pertenece al conjunto esperado`)
  }
}

export const validateModel = (model: PlanModel, owners: OwnersFile): Result => {
  const issues: Issue[] = []
  const agents = owners.agents

  if (model.schema_version !== 1) push(issues, 'SCHEMA', `schema_version inesperada: ${String(model.schema_version)}`)
  if (!model.revision || model.revision.length !== 40) push(issues, 'REVISION', 'revision debe ser un SHA de 40 caracteres')

  const waveIds = model.waves
  if (waveIds.length === 0) push(issues, 'WAVES', 'no hay olas declaradas')
  for (const dup of duplicates(waveIds)) push(issues, 'DUPLICATE_WAVE', `ola duplicada: ${dup}`)

  const contractIds = model.contracts.map(c => c.id)
  for (const dup of duplicates(contractIds)) push(issues, 'DUPLICATE_CONTRACT', `contrato duplicado: ${dup}`)
  for (const contract of model.contracts) {
    if (!agents[contract.agent]) push(issues, 'UNKNOWN_AGENT', `${contract.id}: agente ${contract.agent} no existe en owners.json`)
  }

  const caseIds = model.cases.map(c => c.id)
  for (const dup of duplicates(caseIds)) push(issues, 'DUPLICATE_CASE', `caso duplicado: ${dup}`)
  sameSet(caseIds, range('T', 1, 25, 'plain'), 'casos', issues)

  const partIds: string[] = []
  for (const testCase of model.cases) {
    if (testCase.parts.length === 0) push(issues, 'NO_PARTS', `${testCase.id} no tiene partes`)
    if (!ALLOWED_LEVELS.includes(testCase.level)) {
      push(issues, 'LEVEL', `${testCase.id}: nivel ${testCase.level} no permitido`)
    }
    if (testCase.level === 'C3' && /PC[3-6]|E4|SEMANA|PC5/.test(testCase.global_gate)) {
      push(issues, 'C3_ON_GATE', `${testCase.id}: C3 no puede sostener ${testCase.global_gate}`)
    }
    if (!agents[testCase.owner]) push(issues, 'UNKNOWN_OWNER', `${testCase.id}: owner ${testCase.owner} no existe`)
    for (const part of testCase.parts) {
      partIds.push(part.id)
      if (!waveIds.includes(part.wave)) push(issues, 'UNKNOWN_WAVE', `${part.id}: ola ${part.wave} no declarada`)
      if (!part.gate) push(issues, 'NO_GATE', `${part.id}: sin gate`)
    }
  }
  for (const dup of duplicates(partIds)) push(issues, 'DUPLICATE_PART', `parte duplicada: ${dup}`)

  const ruleIds = model.rules.map(r => r.id)
  for (const dup of duplicates(ruleIds)) push(issues, 'DUPLICATE_RULE', `regla duplicada: ${dup}`)
  sameSet(ruleIds, range('', 1, 35, 'plain'), 'reglas', issues)
  for (const rule of model.rules) {
    if (!agents[rule.owner]) push(issues, 'UNKNOWN_OWNER', `regla ${rule.id}: owner ${rule.owner} no existe`)
    if (rule.waves.length === 0) push(issues, 'RULE_NO_WAVE', `regla ${rule.id} sin ola`)
  }

  const precisionIds = model.precisiones.map(p => p.id)
  for (const dup of duplicates(precisionIds)) push(issues, 'DUPLICATE_R2', `R2 duplicada: ${dup}`)
  sameSet(precisionIds, range('R2', 1, 18, 'r2'), 'R2', issues)
  for (const precision of model.precisiones) {
    if (!agents[precision.owner]) push(issues, 'UNKNOWN_OWNER', `${precision.id}: owner ${precision.owner} no existe`)
  }

  const appearanceIds = model.appearance.map(a => a.id)
  for (const dup of duplicates(appearanceIds)) push(issues, 'DUPLICATE_A', `A duplicada: ${dup}`)
  sameSet(appearanceIds, range('A', 1, 9, 'plain'), 'apariencia', issues)
  for (const item of model.appearance) {
    if (item.gates.length === 0) push(issues, 'A_NO_GATE', `${item.id} sin gate`)
    if (!agents[item.owner]) push(issues, 'UNKNOWN_OWNER', `${item.id}: owner ${item.owner} no existe`)
  }

  const gateIds = model.human_gates.map(g => g.id)
  for (const dup of duplicates(gateIds)) push(issues, 'DUPLICATE_GATE', `gate duplicado: ${dup}`)
  sameSet(gateIds, REQUIRED_HUMAN_GATES, 'gates humanos', issues)
  for (const gate of model.human_gates) {
    if (!waveIds.includes(gate.wave)) push(issues, 'UNKNOWN_WAVE', `${gate.id}: ola ${gate.wave} no declarada`)
  }

  const ratifiedIds = model.precisions.map(p => p.id)
  for (const dup of duplicates(ratifiedIds)) push(issues, 'DUPLICATE_PREC', `precisión duplicada: ${dup}`)
  sameSet(ratifiedIds, range('PREC-0', 1, 6, 'plain'), 'precisiones', issues)
  for (const precision of model.precisions) {
    if (!precision.declared) push(issues, 'NOT_DECLARED', `${precision.id} sin declaración expresa del CEO`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(precision.declared_at)) push(issues, 'BAD_DATE', `${precision.id}: fecha inválida`)
    if (precision.record.trim().length === 0) {
      push(issues, 'NO_RECORD', `${precision.id} sin registro de custodia en decisions/`)
    }
    if (precision.signed && !/^\d{4}-\d{2}-\d{2}$/.test(precision.signed_at ?? '')) {
      push(issues, 'FAKE_SIGNATURE', `${precision.id} se declara firmada sin fecha de firma`)
    }
  }

  for (const [agentId, agent] of Object.entries(agents)) {
    if (!contractIds.includes(agent.contract)) push(issues, 'OWNER_CONTRACT', `${agentId}: contrato ${agent.contract} no existe`)
    if (!agents[agent.reviewer] && agent.reviewer !== owners.external_approver.id) {
      push(issues, 'UNKNOWN_REVIEWER', `${agentId}: revisor ${agent.reviewer} no existe`)
    }
    if (agentId === agent.reviewer) push(issues, 'SELF_REVIEW', `${agentId} se revisa a sí mismo`)
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: {
      waves: waveIds.length,
      contracts: contractIds.length,
      cases: caseIds.length,
      parts: partIds.length,
      rules: ruleIds.length,
      precisiones: precisionIds.length,
      appearance: appearanceIds.length,
      human_gates: gateIds.length,
      precisions: ratifiedIds.length,
      agents: Object.keys(agents).length,
    },
  }
}

const contractRows = (todo: string): Map<string, { check: string; files: string }> => {
  const rows = new Map<string, { check: string; files: string }>()
  for (const line of todo.split(/\r?\n/)) {
    const match = /^\|\s*\[[ x]\]\s*(O[0-9A-C]+-\d+[A-C]?)\s*\|([^|]*)\|([^|]*)\|/.exec(line)
    if (!match) continue
    const check = (match[1] ?? '').trim()
    const files = (match[3] ?? '').trim()
    const fm = /FM-[A-Z0-9-]+/.exec(files)
    if (!fm) continue
    rows.set(fm[0], { check, files })
  }
  return rows
}

const fileMapRows = (fileMap: string): Map<string, string[]> => {
  const rows = new Map<string, string[]>()
  for (const line of fileMap.split(/\r?\n/)) {
    const match = /^\|\s*(FM-[A-Z0-9-]+)\s*\|([^|]*)\|([^|]*)\|/.exec(line)
    if (!match) continue
    const fm = match[1] ?? ''
    const created = match[3] ?? ''
    const paths = [...created.matchAll(/`([^`]+)`/g)].map(m => (m[1] ?? '').trim()).filter(Boolean)
    rows.set(fm, paths)
  }
  return rows
}

export const validateDocs = (todo: string, fileMap: string): Result => {
  const issues: Issue[] = []
  const contracts = contractRows(todo)
  const map = fileMapRows(fileMap)

  if (contracts.size === 0) push(issues, 'NO_CONTRACTS', 'todo.md no declara contratos legibles')
  if (map.size === 0) push(issues, 'NO_FILEMAP', 'file-map.md no declara contratos legibles')

  for (const fm of contracts.keys()) {
    if (!map.has(fm)) push(issues, 'FM_WITHOUT_MAP', `${fm} aparece en todo.md y no en file-map.md`)
  }
  for (const [fm, paths] of map) {
    if (!contracts.has(fm)) push(issues, 'MAP_WITHOUT_CONTRACT', `${fm} aparece en file-map.md y no en todo.md`)
    if (paths.length > MAX_FILES_PER_CONTRACT) {
      push(issues, 'TOO_MANY_FILES', `${fm} declara ${String(paths.length)} archivos nuevos; el máximo es ${String(MAX_FILES_PER_CONTRACT)}`)
    }
  }

  const waves = new Set([...contracts.keys()].map(fm => fm.split('-')[1]))
  for (const wave of ['O0', 'O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8A', 'O8B', 'O8C', 'O9', 'O10', 'O11']) {
    if (!waves.has(wave)) push(issues, 'WAVE_WITHOUT_CONTRACT', `la ola ${wave} no tiene contratos en todo.md`)
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: { contracts_in_todo: contracts.size, contracts_in_map: map.size, waves: waves.size },
  }
}

export const validateBaseline = (baseline: BaselineFile, expectedRevision: string): Result => {
  const issues: Issue[] = []
  if (baseline.revision !== expectedRevision) {
    push(issues, 'BASELINE_REVISION', `baseline.json mide ${baseline.revision} y el modelo declara ${expectedRevision}`)
  }
  if (baseline.entries.length === 0) push(issues, 'BASELINE_EMPTY', 'baseline sin entradas')
  for (const entry of baseline.entries) {
    if (!entry.id) push(issues, 'BASELINE_ID', 'entrada sin id')
    if (!entry.expected) push(issues, 'BASELINE_EXPECTED', `${entry.id}: sin resultado esperado`)
    if (entry.verdict !== 'NOT_RUN' && !entry.observed) {
      push(issues, 'BASELINE_OBSERVED', `${entry.id}: veredicto ${entry.verdict} sin observación`)
    }
    if (entry.verdict === 'PASS' && entry.observed.length === 0) {
      push(issues, 'BASELINE_FAKE_PASS', `${entry.id}: PASS sin observación es un pase inventado`)
    }
    if ((entry.verdict === 'FAIL' || entry.verdict === 'BLOCKED') && entry.limitation.trim().length === 0) {
      push(issues, 'BASELINE_LIMITATION', `${entry.id}: ${entry.verdict} exige limitación escrita`)
    }
  }
  return { ok: issues.length === 0, issues, stats: { entries: baseline.entries.length } }
}

const readText = (path: string): string => readFileSync(path, 'utf8')

const here = dirname(fileURLToPath(import.meta.url))

export interface CliOptions {
  scriptsDir: string
  docsDir: string | null
}

export const loadAndValidate = (options: CliOptions): { model: Result; docs: Result | null; baseline: Result | null } => {
  const model = JSON.parse(readText(join(options.scriptsDir, 'requirements.json'))) as PlanModel
  const owners = JSON.parse(readText(join(options.scriptsDir, 'owners.json'))) as OwnersFile
  const modelResult = validateModel(model, owners)

  let docsResult: Result | null = null
  if (options.docsDir) {
    const todo = readFileSync(join(options.docsDir, 'todo.md'), 'utf8')
    const fileMap = readFileSync(join(options.docsDir, 'file-map.md'), 'utf8')
    docsResult = validateDocs(todo, fileMap)
  }

  let baselineResult: Result | null = null
  try {
    const baseline = JSON.parse(readText(join(options.scriptsDir, 'baseline.json'))) as BaselineFile
    baselineResult = validateBaseline(baseline, model.revision)
  } catch {
    baselineResult = null
  }

  return { model: modelResult, docs: docsResult, baseline: baselineResult }
}

const render = (label: string, result: Result): string => {
  const head = `${result.ok ? 'PASS' : 'FAIL'} ${label}`
  const stats = Object.entries(result.stats).map(([k, v]) => `${k}=${String(v)}`).join(' ')
  const body = result.issues.map(i => `  [${i.code}] ${i.message}`).join('\n')
  return `${head}\n  ${stats}${body ? `\n${body}` : ''}`
}

const isMain = (): boolean => {
  const entry = process.argv[1]
  if (!entry) return false
  return resolve(entry) === resolve(fileURLToPath(import.meta.url))
}

if (isMain()) {
  const repoRoot = resolve(here, '..', '..')
  const docsDir = process.argv.includes('--no-docs') ? null : resolve(repoRoot, '..', 'FaberLoom_tarea_2026-11-16', 'tasks')
  const { model, docs, baseline } = loadAndValidate({ scriptsDir: here, docsDir })
  const parts = [render('modelo', model)]
  if (docs) parts.push(render('documentos', docs))
  if (baseline) parts.push(render('baseline', baseline))
  process.stdout.write(`${parts.join('\n')}\n`)
  const failed = !model.ok || (docs !== null && !docs.ok) || (baseline !== null && !baseline.ok)
  process.exitCode = failed ? 1 : 0
}
