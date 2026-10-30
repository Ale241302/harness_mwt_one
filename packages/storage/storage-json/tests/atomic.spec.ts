/**
 * The atomic replacement helper on its own: the retry Windows needs while a
 * scanner holds the destination, and the failures a retry must not mask.
 */

import { describe, expect, it } from 'vitest'
import { renameWithRetry } from '../src/atomic.ts'

describe('renameWithRetry', () => {
  it('retries a transient Windows refusal and then replaces the file', async () => {
    let calls = 0
    await renameWithRetry('from', 'to', async () => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('busy'), { code: 'EPERM' })
    })
    expect(calls).toBe(2)
  })

  it('stops at a refusal a retry cannot fix', async () => {
    let waited = false
    await expect(renameWithRetry('from', 'to', async () => {
      throw Object.assign(new Error('gone'), { code: 'ENOENT' })
    }, async () => { waited = true })).rejects.toThrow('gone')
    expect(waited).toBe(false)
  })

  it('gives up after the bounded number of attempts', async () => {
    const waits: number[] = []
    let calls = 0
    await expect(renameWithRetry('from', 'to', async () => {
      calls += 1
      throw Object.assign(new Error('locked'), { code: 'EBUSY' })
    }, async (ms) => { waits.push(ms) })).rejects.toThrow('locked')
    expect(calls).toBe(9)
    expect(waits).toHaveLength(8)
  })
})
