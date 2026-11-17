/**
 * Dos validadores de estructura para el desarrollo de FaberLoom Web.
 *
 * 1. `validateEvidenceRecord`: un cierre exige observación, control positivo,
 *    control negativo, limitaciones escritas, revisión de otra persona y
 *    veredicto. Si falta uno, el estado no puede ser CLOSED.
 * 2. `validateOpencodeConfig`: la configuración de `.opencode` se lee sin
 *    comentarios, se comprueban los once agentes, los siete comandos y, sobre
 *    todo, que las denegaciones ganen donde tienen que ganar.
 *
 * Ninguno de los dos demuestra comportamiento del producto. Demuestran que la
 * evidencia y los permisos están bien formados.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Issue {
  code: string
  message: string
}

export type Effect = 'allow' | 'ask' | 'deny'

export interface Rule {
  action: string
  resource: string
  effect: Effect
}

export type ClosureState =
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'READY_ISOLATED'
  | 'READY_FOR_CEO'
  | 'CLOSED'
  | 'NOT_APPLICABLE_APPROVED'

export type Level = 'C1-L' | 'C1-E' | 'C1-I' | 'OBSERVADO_REAL'

export interface EvidenceRecord {
  contract: string
  wave: string
  revision: string
  scope: string
  level: Level
  state: ClosureState
  gate: string
  fixture: string
  commands: string[]
  expected: string
  observed: string
  positive: string
  negative: string
  limitations: string[]
  approvals: string[]
  author: string
  reviewer: string
  reviewer_verdict: 'PASS' | 'NEEDS_WORK' | ''
}

const EVIDENCE_LEVELS: Level[] = ['C1-L', 'C1-E', 'C1-I', 'OBSERVADO_REAL']
const EXECUTED_LEVELS: Level[] = ['C1-E', 'C1-I', 'OBSERVADO_REAL']
const SUSPECT_WORDS = /\b(pendiente|TODO|FIXME|no ejecutad[oa]|sin ejecutar|supuesto)\b/i

export const validateEvidenceRecord = (record: EvidenceRecord): Issue[] => {
  const issues: Issue[] = []
  const add = (code: string, message: string): void => {
    issues.push({ code, message })
  }

  for (const field of ['contract', 'wave', 'revision', 'scope', 'gate', 'author'] as const) {
    if (record[field].trim().length === 0) add('EMPTY_FIELD', `${field} vacío`)
  }
  if (!EVIDENCE_LEVELS.includes(record.level)) add('LEVEL', `nivel ${record.level} no permitido`)
  if (record.revision.length !== 40) add('REVISION', 'la revisión debe ser un SHA de 40 caracteres')

  if (EXECUTED_LEVELS.includes(record.level) && record.commands.length === 0) {
    add('NO_COMMANDS', `${record.level} exige comandos ejecutados`)
  }
  if (record.expected.trim().length === 0) add('NO_EXPECTED', 'sin resultado esperado')
  if (record.observed.trim().length === 0) add('NO_OBSERVED', 'sin observación: no se puede cerrar lo que no se observó')
  if (SUSPECT_WORDS.test(record.observed)) add('SUSPECT_OBSERVED', 'la observación contiene una palabra de trabajo pendiente')
  if (record.positive.trim().length === 0) add('NO_POSITIVE', 'sin control positivo no se distingue un backend que siempre niega')
  if (record.negative.trim().length === 0) add('NO_NEGATIVE', 'sin control negativo no se prueba el rechazo')
  if (record.limitations.length === 0) add('NO_LIMITATIONS', 'sin limitaciones escritas')

  if (record.reviewer.trim().length === 0) add('NO_REVIEWER', 'sin revisor')
  if (record.reviewer === record.author) add('SELF_REVIEW', 'el autor no se revisa a sí mismo')

  if (record.state === 'CLOSED' || record.state === 'READY_FOR_CEO') {
    if (record.reviewer_verdict !== 'PASS') add('NO_VERDICT', `${record.state} exige veredicto PASS del revisor`)
  }
  if (record.state === 'CLOSED' && record.gate.trim().length > 0 && record.gate !== 'NINGUNA' && record.approvals.length === 0) {
    add('NO_APPROVAL', `el contrato depende de ${record.gate} y no cita aprobación`)
  }
  if (record.state === 'NOT_APPLICABLE_APPROVED' && record.approvals.length === 0) {
    add('NO_APPROVAL', 'NOT_APPLICABLE_APPROVED exige decisión explícita')
  }
  if (record.state === 'BLOCKED' && record.limitations.length === 0) {
    add('NO_LIMITATIONS', 'BLOCKED exige decir qué falta')
  }
  if (record.fixture.trim().length === 0 && EXECUTED_LEVELS.includes(record.level)) {
    add('NO_FIXTURE', `${record.level} exige fixture identificado`)
  }

  return issues
}

/* ------------------------------------------------------------------ */
/* JSONC                                                               */
/* ------------------------------------------------------------------ */

export const stripJsonc = (text: string): string => {
  let out = ''
  let index = 0
  let inString = false
  let quote = ''
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (inString) {
      out += char ?? ''
      if (char === '\\') {
        out += next ?? ''
        index += 2
        continue
      }
      if (char === quote) inString = false
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      inString = true
      quote = char
      out += char
      index += 1
      continue
    }
    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1
      index += 2
      continue
    }
    out += char ?? ''
    index += 1
  }
  return out.replace(/,\s*([}\]])/g, '$1')
}

/* ------------------------------------------------------------------ */
/* Evaluador de permisos (misma semántica que OpenCode: gana la última) */
/* ------------------------------------------------------------------ */

const toRegex = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

export const matches = (pattern: string, resource: string): boolean => {
  const value = resource.replace(/\\/g, '/')
  const raw = pattern.replace(/\\/g, '/')
  if (toRegex(raw).test(value)) return true
  if (raw.endsWith(' *') && toRegex(raw.slice(0, -2)).test(value)) return true
  return false
}

export const evaluate = (rules: Rule[], action: string, resource: string): Effect => {
  let effect: Effect = 'ask'
  for (const rule of rules) {
    if (!matches(rule.action, action)) continue
    if (!matches(rule.resource, resource)) continue
    effect = rule.effect
  }
  return effect
}

export const policyDenies = (policies: Rule[], action: string, resource: string): boolean =>
  policies.some(policy => policy.effect === 'deny' && matches(policy.resource, `${action}:${resource}`))

export interface AgentConfig {
  description?: string
  mode?: string
  system?: string
  model?: string
  permissions?: Rule[]
}

export interface OpencodeConfig {
  $schema?: string
  permissions?: Rule[]
  policies?: Rule[]
  agents?: Record<string, AgentConfig>
  commands?: Record<string, { description?: string; template?: string; agent?: string; subagent?: boolean }>
}

export const EXPECTED_AGENTS = [
  'faberloom-orchestrator',
  'faberloom-architect',
  'faberloom-evidence',
  'faberloom-mail',
  'faberloom-security',
  'faberloom-ui',
  'faberloom-learning',
  'faberloom-qa',
  'faberloom-release',
  'faberloom-reviewer',
  'faberloom-docs',
]

export const EXPECTED_COMMANDS = [
  'faberloom/wave',
  'faberloom/verify',
  'faberloom/review',
  'faberloom/close',
  'faberloom/inventory',
  'faberloom/prototype',
  'faberloom/transition',
]

const REQUIRED_POLICIES = [
  ['shell', 'ssh root@example.com'],
  ['shell', 'scp archivo root@example.com:/tmp'],
  ['shell', 'rsync -a origen destino'],
  ['shell', 'docker run hello-world'],
  ['shell', 'git push origin main'],
  ['shell', 'sudo systemctl restart docker'],
  ['shell', 'rm -rf build'],
  ['shell', 'Remove-Item -Recurse build'],
  ['shell', 'curl https://example.com'],
  ['shell', 'wget https://example.com'],
  ['shell', 'Invoke-WebRequest https://example.com'],
] as const

const agentEffect = (config: OpencodeConfig, agentId: string, action: string, resource: string): Effect => {
  const rules = [...(config.permissions ?? []), ...(config.agents?.[agentId]?.permissions ?? [])]
  return evaluate(rules, action, resource)
}

export const validateOpencodeConfig = (text: string): { issues: Issue[]; config: OpencodeConfig | null } => {
  const issues: Issue[] = []
  const add = (code: string, message: string): void => {
    issues.push({ code, message })
  }

  let config: OpencodeConfig
  try {
    config = JSON.parse(stripJsonc(text)) as OpencodeConfig
  } catch (error) {
    add('PARSE', `JSONC inválido: ${(error as Error).message}`)
    return { issues, config: null }
  }

  if (config.$schema !== 'https://opencode.ai/config.json') add('SCHEMA', 'falta el $schema oficial de OpenCode V2')

  const agents = Object.keys(config.agents ?? {})
  for (const id of EXPECTED_AGENTS) {
    if (!agents.includes(id)) add('MISSING_AGENT', `falta el agente ${id}`)
  }
  for (const id of agents) {
    if (!EXPECTED_AGENTS.includes(id)) add('EXTRA_AGENT', `agente no previsto: ${id}`)
    const agent = config.agents?.[id]
    if (!agent) continue
    if (!agent.description) add('AGENT_DESCRIPTION', `${id} sin description`)
    if (!agent.system) add('AGENT_SYSTEM', `${id} sin system`)
    if (!agent.mode) add('AGENT_MODE', `${id} sin mode`)
    if (agent.model) add('AGENT_MODEL', `${id} fija modelo; los contratos heredan el de la sesión`)
    if (!agent.permissions || agent.permissions.length === 0) add('AGENT_PERMISSIONS', `${id} sin permissions`)
  }

  const commands = Object.keys(config.commands ?? {})
  for (const id of EXPECTED_COMMANDS) {
    if (!commands.includes(id)) add('MISSING_COMMAND', `falta el comando ${id}`)
  }
  for (const id of commands) {
    const command = config.commands?.[id]
    if (!command?.template) add('COMMAND_TEMPLATE', `${id} sin template`)
    if (command?.agent && !agents.includes(command.agent)) add('COMMAND_AGENT', `${id} apunta a un agente inexistente: ${command.agent}`)
  }

  for (const [action, command] of REQUIRED_POLICIES) {
    if (!policyDenies(config.policies ?? [], action, command)) {
      add('POLICY_GAP', `no hay denegación dura para \`${command}\``)
    }
  }

  if (agentEffect(config, 'faberloom-reviewer', 'edit', 'packages/faberloom/board/src/index.ts') !== 'deny') {
    add('REVIEWER_CAN_EDIT', 'el revisor puede editar producto')
  }
  if (agentEffect(config, 'faberloom-security', 'edit', 'packages/faberloom/board/src/index.ts') !== 'deny') {
    add('SECURITY_CAN_EDIT', 'seguridad puede editar producto')
  }
  if (!(config.permissions ?? []).some(rule => rule.action === 'edit' && rule.resource === '.opencode/**' && rule.effect === 'deny')) {
    add('CONFIG_RULE_MISSING', 'falta la denegación global de edición sobre .opencode/**')
  }
  for (const id of agents) {
    if (agentEffect(config, id, 'edit', '.opencode/opencode.jsonc') !== 'deny') {
      add('AGENT_CAN_EDIT_CONFIG', `${id} puede editar su propia configuración`)
    }
  }
  if (agentEffect(config, 'faberloom-qa', 'read', '.env') !== 'deny') {
    add('ENV_READABLE', 'se puede leer .env')
  }
  if (agentEffect(config, 'faberloom-qa', 'read', '.env.example') !== 'allow') {
    add('EXAMPLE_BLOCKED', '.env.example debería ser legible')
  }
  if (agentEffect(config, 'faberloom-mail', 'shell', 'git show --stat -p abc123:secreto') === 'allow') {
    add('SHOW_LEAK', 'git show con argumentos extra revela contenido sin preguntar')
  }
  if (agentEffect(config, 'faberloom-mail', 'shell', 'git diff --stat -p') === 'allow') {
    add('DIFF_LEAK', 'git diff con -p revela contenido sin preguntar')
  }
  if (agentEffect(config, 'faberloom-orchestrator', 'shell', 'git status --short') !== 'allow') {
    add('STATUS_BLOCKED', 'el orquestador no puede consultar git status')
  }

  return { issues, config }
}

const here = dirname(fileURLToPath(import.meta.url))

export const ALLOWED_STATES: ClosureState[] = [
  'PLANNED',
  'IN_PROGRESS',
  'BLOCKED',
  'READY_ISOLATED',
  'READY_FOR_CEO',
  'CLOSED',
  'NOT_APPLICABLE_APPROVED',
]

export interface EvidenceFileIssue {
  file: string
  code: string
  message: string
}

const field = (text: string, label: string): string => {
  const match = new RegExp(`${label}[^:\\n]*:\\s*([^\\n]+)`, 'i').exec(text)
  return match?.[1]?.trim() ?? ''
}

/**
 * Valida los expedientes de evidencia reales, no solo un objeto en memoria.
 *
 * Un expediente que se dice `CLOSED` sin revisor ni veredicto es exactamente el
 * cierre narrativo que el plan prohíbe. Este validador lo detecta en los archivos.
 */
export const validateEvidenceText = (file: string, text: string): EvidenceFileIssue[] => {
  const issues: EvidenceFileIssue[] = []
  const add = (code: string, message: string): void => {
    issues.push({ file, code, message })
  }

  const rawState = field(text, 'Estado').replace(/\*/g, '').trim()
  const state = rawState.split(/[\s;,(]/)[0] as ClosureState
  if (!rawState) add('NO_STATE', 'sin campo Estado')
  else if (!ALLOWED_STATES.includes(state)) add('BAD_STATE', `estado desconocido: ${rawState}`)

  const revision = field(text, 'Revisión').replace(/`/g, '').trim()
  if (!revision) add('NO_REVISION', 'sin revisión medida')
  else if (!/^[0-9a-f]{40}/i.test(revision)) add('BAD_REVISION', `revisión no identificable: ${revision.slice(0, 20)}`)

  const level = field(text, 'Nivel')
  if (!level) add('NO_LEVEL', 'sin nivel de evidencia')

  const reviewer = field(text, 'Revisor')
  const hasReviewer = reviewer.length > 0 && !/^(pendiente|ninguno|n\/d|—|-)$/i.test(reviewer)
  const verdictPass = /Veredicto:\s*PASS/i.test(text)

  if ((state === 'CLOSED' || state === 'READY_FOR_CEO') && !hasReviewer) {
    add('CLOSED_WITHOUT_REVIEWER', `${state} sin revisor independiente`)
  }
  if ((state === 'CLOSED' || state === 'READY_FOR_CEO') && !verdictPass) {
    add('CLOSED_WITHOUT_VERDICT', `${state} sin veredicto PASS`)
  }
  if (state === 'CLOSED' && /Revisor:\s*pendiente/i.test(text)) {
    add('CLOSED_WITH_PENDING_REVIEW', 'CLOSED con la revisión pendiente')
  }

  return issues
}

export const validateEvidenceDirectory = (
  files: { path: string; text: string }[],
  statusByContract: Record<string, string> = {},
): EvidenceFileIssue[] => {
  const issues = files.flatMap(file => validateEvidenceText(file.path, file.text))
  for (const file of files) {
    const contract = /FM-([A-Z0-9-]+)\.md$/.exec(file.path)?.[1]
    if (!contract) continue
    const declared = statusByContract[contract]
    if (!declared) {
      issues.push({ file: file.path, code: 'NOT_IN_DASHBOARD', message: `${contract} no aparece en f0-status.md` })
      continue
    }
    const own = field(file.text, 'Estado').replace(/\*/g, '').split(/[\s;,(]/)[0]
    if (own !== declared) {
      issues.push({
        file: file.path,
        code: 'STATE_DRIFT',
        message: `el expediente dice ${own} y f0-status.md dice ${declared}`,
      })
    }
  }
  return issues
}

export const parseDashboardStates = (markdown: string): Record<string, string> => {
  const states: Record<string, string> = {}
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\|\s*(O[0-9A-C]+-\d+[A-C]?)\s*\|[^|]*\|\s*\**\s*([A-Z_]+)\s*\**\s*\|/.exec(line)
    if (match?.[1] && match[2]) states[match[1]] = match[2]
  }
  return states
}

const isMain = (): boolean => {
  const entry = process.argv[1]
  if (!entry) return false
  return resolve(entry) === resolve(fileURLToPath(import.meta.url))
}

if (isMain()) {
  const repoRoot = resolve(here, '..', '..')
  const text = readFileSync(join(repoRoot, '.opencode', 'opencode.jsonc'), 'utf8')
  const { issues, config } = validateOpencodeConfig(text)
  const agentCount = Object.keys(config?.agents ?? {}).length
  const commandCount = Object.keys(config?.commands ?? {}).length
  const status = issues.length === 0 ? 'PASS' : 'FAIL'
  process.stdout.write(`${status} configuracion\n  agents=${String(agentCount)} commands=${String(commandCount)}\n`)
  for (const issue of issues) process.stdout.write(`  [${issue.code}] ${issue.message}\n`)

  const evidenceRoot = join(repoRoot, 'docs', 'scratch', 'faberloom-daily-work', 'evidence')
  const dashboardPath = join(repoRoot, 'docs', 'scratch', 'faberloom-daily-work', 'f0-status.md')
  let dashboardStates: Record<string, string> = {}
  try {
    dashboardStates = parseDashboardStates(readFileSync(dashboardPath, 'utf8'))
  } catch {
    dashboardStates = {}
  }
  const evidenceFiles: { path: string; text: string }[] = []
  for (const wave of ['O0', 'O1']) {
    const dir = join(evidenceRoot, wave)
    let entries: string[] = []
    try {
      entries = readdirSync(dir).filter(name => name.endsWith('.md'))
    } catch {
      entries = []
    }
    for (const name of entries.sort()) {
      evidenceFiles.push({ path: `${wave}/${name}`, text: readFileSync(join(dir, name), 'utf8') })
    }
  }
  const evidenceIssues = validateEvidenceDirectory(evidenceFiles, dashboardStates)
  process.stdout.write(
    `${evidenceIssues.length === 0 ? 'PASS' : 'FAIL'} evidencia\n  files=${String(evidenceFiles.length)} issues=${String(evidenceIssues.length)}\n`,
  )
  for (const issue of evidenceIssues) process.stdout.write(`  [${issue.code}] ${issue.file}: ${issue.message}\n`)

  process.exitCode = issues.length === 0 && evidenceIssues.length === 0 ? 0 : 1
}
