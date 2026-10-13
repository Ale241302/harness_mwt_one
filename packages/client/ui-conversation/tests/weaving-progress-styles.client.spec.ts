/**
 * The weaving pass as CSS text. jsdom has no layout and CSS Modules resolve to
 * class-name maps in the component suites, so the declarations that thread the
 * weft and the ones that stop it are only readable here: a pass that lost its
 * reduced-motion arm would leave a reader who asked for less motion with a
 * moving, or worse an undrawn, knot.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/WeavingProgress.module.css', import.meta.url)),
  'utf8',
)

describe('WeavingProgress.module.css', () => {
  it('carries the pass on the weft alone', () => {
    expect(css).toContain('@keyframes dsh-faberloom-weave')
    expect(css).toContain('.knot .weft {')
    expect(css).toContain('animation: dsh-faberloom-weave')
    // The brand's own coral; this sheet's `--dsw-alias-brand-primary` is ink.
    expect(css).toContain('var(--dsw-alias-brand-primary-new-colorprimary-new-color)')
  })

  it('stops the pass and leaves the finished knot when motion is reduced', () => {
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(at).toBeGreaterThan(css.indexOf('@keyframes dsh-faberloom-weave'))
    const reducedMotion = css.slice(at)
    expect(reducedMotion).toContain('animation: none')
    // Every thread drawn: without this the weft would be left hidden at rest.
    expect(reducedMotion).toContain('stroke-dashoffset: 0')
  })
})
