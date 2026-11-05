import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkRegistry,
  type BaselineDocument,
  type OwnersDocument,
  type RegistryDocument,
  type RequirementRecord,
} from './check-plan.ts'

const root = resolve(import.meta.dirname, '..', '..')

function registry(): RegistryDocument {
  return JSON.parse(readFileSync(join(root, 'scripts/faberloom-portable/requirements.json'), 'utf8')) as RegistryDocument
}

function baseline(): BaselineDocument {
  return JSON.parse(readFileSync(join(root, 'scripts/faberloom-portable/baseline.json'), 'utf8')) as BaselineDocument
}

function owners(): OwnersDocument {
  return JSON.parse(readFileSync(join(root, 'scripts/faberloom-portable/owners.json'), 'utf8')) as OwnersDocument
}

function requirement(overrides: Partial<RequirementRecord> = {}): RequirementRecord {
  return {
    id: 'PROP-09',
    source: '01-Plan-FaberLoom-portable-por-fases.md#7',
    obligation: 'every approval needs an exact human action',
    phase: 'Fase 1',
    waves: ['1.1'],
    owner: 'backend-architect',
    dependencies: [],
    positive: 'a human approval commits',
    negative: 'a replicated approval is refused',
    test: 'packages/faberloom/board/tests/knowledge-approval.spec.ts',
    testStatus: 'existing',
    comparator: 'receipt',
    environment: 'L1',
    manual: false,
    status: 'no-comprobada',
    ...overrides,
  }
}

const plan = '#### Ola 1.1. Cerrar la aprobación\n\n#### Ola 2.1. Separar inicio local\n'
const realPlan = readFileSync(join(root, 'docs', 'scratch', 'faberloom-portable-fases-olas.md'), 'utf8')

/** A registry with the product rows removed from a complete one plus the fixture case. */
function document(requirements: readonly RequirementRecord[], productCount = 58): RegistryDocument {
  return {
    schemaVersion: 1,
    productCount,
    requirements,
    harness: Array.from({ length: 8 }, (_, index) => ({
      id: `HAR-0${index + 1}`,
      test: 'scripts/faberloom-portable/check-plan.spec.ts',
    })),
    conservation: ['REG-SPACE', 'REG-AGENT', 'REG-MEMORY', 'REG-RUN', 'REG-EXEC', 'REG-BOARD', 'REG-PROJECTION', 'REG-BACKUP', 'REG-DESKTOP', 'REG-SESSION']
      .map(id => ({ id })),
  }
}

describe('check-plan registry', () => {
  it('accepts the committed registry, baseline, and ownership map', () => {
    expect(checkRegistry({ root, registry: registry(), baseline: baseline(), owners: owners(), plan: realPlan })).toEqual([])
  })

  it('refuses a registry that drops a required case (HAR-01)', () => {
    const failures = checkRegistry({
      root,
      registry: document([requirement()]),
      plan,
    })
    expect(failures.join('\n')).toMatch(/requirements has 1 rows but productCount is 58/u)
  })

  it('refuses a demonstrated case whose test is still proposed (HAR-02, HAR-07)', () => {
    const failures = checkRegistry({
      root,
      registry: document([requirement({ status: 'demostrada', testStatus: 'proposed' })]),
      plan,
    })
    expect(failures.join('\n')).toMatch(/marked demostrada but its test is still proposed/u)
  })

  it('refuses a demonstrated case whose test file is absent', () => {
    const failures = checkRegistry({
      root,
      registry: document([requirement({ status: 'demostrada', test: 'packages/faberloom/board/tests/missing.spec.ts' })]),
      plan,
    })
    expect(failures.join('\n')).toMatch(/marked demostrada but .*missing\.spec\.ts does not exist/u)
  })

  it('refuses a duplicated id, an unknown wave, and an owner outside the catalog', () => {
    const failures = checkRegistry({
      root,
      registry: document([
        requirement(),
        requirement({ status: 'no-comprobada' }),
        requirement({ id: 'PROP-10', owner: 'model', waves: ['9.9'] }),
      ]),
      plan,
    })
    const joined = failures.join('\n')
    expect(joined).toMatch(/PROP-09: duplicated id/u)
    expect(joined).toMatch(/PROP-10: owner "model" is not in the agent catalog/u)
    expect(joined).toMatch(/PROP-10: wave 9\.9 does not exist in the plan/u)
  })

  it('refuses a baseline whose byte digest is not a sha256 (HAR-03)', () => {
    const files = baseline().files.map((file, index) => index === 0 ? { ...file, sha256: 'changed' } : file)
    const failures = checkRegistry({
      root,
      registry: document([requirement()]),
      baseline: { schemaVersion: 1, files },
      plan,
    })
    expect(failures.join('\n')).toMatch(/has no sha256/u)
  })

  it('refuses two owner entries for the same path', () => {
    const entry = owners().entries[0]
    if (entry === undefined) throw new Error('the ownership map has no entries')
    const failures = checkRegistry({
      root,
      registry: document([requirement()]),
      owners: { schemaVersion: 1, entries: [entry, { ...entry, owner: 'architect' }] },
      plan,
    })
    expect(failures.join('\n')).toMatch(/has more than one owner entry/u)
  })
})

describe('check-plan demonstrated evidence', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('accepts a demonstrated case whose test exists on disk', () => {
    dir = mkdtempSync(join(tmpdir(), 'faberloom-plan-'))
    mkdirSync(join(dir, 'tests'), { recursive: true })
    writeFileSync(join(dir, 'tests', 'case.spec.ts'), '')
    const failures = checkRegistry({
      root: dir,
      registry: document([requirement({ status: 'demostrada', test: 'tests/case.spec.ts' })], 1),
      plan,
      expectedProductCount: 1,
    })
    expect(failures).toEqual([])
  })
})
