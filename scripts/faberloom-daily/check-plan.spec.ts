import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateBaseline,
  validateDocs,
  validateModel,
  type BaselineFile,
  type OwnersFile,
  type PlanModel,
} from './check-plan.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const docsDir = process.env.FABERLOOM_DOCS_DIR ?? resolve(repoRoot, '..', 'FaberLoom_tarea_2026-11-16', 'tasks')
const docsAvailable = existsSync(join(docsDir, 'todo.md')) && existsSync(join(docsDir, 'file-map.md'))

const model = JSON.parse(readFileSync(join(here, 'requirements.json'), 'utf8')) as PlanModel
const owners = JSON.parse(readFileSync(join(here, 'owners.json'), 'utf8')) as OwnersFile

const clone = (): PlanModel => structuredClone(model)

const codes = (result: { issues: { code: string }[] }): string[] => result.issues.map(i => i.code)

describe('modelo real de requisitos', () => {
  it('es coherente y completo', () => {
    const result = validateModel(model, owners)
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.stats.cases).toBe(25)
    expect(result.stats.rules).toBe(35)
    expect(result.stats.precisiones).toBe(18)
    expect(result.stats.appearance).toBe(9)
    expect(result.stats.precisions).toBe(6)
    expect(result.stats.agents).toBe(11)
  })

  it('declara las seis precisiones con su registro y su tipo de firma', () => {
    expect(model.precisions.map(p => p.id)).toEqual(['PREC-01', 'PREC-02', 'PREC-03', 'PREC-04', 'PREC-05', 'PREC-06'])
    for (const precision of model.precisions) {
      expect(precision.declared).toBe(true)
      expect(precision.declared_at).toBe('2026-11-16')
      expect(precision.signed).toBe(true)
      expect(precision.signed_at).toBe('2026-11-16')
      expect(precision.record).toBe('decisions/RAT-2026-11-16-PREC.md')
    }
  })
})

describe('modelo: los rechazos existen y dicen por qué', () => {
  it('detecta un caso ausente', () => {
    const broken = clone()
    broken.cases = broken.cases.filter(c => c.id !== 'T23')
    const result = validateModel(broken, owners)
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain('MISSING_ID')
  })

  it('detecta una parte duplicada', () => {
    const broken = clone()
    const t1 = broken.cases.find(c => c.id === 'T1')
    if (!t1) throw new Error('T1 debe existir en el modelo')
    t1.parts.push({ id: 'T1-E1', wave: 'O7', gate: 'PC4' })
    const result = validateModel(broken, owners)
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain('DUPLICATE_PART')
  })

  it('detecta una ola inexistente en una parte', () => {
    const broken = clone()
    const first = broken.cases[0]
    if (!first) throw new Error('el modelo debe tener casos')
    const part = first.parts[0]
    if (!part) throw new Error('el caso debe tener partes')
    first.parts[0] = { ...part, wave: 'O99' }
    const result = validateModel(broken, owners)
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain('UNKNOWN_WAVE')
  })

  it('detecta un owner que no existe', () => {
    const broken = clone()
    const first = broken.cases[0]
    if (!first) throw new Error('el modelo debe tener casos')
    first.owner = 'faberloom-fantasma'
    const result = validateModel(broken, owners)
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain('UNKNOWN_OWNER')
  })

  it('rechaza C3 como sostén de un gate de habilitación', () => {
    const broken = clone()
    const t4 = broken.cases.find(c => c.id === 'T4')
    if (!t4) throw new Error('T4 debe existir')
    t4.level = 'C3'
    const result = validateModel(broken, owners)
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain('C3_ON_GATE')
  })

  it('rechaza una precisión sin declaración expresa', () => {
    const broken = clone()
    const prec = broken.precisions.find(p => p.id === 'PREC-04')
    if (!prec) throw new Error('PREC-04 debe existir')
    prec.declared = false
    const result = validateModel(broken, owners)
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain('NOT_DECLARED')
  })

  it('rechaza una precisión sin registro de custodia', () => {
    const broken = clone()
    const prec = broken.precisions[0]
    if (!prec) throw new Error('el modelo debe tener precisiones')
    prec.record = '  '
    const result = validateModel(broken, owners)
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain('NO_RECORD')
  })

  it('rechaza una firma declarada sin fecha de firma', () => {
    const broken = clone()
    const prec = broken.precisions[0]
    if (!prec) throw new Error('el modelo debe tener precisiones')
    prec.signed = true
    delete (prec as { signed_at?: string }).signed_at
    const result = validateModel(broken, owners)
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain('FAKE_SIGNATURE')
  })

  it('rechaza una regla ausente', () => {
    const broken = clone()
    broken.rules = broken.rules.filter(r => r.id !== '17')
    const result = validateModel(broken, owners)
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain('MISSING_ID')
  })

  it('rechaza un gate humano ausente', () => {
    const broken = clone()
    broken.human_gates = broken.human_gates.filter(g => g.id !== 'PC6')
    const result = validateModel(broken, owners)
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain('MISSING_ID')
  })

  it('rechaza un agente que se revisa a sí mismo', () => {
    const brokenOwners = structuredClone(owners)
    const agent = brokenOwners.agents['faberloom-mail']
    if (!agent) throw new Error('faberloom-mail debe existir en owners.json')
    agent.reviewer = 'faberloom-mail'
    const result = validateModel(model, brokenOwners)
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain('SELF_REVIEW')
  })

  it('rechaza un revisor inexistente', () => {
    const brokenOwners = structuredClone(owners)
    const agent = brokenOwners.agents['faberloom-ui']
    if (!agent) throw new Error('faberloom-ui debe existir en owners.json')
    agent.reviewer = 'nadie-revisa'
    const result = validateModel(model, brokenOwners)
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain('UNKNOWN_REVIEWER')
  })
})

describe('documentos: todo.md contra file-map.md', () => {
  const todo = [
    '| [ ] O0-01 | algo | FM-O0-01 | v | d |',
    '| [ ] O0-02 | algo | FM-O0-02 | v | d |',
  ].join('\n')
  const map = [
    '| FM-O0-01 | R: `README.mwt-one.md` | X: `a.md`, `b.md` |',
    '| FM-O0-02 | Sin modificación | X: `a.json`, `b.json`, `c.json`, `d.json`, `e.json` |',
  ].join('\n')
  const mapOverLimit = [
    '| FM-O0-01 | R: `README.mwt-one.md` | X: `a.md`, `b.md` |',
    '| FM-O0-02 | Sin modificación | X: `a.json`, `b.json`, `c.json`, `d.json`, `e.json`, `f.json` |',
  ].join('\n')

  it('acepta un mapa coherente y de cinco archivos o menos', () => {
    const result = validateDocs(todo, map)
    expect(result.issues.filter(i => i.code === 'TOO_MANY_FILES')).toEqual([])
  })

  it('detecta un contrato sin entrada en el mapa', () => {
    const result = validateDocs(`${todo}\n| [ ] O0-03 | algo | FM-O0-03 | v | d |`, map)
    expect(codes(result)).toContain('FM_WITHOUT_MAP')
  })

  it('detecta una entrada del mapa sin contrato', () => {
    const orphanRow = '| FM-O0-09 | Sin archivos | X: `x.md` |'
    const result = validateDocs(todo, `${map}\n${orphanRow}`)
    expect(codes(result)).toContain('MAP_WITHOUT_CONTRACT')
  })

  it('detecta un contrato con más de cinco archivos', () => {
    const result = validateDocs(todo, mapOverLimit)
    expect(codes(result)).toContain('TOO_MANY_FILES')
  })

  it('detecta una ola sin contratos', () => {
    const result = validateDocs(todo, map)
    expect(codes(result)).toContain('WAVE_WITHOUT_CONTRACT')
  })
})

describe('baseline: ningún pase inventado', () => {
  const base: BaselineFile = {
    revision: model.revision,
    executed_at_utc: '2026-11-16T00:00:00Z',
    runtime: { node: '22.22.2' },
    entries: [],
  }

  it('rechaza PASS sin observación', () => {
    const result = validateBaseline({
      ...base,
      entries: [{ id: 'B1', area: 'x', command: 'y', expected: 'ok', observed: '', verdict: 'PASS', limitation: '' }],
    }, model.revision)
    expect(codes(result)).toContain('BASELINE_FAKE_PASS')
  })

  it('exige limitación en FAIL y en BLOCKED', () => {
    const result = validateBaseline({
      ...base,
      entries: [{ id: 'B2', area: 'x', command: 'y', expected: 'ok', observed: 'falló', verdict: 'FAIL', limitation: ' ' }],
    }, model.revision)
    expect(codes(result)).toContain('BASELINE_LIMITATION')
  })

  it('rechaza una revisión distinta a la medida', () => {
    const result = validateBaseline({ ...base, entries: [] }, 'a'.repeat(40))
    expect(codes(result)).toContain('BASELINE_REVISION')
  })

  it('acepta una entrada fallida con limitación escrita', () => {
    const result = validateBaseline({
      ...base,
      entries: [{ id: 'B3', area: 'x', command: 'y', expected: 'ok', observed: '2 fallos', verdict: 'FAIL', limitation: 'falla conocida en el upstream' }],
    }, model.revision)
    expect(result.ok).toBe(true)
  })
})

describe.skipIf(!docsAvailable)('documentos reales del paquete de plan', () => {
  it('todo.md y file-map.md coinciden con el modelo', () => {
    const todoText = readFileSync(join(docsDir, 'todo.md'), 'utf8')
    const fileMapText = readFileSync(join(docsDir, 'file-map.md'), 'utf8')
    const result = validateDocs(todoText, fileMapText)
    expect(result.issues).toEqual([])
    expect(result.stats.contracts_in_map).toBeGreaterThanOrEqual(40)
  })
})
