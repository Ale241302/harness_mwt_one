/**
 * The T14 gate must tell three situations apart with the same code path: a
 * contract that survives the target, one the fork added itself, and one the
 * target dropped.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { contractEdges, coreFilesTouched, exportedNames } from './update-gate.ts'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** Run git in a fixture repository. */
function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
}

/** Write one file, creating its parent directories. */
function write(repo: string, path: string, content: string): void {
  const target = join(repo, path)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, content)
}

/** Commit everything and return the commit SHA. */
function commit(repo: string, message: string): string {
  git(repo, 'add', '-A')
  git(repo, '-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-q', '-m', message)
  return git(repo, 'rev-parse', 'HEAD').trim()
}

describe('update gate', () => {
  it('reads declarations, type re-exports and multi-line export blocks', () => {
    const names = exportedNames([
      'export interface Alpha {}',
      'export const beta = 1',
      "export type { Gamma, Delta } from './g.ts'",
      'export type {',
      '  Epsilon,',
      '  Zeta,',
      "} from './e.ts'",
      'export default class Omega {}',
    ].join('\n'))
    expect([...names].sort()).toEqual(['Alpha', 'Delta', 'Epsilon', 'Gamma', 'Zeta', 'beta'])
  })

  it('tells a surviving contract, a fork-added one and a dropped one apart', () => {
    const repo = mkdtempSync(join(tmpdir(), 'update-gate-'))
    homes.push(repo)
    const roots = ['own/src']
    git(repo, 'init', '-q')

    // The target that still has Beta.
    write(repo, 'packages/a/package.json', JSON.stringify({ name: '@deepseek-ai/dsh-a' }))
    write(repo, 'packages/a/src/index.ts', 'export interface Alpha {}\nexport type { Beta } from \'./b.ts\'\n')
    write(repo, 'packages/a/src/b.ts', 'export type Beta = string\n')
    write(repo, 'own/src/index.ts', "import type { Alpha, Beta, Fork } from '@deepseek-ai/dsh-a'\nexport type Both = [Alpha, Beta, Fork]\n")
    const withBeta = commit(repo, 'target exports Beta')

    // The target that dropped Beta.
    write(repo, 'packages/a/src/index.ts', 'export interface Alpha {}\nexport const Gamma = 1\n')
    const withoutBeta = commit(repo, 'target drops Beta')

    // The fork's own copy adds `Fork` to the shared package, so it travels along.
    write(repo, 'packages/a/src/index.ts', 'export interface Alpha {}\nexport const Gamma = 1\nexport interface Fork {}\n')

    const pass = contractEdges(repo, withBeta, withBeta, roots)
    expect(pass.every(edge => edge.ok)).toBe(true)
    expect(pass[0]?.owned).toEqual(['Fork'])

    // Present at the base, gone at the target: the update would break the own layer.
    const dropped = contractEdges(repo, withoutBeta, withBeta, roots)
    expect(dropped[0]?.ok).toBe(false)
    expect(dropped[0]?.missing).toEqual(['Beta'])
    expect(dropped[0]?.owned).toEqual(['Fork'])

    // A package the fork ships itself is own cargo, not a lost upstream contract.
    write(repo, 'own/src/other.ts', "import type { Alpha } from '@deepseek-ai/dsh-gone'\nexport type Gone = Alpha\n")
    write(repo, 'packages/gone/package.json', JSON.stringify({ name: '@deepseek-ai/dsh-gone' }))
    write(repo, 'packages/gone/src/index.ts', 'export interface Alpha {}\n')
    commit(repo, 'own layer imports a package the fork ships')
    const ownPackage = contractEdges(repo, withoutBeta, withBeta, roots).find(edge => edge.specifier === '@deepseek-ai/dsh-gone')
    expect(ownPackage?.ok).toBe(true)
    expect(ownPackage?.owned).toEqual(['Alpha'])
  })

  it('measures core divergence by tree, not by commit range', () => {
    const repo = mkdtempSync(join(tmpdir(), 'update-gate-'))
    homes.push(repo)
    git(repo, 'init', '-q')

    write(repo, 'packages/core/a/src/index.ts', 'export const a = 1\n')
    const base = commit(repo, 'base')

    // The pinned target advances core on its own branch.
    git(repo, 'checkout', '-q', '-b', 'target')
    write(repo, 'packages/core/a/src/index.ts', 'export const a = 2\n')
    const target = commit(repo, 'target advances core')

    // The candidate is a sibling that stages the target's core content and
    // adds its own layer. Its history diverges, its core tree does not.
    git(repo, 'checkout', '-q', base)
    git(repo, 'checkout', '-q', '-b', 'candidate')
    write(repo, 'packages/core/a/src/index.ts', 'export const a = 2\n')
    write(repo, 'packages/faberloom/x/src/index.ts', 'export const x = 1\n')
    const candidate = commit(repo, 'candidate stages the target tree')

    expect(coreFilesTouched(repo, target)).toEqual([])
    // The commit range would have counted the target's own advance as fork work.
    expect(git(repo, 'diff', '--name-only', `${target}...${candidate}`).trim()).not.toBe('')

    // A core edit made by the candidate is reported.
    write(repo, 'packages/core/a/src/index.ts', 'export const a = 3\n')
    commit(repo, 'candidate edits core')
    expect(coreFilesTouched(repo, target)).toEqual(['packages/core/a/src/index.ts'])
  })
})
