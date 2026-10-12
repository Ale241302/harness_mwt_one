/**
 * The built-in palette catalog: five palettes, complete on the core alias
 * roles, and the ids the durable preference and the boot style resolve against.
 */
import { describe, expect, it } from 'vitest'
import { THEME_PALETTES, THEME_PALETTE_IDS, paletteById } from '../src/theme-palettes.ts'
import { THEME_PREFERENCES, isThemePreference } from '../src/theme-settings.ts'

/** The alias roles every palette must answer for the shell to read as one theme. */
const CORE_ROLES = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-brand-primary',
  '--dsw-alias-brand-primary-new-colorprimary-new-color',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-business-primary',
] as const

describe('built-in palettes', () => {
  it('lists the five palettes in registry order, three dark and two light', () => {
    expect(THEME_PALETTES.map(entry => entry.id)).toEqual([...THEME_PALETTE_IDS])
    expect(THEME_PALETTES.filter(entry => entry.colorScheme === 'dark').map(entry => entry.id))
      .toEqual(['dark', 'slate', 'mono'])
    expect(THEME_PALETTES.filter(entry => entry.colorScheme === 'light').map(entry => entry.id))
      .toEqual(['light', 'cloud'])
    // The pair a `system` preference resolves between keeps its meaning.
    expect(paletteById('light')?.colorScheme).toBe('light')
    expect(paletteById('dark')?.colorScheme).toBe('dark')
  })

  it('answers every core alias role with a real colour', () => {
    for (const entry of THEME_PALETTES) {
      for (const role of CORE_ROLES) {
        const value = entry.tokens[role]
        expect(value, `${entry.id} is missing ${role}`).toBeTruthy()
        expect(String(value), `${entry.id} ${role}`).toMatch(/^(?:#[0-9A-Fa-f]{3,8}|rgba?\()/u)
      }
    }
  })

  it('keeps the palette families distinct and the accent in the coral family', () => {
    for (const entry of THEME_PALETTES) {
      const ground = entry.tokens['--dsw-alias-bg-base'] ?? ''
      expect(ground, entry.id).toBe(entry.ground)
      if (entry.colorScheme === 'dark') expect(ground, entry.id).toMatch(/^#(?:0|1)/u)
      else expect(ground, entry.id).toMatch(/^#[DE-F]/iu)
      expect(entry.tokens['--dsw-alias-brand-primary'], entry.id).toMatch(/^#(?:C|D)/iu)
    }
  })

  it('names every palette and resolves it by id', () => {
    for (const entry of THEME_PALETTES) {
      expect(entry.name.length).toBeGreaterThan(0)
      expect(paletteById(entry.id)).toBe(entry)
    }
    expect(paletteById('midnight')).toBeUndefined()
  })

  it('accepts exactly the built-in ids plus system as a durable preference', () => {
    expect(THEME_PREFERENCES).toEqual([...THEME_PALETTE_IDS, 'system'])
    for (const preference of THEME_PREFERENCES) expect(isThemePreference(preference)).toBe(true)
    expect(isThemePreference('sepia')).toBe(false)
    expect(isThemePreference('')).toBe(false)
  })
})

/**
 * The two-tone wordmark reads its halves from aliases the palettes own:
 * BrandWordmark paints "Faber" with the coral alias and "Loom" with the label
 * alias. These assertions keep a later palette edit from collapsing either
 * half: Faber stays coral and distinct in every palette, and Loom flexes to a
 * light colour on every dark palette (its cream on the warm-dark ground) and to
 * the ground ink on every light one.
 */
describe('wordmark halves across the built-in palettes', () => {
  const CORAL_ALIAS = '--dsw-alias-brand-primary-new-colorprimary-new-color'
  const LOOM_ALIAS = '--dsw-alias-label-primary'

  /** A palette colour as its three 0-255 channels. */
  const rgb = (hex: string): [r: number, g: number, b: number] => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]

  it('paints Faber coral in every palette, never the Loom ink', () => {
    for (const entry of THEME_PALETTES) {
      const coral = entry.tokens[CORAL_ALIAS] ?? ''
      expect(coral, entry.id).toMatch(/^#[0-9A-Fa-f]{6}$/u)
      const [red, green, blue] = rgb(coral)
      expect(red, `${entry.id} coral: red leads green`).toBeGreaterThan(green)
      expect(green, `${entry.id} coral: green leads blue`).toBeGreaterThan(blue)
      expect(red - blue, `${entry.id} coral: warm separation`).toBeGreaterThanOrEqual(100)
      // The coral half is the same accent the rest of the UI actions use.
      expect(coral, entry.id).toBe(entry.tokens['--dsw-alias-brand-primary'])
      expect(entry.tokens[LOOM_ALIAS], `${entry.id} coral and loom differ`).not.toBe(coral)
    }
  })

  it('flexes Loom to a light colour on every dark palette', () => {
    for (const entry of THEME_PALETTES.filter(candidate => candidate.colorScheme === 'dark')) {
      const [red, green, blue] = rgb(entry.tokens[LOOM_ALIAS] ?? '')
      expect(Math.min(red, green, blue), `${entry.id} Loom is light`).toBeGreaterThanOrEqual(200)
    }
  })

  it('keeps Loom as the ground ink on every light palette', () => {
    for (const entry of THEME_PALETTES.filter(candidate => candidate.colorScheme === 'light')) {
      const [red, green, blue] = rgb(entry.tokens[LOOM_ALIAS] ?? '')
      expect(Math.max(red, green, blue), `${entry.id} Loom is dark ink`).toBeLessThanOrEqual(60)
    }
  })
})
