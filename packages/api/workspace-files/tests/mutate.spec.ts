/**
 * The mutation verbs: create a file, create a directory, move an entry, and
 * remove an entry, each confined to the Session's workspace root.
 *
 * The real local backend is under test because a fake provider would let a
 * string-prefix containment check pass a `..` or an absolute sibling path,
 * which is exactly the refusal these verbs exist to make.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { failureOf, openWorkspace, signal, type Harness } from './harness.ts'

/** A filesystem provider whose execution world is not this host's, for the backend gate. */
class OffHostFileSystem extends LocalFileSystem {
  /** @returns always undefined: this backend shares no host path with the process. */
  override processPathFromHostPath(): string | undefined {
    return undefined
  }
}

let harness: Harness
let workspace: string
let outside: string

beforeEach(async () => {
  harness = await openWorkspace('dsh-workspace-files-mutate-')
  workspace = harness.workspace
  outside = harness.outside
})

afterEach(async () => {
  await harness.dispose()
})

const endpoint = (): ReturnType<Harness['endpoint']> => harness.endpoint()

describe('workspaceFiles.createFile', () => {
  it('writes the content and reports the entry as a workspace path and an absolute path', async () => {
    const result = await endpoint().createFile(harness.scope, 'notes.txt', 'hello\n', signal())
    expect(result).toEqual({
      operation: 'created-file',
      path: 'notes.txt',
      absolutePath: await realpath(join(workspace, 'notes.txt')),
    })
    await expect(readFile(join(workspace, 'notes.txt'), 'utf8')).resolves.toBe('hello\n')
  })

  it('creates the missing parent directories of a nested path', async () => {
    const result = await endpoint().createFile(harness.scope, 'src/deep/a.ts', 'export {}\n', signal())
    expect(result.path).toBe('src/deep/a.ts')
    await expect(readFile(join(workspace, 'src', 'deep', 'a.ts'), 'utf8')).resolves.toBe('export {}\n')
  })

  it('refuses an occupied destination as already-exists and leaves the file alone', async () => {
    await writeFile(join(workspace, 'notes.txt'), 'original', 'utf8')
    const failure = await failureOf(endpoint().createFile(harness.scope, 'notes.txt', 'other', signal()))
    expect(failure.code).toBe('workspace-file/already-exists')
    expect(failure.details).toEqual({ path: 'notes.txt' })
    await expect(readFile(join(workspace, 'notes.txt'), 'utf8')).resolves.toBe('original')
  })

  it('refuses content above the full-file cap as too-large', async () => {
    const failure = await failureOf(harness.endpoint({ maxFileBytes: 4 }).createFile(harness.scope, 'big.txt', '12345', signal()))
    expect(failure.code).toBe('workspace-file/too-large')
    expect(failure.details).toEqual({ path: 'big.txt', limit: 4 })
  })

  it('refuses an empty path as a bad request', async () => {
    const failure = await failureOf(endpoint().createFile(harness.scope, '', 'x', signal()))
    expect(failure.code).toBe('gateway/bad-request')
  })

  it('refuses a traversal that climbs out of the workspace, before writing anything', async () => {
    const failure = await failureOf(endpoint().createFile(harness.scope, '../escaped.txt', 'x', signal()))
    expect(failure.code).toBe('workspace-file/outside-workspace')
    expect(failure.details).toEqual({ path: '../escaped.txt' })
    await expect(readFile(join(outside, 'escaped.txt'), 'utf8')).rejects.toThrow()
  })

  it('refuses an absolute path outside the workspace', async () => {
    const failure = await failureOf(endpoint().createFile(harness.scope, join(outside, 'escaped.txt'), 'x', signal()))
    expect(failure.code).toBe('workspace-file/outside-workspace')
    await expect(readFile(join(outside, 'escaped.txt'), 'utf8')).rejects.toThrow()
  })

  it('refuses a destination whose name is a symbolic link', async () => {
    await mkdir(join(workspace, 'realdir'))
    await symlink(join(workspace, 'realdir'), join(workspace, 'link'), 'junction')
    const failure = await failureOf(endpoint().createFile(harness.scope, 'link', 'x', signal()))
    expect(failure.code).toBe('workspace-file/symlink-refused')
    expect(failure.details).toEqual({ path: 'link' })
  })
})

describe('workspaceFiles.createDirectory', () => {
  it('creates a nested directory and reports it', async () => {
    const result = await endpoint().createDirectory(harness.scope, 'src/deep', signal())
    expect(result).toEqual({
      operation: 'created-directory',
      path: 'src/deep',
      absolutePath: await realpath(join(workspace, 'src', 'deep')),
    })
  })

  it('refuses an occupied name, including a symbolic link and the workspace root itself', async () => {
    await mkdir(join(workspace, 'src'))
    const occupied = await failureOf(endpoint().createDirectory(harness.scope, 'src', signal()))
    expect(occupied.code).toBe('workspace-file/already-exists')
    await mkdir(join(workspace, 'realdir'))
    await symlink(join(workspace, 'realdir'), join(workspace, 'link'), 'junction')
    const link = await failureOf(endpoint().createDirectory(harness.scope, 'link', signal()))
    expect(link.code).toBe('workspace-file/symlink-refused')
    const root = await failureOf(endpoint().createDirectory(harness.scope, '.', signal()))
    expect(root.code).toBe('workspace-file/already-exists')
    expect(root.details).toEqual({ path: '.' })
  })

  it('refuses a path outside the workspace', async () => {
    const failure = await failureOf(endpoint().createDirectory(harness.scope, outside, signal()))
    expect(failure.code).toBe('workspace-file/outside-workspace')
  })
})

describe('workspaceFiles.move', () => {
  it('renames one entry in place and names the previous workspace path', async () => {
    await writeFile(join(workspace, 'old.txt'), 'body', 'utf8')
    const result = await endpoint().move(harness.scope, 'old.txt', 'new.txt', {}, signal())
    expect(result).toEqual({
      operation: 'moved',
      path: 'new.txt',
      absolutePath: await realpath(join(workspace, 'new.txt')),
      from: 'old.txt',
    })
    await expect(readFile(join(workspace, 'new.txt'), 'utf8')).resolves.toBe('body')
    await expect(readFile(join(workspace, 'old.txt'), 'utf8')).rejects.toThrow()
  })

  it('moves one entry into another directory', async () => {
    await mkdir(join(workspace, 'src'))
    await writeFile(join(workspace, 'a.txt'), 'body', 'utf8')
    const result = await endpoint().move(harness.scope, 'a.txt', 'src/a.txt', {}, signal())
    expect(result.path).toBe('src/a.txt')
    expect(result.from).toBe('a.txt')
  })

  it('refuses a missing source as not-found', async () => {
    const failure = await failureOf(endpoint().move(harness.scope, 'gone.txt', 'new.txt', {}, signal()))
    expect(failure.code).toBe('workspace-file/not-found')
    expect(failure.details).toEqual({ path: 'gone.txt' })
  })

  it('refuses an empty destination as a bad request', async () => {
    await writeFile(join(workspace, 'a.txt'), 'body', 'utf8')
    const failure = await failureOf(endpoint().move(harness.scope, 'a.txt', '', {}, signal()))
    expect(failure.code).toBe('gateway/bad-request')
  })

  it('refuses an occupied destination unless the call allows the replacement', async () => {
    await writeFile(join(workspace, 'a.txt'), 'from', 'utf8')
    await writeFile(join(workspace, 'b.txt'), 'to', 'utf8')
    const refused = await failureOf(endpoint().move(harness.scope, 'a.txt', 'b.txt', {}, signal()))
    expect(refused.code).toBe('workspace-file/already-exists')
    expect(refused.details).toEqual({ path: 'b.txt' })
    await expect(readFile(join(workspace, 'a.txt'), 'utf8')).resolves.toBe('from')

    const replaced = await endpoint().move(harness.scope, 'a.txt', 'b.txt', { overwrite: true }, signal())
    expect(replaced.path).toBe('b.txt')
    await expect(readFile(join(workspace, 'b.txt'), 'utf8')).resolves.toBe('from')
  })

  it('replaces an occupied directory when the call allows it', async () => {
    await writeFile(join(workspace, 'a.txt'), 'from', 'utf8')
    await mkdir(join(workspace, 'doomed', 'nested'), { recursive: true })
    const replaced = await endpoint().move(harness.scope, 'a.txt', 'doomed', { overwrite: true }, signal())
    expect(replaced.path).toBe('doomed')
    await expect(readFile(join(workspace, 'doomed'), 'utf8')).resolves.toBe('from')
  })

  it('refuses a destination no more specific than the source, and one inside the workspace but under nothing else', async () => {
    await mkdir(join(workspace, 'src', 'deep'), { recursive: true })
    const itself = await failureOf(endpoint().move(harness.scope, 'src', 'src', {}, signal()))
    expect(itself.code).toBe('workspace-file/bad-target')
    expect(itself.details).toEqual({ path: 'src', target: 'src' })
    const into = await failureOf(endpoint().move(harness.scope, 'src', 'src/deep/moved', {}, signal()))
    expect(into.code).toBe('workspace-file/bad-target')
  })

  it('refuses the workspace root as the source or as the destination', async () => {
    await writeFile(join(workspace, 'a.txt'), 'body', 'utf8')
    const source = await failureOf(endpoint().move(harness.scope, '.', 'moved', {}, signal()))
    expect(source.code).toBe('workspace-file/root-refused')
    const destination = await failureOf(endpoint().move(harness.scope, 'a.txt', '.', { overwrite: true }, signal()))
    expect(destination.code).toBe('workspace-file/root-refused')
    expect(destination.details).toEqual({ path: '.' })
    await expect(readFile(join(workspace, 'a.txt'), 'utf8')).resolves.toBe('body')
  })

  it('refuses either path outside the workspace', async () => {
    await writeFile(join(workspace, 'a.txt'), 'body', 'utf8')
    const from = await failureOf(endpoint().move(harness.scope, '..', 'b.txt', {}, signal()))
    expect(from.code).toBe('workspace-file/outside-workspace')
    const to = await failureOf(endpoint().move(harness.scope, 'a.txt', join(outside, 'b.txt'), {}, signal()))
    expect(to.code).toBe('workspace-file/outside-workspace')
    await expect(readFile(join(workspace, 'a.txt'), 'utf8')).resolves.toBe('body')
  })

  it('refuses a symbolic-link source instead of moving its destination', async () => {
    await mkdir(join(workspace, 'realdir'))
    await symlink(join(workspace, 'realdir'), join(workspace, 'link'), 'junction')
    const failure = await failureOf(endpoint().move(harness.scope, 'link', 'moved', {}, signal()))
    expect(failure.code).toBe('workspace-file/symlink-refused')
    expect(existsSync(join(workspace, 'realdir'))).toBe(true)
  })

  it('refuses a symbolic-link destination', async () => {
    await writeFile(join(workspace, 'a.txt'), 'from', 'utf8')
    await mkdir(join(workspace, 'realdir'))
    await symlink(join(workspace, 'realdir'), join(workspace, 'link'), 'junction')
    const failure = await failureOf(endpoint().move(harness.scope, 'a.txt', 'link', {}, signal()))
    expect(failure.code).toBe('workspace-file/symlink-refused')
    await expect(readFile(join(workspace, 'a.txt'), 'utf8')).resolves.toBe('from')
  })
})

describe('workspaceFiles.removePath', () => {
  it('removes one file and reports the entry it removed', async () => {
    await writeFile(join(workspace, 'gone.txt'), 'body', 'utf8')
    const result = await endpoint().removePath(harness.scope, 'gone.txt', {}, signal())
    expect(result.operation).toBe('removed')
    expect(result.path).toBe('gone.txt')
    await expect(readFile(join(workspace, 'gone.txt'), 'utf8')).rejects.toThrow()
  })

  it('removes an empty directory', async () => {
    await mkdir(join(workspace, 'empty'))
    const result = await endpoint().removePath(harness.scope, 'empty', {}, signal())
    expect(result.path).toBe('empty')
    expect(existsSync(join(workspace, 'empty'))).toBe(false)
  })

  it('refuses a directory that still has entries, and removes it with recursive', async () => {
    await mkdir(join(workspace, 'full', 'nested'), { recursive: true })
    await writeFile(join(workspace, 'full', 'a.txt'), 'body', 'utf8')
    const refused = await failureOf(endpoint().removePath(harness.scope, 'full', {}, signal()))
    expect(refused.code).toBe('workspace-file/directory-not-empty')
    expect(refused.details).toEqual({ path: 'full' })
    await expect(readFile(join(workspace, 'full', 'a.txt'), 'utf8')).resolves.toBe('body')

    const removed = await endpoint().removePath(harness.scope, 'full', { recursive: true }, signal())
    expect(removed.path).toBe('full')
    await expect(readFile(join(workspace, 'full', 'a.txt'), 'utf8')).rejects.toThrow()
  })

  it('refuses a missing entry as not-found', async () => {
    const failure = await failureOf(endpoint().removePath(harness.scope, 'gone.txt', {}, signal()))
    expect(failure.code).toBe('workspace-file/not-found')
  })

  it('refuses the workspace root and any path outside it', async () => {
    await writeFile(join(workspace, 'keep.txt'), 'body', 'utf8')
    const root = await failureOf(endpoint().removePath(harness.scope, '.', { recursive: true }, signal()))
    expect(root.code).toBe('workspace-file/root-refused')
    const traversal = await failureOf(endpoint().removePath(harness.scope, '../outside', { recursive: true }, signal()))
    expect(traversal.code).toBe('workspace-file/outside-workspace')
    const absolute = await failureOf(endpoint().removePath(harness.scope, outside, { recursive: true }, signal()))
    expect(absolute.code).toBe('workspace-file/outside-workspace')
    await expect(readFile(join(workspace, 'keep.txt'), 'utf8')).resolves.toBe('body')
  })

  it('refuses a symbolic link instead of deleting its destination', async () => {
    await mkdir(join(workspace, 'realdir', 'nested'), { recursive: true })
    await symlink(join(workspace, 'realdir'), join(workspace, 'link'), 'junction')
    const failure = await failureOf(endpoint().removePath(harness.scope, 'link', { recursive: true }, signal()))
    expect(failure.code).toBe('workspace-file/symlink-refused')
    expect(existsSync(join(workspace, 'realdir', 'nested'))).toBe(true)
  })
})

describe('workspaceFiles mutations — the backend gate', () => {
  it('refuses a backend that does not share the harness host', async () => {
    const offHost = await openWorkspace('dsh-workspace-files-offhost-', OffHostFileSystem)
    try {
      const failure = await failureOf(offHost.endpoint().createDirectory(offHost.scope, 'src', signal()))
      expect(failure.code).toBe('workspace-file/unsupported-backend')
      expect(failure.details).toEqual({ path: 'src' })
    } finally {
      await offHost.dispose()
    }
  })
})
