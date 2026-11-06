/**
 * One throwaway Git repository for publication tests. Every helper runs the
 * real `git` binary in a fresh temporary directory, so a spec proves the
 * adapter against a work tree rather than against a mock.
 * @module @deepseek-ai/dsh-faberloom-publication/tests/support/git-repo
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** A temporary repository plus the operations the publication specs need. */
export interface TestRepository {
  /** Absolute work-tree root. */
  readonly root: string
  /**
   * Run one Git command in the repository.
   * @param args - arguments after `git -C <root>`.
   * @param input - text written to the child's stdin.
   * @returns stdout as text.
   */
  git(args: readonly string[], input?: string): string
  /** Current HEAD commit id. */
  head(): string
  /** Number of commits reachable from HEAD. */
  commitCount(): number
  /**
   * Write one repository-relative file, creating its directory.
   * @param path - repository-relative path.
   * @param content - UTF-8 content.
   */
  write(path: string, content: string): void
  /**
   * Write and commit one file.
   * @param path - repository-relative path.
   * @param content - UTF-8 content.
   * @param message - commit subject.
   * @returns the commit id.
   */
  commit(path: string, content: string, message: string): string
  /**
   * Produce the unified diff of one new content against HEAD and restore the
   * work tree, so the patch can be applied by the publication adapter.
   * @param path - tracked repository-relative path.
   * @param content - the content the diff produces.
   * @returns the unified diff.
   */
  diff(path: string, content: string): string
  /**
   * Read one repository-relative file as UTF-8.
   * @param path - repository-relative path.
   * @returns the file content.
   */
  read(path: string): string
  /** Remove the temporary directory. */
  dispose(): void
}

/**
 * Create one repository with deterministic identity and no line-ending or
 * signing configuration inherited from the host.
 * @returns the repository.
 */
export function createTestRepository(): TestRepository {
  const root = mkdtempSync(join(tmpdir(), 'faberloom-publication-'))
  const git = (args: readonly string[], input?: string): string => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...input === undefined ? {} : { input },
  })
  git(['init', '--initial-branch=main'])
  git(['config', 'user.email', 'qa@faberloom.invalid'])
  git(['config', 'user.name', 'FaberLoom QA'])
  git(['config', 'core.autocrlf', 'false'])
  git(['config', 'commit.gpgsign', 'false'])
  const write = (path: string, content: string): void => {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
  const head = (): string => git(['rev-parse', 'HEAD']).trim()
  return {
    root,
    git,
    head,
    commitCount: () => Number(git(['rev-list', '--count', 'HEAD']).trim()),
    write,
    commit: (path, content, message) => {
      write(path, content)
      git(['add', '--', path])
      git(['commit', '--no-gpg-sign', '-m', message])
      return head()
    },
    diff: (path, content) => {
      write(path, content)
      const patch = git(['diff', '--no-color', '--', path])
      git(['checkout', '--', path])
      return patch
    },
    read: path => readFileSync(join(root, path), 'utf8'),
    dispose: () => { rmSync(root, { recursive: true, force: true, maxRetries: 3 }) },
  }
}
