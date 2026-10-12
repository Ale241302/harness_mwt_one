/** Sidebar shell style contracts shared with its slot-owned controls. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one exact selector, keyed by property.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('SidebarRoot.module.css', () => {
  it('shares and cancels the wide shell trailing padding structurally', () => {
    const root = declarations('.root')
    expect(root?.get('--dsh-sidebar-inline-padding')).toBe('12px')
    expect(root?.get('padding')).toBe('6px var(--dsh-sidebar-inline-padding)')
    expect(declarations('.regionArea')?.get('margin-left')).toBe('-4px')
    expect(declarations('.regionArea')?.get('padding-left')).toBe('4px')
    expect(declarations('.regionArea')?.get('margin-right')).toBe(
      'calc(-1 * var(--dsh-sidebar-inline-padding))',
    )
    expect(declarations('.collapsed .regionArea')?.get('margin-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('padding-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('margin-right')).toBe('0')
  })

  it('moves the four upper controls while the settings seat only fades', () => {
    const animation = 'rail-in 150ms var(--ds-ease-in-out) backwards'
    for (const selector of [
      '.railIn .iconButton',
      '.railIn .newSession',
      '.railIn .regionArea',
    ]) {
      expect(declarations(selector)?.get('animation')).toBe(animation)
    }
    expect(declarations('.railIn .footArea')?.get('animation')).toBe(
      'rail-fade-in 150ms var(--ds-ease-in-out) backwards',
    )
    expect(css).toMatch(
      /@keyframes rail-in\s*\{\s*from\s*\{\s*opacity: 0;\s*transform: translateX\(49px\);\s*}\s*}/,
    )
    expect(css).toMatch(/@keyframes rail-fade-in\s*\{\s*from\s*\{\s*opacity: 0;\s*}\s*}/)
  })

  it('gives shell rail controls the same base anchor for their shared translation', () => {
    expect(declarations('.collapsed .logoRow')?.get('justify-content')).toBe('flex-start')
    expect(declarations('.collapsed .newSession')?.get('align-self')).toBe('flex-start')
    expect(declarations('.collapsed .newSession')?.get('width')).toBe('36px')
  })

  it('renders footer actions to the right of Settings when wide and above it in the rail', () => {
    // DOM order is [footerActions][settingsArea]; the reversed row axis is what
    // renders Settings first with the actions beside it. The rail restores the
    // column so the actions sit above the Settings icon.
    expect(declarations('.footArea')?.get('flex-direction')).toBe('row-reverse')
    expect(declarations('.footArea')?.get('align-items')).toBe('center')
    expect(declarations('.settingsArea')?.get('flex')).toBe('1')
    expect(declarations('.footerActions')?.get('flex')).toBe('none')
    expect(declarations('.collapsed .footArea')?.get('flex-direction')).toBe('column')
    expect(declarations('.collapsed .settingsArea')?.get('flex')).toBe('none')
    expect(declarations('.collapsed .settingsArea')?.get('width')).toBe('auto')
  })

  it('keeps the slotted brand row at the full artwork height', () => {
    expect(declarations('.brandIdentity')?.get('height')).toBe('24px')
    expect(declarations('.brandName')?.get('height')).toBe('24px')
    expect(declarations('.brandName')?.get('line-height')).toBe('24px')
    expect(declarations('.brandName')?.get('font-size')).toBe('18px')
    expect(declarations('.fallbackBrandName')?.get('font-size')).toBe('17px')
    expect(declarations('.fallbackBrandName')?.get('white-space')).toBe('nowrap')
  })
})

describe('SidebarRoot.module.css panel placement', () => {
  it('makes the panel list a query container so a narrow column degrades in place', () => {
    expect(declarations('.panelList')?.get('container-type')).toBe('inline-size')
    expect(declarations('.panelList')?.get('min-width')).toBe('0')
    expect(css).toMatch(/@container \(max-width: 300px\) \{/)
  })

  it('truncates the heading and the row title with ellipsis', () => {
    for (const selector of ['.accordionTitle', '.panelTitle']) {
      expect(declarations(selector)?.get('overflow')).toBe('hidden')
      expect(declarations(selector)?.get('text-overflow')).toBe('ellipsis')
      expect(declarations(selector)?.get('white-space')).toBe('nowrap')
    }
  })

  it('hides the collapsed accordion body against its column display', () => {
    expect(declarations('.accordionBody')?.get('display')).toBe('flex')
    expect(declarations('.accordionBody[hidden]')?.get('display')).toBe('none')
  })

  it('keeps 44px hit targets on touch pointers', () => {
    const block = /@media \(pointer: coarse\) \{([\s\S]*?)\n}/.exec(css)?.[1] ?? ''
    for (const selector of ['.modeButton', '.accordionHead', '.panelRow']) {
      expect(block).toContain(selector)
    }
    expect(block).toContain('min-height: 44px')
  })

  it('stacks the mode bar in the rail and keeps the 36px rail controls', () => {
    expect(declarations('.collapsed .modeBar')?.get('flex-direction')).toBe('column')
    expect(declarations('.collapsed .modeButton')?.get('height')).toBe('36px')
  })

  it('paints with theme tokens only, never a literal color', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|lab|lch)\(/)
  })
})
