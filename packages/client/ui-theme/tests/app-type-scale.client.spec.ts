/**
 * The app type scale in app-type-scale.css, asserted against the CSS text on
 * disk. The sheet is the single definition of the brand's eight interface
 * roles, so the exact size/line-height/weight of each role, the serif-is-italic
 * rule, the mono-caps tracking rule, and the theme-independence of the scale
 * are pinned here rather than restated per consumer.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseRules } from './stylesheet-scan.ts'

const sheetPath = fileURLToPath(new URL('../src/styles/app-type-scale.css', import.meta.url))
const sheetCss = readFileSync(sheetPath, 'utf8')
const rules = parseRules(sheetCss)
const declarations = rules.flatMap(rule => rule.declarations)
const value = (property: string): string | undefined =>
  declarations.find(([name]) => name === property)?.[1]

/** Every role's full token trio: the composite shorthand plus the size, line-height, and weight it fixes. */
const ROLES = [
  ['app-title', 'italic 500 28px/31px var(--dsw-font-family-serif)', '28px', '31px', '500', 'italic'],
  ['screen-title', '600 20px/25px var(--dsw-font-family)', '20px', '25px', '600', 'normal'],
  ['panel-label', '600 15px/20px var(--dsw-font-family)', '15px', '20px', '600', 'normal'],
  ['ui-body', '400 14px/21px var(--dsw-font-family)', '14px', '21px', '400', 'normal'],
  ['control', '500 14px/1 var(--dsw-font-family)', '14px', '1', '500', 'normal'],
  ['caption', '400 12px/17px var(--dsw-font-family)', '12px', '17px', '400', 'normal'],
  ['overline', '400 11px/14px var(--ds-font-family-code)', '11px', '14px', '400', 'normal'],
  ['data', '400 12.5px/19px var(--ds-font-family-code)', '12.5px', '19px', '400', 'normal'],
  ['data-strong', '500 12.5px/19px var(--ds-font-family-code)', '12.5px', '19px', '500', 'normal'],
] as const

describe('app-type-scale.css roles', () => {
  it.each(ROLES)('pins the %s role to its brand shorthand and companions', (role, shorthand, size, lineHeight, weight, style) => {
    expect(value(`--dsw-font-${role}`)).toBe(shorthand)
    expect(value(`--dsw-font-${role}-font-size`)).toBe(size)
    expect(value(`--dsw-font-${role}-line-height`)).toBe(lineHeight)
    expect(value(`--dsw-font-${role}-font-weight`)).toBe(weight)
    expect(value(`--dsw-font-${role}-font-style`)).toBe(style)
  })

  it('declares the button hit target as a role minimum', () => {
    expect(value('--dsw-control-hit-target')).toBe('44px')
  })

  it('keeps the smallest interface text at the caption size and the mono overline as the one 11px role', () => {
    const below12 = ROLES.filter(([, , size]) => Number.parseFloat(size) < 12)
    expect(below12.map(([role]) => role)).toEqual(['overline'])
    expect(value('--dsw-font-caption-font-size')).toBe('12px')
  })

  it('reserves letter-spacing for the mono caps, never for lowercase Geist', () => {
    const tracked = declarations.filter(([name]) => name.endsWith('letter-spacing'))
    expect(tracked).toEqual([['--dsw-font-overline-letter-spacing', '0.12em']])
    expect(value('--dsw-font-overline-text-transform')).toBe('uppercase')
  })

  it('sets the serif only on the italic app title, never on body copy or a control', () => {
    const serifTokens = declarations.filter(([, v]) => v.includes('--dsw-font-family-serif')).map(([name]) => name)
    expect(serifTokens.sort()).toEqual([
      '--dsw-font-app-title',
      '--dsw-font-app-title-font-family',
    ])
    expect(value('--dsw-font-app-title-font-style')).toBe('italic')
  })

  it('gives the data roles tabular figures so numeric columns align', () => {
    expect(value('--dsw-font-data-font-variant-numeric')).toBe('tabular-nums')
    expect(value('--dsw-font-data-strong-font-variant-numeric')).toBe('tabular-nums')
  })
})

describe('app-type-scale.css theme independence', () => {
  it('declares the whole scale on :root alone, so no palette can restyle it', () => {
    expect(rules).toHaveLength(1)
    expect(rules[0]?.selectors).toEqual([':root'])
    // A palette override would arrive as a body[data-ds-dark-theme] rule; the
    // scale is typography and must stay identical in every theme.
    expect(sheetCss).not.toContain('data-ds-dark-theme')
  })
})
