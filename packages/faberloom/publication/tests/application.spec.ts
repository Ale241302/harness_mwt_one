// @vitest-environment node
/**
 * Wave 3A.1: the applier only commits the approved diff, resolves every path
 * against the server inventory, and records a durable conflict without writing
 * when the base, path, symlink, or work tree is not the approved one.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomPublication, {
  type PublicationApproval,
  commitApplication,
  diffPaths,
} from '../src/index.ts'
import { createTestRepository, type TestRepository } from './support/git-repo.ts'

const PATH_A = 'knowledge/a.md'
const PATH_B = 'knowledge/b.md'
const BASE_A = '# A\n\nuno\n'
const BASE_B = '# B\n\nuno\n'
/** Expected tree kept outside the work tree, so the assertion does not derive from the applier. */
const EXPECTED = fileURLToPath(new URL('./fixtures/application-expected/', import.meta.url))

/** One expected file and its independently recorded digest. */
interface ExpectedFile {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

const EXPECTED_MANIFEST = JSON.parse(readFileSync(join(EXPECTED, 'manifest.json'), 'utf8')) as {
  readonly files: readonly ExpectedFile[]
}

const repositories: TestRepository[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const repo of repositories.splice(0)) repo.dispose()
})

/** Boot the real storage composition plus the publication service. */
async function boot(repo: TestRepository, inventory: readonly string[], pool = new MemoryMediaPool()) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomPublication, {
    repo: repo.root,
    inventory,
    maxBytes: 1024 * 1024,
  })
  return { ctx, service: ctx.faberloomPublication, pool }
}

/** One repository with the two tracked files the inventory names. */
function repository(): TestRepository {
  const repo = createTestRepository()
  repositories.push(repo)
  repo.commit(PATH_A, BASE_A, 'base a')
  repo.commit(PATH_B, BASE_B, 'base b')
  return repo
}

/** One approval against the repository's current HEAD. */
function approval(repo: TestRepository, diff: string, overrides: Partial<PublicationApproval> = {}): PublicationApproval {
  return {
    itemId: 'item-1',
    revision: repo.head(),
    diff,
    artifactHash: 'h1',
    motivo: 'Tarea local aprobada',
    evidence: ['oc:505288'],
    ...overrides,
  }
}

describe('3A.1 applier', () => {
  it('commits a multi-file approved diff and reuses the same commit on retry', async () => {
    const repo = repository()
    const { service } = await boot(repo, [PATH_A, PATH_B])
    const before = repo.commitCount()
    const diff = [
      repo.diff(PATH_A, '# A\n\ndos\n'),
      repo.diff(PATH_B, '# B\n\ndos\n'),
    ].join('')
    expect(diffPaths(diff)).toEqual([PATH_A, PATH_B])

    const first = await service.apply(approval(repo, diff))
    expect(first.state).toBe('applied')
    expect(first.commit).toMatch(/^[0-9a-f]{40}$/u)
    expect(first.files).toEqual([
      expect.objectContaining({ path: PATH_A, status: 'modified' }),
      expect.objectContaining({ path: PATH_B, status: 'modified' }),
    ])
    expect(repo.git(['diff-tree', '--no-commit-id', '--name-only', '-r', first.commit]).trim().split('\n'))
      .toEqual(EXPECTED_MANIFEST.files.map(file => file.path))
    for (const file of EXPECTED_MANIFEST.files) {
      const committed = repo.git(['show', `${first.commit}:${file.path}`])
      expect(committed).toBe(readFileSync(join(EXPECTED, file.path), 'utf8'))
      expect(createHash('sha256').update(committed).digest('hex')).toBe(file.sha256)
      expect(Buffer.byteLength(committed)).toBe(file.bytes)
      expect(repo.read(file.path)).toBe(committed)
      expect(first.files).toContainEqual({
        path: file.path,
        status: 'modified',
        sha256: file.sha256,
        bytes: file.bytes,
      })
    }
    expect(repo.commitCount()).toBe(before + 1)

    const retry = await service.apply({
      itemId: 'item-1',
      revision: first.revision,
      diff,
      artifactHash: 'h1',
      motivo: 'Tarea local aprobada',
      evidence: ['oc:505288'],
    })
    expect(retry.commit).toBe(first.commit)
    expect(repo.commitCount()).toBe(before + 1)
  })

  it('keeps the application durable across a reopened composition', async () => {
    const repo = repository()
    const { service, pool, ctx } = await boot(repo, [PATH_A])
    const diff = repo.diff(PATH_A, '# A\n\ndos\n')
    const first = await service.apply(approval(repo, diff))
    await ctx.fiber.dispose()

    const reopened = await boot(repo, [PATH_A], pool)
    expect(await reopened.service.application('item-1')).toMatchObject({
      state: 'applied',
      commit: first.commit,
    })
  })

  it('refuses a path outside the server inventory with a durable conflict and no write', async () => {
    const repo = repository()
    const { service } = await boot(repo, [PATH_A])
    const before = repo.head()
    const diff = repo.diff(PATH_B, '# B\n\ndos\n')

    await expect(service.apply(approval(repo, diff))).rejects.toThrow('PUBLICATION_INVENTORY')
    expect(repo.head()).toBe(before)
    expect(repo.read(PATH_B)).toBe(BASE_B)
    expect(await service.application('item-1')).toMatchObject({ state: 'conflict' })
  })

  it('refuses a symlink at the target path', async () => {
    const repo = repository()
    const outside = join(repo.root, '..', `outside-${String(Date.now())}.md`)
    writeFileSync(outside, 'outside\n')
    const target = join(repo.root, PATH_A)
    const { service } = await boot(repo, [PATH_A])
    const diff = repo.diff(PATH_A, '# A\n\ndos\n')
    rmSync(target, { force: true })
    try {
      symlinkSync(outside, target)
    } catch (error) {
      // A Windows host without symlink privilege cannot host this case; the
      // guard still refuses a symlink wherever one exists.
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }

    await expect(service.apply(approval(repo, diff))).rejects.toThrow('PUBLICATION_SYMLINK')
    expect(await service.application('item-1')).toMatchObject({ state: 'conflict' })
  })

  it('refuses a symlinked parent directory even when the target file is inside it', async () => {
    const repo = createTestRepository()
    repositories.push(repo)
    repo.commit(PATH_A, BASE_A, 'base a')
    const outside = mkdtempSync(join(tmpdir(), 'faberloom-outside-'))
    writeFileSync(join(outside, 'a.md'), BASE_A)
    const diff = repo.diff(PATH_A, '# A\n\ndos\n')
    rmSync(join(repo.root, 'knowledge'), { recursive: true, force: true })
    symlinkSync(outside, join(repo.root, 'knowledge'), 'junction')
    const { service } = await boot(repo, [PATH_A])
    const before = repo.head()

    await expect(service.apply(approval(repo, diff))).rejects.toThrow('PUBLICATION_SYMLINK')
    expect(repo.head()).toBe(before)
    expect(readFileSync(join(outside, 'a.md'), 'utf8')).toBe(BASE_A)
    expect(await service.application('item-1')).toMatchObject({ state: 'conflict' })
    rmSync(outside, { recursive: true, force: true })
  })

  it('refuses a stale base and writes nothing', async () => {
    const repo = repository()
    const { service } = await boot(repo, [PATH_A])
    const approvedBase = repo.head()
    repo.commit('knowledge/foreign.md', 'foreign\n', 'foreign change')
    const diff = repo.diff(PATH_A, '# A\n\ndos\n')

    await expect(service.apply(approval(repo, diff, { revision: approvedBase }))).rejects.toThrow('PUBLICATION_BASE_STALE')
    expect(repo.read(PATH_A)).toBe(BASE_A)
    expect(await service.application('item-1')).toMatchObject({ state: 'conflict' })
  })

  it('serializes two competing approvals into one commit', async () => {
    const repo = repository()
    const { service } = await boot(repo, [PATH_A])
    const before = repo.commitCount()
    const diff = repo.diff(PATH_A, '# A\n\ndos\n')
    const one = approval(repo, diff, { itemId: 'item-a' })
    const two = approval(repo, diff, { itemId: 'item-b' })

    const results = await Promise.allSettled([service.apply(one), service.apply(two)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(repo.commitCount()).toBe(before + 1)
  })

  it('refuses a work tree with foreign changes', async () => {
    const repo = repository()
    const { service } = await boot(repo, [PATH_A])
    const before = repo.head()
    const diff = repo.diff(PATH_A, '# A\n\ndos\n')
    writeFileSync(join(repo.root, PATH_A), 'foreign\n')

    await expect(service.apply(approval(repo, diff))).rejects.toThrow('PUBLICATION_WORKTREE_DIRTY')
    expect(repo.head()).toBe(before)
  })

  it('never executes a command written in the diff', async () => {
    const repo = repository()
    const { service } = await boot(repo, [PATH_A])
    const marker = join(repo.root, '..', `pwned-${String(Date.now())}.txt`)
    const diff = repo.diff(PATH_A, `# A\n\n$(touch "${marker}")\n`)

    await service.apply(approval(repo, diff))
    expect(existsSync(marker)).toBe(false)
  })

  it('reconciles a commit that exists before the durable row is written', async () => {
    const repo = repository()
    const { service } = await boot(repo, [PATH_A])
    const diff = repo.diff(PATH_A, '# A\n\ndos\n')
    const approved = approval(repo, diff)
    const direct = commitApplication({
      root: repo.root,
      revision: approved.revision,
      diff,
      itemId: 'item-1',
      artifactHash: 'h1',
      inventory: [PATH_A],
      maxBytes: 1024 * 1024,
    })
    const before = repo.commitCount()

    const applied = await service.apply(approved)
    expect(applied.commit).toBe(direct.commit)
    expect(repo.commitCount()).toBe(before)
  })

  it('refuses a diff that smuggles a rename section past the inventory', async () => {
    const repo = repository()
    const { service } = await boot(repo, [PATH_A])
    const before = repo.head()
    const diff = repo.diff(PATH_A, '# A\n\ndos\n') + [
      'diff --git a/knowledge/b.md b/escape/moved.md',
      'similarity index 100%',
      'rename from knowledge/b.md',
      'rename to escape/moved.md',
      '',
    ].join('\n')

    await expect(service.apply(approval(repo, diff))).rejects.toThrow('PUBLICATION_PATCH_INVALID')
    expect(repo.head()).toBe(before)
    expect(repo.read(PATH_A)).toBe(BASE_A)
    expect(repo.read(PATH_B)).toBe(BASE_B)
    expect(await service.application('item-1')).toMatchObject({ state: 'conflict' })
  })

  it('refuses a changed diff under the same approval identity', async () => {
    const repo = repository()
    const { service } = await boot(repo, [PATH_A])
    const diff = repo.diff(PATH_A, '# A\n\ndos\n')
    const first = await service.apply(approval(repo, diff))

    await expect(service.apply({
      ...approval(repo, `${diff}\n`),
      revision: first.revision,
    })).rejects.toThrow('PUBLICATION_REQUEST_CONFLICT')
  })

  it('retries the same diff after the work-tree conflict is resolved', async () => {
    const repo = repository()
    const { service } = await boot(repo, [PATH_A])
    const diff = repo.diff(PATH_A, '# A\n\ndos\n')
    writeFileSync(join(repo.root, PATH_A), 'foreign\n')

    await expect(service.apply(approval(repo, diff))).rejects.toThrow('PUBLICATION_WORKTREE_DIRTY')
    expect(await service.application('item-1')).toMatchObject({ state: 'conflict' })

    repo.git(['checkout', '--', PATH_A])
    const applied = await service.apply(approval(repo, diff))
    expect(applied.state).toBe('applied')
    expect(repo.read(PATH_A)).toBe(readFileSync(join(EXPECTED, PATH_A), 'utf8'))
  })

  it('refuses while another process holds the application lock and retries after release', async () => {
    const repo = repository()
    const { service } = await boot(repo, [PATH_A])
    const lock = join(repo.root, '.git', 'faberloom-apply.lock')
    mkdirSync(lock)
    writeFileSync(join(lock, 'owner'), `${String(process.pid)}:another`)
    const diff = repo.diff(PATH_A, '# A\n\ndos\n')

    await expect(service.apply(approval(repo, diff))).rejects.toThrow('PUBLICATION_LOCKED')
    expect(await service.application('item-1')).toMatchObject({ state: 'conflict' })
    rmSync(lock, { recursive: true, force: true })
    expect((await service.apply(approval(repo, diff))).state).toBe('applied')
  })

  it('reconciles two services sharing one work tree and one medium', async () => {
    const repo = repository()
    const one = await boot(repo, [PATH_A])
    const two = await boot(repo, [PATH_A], one.pool)
    const diff = repo.diff(PATH_A, '# A\n\ndos\n')
    const request = approval(repo, diff)
    const before = repo.commitCount()

    const results = await Promise.allSettled([one.service.apply(request), two.service.apply(request)])
    const commits = results.flatMap(result => result.status === 'fulfilled' ? [result.value.commit] : [])
    expect(commits).toHaveLength(2)
    expect(new Set(commits).size).toBe(1)
    expect(repo.commitCount()).toBe(before + 1)
  })
})
