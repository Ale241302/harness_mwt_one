import { describe, expect, it } from 'vitest'
import { panelLayout, projectPanels, samePanels } from '../src/client/sidebar/panels.ts'

/** One panellist registration shaped as the slot registry stores it. */
function row(id: string, options: Record<string, unknown> = {}) {
  return {
    options: {
      id,
      order: 0,
      label: id,
      ...options,
    },
  }
}

describe('projectPanels', () => {
  it('resolves placement thunks and orders rows ascending', () => {
    const panels = projectPanels([
      row('b', { order: 20, mode: () => 'Operar', group: () => 'Trabajo', badge: () => '3' }),
      row('a', { order: 10 }),
    ])
    expect(panels.map(panel => panel.id)).toEqual(['a', 'b'])
    expect(panels[1]).toMatchObject({ mode: 'Operar', group: 'Trabajo', badge: '3' })
    // A registration that declares no placement keeps those members out.
    expect(panels[0]).not.toHaveProperty('mode')
  })

  it('reports an unchanged projection so subscribers do not wake', () => {
    const entries = [row('a', { order: 10, mode: () => 'Operar' })]
    expect(samePanels(projectPanels(entries), projectPanels(entries))).toBe(true)
    expect(samePanels(projectPanels(entries), projectPanels([...entries, row('b')]))).toBe(false)
  })

  it('reads the placement kept beside the registration', () => {
    // A Host registry that drops unknown registration members stores no group;
    // the shell still groups the row from its own sidecar.
    const panels = projectPanels(
      [row('board', { order: 20 })],
      id => (id === 'board' ? { group: () => 'Trabajo', badge: () => '3' } : undefined),
    )
    expect(panels[0]).toMatchObject({ group: 'Trabajo', badge: '3' })
  })
})

describe('panelLayout', () => {
  const panels = projectPanels([
    row('board', { order: 20, mode: () => 'Operar', group: () => 'Trabajo' }),
    row('spaces', { order: 30, mode: () => 'Operar', group: () => 'Trabajo' }),
    row('mail', { order: 40, mode: () => 'Entrada', group: () => 'Entrada' }),
    row('memory', { order: 60, mode: () => 'Aprender', group: () => 'Conocimiento' }),
    row('admin', { order: 70, mode: () => 'Admin', group: () => 'Configuración' }),
  ])

  it('builds one tab per mode in registration order and shows the first', () => {
    const layout = panelLayout(panels, undefined)
    expect(layout.tabs.map(tab => tab.mode)).toEqual(['Operar', 'Entrada', 'Aprender', 'Admin'])
    expect(layout.showModeBar).toBe(true)
    expect(layout.mode).toBe('Operar')
  })

  it('groups the displayed mode into accordions carrying their row counts', () => {
    const layout = panelLayout(panels, 'Operar')
    expect(layout.accordions).toHaveLength(1)
    expect(layout.accordions[0]?.group).toBe('Trabajo')
    expect(layout.accordions[0]?.rows.map(panel => panel.id)).toEqual(['board', 'spaces'])
  })

  it('falls back to the first mode when the pick no longer exists', () => {
    expect(panelLayout(panels, 'Desconocido').mode).toBe('Operar')
  })

  it('keeps rows that declare no mode visible in every layout', () => {
    const withFlat = [...panels, ...projectPanels([row('extra', { order: 5 })])]
    const layout = panelLayout(withFlat, 'Entrada')
    expect(layout.unplaced.map(panel => panel.id)).toEqual(['extra'])
    expect(layout.modeRows.map(panel => panel.id)).toEqual(['mail'])
  })

  it('groups every row into accordions when no mode is declared', () => {
    // The product's sidebar declares groups only, so the whole list is one
    // bucket and its groups still fold.
    const grouped = projectPanels([
      row('board', { order: 20, group: () => 'Trabajo' }),
      row('spaces', { order: 30, group: () => 'Trabajo' }),
      row('mail', { order: 40, group: () => 'Herramientas' }),
    ])
    const layout = panelLayout(grouped, undefined)
    expect(layout.showModeBar).toBe(false)
    expect(layout.unplaced).toEqual([])
    expect(layout.accordions.map(accordion => accordion.group)).toEqual(['Trabajo', 'Herramientas'])
    expect(layout.accordions[0]?.rows.map(panel => panel.id)).toEqual(['board', 'spaces'])
  })

  it('hides the mode bar when a single mode is declared', () => {
    const oneMode = projectPanels([row('a', { mode: () => 'Operar' })])
    expect(panelLayout(oneMode, undefined).showModeBar).toBe(false)
  })
})
