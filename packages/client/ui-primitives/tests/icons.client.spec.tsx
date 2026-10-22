// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconAlarmClockOutline16, IconApiOutline14, IconArchiveOutline20, IconFolderClose16,
  IconGoalOutline16, IconSendOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

// Icon components all share the IconProps signature; the barrel also exports
// non-icon atoms (different props shapes), so filter by prefix BEFORE typing.
const icons = Object.fromEntries(
  Object.entries(primitives).filter(([name]) => name.startsWith('Icon')),
) as Record<string, (p: primitives.IconProps) => React.JSX.Element>
const iconNames = Object.keys(icons)

describe('ic_ds_ icon set', () => {
  it('exports the full icon set (46 deepsuite + 21 figma extracts + twelve product glyphs outside those sets)', () => {
    expect(iconNames.length).toBe(79)
    // The composer menu's own glyphs, pinned by name.
    expect(iconNames).toEqual(expect.arrayContaining(['IconPlanOutline14', 'IconCompactOutline16', 'IconShieldOutline16']))
  })

  it('the permission selector composes its marks over the shield contour exported here', () => {
    const { container } = render(<primitives.IconShieldOutline16 />)
    expect(container.querySelector('path')?.getAttribute('d')).toBe(primitives.SHIELD_OUTLINE_PATH)
    expect(container.querySelector('path')?.getAttribute('stroke-width')).toBe(primitives.SHIELD_OUTLINE_STROKE)
  })

  it.each(iconNames)('%s renders an svg with currentColor fills and no hardcoded palette', (name) => {
    const Icon = icons[name]!
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const markup = container.innerHTML
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}"/)
    expect(markup).toContain('currentColor')
  })

  it('size and className props land on the root svg', () => {
    const { container } = render(<IconSendOutline14 size={20} className="x" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.getAttribute('height')).toBe('20')
    expect(svg.classList.contains('x')).toBe(true)
  })

  it('each glyph defaults to its own drawn size, not one set-wide default', () => {
    const api = render(<IconApiOutline14 />)
    expect(api.container.querySelector('svg')!.getAttribute('width')).toBe('14')
    const folder = render(<IconFolderClose16 />)
    expect(folder.container.querySelector('svg')!.getAttribute('width')).toBe('16')
    const archive = render(<IconArchiveOutline20 />)
    expect(archive.container.querySelector('svg')!.getAttribute('width')).toBe('20')
    const alarm = render(<IconAlarmClockOutline16 />)
    expect(alarm.container.querySelector('svg')!.getAttribute('width')).toBe('16')
  })

  it('renders reusable goal glyphs without document-global ids', () => {
    const { container } = render(<><IconGoalOutline16 /><IconGoalOutline16 /></>)
    expect(container.querySelector('[id]')).toBeNull()
    expect(container.querySelector('[clip-path]')).toBeNull()
  })
})

describe('FishLogo', () => {
  it('renders the fish path in currentColor at the native ratio', () => {
    const { container } = render(<primitives.FishLogo />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('24')
    expect(Number(svg.getAttribute('height'))).toBeCloseTo(17.66, 1)
    expect(svg.getAttribute('viewBox')).toBe('0 0 23.16 17.04')
    expect(container.querySelectorAll('path')).toHaveLength(1)
    expect(container.innerHTML).toContain('currentColor')
    expect(container.innerHTML).not.toContain('M0 0L23.16')
  })
})

// The FaberLoom families share one 24px grid and the same IconProps
// signature; filter by the FlIcon prefix before typing.
const flIcons = Object.fromEntries(
  Object.entries(primitives).filter(([name]) => name.startsWith('FlIcon')),
) as Record<string, (p: primitives.IconProps) => React.JSX.Element>
const flIconNames = Object.keys(flIcons)

describe('FaberLoom icon set', () => {
  it('exports the ten brand glyphs and the thirty-six standard glyphs', () => {
    expect(flIconNames).toHaveLength(46)
    expect(flIconNames).toEqual(expect.arrayContaining([
      'FlIconBrandLoom', 'FlIconCriterio', 'FlIconWorkloom', 'FlIconSpaceloom', 'FlIconStackloom',
      'FlIconVoice', 'FlIconLearningClock', 'FlIconKnowledgeIndex', 'FlIconCuration', 'FlIconWorkspace',
      'FlIconSearch', 'FlIconPlus', 'FlIconClose', 'FlIconChevron', 'FlIconArrow', 'FlIconArrowUp',
      'FlIconPanelLeft', 'FlIconPanelRight', 'FlIconHourglass', 'FlIconClock', 'FlIconRefresh',
      'FlIconLayers', 'FlIconLibrary', 'FlIconBookmark', 'FlIconFileText', 'FlIconMail', 'FlIconMessage',
      'FlIconInbox', 'FlIconPaperclip', 'FlIconCheck', 'FlIconAlert', 'FlIconWarning', 'FlIconSparkles',
      'FlIconPin', 'FlIconCircle', 'FlIconCircleFill', 'FlIconUser', 'FlIconUsers', 'FlIconUserCircle', 'FlIconAdmin',
      'FlIconSettings', 'FlIconSliders', 'FlIconEdit', 'FlIconLogOut', 'FlIconExternal', 'FlIconTrash',
    ]))
  })

  it.each(flIconNames)('%s draws the 24px grid in currentColor with no hardcoded palette', (name) => {
    const Icon = flIcons[name]!
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('width')).toBe('24')
    expect(svg.getAttribute('fill')).toBe('none')
    const markup = container.innerHTML
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}"/)
    expect(markup).toContain('currentColor')
  })

  it('lands size and className on the root svg', () => {
    const { container } = render(<primitives.FlIconSearch size={32} className="x" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('32')
    expect(svg.getAttribute('height')).toBe('32')
    expect(svg.classList.contains('x')).toBe(true)
  })

  it('keeps a brand glyph filled only at its deliberate anchor node', () => {
    const { container } = render(<primitives.FlIconCriterio />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('stroke-width')).toBe('1.75')
    expect(container.querySelectorAll('[fill="currentColor"]')).toHaveLength(1)
  })
})

describe('FaberLoomMark', () => {
  it('renders the 3x3 weave on the 48-unit field', () => {
    const { container } = render(<primitives.FaberLoomMark />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('24')
    expect(svg.getAttribute('height')).toBe('24')
    expect(svg.getAttribute('viewBox')).toBe('0 0 48 48')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    const group = container.querySelector('g')!
    expect(group.getAttribute('stroke')).toBe('currentColor')
    expect(group.getAttribute('stroke-width')).toBe('3.5')
    expect(group.getAttribute('stroke-linecap')).toBe('round')
    expect(container.querySelectorAll('path')).toHaveLength(15)
  })

  it('collapses to the single woven cross below 24px', () => {
    const { container } = render(<primitives.FaberLoomMark size={16} />)
    expect(container.querySelector('g')!.getAttribute('stroke-width')).toBe('6')
    const paths = [...container.querySelectorAll('path')].map(path => path.getAttribute('d'))
    expect(paths).toEqual(['M24 9 V39', 'M9 24 H17', 'M31 24 H39'])
  })

  it('keeps the full weave at and above 24px', () => {
    const { container } = render(<primitives.FaberLoomMark size={24} className="mark" />)
    expect(container.querySelector('g')!.getAttribute('stroke-width')).toBe('3.5')
    expect(container.querySelectorAll('path')).toHaveLength(15)
    expect(container.querySelector('svg')!.classList.contains('mark')).toBe(true)
  })
})

describe('BrandWordmark', () => {
  it.each([
    ['light', null],
    ['dark', 'data-ds-dark-theme'],
  ])('renders Faber coral and Loom ground ink on a %s ground', (_ground, attribute) => {
    if (attribute !== null) document.body.setAttribute(attribute, '')
    const { container, unmount } = render(<primitives.BrandWordmark size={40} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(root.style.fontFamily).toContain('EB Garamond')
    expect(root.style.fontStyle).toBe('italic')
    expect(root.style.fontWeight).toBe('500')
    expect(root.style.fontSize).toBe('40px')
    expect(root.style.letterSpacing).toBe('-0.005em')
    expect(root.style.lineHeight).toBe('1')
    // "Loom" rides one adaptive ink token, so it takes ink on a light ground and
    // cream on the dark ground; "Faber" keeps the coral accent either way.
    const parts = [...root.querySelector('span')!.children] as HTMLElement[]
    expect(parts.map(part => part.textContent)).toEqual(['Faber', 'Loom'])
    expect(parts[0]!.style.color).toBe('var(--dsw-alias-brand-primary-new-colorprimary-new-color)')
    expect(parts[1]!.style.color).toBe('var(--dsw-alias-label-primary)')
    unmount()
    if (attribute !== null) document.body.removeAttribute(attribute)
  })

  it('adds the woven mark at the brand optical size and drops it on request', () => {
    const view = render(<primitives.BrandWordmark size={38} />)
    const mark = view.container.querySelector('svg')!
    expect(mark.getAttribute('viewBox')).toBe('0 0 48 48')
    expect(mark.getAttribute('width')).toBe('52')

    view.rerender(<primitives.BrandWordmark size={38} includeMark={false} />)
    expect(view.container.querySelector('svg')).toBeNull()
  })
})
