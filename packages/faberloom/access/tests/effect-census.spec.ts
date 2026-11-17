/**
 * The E1 census has to fail when the code drifts, not when someone remembers to
 * re-read it. This spec pins every source file that can put a message on the
 * wire, and requires that the census document names it. A new sender fails here
 * until it is classified in `e1/authority-census.md`.
 *
 * It reads source text, not behaviour: it answers "who can send", which is the
 * question O3-01 asks. Whether a classified path actually denies is O3-02C.
 */
import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const CENSUS = fileURLToPath(new URL('../../../../docs/scratch/faberloom-daily-work/e1/authority-census.md', import.meta.url))

/** A call that writes a message, as opposed to the declaration of the sender. */
const SEND_CALL = /\.sendMail\(|\.sendSmtp\(|\.sendDraft\(|await sendSmtp\(/

/** Files that may call a sender, as classified in the census. */
const CLASSIFIED = [
  'packages/faberloom/connections/src/index.ts',
  'packages/faberloom/effects-mail/src/index.ts',
  'packages/faberloom/view/src/index.ts',
].sort()

/** Every source file under the product packages, relative to the repository. */
function sources(): string[] {
  return globSync('packages/faberloom/*/src/**/*.ts', { cwd: ROOT })
    .map(path => path.split('\\').join('/'))
    .filter(path => !path.endsWith('.d.ts'))
}

/** Files whose source contains a send call. */
function senders(): string[] {
  return sources().filter(path => SEND_CALL.test(readFileSync(`${ROOT}${path}`, 'utf8'))).sort()
}

describe('effect census', () => {
  it('finds exactly the senders the census classifies', () => {
    expect(senders()).toEqual(CLASSIFIED)
  })

  it('names every classified sender in the census document', () => {
    const census = readFileSync(CENSUS, 'utf8')
    const unmentioned = CLASSIFIED.filter(path => !census.includes(path.split('/').slice(2).join('/')))
    expect(unmentioned).toEqual([])
  })

  it('keeps the transport out of the decision layer', () => {
    // `connections` may send; it may not decide. A policy or approval check that
    // lives in the transport hides from every other caller.
    const transport = readFileSync(`${ROOT}packages/faberloom/connections/src/index.ts`, 'utf8')
    expect(/faberloomAccess/.test(transport)).toBe(false)
  })
})
