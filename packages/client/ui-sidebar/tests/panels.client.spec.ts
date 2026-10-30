/**
 * Panellist projection and grouping: registration options become published
 * panel metadata (thunks resolved once, at publish time), and that metadata
 * becomes the mode bar's tabs and the per-mode accordions.
 */
import { describe, expect, it } from 'vitest'
import { accordionKey, panelLayout, projectPanels, samePanels, type PanelRegistration } from '../src/client/panels.ts'
import type { SidebarPanelMetadata } from '../src/client/contract/slots.ts'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'

const id = (value: string): MainPanelId => value as MainPanelId

/**
 * One registration as the registry stores it.
 * @param panelId - list id.
 * @param order - row order.
 * @returns the registration with an omitted label.
 */
function registration(panelId: string, order: number): PanelRegistration {
  return { options: { id: panelId, order } }
}

describe('projectPanels', () => {
  it('resolves label, mode, group, and badge thunks at publish time', () => {
    const projected = projectPanels([{
      options: {
        id: 'board',
        order: 10,
        label: () => 'Board',
        mode: () => 'operate',
        group: () => 'Workspace',
        badge: () => '3',
      },
    }])
    expect(projected).toEqual([{
      id: 'board', order: 10, label: 'Board', mode: 'operate', group: 'Workspace', badge: '3',
    }])
  })

  it('keeps placement members out of the metadata when the registration omits them', () => {
    const projected = projectPanels([{ options: { id: 'inbox', order: 0, label: 'Inbox' } }])
    expect(projected).toEqual([{ id: 'inbox', order: 0, label: 'Inbox' }])
    expect(Object.keys(projected[0] ?? {})).toEqual(['id', 'order', 'label'])
  })

  it('falls back to the id as the label and to order zero', () => {
    expect(projectPanels([registration('bare', 0)])).toEqual([{ id: 'bare', order: 0, label: 'bare' }])
  })

  it('sorts ascending by order and keeps registration order for ties', () => {
    const projected = projectPanels([
      { options: { id: 'late', order: 20, label: 'Late' } },
      { options: { id: 'first', order: 5, label: 'First' } },
      { options: { id: 'tied', order: 20, label: 'Tied' } },
    ])
    expect(projected.map(panel => panel.id)).toEqual(['first', 'late', 'tied'])
  })
})

describe('samePanels', () => {
  const row: SidebarPanelMetadata = { id: id('board'), order: 10, label: 'Board', mode: 'operate' }

  it('matches identical projections and length differences', () => {
    expect(samePanels([row], [{ ...row }])).toBe(true)
    expect(samePanels([row], [])).toBe(false)
    expect(samePanels([], [{ ...row }])).toBe(false)
  })

  it.each([
    ['id', { ...row, id: id('inbox') }],
    ['order', { ...row, order: 20 }],
    ['label', { ...row, label: 'Inbox' }],
    ['mode', { ...row, mode: 'learn' }],
    ['group', { ...row, group: 'Workspace' }],
    ['badge', { ...row, badge: '3' }],
  ])('detects a changed %s', (_field, changed) => {
    expect(samePanels([row], [changed])).toBe(false)
  })
})

describe('panelLayout', () => {
  const flat: readonly SidebarPanelMetadata[] = [
    { id: id('board'), order: 10, label: 'Board' },
    { id: id('inbox'), order: 20, label: 'Inbox' },
  ]
  const placed: readonly SidebarPanelMetadata[] = [
    { id: id('board'), order: 10, label: 'Board', mode: 'operate', group: 'Workspace', badge: '2' },
    { id: id('inbox'), order: 20, label: 'Inbox', mode: 'operate', group: 'Workspace' },
    { id: id('routing'), order: 30, label: 'Routing', mode: 'admin', group: 'Tenant' },
    { id: id('guide'), order: 40, label: 'Guide', mode: 'learn' },
  ]

  it('renders a flat list with no bar and no accordions when no row declares a mode', () => {
    const layout = panelLayout(flat, undefined)
    expect(layout).toEqual({
      tabs: [],
      showModeBar: false,
      mode: undefined,
      unplaced: flat,
      modeRows: [],
      accordions: [],
    })
  })

  it('collects one tab per mode in registration order, using the first row as the glyph', () => {
    const layout = panelLayout(placed, undefined)
    expect(layout.tabs).toEqual([
      { mode: 'operate', glyph: 'board' },
      { mode: 'admin', glyph: 'routing' },
      { mode: 'learn', glyph: 'guide' },
    ])
    expect(layout.showModeBar).toBe(true)
    expect(layout.mode).toBe('operate')
  })

  it('buckets the displayed mode by group and trails ungrouped rows headingless', () => {
    const layout = panelLayout(placed, 'learn')
    expect(layout.modeRows.map(row => row.id)).toEqual(['guide'])
    expect(layout.accordions.map(accordion => [accordion.group, accordion.rows.length])).toEqual([
      [undefined, 1],
    ])
  })

  it('groups rows that declare a group and counts them per bucket', () => {
    const layout = panelLayout(placed, 'operate')
    expect(layout.accordions.map(accordion => [accordion.group, accordion.rows.length])).toEqual([
      ['Workspace', 2],
    ])
  })

  it('keeps rows that declare no mode visible in every mode', () => {
    const rows: readonly SidebarPanelMetadata[] = [
      { id: id('pinned'), order: 0, label: 'Pinned' },
      { id: id('board'), order: 10, label: 'Board', mode: 'operate', group: 'Workspace' },
      { id: id('routing'), order: 20, label: 'Routing', mode: 'admin', group: 'Tenant' },
    ]
    const layout = panelLayout(rows, 'admin')
    expect(layout.unplaced.map(row => row.id)).toEqual(['pinned'])
    expect(layout.modeRows.map(row => row.id)).toEqual(['routing'])
    expect(layout.accordions.map(accordion => accordion.group)).toEqual(['Tenant'])
  })

  it('falls back to the first mode when the pick is gone', () => {
    expect(panelLayout(placed, 'retired').mode).toBe('operate')
  })
})

describe('accordionKey', () => {
  it('keeps one state key per mode+group pair', () => {
    expect(accordionKey('operate', 'Workspace')).toBe(accordionKey('operate', 'Workspace'))
    expect(accordionKey('operate', 'Workspace')).not.toBe(accordionKey('operate', 'Tenant'))
    expect(accordionKey('operate', 'Workspace')).not.toBe(accordionKey('learn', 'Workspace'))
    expect(accordionKey('operate', 'Workspace')).not.toBe(accordionKey('operate', undefined))
  })
})
