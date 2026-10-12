/**
 * The built-in palette catalog: five palettes, complete on the core alias
 * roles, and the ids the durable preference and the boot style resolve against.
 */
import { describe, expect, it } from 'vitest'
import { THEME_PALETTES, THEME_PALETTE_IDS, THEME_PALETTE_NAMES, paletteById } from '../src/theme-palettes.ts'
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
      expect(THEME_PALETTE_NAMES[entry.id]).toBe(entry.name)
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
