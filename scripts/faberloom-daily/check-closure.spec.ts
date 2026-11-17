import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  evaluate,
  matches,
  parseDashboardStates,
  policyDenies,
  stripJsonc,
  validateEvidenceDirectory,
  validateEvidenceRecord,
  validateEvidenceText,
  validateOpencodeConfig,
  type EvidenceRecord,
  type OpencodeConfig,
} from './check-closure.ts'

const here = dirname(fileURLToPath(import.meta.url))
const configText = readFileSync(resolve(here, '..', '..', '.opencode', 'opencode.jsonc'), 'utf8')
const parsed = JSON.parse(stripJsonc(configText)) as OpencodeConfig
const clone = (): OpencodeConfig => structuredClone(parsed)

const codes = (items: { code: string }[]): string[] => items.map(i => i.code)

describe('JSONC', () => {
  it('quita comentarios de línea y bloque, y comas finales', () => {
    const text = '{\n  // comentario\n  "a": 1, /* bloque */\n  "b": [1, 2,],\n}\n'
    expect(JSON.parse(stripJsonc(text))).toEqual({ a: 1, b: [1, 2] })
  })

  it('no rompe una cadena que contiene //', () => {
    const text = '{ "url": "https://opencode.ai/config.json" }'
    expect(JSON.parse(stripJsonc(text))).toEqual({ url: 'https://opencode.ai/config.json' })
  })
})

describe('semántica de permisos', () => {
  it('gana la última coincidencia', () => {
    const rules = [
      { action: 'shell', resource: 'git *', effect: 'ask' as const },
      { action: 'shell', resource: 'git status *', effect: 'allow' as const },
    ]
    expect(evaluate(rules, 'shell', 'git status --short')).toBe('allow')
    expect(evaluate(rules, 'shell', 'git push origin main')).toBe('ask')
  })

  it('un patrón con " *" final también cubre la invocación sin argumentos', () => {
    expect(matches('git status *', 'git status')).toBe(true)
    expect(matches('git status *', 'git status --short')).toBe(true)
    expect(matches('git status *', 'git statusx')).toBe(false)
  })

  it('un patrón exacto no cubre argumentos añadidos', () => {
    expect(matches('git show --stat HEAD', 'git show --stat -p HEAD')).toBe(false)
    expect(matches('git diff --stat', 'git diff --stat -p')).toBe(false)
  })

  it('sin coincidencia el efecto por defecto es ask', () => {
    expect(evaluate([], 'shell', 'cualquier cosa')).toBe('ask')
  })

  it('la política dura deniega aunque exista un allow previo', () => {
    const policies = [{ action: 'tool.use', resource: 'shell:ssh *', effect: 'deny' as const }]
    expect(policyDenies(policies, 'shell', 'ssh root@host-de-ejemplo')).toBe(true)
    expect(policyDenies(policies, 'shell', 'git status')).toBe(false)
  })
})

describe('configuración real de .opencode', () => {
  it('declara once agentes, siete comandos y todas las denegaciones', () => {
    const { issues, config } = validateOpencodeConfig(configText)
    expect(issues).toEqual([])
    expect(Object.keys(config?.agents ?? {})).toHaveLength(11)
    expect(Object.keys(config?.commands ?? {})).toHaveLength(7)
  })

  it('rechaza un agente que fija modelo', () => {
    const broken = clone()
    const agent = broken.agents?.['faberloom-mail']
    if (!agent) throw new Error('faberloom-mail debe existir')
    agent.model = 'deepseek/deepseek-chat'
    expect(codes(validateOpencodeConfig(JSON.stringify(broken)).issues)).toContain('AGENT_MODEL')
  })

  it('rechaza que el revisor pueda editar', () => {
    const broken = clone()
    const reviewer = broken.agents?.['faberloom-reviewer']
    if (!reviewer) throw new Error('faberloom-reviewer debe existir')
    reviewer.permissions = (reviewer.permissions ?? []).filter(rule => !(rule.action === 'edit' && rule.resource === '*'))
    expect(codes(validateOpencodeConfig(JSON.stringify(broken)).issues)).toContain('REVIEWER_CAN_EDIT')
  })

  it('rechaza que un agente edite .opencode', () => {
    const broken = clone()
    broken.permissions = (broken.permissions ?? []).filter(rule => !(rule.action === 'edit' && rule.resource === '.opencode/**'))
    expect(codes(validateOpencodeConfig(JSON.stringify(broken)).issues)).toContain('CONFIG_RULE_MISSING')
  })

  it('rechaza que un agente se conceda edición de .opencode', () => {
    const broken = clone()
    const mail = broken.agents?.['faberloom-mail']
    if (!mail) throw new Error('faberloom-mail debe existir')
    mail.permissions = [...(mail.permissions ?? []), { action: 'edit', resource: '.opencode/**', effect: 'allow' }]
    expect(codes(validateOpencodeConfig(JSON.stringify(broken)).issues)).toContain('AGENT_CAN_EDIT_CONFIG')
  })

  it('rechaza exponer .env', () => {
    const broken = clone()
    broken.permissions = (broken.permissions ?? []).filter(rule => !(rule.action === 'read' && rule.resource === '*.env'))
    expect(codes(validateOpencodeConfig(JSON.stringify(broken)).issues)).toContain('ENV_READABLE')
  })

  it('rechaza permitir git show con argumentos extra', () => {
    const broken = clone()
    const mail = broken.agents?.['faberloom-mail']
    if (!mail) throw new Error('faberloom-mail debe existir')
    mail.permissions = [...(mail.permissions ?? []), { action: 'shell', resource: 'git show *', effect: 'allow' }]
    expect(codes(validateOpencodeConfig(JSON.stringify(broken)).issues)).toContain('SHOW_LEAK')
  })

  it('rechaza un comando sin template', () => {
    const broken = clone()
    const command = broken.commands?.['faberloom/close']
    if (!command) throw new Error('el comando de cierre debe existir')
    delete command.template
    expect(codes(validateOpencodeConfig(JSON.stringify(broken)).issues)).toContain('COMMAND_TEMPLATE')
  })

  it('rechaza un comando que apunta a un agente inexistente', () => {
    const broken = clone()
    const command = broken.commands?.['faberloom/wave']
    if (!command) throw new Error('el comando de ola debe existir')
    command.agent = 'faberloom-inexistente'
    expect(codes(validateOpencodeConfig(JSON.stringify(broken)).issues)).toContain('COMMAND_AGENT')
  })

  it('rechaza un agente ausente', () => {
    const broken = clone()
    delete broken.agents?.['faberloom-learning']
    expect(codes(validateOpencodeConfig(JSON.stringify(broken)).issues)).toContain('MISSING_AGENT')
  })

  it('rechaza un JSONC inválido', () => {
    const result = validateOpencodeConfig('{ esto no es json }')
    expect(codes(result.issues)).toContain('PARSE')
    expect(result.config).toBeNull()
  })
})

describe('expedientes de evidencia reales', () => {
  const header = (estado: string, revisor: string): string =>
    [
      '# FM-X',
      '- Contrato: C-FL-07 · Ola O0',
      '- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d`',
      '- Nivel: C1-E',
      `- Estado: **${estado}**`,
      '- Gate: PC1',
      `- Autor: faberloom-qa · Revisor: ${revisor}`,
    ].join('\n')

  it('acepta un expediente bloqueado sin revisor', () => {
    expect(validateEvidenceText('O0/FM-X.md', header('BLOCKED', 'pendiente'))).toEqual([])
  })

  it('rechaza CLOSED con la revisión pendiente', () => {
    const codes = validateEvidenceText('O0/FM-X.md', header('CLOSED', 'pendiente')).map(i => i.code)
    expect(codes).toContain('CLOSED_WITHOUT_REVIEWER')
    expect(codes).toContain('CLOSED_WITHOUT_VERDICT')
    expect(codes).toContain('CLOSED_WITH_PENDING_REVIEW')
  })

  it('acepta CLOSED con revisor y veredicto', () => {
    const text = `${header('CLOSED', 'faberloom-reviewer')}\n- Veredicto: PASS`
    expect(validateEvidenceText('O0/FM-X.md', text)).toEqual([])
  })

  it('rechaza un expediente sin estado', () => {
    const text = header('BLOCKED', 'pendiente').replace(/- Estado:.*\n/, '')
    expect(validateEvidenceText('O0/FM-X.md', text).map(i => i.code)).toContain('NO_STATE')
  })

  it('rechaza una revisión no identificable', () => {
    const text = header('READY_ISOLATED', 'pendiente').replace('0b01ca39365ba04fe89858bcac56e3523896ee4d', 'HEAD')
    expect(validateEvidenceText('O0/FM-X.md', text).map(i => i.code)).toContain('BAD_REVISION')
  })

  it('rechaza un expediente sin revisión', () => {
    const text = header('READY_ISOLATED', 'pendiente').replace(/- Revisión:.*\n/, '')
    expect(validateEvidenceText('O0/FM-X.md', text).map(i => i.code)).toContain('NO_REVISION')
  })

  it('rechaza READY_FOR_CEO sin veredicto', () => {
    const text = header('READY_FOR_CEO', 'faberloom-reviewer')
    expect(validateEvidenceText('O0/FM-X.md', text).map(i => i.code)).toContain('CLOSED_WITHOUT_VERDICT')
  })

  it('detecta deriva entre el expediente y el tablero', () => {
    const files = [{ path: 'O0/FM-O0-01.md', text: header('READY_ISOLATED', 'pendiente') }]
    expect(validateEvidenceDirectory(files, { 'O0-01': 'BLOCKED' }).map(i => i.code)).toContain('STATE_DRIFT')
    expect(validateEvidenceDirectory(files, { 'O0-01': 'READY_ISOLATED' })).toEqual([])
  })

  it('detecta un expediente que no figura en el tablero', () => {
    const files = [{ path: 'O0/FM-O0-99.md', text: header('BLOCKED', 'pendiente') }]
    expect(validateEvidenceDirectory(files, {}).map(i => i.code)).toContain('NOT_IN_DASHBOARD')
  })

  it('lee los estados del tablero real', () => {
    const states = parseDashboardStates(
      ['| O0-01 | algo | READY_ISOLATED | ev | falta |', '| O0-04 | algo | **BLOCKED** | ev | falta |'].join('\n'),
    )
    expect(states).toEqual({ 'O0-01': 'READY_ISOLATED', 'O0-04': 'BLOCKED' })
  })
})

describe('evidencia de cierre', () => {
  const record = (overrides: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
    contract: 'FM-O0-02',
    wave: 'O0',
    revision: '0b01ca39365ba04fe89858bcac56e3523896ee4d',
    scope: 'modelo de requisitos',
    level: 'C1-E',
    state: 'CLOSED',
    gate: 'NINGUNA',
    fixture: 'requirements.json + owners.json',
    commands: ['vitest run scripts/faberloom-daily/check-plan.spec.ts'],
    expected: '22 pruebas en verde',
    observed: '22 pruebas en verde, 0 fallos',
    positive: 'el modelo real valida',
    negative: 'un caso borrado produce MISSING_ID',
    limitations: ['no prueba comportamiento del producto'],
    approvals: [],
    author: 'faberloom-evidence',
    reviewer: 'faberloom-reviewer',
    reviewer_verdict: 'PASS',
    ...overrides,
  })

  it('acepta una evidencia completa', () => {
    expect(validateEvidenceRecord(record())).toEqual([])
  })

  it('rechaza cerrar sin observación', () => {
    expect(codes(validateEvidenceRecord(record({ observed: '' })))).toContain('NO_OBSERVED')
  })

  it('rechaza una observación con palabras de trabajo pendiente', () => {
    expect(codes(validateEvidenceRecord(record({ observed: 'queda pendiente ejecutar la mitad' })))).toContain('SUSPECT_OBSERVED')
  })

  it('rechaza cerrar sin control negativo', () => {
    expect(codes(validateEvidenceRecord(record({ negative: '' })))).toContain('NO_NEGATIVE')
  })

  it('rechaza cerrar sin limitaciones', () => {
    expect(codes(validateEvidenceRecord(record({ limitations: [] })))).toContain('NO_LIMITATIONS')
  })

  it('rechaza que el autor se revise a sí mismo', () => {
    expect(codes(validateEvidenceRecord(record({ reviewer: 'faberloom-evidence' })))).toContain('SELF_REVIEW')
  })

  it('rechaza CLOSED sin veredicto independiente', () => {
    expect(codes(validateEvidenceRecord(record({ reviewer_verdict: 'NEEDS_WORK' })))).toContain('NO_VERDICT')
    expect(codes(validateEvidenceRecord(record({ reviewer_verdict: '' })))).toContain('NO_VERDICT')
  })

  it('rechaza CLOSED en un contrato con gate sin aprobación citada', () => {
    expect(codes(validateEvidenceRecord(record({ gate: 'PC1' })))).toContain('NO_APPROVAL')
  })

  it('rechaza NOT_APPLICABLE sin decisión', () => {
    expect(codes(validateEvidenceRecord(record({ state: 'NOT_APPLICABLE_APPROVED' })))).toContain('NO_APPROVAL')
  })

  it('rechaza C1-E sin comandos ni fixture', () => {
    expect(codes(validateEvidenceRecord(record({ commands: [], fixture: '' })))).toEqual(
      expect.arrayContaining(['NO_COMMANDS', 'NO_FIXTURE']),
    )
  })

  it('una revisión corta no identifica nada', () => {
    expect(codes(validateEvidenceRecord(record({ revision: '0b01ca3' })))).toContain('REVISION')
  })

  it('acepta READY_FOR_CEO con veredicto y sin aprobación', () => {
    const ready = record({ state: 'READY_FOR_CEO', gate: 'PC1' })
    expect(validateEvidenceRecord(ready)).toEqual([])
  })

  it('acepta BLOCKED con la razón escrita', () => {
    const blocked = record({ state: 'BLOCKED', limitations: ['falta AUTH-LAB-SERVICE'] })
    expect(validateEvidenceRecord(blocked)).toEqual([])
  })
})
