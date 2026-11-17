/**
 * The two looks may only paint with tokens that exist. A `var(--x)` with no
 * declaration and no fallback is not a warning: the property is dropped at
 * computed-value time, so the rule runs and nothing changes on screen. This spec
 * pins the set of tokens that are used and undeclared, so a new one has to be
 * named here (and in `docs/scratch/faberloom-daily-work/f1/token-map.md`) before
 * it can ship.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const themeDir = fileURLToPath(new URL('../../ui-theme/src/', import.meta.url))
const faberloomDir = fileURLToPath(new URL('../src/client/', import.meta.url))

/** Every file under a directory whose name ends with one of the suffixes. */
function collect(dir: string, suffixes: readonly string[]): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}${entry.name}`
    if (entry.isDirectory()) found.push(...collect(`${path}/`, suffixes))
    else if (suffixes.some(suffix => entry.name.endsWith(suffix))) found.push(path)
  }
  return found
}

/** Source text with block comments removed, so a comment cannot declare a token. */
function readable(file: string): string {
  const text = readFileSync(file, 'utf8')
  return file.endsWith('.css') ? text.replace(/\/\*[\s\S]*?\*\//g, ' ') : text
}

/** Token names declared either as `--x:` in CSS or as a quoted key in TSX. */
function declaredTokens(files: readonly string[]): Set<string> {
  const declared = new Set<string>()
  for (const file of files) {
    const text = readable(file)
    for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(match[1] ?? '')
    for (const match of text.matchAll(/['"](--[a-z0-9-]+)['"]\s*:/gi)) declared.add(match[1] ?? '')
  }
  return declared
}

/** Token names consumed through `var(--x)` or a quoted key lookup. */
function usedTokens(files: readonly string[]): Map<string, string[]> {
  const used = new Map<string, string[]>()
  for (const file of files) {
    const text = readable(file)
    for (const match of text.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
      const token = match[1] ?? ''
      used.set(token, [...(used.get(token) ?? []), file])
    }
  }
  return used
}

/**
 * Tokens the product reads without declaring them. Each entry names where it is
 * read and what happens today: a fallback paints a fixed colour that ignores the
 * theme, and no fallback drops the property.
 */
const KNOWN_UNDECLARED: Record<string, string> = {
  '--dsw-alias-bg-secondary': 'panel-boundary.tsx: fallback #1b1b1b, the ground ignores the theme',
  '--dsw-alias-border-danger': 'panel-boundary.tsx: fallback #b42318, the error border ignores the palette',
  '--dsw-alias-border-subtle': 'faberloom.module.css: no fallback, the hairline colour is dropped',
  '--dsw-alias-border-accent': 'faberloom.module.css: no fallback, the focus border matches the neutral one',
  '--dsw-alias-state-error-text': 'faberloom.module.css: fallback #c0392b, error text ignores the palette',
  '--dsh-content-font-size': 'gradient-shadow-text.css: fallback 14px, the user font size is ignored',
  '--dsw-font-family-mono': 'panel-boundary.tsx: fallback ui-monospace, not the product family',
}

const themeSources = collect(themeDir, ['.css', '.ts', '.tsx'])
const faberloomSources = collect(faberloomDir, ['.css', '.tsx'])

describe('appearance tokens', () => {
  it('declares the theme catalogue it ships', () => {
    const declared = declaredTokens(themeSources)
    expect(declared.size).toBeGreaterThan(300)
    expect(declared.has('--dsw-alias-bg-base')).toBe(true)
  })

  it('reads no token that is neither declared nor documented as missing', () => {
    const declared = declaredTokens([...themeSources, ...faberloomSources])
    const used = usedTokens([...themeSources, ...faberloomSources])

    const undeclared = [...used.keys()].filter(token => !declared.has(token)).sort()
    const undocumented = undeclared.filter(token => !(token in KNOWN_UNDECLARED))

    expect(undocumented).toEqual([])
    expect(undeclared.length).toBe(Object.keys(KNOWN_UNDECLARED).length)
  })

  it('keeps every documented gap still real, so the list cannot rot', () => {
    const declared = declaredTokens([...themeSources, ...faberloomSources])
    for (const token of Object.keys(KNOWN_UNDECLARED)) {
      expect({ token, declared: declared.has(token) }).toEqual({ token, declared: false })
    }
  })
})
