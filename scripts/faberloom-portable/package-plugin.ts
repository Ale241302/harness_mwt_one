/**
 * Assemble the installable FaberLoom plugin from the built workspace packages.
 *
 * The host installs a plugin by package name or local path and reads
 * `dsh.bundle.patch`. A workspace bundle cannot be installed as-is: its
 * dependencies use `workspace:` and its product packages are not published.
 * This script copies each built product package into `vendor/`, rewrites the
 * workspace links to file dependencies, moves host-provided packages to
 * peers, and writes a manifest the host installer accepts.
 *
 * Run after `build:lib`:
 * `pnpm exec tsx scripts/faberloom-portable/package-plugin.ts --out dist/faberloom`
 * @module dsh/scripts/faberloom-portable/package-plugin
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const ROOT = resolve(import.meta.dirname, '../..')
const WORKSPACE_GLOB_ROOTS = ['packages', 'apps'] as const
const HOST_SCOPE = '@deepseek-ai/'
const PRODUCT_BUNDLE = '@deepseek-ai/dsh-faberloom-app'
const PLUGIN_NAME = 'faberloom'

/** One workspace package found on disk. */
interface WorkspacePackage {
  readonly name: string
  readonly dir: string
  readonly manifest: Record<string, unknown>
}

/** Read one JSON document as a mutable record. */
function readRecord(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`not an object: ${path}`)
  return value as Record<string, unknown>
}

/** List every `package.json` under `<root>/<group>/<name>` and `<root>/apps/<name>`. */
function workspacePackages(): Map<string, WorkspacePackage> {
  const found = new Map<string, WorkspacePackage>()
  const consider = (dir: string): void => {
    const path = join(dir, 'package.json')
    if (!existsSync(path)) return
    const manifest = readRecord(path)
    const name = manifest['name']
    if (typeof name !== 'string') return
    found.set(name, { name, dir, manifest })
  }
  for (const group of WORKSPACE_GLOB_ROOTS) {
    const groupDir = join(ROOT, group)
    if (!existsSync(groupDir)) continue
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(groupDir, entry.name)
      consider(dir)
      for (const nested of readdirSync(dir, { withFileTypes: true })) {
        if (nested.isDirectory()) consider(join(dir, nested.name))
      }
    }
  }
  return found
}

/** Sorted string keys of one manifest record field. */
function names(manifest: Record<string, unknown>, field: string): string[] {
  const value = manifest[field]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  return Object.keys(value).sort()
}

/** Read one manifest field as a string-valued record. */
function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) if (typeof entry === 'string') out[key] = entry
  return out
}

/** Copy one built package and rewrite its manifest for installation. */
function vendorPackage(source: WorkspacePackage, target: string): void {
  mkdirSync(target, { recursive: true })
  cpSync(join(source.dir, 'package.json'), join(target, 'package.json'))
  const lib = join(source.dir, 'lib')
  if (!existsSync(lib)) throw new Error(`${source.name} has no lib/; run build:lib first`)
  cpSync(lib, join(target, 'lib'), { recursive: true })
  for (const extra of ['README.md', 'README.zh.md', 'cordis.patch.yml', 'cordis.yml']) {
    if (existsSync(join(source.dir, extra))) cpSync(join(source.dir, extra), join(target, extra))
  }
  const manifest = readRecord(join(target, 'package.json'))
  const dependencies = stringRecord(manifest['dependencies'])
  const peers = stringRecord(manifest['peerDependencies'])
  const external: Record<string, string> = {}
  for (const [name, range] of Object.entries(dependencies)) {
    if (name.startsWith(HOST_SCOPE)) {
      peers[name] = '*'
      continue
    }
    if (range.startsWith('workspace:')) throw new Error(`${source.name} depends on unresolved ${name}@${range}`)
    external[name] = range
  }
  for (const name of Object.keys(peers)) peers[name] = '*'
  delete manifest['devDependencies']
  delete manifest['scripts']
  delete manifest['files']
  delete manifest['publishConfig']
  manifest['dependencies'] = external
  manifest['peerDependencies'] = peers
  writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
}

/**
 * Build the installable plugin directory.
 * @param out - destination directory, absolute or relative to the repository root.
 * @returns the manifest written for the plugin.
 */
function packagePlugin(out: string, versionOverride?: string): Record<string, unknown> {
  const packages = workspacePackages()
  const bundle = packages.get(PRODUCT_BUNDLE)
  if (bundle === undefined) throw new Error(`missing ${PRODUCT_BUNDLE}`)
  const declared = bundle.manifest['version']
  if (typeof declared !== 'string') throw new Error('bundle has no version')
  const version = versionOverride ?? declared

  const productNames = names(bundle.manifest, 'dependencies')
  const root = resolve(ROOT, out)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'node_modules', '@deepseek-ai'), { recursive: true })

  const packagePaths = new Map<string, string>()
  const externalDependencies = new Map<string, string>()
  const peers = new Set<string>(['@deepseek-ai/cordis'])

  for (const name of productNames) {
    const source = packages.get(name)
    if (source === undefined) throw new Error(`missing workspace package ${name}`)
    const short = name.slice(name.indexOf('/') + 1)
    vendorPackage(source, join(root, 'node_modules', '@deepseek-ai', short))
    packagePaths.set(name, `./node_modules/@deepseek-ai/${short}/lib/index.js`)
    for (const dep of names(source.manifest, 'dependencies')) {
      if (dep.startsWith(HOST_SCOPE)) peers.add(dep)
      else externalDependencies.set(dep, String((source.manifest['dependencies'] as Record<string, unknown>)[dep]))
    }
    for (const peer of names(source.manifest, 'peerDependencies')) peers.add(peer)
  }

  const bundlePatch = join(bundle.dir, 'cordis.patch.yml')
  if (!existsSync(bundlePatch)) throw new Error('bundle has no cordis.patch.yml')
  const patch = readFileSync(bundlePatch, 'utf8').replace(
    /^(\s*name:\s*)'([^']+)'/gmu,
    (line, prefix: string, name: string) => {
      const path = packagePaths.get(name)
      return path === undefined ? line : `${prefix}'${path}'`
    },
  )
  writeFileSync(join(root, 'cordis.patch.yml'), patch)
  mkdirSync(join(root, 'lib'), { recursive: true })
  cpSync(join(bundle.dir, 'lib/index.js'), join(root, 'lib/index.js'))
  // The base catalog this installation ships: agent presets, the shared skills,
  // and the role catalogs. The seeder installs them into the Harness home on the
  // first pass, so every user gets them without configuring a root.
  for (const catalog of ['agents-shared', 'skills-shared', 'skills-catalog']) {
    const source = join(ROOT, catalog)
    if (existsSync(source)) cpSync(source, join(root, 'catalogs', catalog), { recursive: true })
  }

  const manifest: Record<string, unknown> = {
    name: PLUGIN_NAME,
    version,
    description: 'FaberLoom Spaces, Mesa, publication and model tools for DeepSeek Harness',
    type: 'module',
    main: 'lib/index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dependencies: Object.fromEntries([...externalDependencies].sort()),
    peerDependencies: Object.fromEntries([...peers].sort().map(name => [name, '*'])),
    bundledDependencies: productNames,
  }
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)

  const rows = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
    .split(/\r?\n/u)
    .map(line => /^\s*name:\s*'([^']+)'/u.exec(line)?.[1])
    .filter((name): name is string => name !== undefined)
  // A row may name a package the Host installs (a peer of the product), which
  // the Loader resolves from the running application instead of our tree.
  const missing = rows.filter(name => !name.startsWith('./node_modules/') && !peers.has(name))
  if (missing.length > 0) throw new Error(`patch rows without a vendored file: ${missing.join(', ')}`)
  return manifest
}

const { values } = parseArgs({ options: { out: { type: 'string' }, version: { type: 'string' } }, allowPositionals: false })
const out = values.out ?? 'dist/faberloom'
const manifest = packagePlugin(out, values.version)
console.log(`faberloom plugin: ${String(manifest['name'])}@${String(manifest['version'])} -> ${resolve(ROOT, out)}`)
console.log(`${String((manifest['bundledDependencies'] as readonly string[]).length)} vendored package(s), ${String(Object.keys(manifest['peerDependencies'] as object).length)} peer(s)`)
