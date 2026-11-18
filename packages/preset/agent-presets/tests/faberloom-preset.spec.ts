/**
 * The `faberloom` preset is the product's agent plane: it must ship the work
 * agent without the rows that can reach the network on their own, because E1's
 * authority denies writes inside the process and cannot deny a shell socket.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const preset = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../presets/faberloom/${name}`, import.meta.url)), 'utf8')

/** Top-level row ids; nested group rows are indented and not part of this list. */
function rowIds(yaml: string): string[] {
  return [...yaml.matchAll(/^- id: (.+)$/gmu)].map(match => (match[1] ?? '').trim())
}

describe('faberloom preset', () => {
  it('ships its own name and description', () => {
    const metadata = preset('preset.yml')
    expect(metadata).toMatch(/^name: FaberLoom$/mu)
    expect(metadata).toMatch(/^description: .+$/mu)
  })

  it('omits every row that can reach the network or run arbitrary code', () => {
    const ids = rowIds(preset('agent.cordis.yml'))
    for (const row of ['tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-jobs', 'tool-web']) {
      expect({ row, present: ids.includes(row) }).toEqual({ row, present: false })
    }
  })

  it('keeps the rows the work agent needs', () => {
    const ids = rowIds(preset('agent.cordis.yml'))
    for (const row of ['persona', 'agent-instructions', 'skills', 'delegation', 'tool-todo', 'present']) {
      expect({ row, present: ids.includes(row) }).toEqual({ row, present: true })
    }
  })

  it('is the default preset of the product bundle', () => {
    const patch = readFileSync(
      fileURLToPath(new URL('../../../bundle/faberloom-app/cordis.patch.yml', import.meta.url)),
      'utf8',
    )
    expect(patch).toMatch(/- id: agent-presets\n\s+config:\n\s+default: faberloom\n\s+modeSelectionEnabled: false/u)
  })
})
