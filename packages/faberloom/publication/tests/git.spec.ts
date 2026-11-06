// @vitest-environment node
/**
 * The Git adapter against a real temporary work tree: one diff becomes one
 * commit, a replay reuses that commit, a partially applied patch resumes
 * instead of applying twice, and every unsafe input is refused before Git runs.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertCommitId,
  assertDiffTouchesOnly,
  assertSafePath,
  commitPublication,
  type CommitPublicationOptions,
} from '../src/index.ts'
import { createTestRepository, type TestRepository } from './support/git-repo.ts'

const PATH = 'knowledge/note.md'
const BASE = '# Nota\n\nlínea uno\n'
const CHANGED = '# Nota\n\nlínea uno\nlínea dos\n'

let repositories: TestRepository[] = []
let directories: string[] = []

afterEach(() => {
  for (const repository of repositories) repository.dispose()
  for (const directory of directories) rmSync(directory, { recursive: true, force: true, maxRetries: 3 })
  repositories = []
  directories = []
})

/** Create one repository the spec disposes after the test. */
function repository(): TestRepository {
  const created = createTestRepository()
  repositories.push(created)
  return created
}

/**
 * Options for one publication of {@link CHANGED} over {@link BASE}.
 * @param repo - the work tree.
 * @param revision - base commit.
 * @param diff - unified diff.
 * @returns adapter options.
 */
function options(repo: TestRepository, revision: string, diff: string): CommitPublicationOptions {
  return {
    root: repo.root,
    revision,
    path: PATH,
    diff,
    itemId: 'item-1',
    artifactHash: 'a'.repeat(64),
    maxBytes: 1024 * 1024,
  }
}

describe('Git publication adapter', () => {
  it('applies one diff, commits it under a deterministic subject, and returns the bytes', () => {
    const repo = repository()
    const base = repo.commit(PATH, BASE, 'base')
    const diff = repo.diff(PATH, CHANGED)

    const committed = commitPublication(options(repo, base, diff))

    expect(committed.commit).toMatch(/^[0-9a-f]{40}$/u)
    expect(repo.head()).toBe(committed.commit)
    expect(repo.commitCount()).toBe(2)
    expect(committed.bytes.toString('utf8')).toBe(CHANGED)
    expect(repo.git(['log', '-1', '--format=%s'])).toContain('faberloom: publish item-1')
    expect(repo.git(['status', '--porcelain', '--untracked-files=no'])).toBe('')
  })

  it('reuses the commit when the same publication identity is applied again', () => {
    const repo = repository()
    const base = repo.commit(PATH, BASE, 'base')
    const diff = repo.diff(PATH, CHANGED)

    const first = commitPublication(options(repo, base, diff))
    const second = commitPublication(options(repo, base, diff))

    expect(second.commit).toBe(first.commit)
    expect(second.bytes.toString('utf8')).toBe(CHANGED)
    expect(repo.commitCount()).toBe(2)
  })

  it('resumes a patch already applied to the index instead of applying it twice', () => {
    const repo = repository()
    const base = repo.commit(PATH, BASE, 'base')
    const diff = repo.diff(PATH, CHANGED)
    repo.git(['apply', '--index'], diff)

    const committed = commitPublication(options(repo, base, diff))

    expect(repo.commitCount()).toBe(2)
    expect(repo.head()).toBe(committed.commit)
    expect(committed.bytes.toString('utf8')).toBe(CHANGED)
  })

  it('refuses a base revision that is no longer HEAD', () => {
    const repo = repository()
    const base = repo.commit(PATH, BASE, 'base')
    const diff = repo.diff(PATH, CHANGED)
    repo.commit(PATH, `${BASE}otra\n`, 'later')

    expect(() => commitPublication(options(repo, base, diff))).toThrow('PUBLICATION_BASE_STALE')
    expect(repo.commitCount()).toBe(2)
  })

  it('refuses a work tree that carries another change', () => {
    const repo = repository()
    const base = repo.commit(PATH, BASE, 'base')
    const diff = repo.diff(PATH, CHANGED)
    repo.write(PATH, 'cambio ajeno\n')

    expect(() => commitPublication(options(repo, base, diff))).toThrow('PUBLICATION_WORKTREE_DIRTY')
    expect(repo.commitCount()).toBe(1)
  })

  it('refuses a directory that is not a repository root', () => {
    const directory = mkdtempSync(join(tmpdir(), 'faberloom-not-a-repo-'))
    directories.push(directory)

    expect(() => commitPublication({
      root: directory,
      revision: 'a'.repeat(40),
      path: PATH,
      diff: '',
      itemId: 'item-1',
      artifactHash: 'a'.repeat(64),
      maxBytes: 1024,
    })).toThrow('PUBLICATION_UNAVAILABLE')
    expect(() => commitPublication({
      root: join(directory, 'absent'),
      revision: 'a'.repeat(40),
      path: PATH,
      diff: '',
      itemId: 'item-1',
      artifactHash: 'a'.repeat(64),
      maxBytes: 1024,
    })).toThrow('PUBLICATION_UNAVAILABLE')
  })

  it('refuses a valid patch that does not apply to the approved base', () => {
    const repo = repository()
    const base = repo.commit(PATH, BASE, 'base')
    const diff = [
      'diff --git a/knowledge/note.md b/knowledge/note.md',
      '--- a/knowledge/note.md',
      '+++ b/knowledge/note.md',
      '@@ -1 +1 @@',
      '-# Otra cosa',
      '+# Nota cambiada',
    ].join('\n')

    expect(() => commitPublication(options(repo, base, diff))).toThrow('PUBLICATION_PATCH_REJECTED')
    expect(repo.commitCount()).toBe(1)
    expect(repo.read(PATH)).toBe(BASE)
  })

  it('refuses path traversal, absolute paths, Windows separators, and non-canonical segments', () => {
    for (const path of ['../x.md', '/etc/passwd', 'docs\\x.md', 'C:/x.md', 'knowledge/./x.md', 'knowledge//x.md', '']) {
      expect(() => assertSafePath(path)).toThrow('PUBLICATION_PATH_INVALID')
    }
    expect(assertSafePath('knowledge/x.md')).toBe('knowledge/x.md')
  })

  it('refuses a branch name and a non-commit revision', () => {
    for (const revision of ['main', 'HEAD', 'v1.0.0', '', 'abc', 'z'.repeat(40)]) {
      expect(() => assertCommitId(revision)).toThrow('PUBLICATION_REVISION_INVALID')
    }
    expect(assertCommitId('a'.repeat(40))).toBe('a'.repeat(40))
  })

  it('refuses a diff without file headers and a diff that touches another path', () => {
    expect(() => { assertDiffTouchesOnly('not a patch', PATH) }).toThrow('PUBLICATION_PATCH_INVALID')
    const other = [
      'diff --git a/knowledge/note.md b/knowledge/note.md',
      '--- a/knowledge/note.md',
      '+++ b/knowledge/note.md',
      '@@ -1 +1 @@',
      '-# Nota',
      '+# Otra',
      'diff --git a/knowledge/other.md b/knowledge/other.md',
      '--- /dev/null',
      '+++ b/knowledge/other.md',
      '@@ -0,0 +1 @@',
      '+otro',
    ].join('\n')
    expect(() => { assertDiffTouchesOnly(other, PATH) }).toThrow('PUBLICATION_PATCH_PATH')
    expect(() => {
      assertDiffTouchesOnly([
        'diff --git a/knowledge/other.md b/knowledge/other.md',
        '--- /dev/null',
        '+++ b/knowledge/other.md',
        '@@ -0,0 +1 @@',
        '+otro',
      ].join('\n'), PATH)
    }).toThrow('PUBLICATION_PATCH_PATH')
  })
})
