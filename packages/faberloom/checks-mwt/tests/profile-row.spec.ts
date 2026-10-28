/**
 * The shipped profile row: the adapter mounts without an environment flag, so a
 * deployment with the `mwt` server configured registers the six controls at
 * boot. Only an explicit `FABERLOOM_CHECKS_MWT=0` takes it back out, which is
 * what an offline deployment writes.
 */

import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { isJsExpr, loadCordisYaml } from '../../../../scripts/cordis-yaml.ts'

/** The bundle patch that ships the row. */
const PATCH = new URL('../../../bundle/faberloom-app/cordis.patch.yml', import.meta.url)

/** Row id the adapter mounts under. */
const ROW_ID = 'faberloom-checks-mwt'

/**
 * Whether one value is a string-keyed object.
 * @param value - candidate value.
 * @returns true for a non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The row with one id, wherever the patch nests it.
 * @param value - parsed patch entry or list.
 * @param id - row id to find.
 * @returns the row, or undefined when the patch carries none.
 */
function findRow(value: unknown, id: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findRow(entry, id)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isRecord(value)) return undefined
  if (value['id'] === id) return value
  return findRow(value['insert'], id) ?? findRow(value['config'], id)
}

/**
 * The value the Loader would mount the row with, for one environment.
 * @param row - the shipped row.
 * @param env - environment the expression reads.
 * @returns true when the row is disabled.
 */
function disabledWith(row: Record<string, unknown>, env: Record<string, string>): boolean {
  const disabled = row['disabled']
  // `disabled` is the one metadata field the Loader interpolates, at every
  // mount decision; a literal true is the static form.
  if (isJsExpr(disabled)) return new Script(`(${disabled.__jsExpr})`).runInNewContext({ process: { env } }) === true
  return disabled === true
}

/** The shipped row, read once. */
const DOCUMENT = loadCordisYaml(readFileSync(PATCH, 'utf8'))
const ROW = findRow(DOCUMENT, ROW_ID)

describe('shipped faberloom-checks-mwt row', () => {
  it('ships the row with the MWT server name', () => {
    expect(ROW).toBeDefined()
    expect(ROW?.['name']).toBe('@deepseek-ai/dsh-faberloom-checks-mwt')
    expect(ROW?.['config']).toMatchObject({ serverName: 'mwt' })
  })

  it('mounts the adapter with no environment flag set', () => {
    if (ROW === undefined) throw new Error('the patch must ship the row')
    expect(disabledWith(ROW, {})).toBe(false)
  })

  it('stays mounted when FABERLOOM_CHECKS_MWT is 1', () => {
    if (ROW === undefined) throw new Error('the patch must ship the row')
    expect(disabledWith(ROW, { FABERLOOM_CHECKS_MWT: '1' })).toBe(false)
  })

  it('lets an offline deployment opt out with FABERLOOM_CHECKS_MWT=0', () => {
    if (ROW === undefined) throw new Error('the patch must ship the row')
    expect(disabledWith(ROW, { FABERLOOM_CHECKS_MWT: '0' })).toBe(true)
  })
})
