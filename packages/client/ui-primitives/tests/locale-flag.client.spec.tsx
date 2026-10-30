// @vitest-environment jsdom
/** LocaleFlag: one 16x11 banner per shipped language, nothing for a locale with no art. */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LocaleFlag } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

describe('LocaleFlag', () => {
  it.each(['en', 'es', 'zh'])('renders the 16x11 banner for %s', (id) => {
    const { container } = render(<LocaleFlag id={id} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('width')).toBe('16')
    expect(svg!.getAttribute('height')).toBe('11')
    expect(svg!.getAttribute('viewBox')).toBe('0 0 16 11')
    expect(svg!.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector(`[data-locale-flag="${id}"]`)).not.toBeNull()
  })

  it('renders no icon for a locale with no art', () => {
    const { container } = render(<LocaleFlag id="fr" />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('[data-locale-flag]')).toBeNull()
  })

  it('draws the flags with their own colours (brand art)', () => {
    const { container } = render(<LocaleFlag id="zh" />)
    expect(container.innerHTML).toContain('#DE2910')
  })
})
