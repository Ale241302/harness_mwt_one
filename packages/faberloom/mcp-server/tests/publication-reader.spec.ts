import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_PUBLICATION_BYTES, publicationRoot, readPublication } from '../src/publication-reader.ts'

const repos: string[] = []

afterEach(() => {
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true })
})

/** Two commits of the same file, so a moving branch is observable. */
function repo(): { root: string; first: string; second: string } {
  const root = mkdtempSync(join(tmpdir(), 'faberloom-reader-'))
  repos.push(root)
  const git = (...args: string[]): string => execFileSync('git', [
    '-C', root, '-c', 'user.email=owner@example.test', '-c', 'user.name=Owner', ...args,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  git('init')
  mkdirSync(join(root, 'knowledge'))
  writeFileSync(join(root, 'knowledge', 'procedimiento.md'), 'uno\n')
  git('add', '.')
  git('commit', '-m', 'primera')
  const first = git('rev-parse', 'HEAD')
  writeFileSync(join(root, 'knowledge', 'procedimiento.md'), 'dos\n')
  git('add', '.')
  git('commit', '-m', 'segunda')
  return { root, first, second: git('rev-parse', 'HEAD') }
}

describe('the local publication reader (PUB-03)', () => {
  it('returns the bytes of the fixed commit, never the branch tip', () => {
    const { root, first, second } = repo()
    const read = readPublication({ repo: root, revision: first, path: 'knowledge/procedimiento.md' })
    expect(read.text).toBe('uno\n')
    expect(read.revision).toBe(first)
    expect(read.revision).not.toBe(second)
    expect(read.bytes).toBe(4)
    expect(read.sha256).toBe(createHash('sha256').update('uno\n').digest('hex'))
  })

  it('refuses a branch name, a traversal, an absolute path, and a missing file', () => {
    const { root } = repo()
    expect(() => readPublication({ repo: root, revision: 'main', path: 'knowledge/procedimiento.md' }))
      .toThrow('PUBLICATION_REVISION_INVALID')
    expect(() => readPublication({ repo: root, revision: 'a'.repeat(40), path: '../secreto.md' }))
      .toThrow('PUBLICATION_PATH_INVALID')
    expect(() => readPublication({ repo: root, revision: 'a'.repeat(40), path: join(root, 'knowledge', 'procedimiento.md') }))
      .toThrow('PUBLICATION_PATH_INVALID')
    expect(() => readPublication({ repo: root, revision: 'a'.repeat(40), path: 'knowledge/ausente.md' }))
      .toThrow('PUBLICATION_NOT_FOUND')
  })

  it('refuses a directory that is not a Git work tree', () => {
    const directory = mkdtempSync(join(tmpdir(), 'faberloom-reader-plain-'))
    repos.push(directory)
    expect(() => publicationRoot(directory)).toThrow('PUBLICATION_UNAVAILABLE')
    expect(() => publicationRoot(join(directory, 'ausente'))).toThrow('PUBLICATION_UNAVAILABLE')
  })

  it('enforces its byte ceiling', () => {
    const { root, first } = repo()
    expect(readPublication({
      repo: root, revision: first, path: 'knowledge/procedimiento.md', maxBytes: 4,
    }).bytes).toBe(4)
    expect(() => readPublication({
      repo: root,
      revision: first,
      path: 'knowledge/procedimiento.md',
      maxBytes: 3,
    })).toThrow('PUBLICATION_TOO_LARGE')
    expect(MAX_PUBLICATION_BYTES).toBe(1024 * 1024)
  })
})
