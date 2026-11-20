/**
 * T14 · the upstream update gate.
 *
 * Reads the pinned upstream SHA, measures how far the fork is from it, and
 * checks every harness symbol the own layer imports against that SHA's public
 * surface: the package (or its subpath) must exist there and still export the
 * names the product uses. A missing symbol fails the gate; a modified core file
 * names the `AUTH-CORE` request instead of hiding it.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectUpstream } from './compare-upstream.ts'

/** Imported harness symbol set, grouped by the import specifier. */
export interface ContractEdge {
  /** Specifier the own layer imports from, e.g. `@deepseek-ai/dsh-llm`. */
  readonly specifier: string
  /** Package directory at the target SHA, when it exists. */
  readonly directory: string | null
  /** Symbols the own layer names. */
  readonly symbols: readonly string[]
  /** Whether the entry module and every symbol exist at the target SHA. */
  readonly ok: boolean
  /** Missing symbols, or why the entry could not be read. */
  readonly missing: readonly string[]
  /** Symbols or packages the fork added itself; they travel with the candidate. */
  readonly owned: readonly string[]
}

/** What the gate concluded, with the exact reason. */
export type UpdateVerdict = 'PASS' | 'TARGET_MISSING' | 'INCOMPATIBLE' | 'BLOCKED_AUTH_CORE'

export interface UpdateGateReport {
  /** Target reference and its resolved SHA. */
  readonly target: { readonly ref: string; readonly sha: string | null; readonly present: boolean }
  /** Common base between the fork and the target. */
  readonly base: string | null
  /** Commits the fork has that the target lacks. */
  readonly ahead: number | null
  /** Commits the target has that the fork lacks. */
  readonly behind: number | null
  /** Product and client files that differ from the target. */
  readonly ownLayerFiles: number
  /** Core files the fork changed, which a full merge needs `AUTH-CORE` for. */
  readonly coreFilesTouched: readonly string[]
  /** One entry per import specifier. */
  readonly edges: readonly ContractEdge[]
  /** Final verdict. */
  readonly verdict: UpdateVerdict
  /** What the gate does not prove. */
  readonly limitations: readonly string[]
}

/** Run git and return stdout, or null when it fails. */
function git(repo: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return null
  }
}

/** Every TypeScript source file under one directory. */
function sources(directory: string): string[] {
  const out: string[] = []
  const walk = (path: string): void => {
    for (const entry of readdirSync(path)) {
      const child = join(path, entry)
      const stat = statSync(child)
      if (stat.isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'lib') walk(child)
        continue
      }
      if (/\.(ts|tsx)$/u.test(entry) && !/\.spec\.(ts|tsx)$/u.test(entry)) out.push(child)
    }
  }
  walk(directory)
  return out
}

/**
 * Imported names per specifier across the own layer.
 * @param repo - repository root.
 * @param roots - directories to scan; the own layer by default.
 * @returns specifier to the symbols it must export.
 */
export function importedSymbols(repo: string, roots: readonly string[] = [
  'packages/faberloom',
  'packages/client/ui-faberloom/src',
]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const files = roots
    .map(root => join(repo, root))
    .filter(directory => statSync(directory, { throwIfNoEntry: false })?.isDirectory() === true)
    .flatMap(directory => sources(directory))
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/\bfrom\s+'(@deepseek-ai\/dsh-[^']+)'/gu)) {
      const specifier = match[1] ?? ''
      if (specifier.startsWith('@deepseek-ai/dsh-faberloom')) continue
      if (!out.has(specifier)) out.set(specifier, new Set())
    }
    for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'(@deepseek-ai\/dsh-[^']+)'/gu)) {
      const specifier = match[2] ?? ''
      if (specifier.startsWith('@deepseek-ai/dsh-faberloom')) continue
      const names = (match[1] ?? '').split(',').map(entry => entry.trim()
        .replace(/^type\s+/u, '')
        .split(/\s+as\s+/u)[0] ?? '').filter(entry => entry.length > 0)
      const set = out.get(specifier) ?? new Set<string>()
      for (const name of names) set.add(name)
      out.set(specifier, set)
    }
  }
  return out
}

/**
 * Package name to directory at one commit.
 * @param repo - repository root.
 * @param sha - commit to read.
 * @returns the map, empty when the tree cannot be listed.
 */
export function targetPackages(repo: string, sha: string): Map<string, string> {
  const out = new Map<string, string>()
  const listed = git(repo, ['ls-tree', '-r', '--name-only', sha, '--', 'packages'])
  if (listed === null) return out
  const manifests = listed.split(/\r?\n/u).filter(path => path.endsWith('/package.json'))
  for (const manifest of manifests) {
    const raw = git(repo, ['show', `${sha}:${manifest}`])
    if (raw === null) continue
    try {
      const parsed = JSON.parse(raw) as { name?: string }
      if (typeof parsed.name === 'string' && !out.has(parsed.name)) {
        out.set(parsed.name, manifest.slice(0, -'/package.json'.length))
      }
    } catch {
      // A malformed manifest belongs to that package, not to the gate.
    }
  }
  return out
}

/** Package name to directory in the working tree. */
export function workspacePackages(repo: string): Map<string, string> {
  const root = resolve(repo)
  const out = new Map<string, string>()
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)
      if (!statSync(path).isDirectory()) continue
      try {
        const parsed = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as { name?: string }
        if (typeof parsed.name === 'string') {
          if (!out.has(parsed.name)) out.set(parsed.name, path.slice(root.length + 1).replace(/\\/g, '/'))
          continue
        }
        walk(path)
      } catch {
        walk(path)
      }
    }
  }
  walk(join(root, 'packages'))
  return out
}

/** Whether one exported declaration names the symbol. */
function declares(source: string, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(
    `export\\s+(?:type\\s+)?(?:\\{[^}]*\\b${escaped}\\b[^}]*\\}|(?:declare\\s+)?(?:abstract\\s+)?(?:const|let|var|function|class|interface|type|enum|namespace)\\s+${escaped}\\b)`,
    'su',
  ).test(source)
}

/**
 * Exported names of one module source, for diagnostics and tests.
 * @param source - module text.
 * @returns the exported declaration names.
 */
export function exportedNames(source: string): Set<string> {
  const out = new Set<string>()
  const declarations = 'const|let|var|function|class|interface|type|enum|namespace'
  const exported = new RegExp(`export\\s+(?:type\\s+)?(?:\\{([^}]*)\\}|(?:declare\\s+)?(?:abstract\\s+)?(?:${declarations})\\s+([A-Za-z0-9_$]+))`, 'gu')
  for (const match of source.matchAll(exported)) {
    if (match[1] !== undefined) {
      for (const name of match[1].split(',')) {
        const cleaned = name.trim().split(/\s+as\s+/u).pop() ?? ''
        if (cleaned.length > 0) out.add(cleaned)
      }
    }
    if (match[2] !== undefined) out.add(match[2])
  }
  return out
}

/**
 * Public modules of one entry at the target: the entry file plus every module
 * it re-exports. Internal modules a package never re-exports are not part of
 * the contract a consumer can import.
 * @param repo - repository root.
 * @param sha - commit to read.
 * @param present - every file in the tree under `packages`.
 * @param directory - package directory at that commit.
 * @param entry - entry paths relative to the package, e.g. `src/index.ts`.
 * @returns the source text of the public modules.
 */
function publicSources(
  repo: string,
  sha: string,
  present: ReadonlySet<string>,
  directory: string,
  entry: readonly string[],
): string[] {
  const queue = entry.map(path => `${directory}/${path}`).filter(path => present.has(path))
  const seen = new Set<string>()
  const modules: string[] = []
  while (queue.length > 0) {
    const path = queue.shift()
    if (path === undefined || seen.has(path)) continue
    seen.add(path)
    const source = git(repo, ['show', `${sha}:${path}`])
    if (source === null) continue
    modules.push(source)
    const base = path.slice(0, Math.max(0, path.lastIndexOf('/')))
    for (const match of source.matchAll(/export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+'(\.[^']+)'/gu)) {
      const specifier = match[1] ?? ''
      const resolved = `${base}/${specifier.replace(/^\.\//u, '')}`
      if (present.has(resolved)) queue.push(resolved)
      else if (present.has(`${resolved}.ts`)) queue.push(`${resolved}.ts`)
      else if (present.has(`${resolved}/index.ts`)) queue.push(`${resolved}/index.ts`)
    }
  }
  return modules
}

/** Source text of every TypeScript module the working copy of a package has. */
function localSources(repo: string, directory: string): string[] {
  const root = join(repo, directory)
  if (statSync(root, { throwIfNoEntry: false })?.isDirectory() !== true) return []
  return sources(root).map(file => readFileSync(file, 'utf8'))
}

/** Entry paths one import specifier resolves to inside its package. */
function entryPaths(subpath: string): string[] {
  if (subpath.length === 0) return ['src/index.ts', 'src/main.ts']
  return [`src/${subpath}/index.ts`, `src/${subpath}.ts`]
}

/**
 * Compare the own layer's imports against the pinned target.
 * A package or symbol that is absent from the target *and* from the common base
 * but present in the working tree was added by the fork; it travels with the
 * candidate and is not an upstream contract.
 * @param repo - repository root.
 * @param sha - target commit.
 * @param base - common base commit, or null when it cannot be computed.
 * @param roots - directories to scan; the own layer by default.
 * @returns one edge per import specifier.
 */
export function contractEdges(
  repo: string,
  sha: string,
  base: string | null = null,
  roots?: readonly string[],
): ContractEdge[] {
  const imports = roots === undefined ? importedSymbols(repo) : importedSymbols(repo, roots)
  const packages = targetPackages(repo, sha)
  const localPackages = workspacePackages(repo)
  const basePackages = base === null ? new Map<string, string>() : targetPackages(repo, base)
  const listed = git(repo, ['ls-tree', '-r', '--name-only', sha, '--', 'packages']) ?? ''
  const baseListed = base === null ? '' : git(repo, ['ls-tree', '-r', '--name-only', base, '--', 'packages']) ?? ''
  const present = new Set(listed.split(/\r?\n/u).filter(path => path.length > 0))
  const basePresent = new Set(baseListed.split(/\r?\n/u).filter(path => path.length > 0))
  const edges: ContractEdge[] = []
  for (const [specifier, symbols] of [...imports.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    const segments = specifier.split('/')
    const packageName = segments.slice(0, 2).join('/')
    const subpath = segments.slice(2).join('/')
    const directory = packages.get(packageName) ?? null
    const baseDirectory = basePackages.get(packageName) ?? null
    const localDirectory = localPackages.get(packageName) ?? null
    if (directory === null) {
      // Absent upstream and absent from the base, but present in the working
      // tree: the fork ships it, so it travels with the candidate.
      if (baseDirectory === null && localDirectory !== null) {
        edges.push({ specifier, directory: null, symbols: [...symbols].sort(), ok: true, missing: [], owned: [...symbols].sort() })
        continue
      }
      edges.push({ specifier, directory: null, symbols: [...symbols].sort(), ok: false, missing: ['package missing at the target'], owned: [] })
      continue
    }
    if (symbols.size === 0) {
      edges.push({ specifier, directory, symbols: [], ok: true, missing: [], owned: [] })
      continue
    }
    const entry = entryPaths(subpath)
    const sourcesAtTarget = publicSources(repo, sha, present, directory, entry)
    if (sourcesAtTarget.length === 0) {
      edges.push({ specifier, directory, symbols: [...symbols].sort(), ok: false, missing: [`${entry[0] ?? 'entry'} missing at the target`], owned: [] })
      continue
    }
    const missingAtTarget = [...symbols].filter(symbol => !sourcesAtTarget.some(source => declares(source, symbol))).sort()
    const baseSources = baseDirectory === null || base === null
      ? []
      : publicSources(repo, base, basePresent, baseDirectory, entry)
    const ownSources = localDirectory === null ? [] : localSources(repo, localDirectory)
    // The fork may add a declaration to an upstream package; that symbol is own
    // cargo. A name absent from the target, the base and the working tree is a
    // broken import and fails the gate.
    const owned = missingAtTarget.filter(symbol => !baseSources.some(source => declares(source, symbol))
      && ownSources.some(source => declares(source, symbol)))
    const missing = missingAtTarget.filter(symbol => !owned.includes(symbol))
    edges.push({ specifier, directory, symbols: [...symbols].sort(), ok: missing.length === 0, missing, owned })
  }
  return edges
}

/**
 * Inspect the candidate revision against the pinned target.
 * @param repo - repository root.
 * @param targetRef - pinned reference, `origin/master` by default.
 * @returns the report and its verdict.
 */
export function inspectUpdate(repo: string, targetRef = 'origin/master'): UpdateGateReport {
  const upstream = inspectUpstream(repo, { upstreamRef: targetRef })
  const limitations: string[] = []
  if (upstream.upstreamSha === null) {
    return {
      target: { ref: targetRef, sha: null, present: false },
      base: null,
      ahead: null,
      behind: null,
      ownLayerFiles: 0,
      coreFilesTouched: [],
      edges: [],
      verdict: 'TARGET_MISSING',
      limitations: [`la referencia ${targetRef} no existe localmente; el gate no se ejecuta sin SHA`],
    }
  }
  const edges = contractEdges(repo, upstream.upstreamSha, upstream.mergeBase)
  const coreFilesTouched = (git(repo, ['diff', '--name-only', `${targetRef}...HEAD`, '--', 'packages/core']) ?? '')
    .split(/\r?\n/u).filter(entry => entry.length > 0)
  const incompatible = edges.filter(edge => !edge.ok)
  const verdict: UpdateVerdict = incompatible.length > 0
    ? 'INCOMPATIBLE'
    : coreFilesTouched.length > 0 ? 'BLOCKED_AUTH_CORE' : 'PASS'
  if (coreFilesTouched.length > 0) {
    limitations.push(`${String(coreFilesTouched.length)} core files differ from the target; merging them needs AUTH-CORE (reason, snapshots, migration, rollback)`)
  }
  limitations.push('el gate comprueba presencia de contratos públicos, no ejecuta el producto sobre el árbol del upstream')
  limitations.push('los recorridos afectados se repiten en la revisión candidata, no en una mezcla ya fusionada')
  return {
    target: { ref: targetRef, sha: upstream.upstreamSha, present: true },
    base: upstream.mergeBase,
    ahead: upstream.ahead,
    behind: upstream.behind,
    ownLayerFiles: upstream.byArea.filter(entry => entry.area === 'faberloom' || entry.area === 'client').reduce((sum, entry) => sum + entry.files, 0),
    coreFilesTouched,
    edges,
    verdict,
    limitations,
  }
}

/** Render the report as the markdown the evidence folder keeps. */
export function toMarkdown(report: UpdateGateReport): string {
  const failing = report.edges.filter(edge => !edge.ok)
  const owned = report.edges.filter(edge => edge.owned.length > 0)
  const lines = [
    '# T14 · actualización al SHA fijado',
    '',
    `- Objetivo: \`${report.target.ref}\` = \`${report.target.sha ?? 'ausente'}\``,
    `- Base común: \`${report.base ?? 'no calculable'}\``,
    `- Separación: ${report.ahead === null ? 'desconocida' : `${String(report.ahead)} por delante`}; ${report.behind === null ? 'desconocida' : `${String(report.behind)} por detrás`}`,
    `- Archivos propios (producto y cliente): ${String(report.ownLayerFiles)}`,
    `- Specifiers importados: ${String(report.edges.length)}; con faltantes: ${String(failing.length)}; con carga propia: ${String(owned.length)}`,
    `- Veredicto: **${report.verdict}**`,
    '',
    '## Contratos importados',
    '',
    '| Specifier | Símbolos | Estado | Faltan | Propios |',
    '|---|---|---|---|---|',
    ...report.edges.map(edge => `| \`${edge.specifier}\` | ${String(edge.symbols.length)} | ${edge.ok ? 'PASS' : 'FAIL'} | ${edge.missing.join(', ') || '—'} | ${edge.owned.join(', ') || '—'} |`),
    '',
    '## Núcleo',
    '',
    report.coreFilesTouched.length === 0
      ? 'Sin diferencias en `packages/core`.'
      : `Archivos de núcleo distintos del objetivo: ${String(report.coreFilesTouched.length)}.`,
    ...report.coreFilesTouched.map(path => `- \`${path}\``),
    '',
    '## Límites',
    '',
    ...report.limitations.map(item => `- ${item}`),
  ]
  return `${lines.join('\n')}\n`
}

const isMain = (): boolean => {
  const entry = process.argv[1]
  if (!entry) return false
  return resolve(entry) === resolve(fileURLToPath(import.meta.url))
}

if (isMain()) {
  const repo = process.argv[2] ?? resolve(fileURLToPath(import.meta.url), '..', '..', '..')
  const target = process.argv[3] ?? 'origin/master'
  process.stdout.write(toMarkdown(inspectUpdate(repo, target)))
}
