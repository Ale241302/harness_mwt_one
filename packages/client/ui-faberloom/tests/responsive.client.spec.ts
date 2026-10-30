/**
 * The module screens must survive a narrow, floating, or split window and a
 * phone. jsdom has no layout, so these read the declarations that make the
 * split collapse, the table pan inside its own card, and the toolbar and field
 * grid stack at the phone breakpoint — the structural spec beside this one
 * asserts the rendered element order those rules act on.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  fileURLToPath(new URL('../src/client/faberloom.module.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ')

/** Declarations of the first rule whose selector matches exactly. */
function declarations(selector: string): string[] {
  const pattern = new RegExp(`(?:^|[{}])\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`)
  const rule = pattern.exec(source)
  if (rule === null) throw new Error(`no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

/** Body of the first media query with the given condition. */
function mediaBody(condition: string): string {
  const start = source.indexOf(`@media (${condition})`)
  if (start < 0) throw new Error(`no \`@media (${condition})\` block`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++
    else if (source[index] === '}') {
      depth--
      if (depth === 0) return source.slice(open + 1, index)
    }
  }
  throw new Error(`unterminated \`@media (${condition})\` block`)
}

describe('FaberLoom module responsiveness', () => {
  it('keeps horizontal overflow inside the table card', () => {
    expect(declarations('.screen')).toEqual(expect.arrayContaining(['overflow-x: hidden']))
    expect(declarations('.tableScroll')).toEqual(expect.arrayContaining(['overflow-x: auto']))
  })

  it('pins the table header while the rows scroll', () => {
    expect(declarations('.table thead th')).toEqual(expect.arrayContaining(['position: sticky', 'top: 0']))
  })

  it('collapses the split to one column below the tablet breakpoint', () => {
    const tablet = mediaBody('max-width: 1080px')
    expect(tablet).toContain('.split')
    expect(tablet).toContain('grid-template-columns: minmax(0, 1fr)')
  })

  it('stacks the toolbar, the field grid, and grows touch rows on a phone', () => {
    const phone = mediaBody('max-width: 767px')
    expect(phone).toContain('.toolbarTitle')
    expect(phone).toContain('.grid2')
    expect(phone).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(phone).toContain('min-height: 44px')
  })
})
