/**
 * The Tooltip bubble's chrome as CSS text. CSS Modules resolve to class-name
 * maps in the component suite, so the caption type token and the per-side
 * placement transforms can only be proven against the stylesheet itself.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/Tooltip.module.css', import.meta.url)), 'utf8')
// The animation's @keyframes is a nested-block rule the flat scan drops; every
// selector asserted below is a top-level rule.
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = '', body = '']) => ({
  selectors: selector.split(',').map(part => part.trim()),
  declarations: body.split(';').map(part => part.trim()).filter(Boolean),
}))

/** The declarations of one exact selector, in source order. */
function declarations(selector: string): string[] {
  const rule = rules.find(entry => entry.selectors.includes(selector))
  if (rule === undefined) throw new Error(`Tooltip.module.css has no \`${selector}\` rule`)
  return rule.declarations
}

describe('Tooltip.module.css bubble chrome', () => {
  it('sets the bubble in the caption role with tight padding', () => {
    expect(declarations('.bubble')).toEqual(expect.arrayContaining([
      'font: var(--dsw-font-caption)',
      'padding: 4px 8px',
      'border-radius: 6px',
    ]))
  })

  it('keeps one placement transform per side', () => {
    expect(declarations(".bubble[data-side='right']")).toContain('transform: translateY(-50%)')
    expect(declarations(".bubble[data-side='bottom']")).toContain('transform: translateX(-50%)')
    expect(declarations(".bubble[data-side='top']")).toContain('transform: translate(-50%, -100%)')
  })
})
