/**
 * Validate the portable FaberLoom registry: the 58 product cases, the harness
 * cases, the conservation groups, the frozen input baseline, and the ownership
 * map. The registry is the authority for planning coverage; this check makes an
 * orphan requirement, a duplicated id, or a demonstrated case without an
 * existing test fail instead of staying a claim in prose.
 *
 * Run `pnpm run check-faberloom-portable-plan` (or the file directly with tsx).
 * `--json` prints the same verdict as one JSON document.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/** Owner identifiers the agent contract in the plan permits. */
export const OWNERS = [
  'planner', 'architect', 'backend-architect', 'identity-access-engineer',
  'desktop-app-engineer', 'frontend-developer', 'developer-tooling-engineer',
  'test-automation-engineer', 'security-reviewer', 'accessibility-auditor',
  'evidence-collector', 'devops-automator', 'technical-writer', 'reality-checker',
  'product-manager',
] as const

/** Comparators defined in §5.3. */
export const COMPARATORS = [
  'requirements', 'permissions', 'receipt', 'application',
  'generation', 'determinism', 'publication', 'context', 'evidence',
] as const

/** Evidence levels defined in §5.2. */
export const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const

/** Result states allowed for one case. */
export const STATES = ['demostrada', 'refutada', 'no-comprobada', 'no-aplicable'] as const

/** One product requirement. */
export interface RequirementRecord {
  readonly id: string
  readonly source: string
  readonly obligation: string
  readonly phase: string
  readonly waves: readonly string[]
  readonly owner: string
  readonly dependencies: readonly string[]
  readonly positive: string
  readonly negative: string
  readonly test: string
  readonly testStatus: 'existing' | 'proposed'
  readonly comparator: string
  readonly environment: string
  readonly manual: boolean
  readonly status: string
}

/** One harness case, conservation group, or the registry as a whole. */
export interface RegistryDocument {
  readonly schemaVersion: number
  /** Digest of the plan this registry was generated from, when the producer stamped one. */
  readonly generatedFromSha256?: string
  readonly productCount: number
  readonly requirements: readonly RequirementRecord[]
  readonly harness: readonly { readonly id: string; readonly test: string }[]
  readonly conservation: readonly { readonly id: string }[]
}

/** The frozen package inventory. */
export interface BaselineDocument {
  readonly schemaVersion: number
  readonly files: readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[]
}

/** One path of the ownership map. */
export interface OwnerEntry {
  readonly path: string
  readonly kind: 'E' | 'N'
  readonly owner: string
  readonly wave: string
  readonly integrator: string
  readonly consumers: readonly string[]
}

/** The ownership map. */
export interface OwnersDocument {
  readonly schemaVersion: number
  readonly entries: readonly OwnerEntry[]
}

/** Paths and documents a check reads. */
export interface CheckInput {
  readonly root: string
  readonly registry: RegistryDocument
  readonly baseline?: BaselineDocument
  readonly owners?: OwnersDocument
  readonly plan?: string
  /** Denominator the check enforces; production uses the fixed 58. */
  readonly expectedProductCount?: number
}

const CASE_ID = /^(?:BASE|AUTH|PROP|PKG|FS|HOST|LIFE|UX|CTX|CON|PUB|VER|IA|DIST|PIL)-\d{2}$/u
const HARNESS_ID = /^HAR-\d{2}$/u
const CONSERVATION_ID = /^REG-[A-Z]+$/u
const SHA256 = /^[a-f0-9]{64}$/u

/**
 * Collect every violation of the registry contract.
 * @param input - root, documents, and the plan text whose wave headings define valid ids.
 * @returns one message per violation; empty means the registry is consistent.
 */
export function checkRegistry(input: CheckInput): string[] {
  const failures: string[] = []
  const { registry, baseline, owners } = input
  const expected = input.expectedProductCount ?? 58
  if (registry.schemaVersion !== 1) failures.push(`schemaVersion must be 1, got ${String(registry.schemaVersion)}`)
  if (registry.productCount !== expected) failures.push(`productCount must be ${expected}, got ${String(registry.productCount)}`)
  if (registry.requirements.length !== registry.productCount) {
    failures.push(`requirements has ${registry.requirements.length} rows but productCount is ${String(registry.productCount)}`)
  }
  // The registry is generated from the plan; a stale digest means an id, wave,
  // or oracle changed without the cases following (HAR-03).
  if (input.plan !== undefined && registry.generatedFromSha256 !== undefined) {
    const digest = createHash('sha256').update(input.plan).digest('hex')
    if (digest !== registry.generatedFromSha256) {
      failures.push('generatedFromSha256 does not match the plan; regenerate requirements.json')
    }
  }

  const waveIds = waveHeadings(input.plan)
  const seen = new Set<string>()
  for (const requirement of registry.requirements) {
    if (!CASE_ID.test(requirement.id)) failures.push(`${requirement.id}: id does not match the product case form`)
    if (seen.has(requirement.id)) failures.push(`${requirement.id}: duplicated id`)
    seen.add(requirement.id)
    if (requirement.owner.length === 0 || !(OWNERS as readonly string[]).includes(requirement.owner)) {
      failures.push(`${requirement.id}: owner ${JSON.stringify(requirement.owner)} is not in the agent catalog`)
    }
    if (requirement.waves.length === 0) failures.push(`${requirement.id}: no wave assigned`)
    for (const wave of requirement.waves) {
      if (waveIds.size > 0 && !waveIds.has(wave)) failures.push(`${requirement.id}: wave ${wave} does not exist in the plan`)
    }
    if (requirement.test.trim().length === 0) failures.push(`${requirement.id}: no test file`)
    if (!(COMPARATORS as readonly string[]).includes(requirement.comparator)) {
      failures.push(`${requirement.id}: comparator ${JSON.stringify(requirement.comparator)} is not in §5.3`)
    }
    if (!(LEVELS as readonly string[]).includes(requirement.environment)) {
      failures.push(`${requirement.id}: environment ${JSON.stringify(requirement.environment)} is not a level`)
    }
    if (!(STATES as readonly string[]).includes(requirement.status)) {
      failures.push(`${requirement.id}: status ${JSON.stringify(requirement.status)} is not a result state`)
    }
    if (requirement.obligation.trim().length === 0) failures.push(`${requirement.id}: no obligation`)
    // A demonstrated case without a test that exists is the claim this registry
    // exists to reject: the status would rest on prose, not on executed code.
    if (requirement.status === 'demostrada') {
      if (requirement.testStatus !== 'existing') {
        failures.push(`${requirement.id}: marked demostrada but its test is still proposed`)
      } else if (!existsSync(resolve(input.root, requirement.test))) {
        failures.push(`${requirement.id}: marked demostrada but ${requirement.test} does not exist`)
      }
    }
  }

  const harnessIds = new Set(registry.harness.map(entry => entry.id))
  for (let index = 1; index <= 8; index += 1) {
    const id = `HAR-${String(index).padStart(2, '0')}`
    if (!harnessIds.has(id)) failures.push(`${id}: harness case missing`)
  }
  for (const entry of registry.harness) {
    if (!HARNESS_ID.test(entry.id)) failures.push(`${entry.id}: id does not match the harness case form`)
    if (entry.test.trim().length === 0) failures.push(`${entry.id}: no test file`)
  }

  const conservationIds = new Set(registry.conservation.map(entry => entry.id))
  for (const id of ['REG-SPACE', 'REG-AGENT', 'REG-MEMORY', 'REG-RUN', 'REG-EXEC', 'REG-BOARD', 'REG-PROJECTION', 'REG-BACKUP', 'REG-DESKTOP', 'REG-SESSION']) {
    if (!conservationIds.has(id)) failures.push(`${id}: conservation group missing`)
  }
  for (const entry of registry.conservation) {
    if (!CONSERVATION_ID.test(entry.id)) failures.push(`${entry.id}: id does not match the conservation form`)
  }

  if (baseline !== undefined) failures.push(...checkBaseline(baseline))
  if (owners !== undefined) failures.push(...checkOwners(owners, waveIds))
  return failures
}

/**
 * Validate the frozen six-file inventory.
 * @param baseline - the baseline document.
 * @returns one message per violation.
 */
function checkBaseline(baseline: BaselineDocument): string[] {
  const failures: string[] = []
  if (baseline.schemaVersion !== 1) failures.push('baseline: schemaVersion must be 1')
  if (baseline.files.length !== 6) failures.push(`baseline: expected 6 files, got ${baseline.files.length}`)
  const paths = new Set<string>()
  for (const file of baseline.files) {
    if (paths.has(file.path)) failures.push(`baseline: duplicated path ${file.path}`)
    paths.add(file.path)
    if (!SHA256.test(file.sha256)) failures.push(`baseline: ${file.path} has no sha256`)
    if (!Number.isInteger(file.bytes) || file.bytes <= 0) failures.push(`baseline: ${file.path} has no size`)
  }
  return failures
}

/**
 * Validate the exclusive ownership map.
 * @param owners - the ownership document.
 * @param waveIds - wave headings the map may reference.
 * @returns one message per violation.
 */
function checkOwners(owners: OwnersDocument, waveIds: ReadonlySet<string>): string[] {
  const failures: string[] = []
  if (owners.schemaVersion !== 1) failures.push('owners: schemaVersion must be 1')
  const paths = new Set<string>()
  for (const entry of owners.entries) {
    if (paths.has(entry.path)) failures.push(`owners: ${entry.path} has more than one owner entry`)
    paths.add(entry.path)
    if ((entry.kind as string) !== 'E' && (entry.kind as string) !== 'N') failures.push(`owners: ${entry.path} has invalid kind`)
    if (entry.owner.length === 0) failures.push(`owners: ${entry.path} has no owner`)
    if (entry.integrator.length === 0) failures.push(`owners: ${entry.path} has no integrator`)
    if (entry.kind === 'N' && entry.wave.length === 0) failures.push(`owners: ${entry.path} is new and names no wave`)
    if (waveIds.size > 0 && !waveIds.has(entry.wave)) failures.push(`owners: ${entry.path} names unknown wave ${entry.wave}`)
    if (entry.consumers.length === 0) failures.push(`owners: ${entry.path} names no consumer`)
  }
  return failures
}

/**
 * Wave identifiers declared by the plan's `#### Ola X.Y.` headings.
 * @param plan - plan text, or undefined to skip the comparison.
 * @returns the declared ids.
 */
function waveHeadings(plan: string | undefined): Set<string> {
  const ids = new Set<string>()
  if (plan === undefined) return ids
  for (const line of plan.split(/\r?\n/u)) {
    const match = /^#### Ola (\d+[A-Z]?\.\d+)\./u.exec(line)
    const wave = match?.[1]
    if (wave !== undefined) ids.add(wave)
  }
  return ids
}

/**
 * Read one JSON document.
 * @param path - absolute path.
 * @returns the parsed value, unvalidated.
 */
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]).replace(/\\/gu, '/').endsWith('/scripts/faberloom-portable/check-plan.ts')

if (invokedDirectly) {
  const root = resolve(import.meta.dirname, '..', '..')
  const input: CheckInput = {
    root,
    registry: readJson(resolve(root, 'scripts/faberloom-portable/requirements.json')) as RegistryDocument,
    baseline: readJson(resolve(root, 'scripts/faberloom-portable/baseline.json')) as BaselineDocument,
    owners: readJson(resolve(root, 'scripts/faberloom-portable/owners.json')) as OwnersDocument,
    plan: readFileSync(resolve(root, 'docs/scratch/faberloom-portable-fases-olas.md'), 'utf8'),
  }
  const failures = checkRegistry(input)
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ok: failures.length === 0, failures }, null, 2)}\n`)
  } else if (failures.length === 0) {
    process.stdout.write(
      `faberloom-portable: ${input.registry.requirements.length} product cases, `
      + `${input.registry.harness.length} harness cases, ${input.registry.conservation.length} conservation groups, `
      + `${input.baseline?.files.length ?? 0} frozen files, ${input.owners?.entries.length ?? 0} owned paths.\n`,
    )
  } else {
    for (const failure of failures) process.stderr.write(`faberloom-portable: ${failure}\n`)
  }
  process.exitCode = failures.length === 0 ? 0 : 1
}
