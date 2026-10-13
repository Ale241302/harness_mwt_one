// @vitest-environment jsdom
// The weaving progress state: the knot draws while work runs and falls back to
// the static shared mark when the reader asked for reduced motion.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { WeavingProgress } from '../src/client/skeleton/WeavingProgress.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WeavingProgress', () => {
  it('draws the knot when motion is allowed', () => {
    // jsdom ships no matchMedia: absent media API means motion is allowed.
    const view = render(<WeavingProgress label="The agent is working" className="seat" />)
    const status = view.getByRole('status')
    expect(status.getAttribute('aria-label')).toBe('The agent is working')
    expect(status.hasAttribute('data-weaving-progress')).toBe(true)
    // The animated arm wraps the shared mark so the drawing CSS can target it.
    expect(status.querySelector(':scope > span > svg')).not.toBeNull()
    expect(status.querySelector(':scope > svg')).toBeNull()
  })

  it('falls back to the static mark when the reader asked for less motion', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true }) as MediaQueryList))
    const view = render(<WeavingProgress label="El agente está trabajando" size={32} />)
    const status = view.getByRole('status')
    expect(status.getAttribute('aria-label')).toBe('El agente está trabajando')
    // The static arm renders the mark directly: no animated wrapper.
    expect(status.querySelector(':scope > svg')).not.toBeNull()
    expect(status.querySelector(':scope > span')).toBeNull()
  })

  it('draws the knot when the media API reports motion is allowed', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false }) as MediaQueryList))
    const view = render(<WeavingProgress label="The agent is working" />)
    expect(view.getByRole('status').querySelector(':scope > span > svg')).not.toBeNull()
  })
})
