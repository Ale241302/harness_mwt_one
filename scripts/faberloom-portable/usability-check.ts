/**
 * Validate one 4A.3 usability observation. The checker refuses a developer or
 * synthetic participant, missing approved thresholds, an over-threshold time,
 * a token/command/config path, and a load record that does not match the
 * revision and host. It prints the verdict; a failed observation keeps the wave
 * open instead of turning an estimate into evidence.
 *
 * Run:
 *   pnpm exec tsx scripts/faberloom-portable/usability-check.ts <observation.json>
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkUsabilityObservation } from '../../packages/faberloom/portable/src/usability.ts'

const path = process.argv[2]
if (path === undefined || path.trim().length === 0) {
  console.error('usage: usability-check.ts <observation.json>')
  process.exit(2)
}
let parsed: unknown
try {
  parsed = JSON.parse(readFileSync(resolve(path), 'utf8'))
} catch (error) {
  console.error(`usability-check: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}
const verdict = checkUsabilityObservation(parsed)
console.log(JSON.stringify(verdict, null, 2))
process.exit(verdict.ok ? 0 : 1)
