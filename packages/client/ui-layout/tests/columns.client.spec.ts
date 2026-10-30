import { describe, expect, it } from 'vitest'
import {
  clampWidth, computeColumns, drawerWidth, shellRegime, SHELL_PHONE_BREAKPOINT,
  SHELL_TABLET_BREAKPOINT, SIDEBAR_AUTO_COLLAPSE,
} from '../src/client/columns.ts'

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(250.4, 240, 420)).toBe(250)
    expect(clampWidth(100, 240, 420)).toBe(240)
    expect(clampWidth(9999, 240, 420)).toBe(420)
  })
})

describe('computeColumns', () => {
  it('gives each edge column its preference when the center has enough room', () => {
    expect(computeColumns(1920, 280, 864)).toEqual({ sidebar: 280, center: 776, rightbar: 864 })
  })

  it('keeps only the left rail when both panels are closed', () => {
    expect(computeColumns(1920, 0, 0)).toEqual({ sidebar: 56, center: 1864, rightbar: 0 })
  })

  it('clamps sidebar preferences and limits the right panel to 70% of the frame', () => {
    expect(computeColumns(3000, 9999, 9999)).toEqual({ sidebar: 420, center: 480, rightbar: 2100 })
    expect(computeColumns(1920, 1, 1)).toEqual({ sidebar: 264, center: 1356, rightbar: 300 })
  })

  it.each([
    [1300, 280, 620, 400],
    [1100, 280, 420, 400],
    [1120, 420, 300, 400],
    [1119, 420, 0, 699],
    [1024, 420, 0, 604],
    [756, 0, 300, 400],
    [755, 0, 0, 699],
    [455, 0, 0, 399],
    [20, 0, 0, 0],
  ])('solves frame %i and sidebar %i to right %i and center %i', (viewport, sidebar, rightbar, center) => {
    expect(computeColumns(viewport, sidebar, 864)).toEqual({ sidebar: sidebar || 56, center, rightbar })
  })

  it('does not reduce the wide sidebar to keep a normal right panel open', () => {
    expect(computeColumns(1024, 420, 500)).toEqual({ sidebar: 420, center: 604, rightbar: 0 })
  })

  it('restores a still-open preference when the frame widens', () => {
    expect(computeColumns(1100, 280, 864).rightbar).toBe(420)
    expect(computeColumns(1920, 280, 864).rightbar).toBe(864)
  })

  it('leaves a closed right track closed when the frame widens', () => {
    expect(computeColumns(755, 0, 0).rightbar).toBe(0)
    expect(computeColumns(1920, 0, 0).rightbar).toBe(0)
  })
})

describe('shellRegime', () => {
  it.each([
    [1920, 'wide'],
    [1440, 'wide'],
    [1024, 'wide'],
    [1023, 'tablet'],
    [900, 'tablet'],
    [768, 'tablet'],
    [767, 'phone'],
    [360, 'phone'],
    [0, 'phone'],
  ] as const)('resolves a %ipx frame to the %s regime', (viewport, regime) => {
    expect(shellRegime(viewport)).toBe(regime)
  })

  it('binds the tablet breakpoint to the rail auto-collapse boundary', () => {
    expect(SHELL_TABLET_BREAKPOINT).toBe(SIDEBAR_AUTO_COLLAPSE)
    expect(shellRegime(SHELL_TABLET_BREAKPOINT)).toBe('wide')
    expect(shellRegime(SHELL_TABLET_BREAKPOINT - 1)).toBe('tablet')
    expect(shellRegime(SHELL_PHONE_BREAKPOINT)).toBe('tablet')
    expect(shellRegime(SHELL_PHONE_BREAKPOINT - 1)).toBe('phone')
  })
})

describe('drawerWidth', () => {
  it.each([
    [360, 302],
    [400, 320],
    [767, 320],
    [1023, 320],
    [1920, 320],
  ])('caps the drawer at most of a %ipx frame to %ipx', (viewport, width) => {
    expect(drawerWidth(viewport)).toBe(width)
  })
})
