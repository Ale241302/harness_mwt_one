// @vitest-environment jsdom
// The weaving progress state's render: the knot's weft is threaded one segment
// at a time while work is in flight. The reduced-motion arm is a stylesheet
// property rather than a render branch, so it is pinned against the stylesheet
// itself by weaving-progress-styles.client.spec.ts.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { WeavingProgress } from '../src/client/skeleton/WeavingProgress.tsx'

afterEach(() => {
  cleanup()
})

/** The knot's threads in render order, split by the role the pass gives them. */
function threads(status: HTMLElement): { warp: SVGPathElement[]; weft: SVGPathElement[] } {
  const paths = [...status.querySelectorAll('path')] as SVGPathElement[]
  return {
    warp: paths.filter(path => path.getAttribute('data-weave') === 'warp'),
    weft: paths.filter(path => path.getAttribute('data-weave') === 'weft'),
  }
}

describe('WeavingProgress', () => {
  it('draws the woven knot as a decorative, named status', () => {
    const view = render(<WeavingProgress label="The agent is working" className="seat" />)
    const status = view.getByRole('status')
    expect(status.getAttribute('aria-label')).toBe('The agent is working')
    expect(status.hasAttribute('data-weaving-progress')).toBe(true)
    // The drawing carries no accessible name of its own; the status does.
    const svg = status.querySelector(':scope > svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 48 48')
  })

  it('keeps the warp drawn and threads the weft one segment at a time, top to bottom', () => {
    const { warp, weft } = threads(render(<WeavingProgress label="working" />).getByRole('status'))
    // The 3x3 weave: seven warp threads over eight weft segments.
    expect(warp).toHaveLength(7)
    expect(weft).toHaveLength(8)
    // The prepared structure does not move.
    expect(warp.every(path => path.style.animationDelay === '')).toBe(true)
    // One pass, one thread at a time, in render order.
    expect(weft.map(path => path.style.animationDelay))
      .toEqual(['0ms', '100ms', '200ms', '300ms', '400ms', '500ms', '600ms', '700ms'])
  })

  it('collapses to the woven cross below the weave size, still in flight', () => {
    const { warp, weft } = threads(render(<WeavingProgress label="working" size={16} />).getByRole('status'))
    // The cross is one vertical thread crossed by two edge stubs.
    expect(warp).toHaveLength(1)
    expect(weft).toHaveLength(2)
    expect(weft.map(path => path.style.animationDelay)).toEqual(['0ms', '100ms'])
  })
})
