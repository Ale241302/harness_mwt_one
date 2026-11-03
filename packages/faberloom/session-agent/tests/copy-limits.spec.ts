/**
 * C-B03.1: the product must never claim that a user's own key removes every
 * limit. The check reads the shipped strings and the two documents that repeat
 * the claim, so a new sentence is a deliberate edit with a failing gate.
 * @module @deepseek-ai/dsh-faberloom-session-agent/tests/copy-limits
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OWN_KEY_PERSONA,
  DEFAULT_PRODUCT_PERSONA,
  DEFAULT_REFUSAL,
  DEFAULT_UNVERIFIED_REFUSAL,
  PRODUCT_POLICY,
} from '../src/policy.ts'

/** The claim this product cannot make: the provider always applies its own limits. */
const UNLIMITED_CLAIM = /sin l[ií]mite|no tiene l[ií]mite|ilimitad|unlimited/iu

/** Read one repository document relative to this test file. */
function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

describe('C-B03 — no shipped text promises unlimited use', () => {
  it('C-B03.1 — the policy strings carry no unlimited claim', () => {
    const strings = {
      DEFAULT_PRODUCT_PERSONA,
      DEFAULT_OWN_KEY_PERSONA,
      PRODUCT_POLICY,
      DEFAULT_REFUSAL,
      DEFAULT_UNVERIFIED_REFUSAL,
    }
    for (const [name, text] of Object.entries(strings)) {
      expect(text, name).not.toMatch(UNLIMITED_CLAIM)
    }
  })

  it('C-B03.1 — the shared skill and the bundle comment carry no unlimited claim', () => {
    const skill = read('../../../../skills-shared/politica-llave-compartida/SKILL.md')
    const patch = read('../../../bundle/faberloom-app/cordis.patch.yml')
    expect(skill).not.toMatch(UNLIMITED_CLAIM)
    expect(patch).not.toMatch(UNLIMITED_CLAIM)
  })
})
