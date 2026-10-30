/**
 * The table value role: an exact value (a date, an id, a version) carries the
 * data role, while prose keeps the UI-body role the table sets. jsdom carries
 * no computed styles, so this reads the declarations that make the split.
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

describe('FaberLoom table roles', () => {
  it('gives exact values the data role with tabular digits', () => {
    expect(declarations('.cellData')).toEqual(expect.arrayContaining([
      'font: var(--dsw-font-data)',
      'font-variant-numeric: var(--dsw-font-data-font-variant-numeric)',
    ]))
  })

  it('leaves prose on the UI-body role the table sets', () => {
    // The prose cell carries no font of its own, so it inherits the table's
    // body role; only the data class rebinds the face.
    expect(declarations('.table')).toEqual(expect.arrayContaining(['font: var(--dsw-font-ui-body)']))
    expect(declarations('.cellName')).not.toEqual(expect.arrayContaining(['font: var(--dsw-font-data)']))
  })
})
