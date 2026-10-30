/**
 * The whole mutation loop over one real temp workspace: a create, a content
 * change, a rename, and a delete, each observed through the verbs the composer's
 * `@` menu and the Files panel read.
 *
 * The point is the seam, not one verb. `@` holds no cache: every query asks
 * `workspaceFiles.list` for the Session's workspace root and renders the answer,
 * so "visible in `@` afterwards" means the listing names the entry, with the
 * workspace path that becomes its mention text. The attach row beside it asks
 * `workspaceFiles.readAll`, so "the model reads the file" means those bytes.
 * The mutation verbs under test are the ones the model's `faberloom_files_*`
 * tools and the Files panel's gestures both call, resolved against the same
 * Session workspace root, which is why this spec drives them directly here.
 *
 * A content change is written through `ctx.fs.writeText` with no intent, which
 * is what the model's own `write` tool does; this package owns no verb that
 * overwrites an existing file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { failureOf, openWorkspace, signal, type Harness } from './harness.ts'

let harness: Harness

beforeEach(async () => {
  harness = await openWorkspace('dsh-workspace-files-loop-')
})

afterEach(async () => {
  await harness.dispose()
})

const endpoint = (): ReturnType<Harness['endpoint']> => harness.endpoint()

/** The names one listing offers the menu, exactly as `@` reads them. */
async function listedNames(path = '.'): Promise<string[]> {
  const listing = await endpoint().list(harness.scope, path, signal())
  return listing.entries.map(entry => entry.name)
}

/** The complete bytes of one file, exactly as the attach row reads them. */
async function attachedBytes(path: string): Promise<Buffer> {
  const read = await endpoint().readAll(harness.scope, path, signal())
  return Buffer.from(read.data, 'base64')
}

describe('the workspace folder mutation loop', () => {
  it('shows a created file in the listing, with the path its mention carries', async () => {
    await expect(listedNames()).resolves.toEqual([])

    const created = await endpoint().createFile(harness.scope, 'informe.md', 'primera\n', signal())
    expect(created.operation).toBe('created-file')
    expect(created.path).toBe('informe.md')

    expect(await listedNames()).toEqual(['informe.md'])
    await expect(readFile(join(harness.workspace, 'informe.md'), 'utf8')).resolves.toBe('primera\n')
    // The attach row's read, over the entry the listing just named.
    expect((await attachedBytes('informe.md')).toString('utf8')).toBe('primera\n')
  })

  it('shows a created folder in the listing and lists its contents one level down', async () => {
    await endpoint().createDirectory(harness.scope, 'Documentos 2026', signal())
    await endpoint().createFile(harness.scope, 'Documentos 2026/factura.txt', 'contenido\n', signal())

    // The root listing names the folder alone: one level per listing, which is
    // what the `@` menu drills through.
    expect(await listedNames()).toEqual(['Documentos 2026'])
    expect(await listedNames('Documentos 2026')).toEqual(['factura.txt'])
  })

  it('keeps a content change visible: the listing still names the file and the attach row reads the new bytes', async () => {
    await endpoint().createFile(harness.scope, 'notas.txt', 'antes\n', signal())
    const target = await harness.ctx.fs.resolve('notas.txt', { cwd: harness.workspace, signal: signal() })
    // No intent: the unconditional create-or-replace, as the model's `write` tool defaults to.
    await harness.ctx.fs.writeText(target, 'después\n', undefined, signal())

    // The edit changes no name, so `@` still lists it and the bytes behind its
    // attach row are the model's new content.
    expect(await listedNames()).toEqual(['notas.txt'])
    expect((await attachedBytes('notas.txt')).toString('utf8')).toBe('después\n')
    await expect(readFile(join(harness.workspace, 'notas.txt'), 'utf8')).resolves.toBe('después\n')
  })

  it('replaces the renamed name in the listing and keeps the content under it', async () => {
    await endpoint().createFile(harness.scope, 'borrador.txt', 'cuerpo\n', signal())
    const moved = await endpoint().move(harness.scope, 'borrador.txt', 'final.txt', {}, signal())
    expect(moved.operation).toBe('moved')
    expect(moved.from).toBe('borrador.txt')
    expect(moved.path).toBe('final.txt')

    expect(await listedNames()).toEqual(['final.txt'])
    expect(existsSync(join(harness.workspace, 'borrador.txt'))).toBe(false)
    expect((await attachedBytes('final.txt')).toString('utf8')).toBe('cuerpo\n')
  })

  it('drops a removed file from the listing and refuses its attach read', async () => {
    await endpoint().createFile(harness.scope, 'temporal.txt', 'x\n', signal())
    expect(await listedNames()).toEqual(['temporal.txt'])

    const removed = await endpoint().removePath(harness.scope, 'temporal.txt', {}, signal())
    expect(removed.operation).toBe('removed')
    expect(removed.path).toBe('temporal.txt')

    expect(await listedNames()).toEqual([])
    expect(existsSync(join(harness.workspace, 'temporal.txt'))).toBe(false)
    const gone = await failureOf(endpoint().readAll(harness.scope, 'temporal.txt', signal()))
    expect(gone.code).toBe('workspace-file/not-found')
  })

  it('runs the whole loop over one file and leaves the workspace as it found it', async () => {
    expect(await listedNames()).toEqual([])
    await endpoint().createFile(harness.scope, 'ciclo.txt', 'uno\n', signal())
    expect(await listedNames()).toEqual(['ciclo.txt'])

    const target = await harness.ctx.fs.resolve('ciclo.txt', { cwd: harness.workspace, signal: signal() })
    await harness.ctx.fs.writeText(target, 'dos\n', undefined, signal())
    expect((await attachedBytes('ciclo.txt')).toString('utf8')).toBe('dos\n')

    await endpoint().move(harness.scope, 'ciclo.txt', 'ciclo final.txt', {}, signal())
    expect(await listedNames()).toEqual(['ciclo final.txt'])

    await endpoint().removePath(harness.scope, 'ciclo final.txt', {}, signal())
    expect(await listedNames()).toEqual([])
  })

  it('refuses a traversal above the workspace for every verb of the loop', async () => {
    await endpoint().createFile(harness.scope, 'dentro.txt', 'x\n', signal())
    expect((await failureOf(endpoint().createFile(harness.scope, '../fuera.txt', 'x', signal()))).code)
      .toBe('workspace-file/outside-workspace')
    expect((await failureOf(endpoint().move(harness.scope, 'dentro.txt', '../fuera.txt', {}, signal()))).code)
      .toBe('workspace-file/outside-workspace')
    // The sibling directory exists, so the refusal is containment and not a
    // missing entry.
    expect((await failureOf(endpoint().removePath(harness.scope, harness.outside, { recursive: true }, signal()))).code)
      .toBe('workspace-file/outside-workspace')
    expect(existsSync(join(harness.outside, 'fuera.txt'))).toBe(false)
    expect(existsSync(harness.outside)).toBe(true)
    expect(await listedNames()).toEqual(['dentro.txt'])
  })
})
