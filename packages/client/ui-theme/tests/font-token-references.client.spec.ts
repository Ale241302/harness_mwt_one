/**
 * Font-token reference contract: every `--dsw-font*` and `--dsw-control*` token
 * a corpus stylesheet reads must be defined by ui-theme's own sheets in
 * `src/styles/`. A `var()` with no definition is invalid at computed-value time
 * and the declaration silently falls back to the inherited value, so a rename on
 * one side renders the wrong type with no error — exactly how `--dsw-font`,
 * `--dsw-font-mono`, and `--dsw-font-sm-13` shipped. The corpus is the consumer
 * packages that change fixed, named below and read in full by this spec; it is
 * not a claim about packages it does not read, and a new consumer package joins
 * the list when its own migration lands.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { packageStylesheets, parseRules, varReferences } from './stylesheet-scan.ts'

/** Token prefixes under contract: the app type scale and the control hit target. */
const TOKEN_PREFIXES = ['--dsw-font', '--dsw-control']

/** Consumer packages this contract ranges over — the packages the fix touched. */
const CORPUS_PACKAGES = [
  'ui-sidebar-documentpreview',
  'ui-agent-preset',
  'ui-jobs',
  'ui-tool',
]

const PACKAGES_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const STYLES_DIR = fileURLToPath(new URL('../src/styles/', import.meta.url))

/** Absolute directory prefixes, with the separator, so `ui-jobs` never matches `ui-jobs-extra`. */
const CORPUS_DIRS = CORPUS_PACKAGES.map(pkg => join(PACKAGES_ROOT, 'client', pkg) + sep)

/** Every token ui-theme's sheets declare, from all of `src/styles/`. */
const definedTokens = new Set<string>()
for (const name of readdirSync(STYLES_DIR)) {
  if (!name.endsWith('.css')) continue
  for (const rule of parseRules(readFileSync(join(STYLES_DIR, name), 'utf8'))) {
    for (const [property] of rule.declarations) definedTokens.add(property)
  }
}

/** One `--dsw-font*`/`--dsw-control*` read, with the declaration that reads it. */
interface TokenReference {
  token: string
  file: string
  selector: string
  property: string
}

/** Corpus stylesheets, keyed by their package, so a dropped package is visible. */
const corpusByPackage = new Map<string, string[]>(CORPUS_PACKAGES.map(pkg => [pkg, []]))
const references: TokenReference[] = []

for (const file of packageStylesheets()) {
  const owner = CORPUS_DIRS.findIndex(dir => file.startsWith(dir))
  if (owner === -1) continue
  corpusByPackage.get(CORPUS_PACKAGES[owner]!)!.push(file)
  for (const rule of parseRules(readFileSync(file, 'utf8'))) {
    for (const [property, value] of rule.declarations) {
      for (const token of varReferences(value)) {
        if (TOKEN_PREFIXES.some(prefix => token.startsWith(prefix))) {
          references.push({ token, file, selector: rule.selectors.join(', '), property })
        }
      }
    }
  }
}

describe('font-token references', () => {
  it('reads every package it names, so the corpus is honest', () => {
    for (const [pkg, files] of corpusByPackage) {
      expect(files.length, `${pkg} contributes no stylesheet`).toBeGreaterThan(0)
    }
  })

  it('resolves its definition side from ui-theme/src/styles', () => {
    // Pins the source of truth the contract checks against: a scale role, its
    // family part, and the control hit target.
    expect(definedTokens.has('--dsw-font-ui-body')).toBe(true)
    expect(definedTokens.has('--dsw-font-data-font-family')).toBe(true)
    expect(definedTokens.has('--dsw-control-hit-target')).toBe(true)
  })

  it('finds font references in the corpus, so the check is not vacuous', () => {
    expect(references.length).toBeGreaterThan(0)
  })

  it('defines every --dsw-font* and --dsw-control* token the corpus reads', () => {
    const dangling = references
      .filter(({ token }) => !definedTokens.has(token))
      .map(({ token, file, selector, property }) => `${file} \`${selector}\` { ${property} } reads undefined ${token}`)
    expect(dangling).toEqual([])
  })
})
