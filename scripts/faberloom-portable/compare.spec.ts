import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compareFile, compareTrees, sha256 } from './compare.ts'

let dir: string | undefined
function workspace(): string {
  dir ??= mkdtempSync(join(tmpdir(), 'faberloom-compare-'))
  return dir
}

function write(root: string, path: string, body: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, body)
}

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

describe('compare trees', () => {
  it('accepts identical bytes and counts every expected file', () => {
    const expected = join(workspace(), 'expected')
    const actual = join(workspace(), 'actual')
    for (const root of [expected, actual]) {
      write(root, 'a.txt', 'uno')
      write(root, 'sub/b.txt', 'dos')
    }
    expect(compareTrees(expected, actual)).toEqual({ ok: true, compared: 2, differences: [] })
  })

  it('names a changed byte with both digests (HAR-03)', () => {
    const expected = join(workspace(), 'expected')
    const actual = join(workspace(), 'actual')
    write(expected, 'a.txt', 'uno')
    write(actual, 'a.txt', 'unO')
    const result = compareTrees(expected, actual)
    expect(result.ok).toBe(false)
    expect(result.differences).toEqual([{
      path: 'a.txt',
      kind: 'changed',
      expectedSha256: sha256('uno'),
      actualSha256: sha256('unO'),
    }])
  })

  it('distinguishes a missing file from an extra one', () => {
    const expected = join(workspace(), 'expected')
    const actual = join(workspace(), 'actual')
    write(expected, 'a.txt', 'uno')
    write(expected, 'b.txt', 'dos')
    write(actual, 'a.txt', 'uno')
    write(actual, 'c.txt', 'tres')
    expect(compareTrees(expected, actual).differences).toEqual([
      { path: 'b.txt', kind: 'missing', expectedSha256: sha256('dos'), actualSha256: null },
      { path: 'c.txt', kind: 'extra', expectedSha256: null, actualSha256: sha256('tres') },
    ])
  })

  it('compares one file and reports an absent target', () => {
    const actual = join(workspace(), 'one.txt')
    writeFileSync(actual, 'contenido')
    expect(compareFile(actual, sha256('contenido'))).toEqual({
      ok: true, expectedSha256: sha256('contenido'), actualSha256: sha256('contenido'),
    })
    expect(compareFile(join(workspace(), 'missing.txt'), sha256('x'))).toEqual({
      ok: false, expectedSha256: sha256('x'), actualSha256: null,
    })
  })
})
