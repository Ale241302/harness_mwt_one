// @vitest-environment jsdom
/**
 * The tree's mutation gestures against a scripted host.
 *
 * What is asserted is the reader's contract: the header control creates in the
 * workspace root, a row's control creates in that row's directory, rename
 * offers the current name, delete names the entry and asks before removing a
 * folder's contents, a refusal stays in the dialog as a localized line, and a
 * success closes the dialog because the face re-lists the level from the host.
 * The dialog's own confirmation gate is checked on its own.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { RemoteError, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { failureLine } from '../src/client/FilesBody.tsx'
import { zh } from '../src/client/locales.ts'
import type { DirLevel } from '../src/client/store.ts'
import { mountBody, ROOT, SESSION } from './mount.client.tsx'
import { CREATED } from './scripted-mutate.client.ts'

const ROOT_LEVEL: DirLevel = {
  entries: [
    { name: 'src', type: 'directory' },
    { name: 'notes.txt', type: 'file', size: 4 },
  ],
  truncated: false,
}

afterEach(() => { cleanup() })

/** Choose one menu item by its visible label. */
async function pick(label: string): Promise<void> {
  const item = await screen.findByRole('menuitem', { name: label })
  act(() => { fireEvent.click(item) })
}

/** Open one row's more-actions menu and choose an item by its visible label. */
async function choose(parent: string, label: string): Promise<void> {
  act(() => { fireEvent.click(document.querySelector(`[data-files-menu="${parent}"]`)!) })
  await pick(label)
}

describe('FilesBody mutations', () => {
  it('creates a file in the workspace root from the header control, then closes and re-lists', async () => {
    const { script, mutations } = mountBody()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    script.list.mockClear()

    act(() => { fireEvent.click(document.querySelector('[data-files-new]')!) })
    await pick(zh['menu.newFile'])
    const dialog = document.querySelector('[data-files-dialog="create"]')
    expect(dialog).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(zh['dialog.newFileTitle'])

    fireEvent.change(document.querySelector('[data-files-name]')!, { target: { value: 'notas.md' } })
    act(() => { fireEvent.click(screen.getByRole('button', { name: zh['dialog.create'] })) })
    expect(mutations.createFile).toHaveBeenCalledWith(SESSION, `${ROOT}/notas.md`, '', expect.any(AbortSignal))

    await act(() => mutations.settle({ ok: true, value: CREATED }))
    expect(document.querySelector('[data-files-dialog]')).toBeNull()
    expect(script.list).toHaveBeenCalledWith(SESSION, ROOT, expect.any(AbortSignal))
  })

  it('creates a folder in the row it was asked from', async () => {
    const { script, mutations } = mountBody()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    await choose(`${ROOT}/src`, zh['menu.newFolder'])
    fireEvent.change(document.querySelector('[data-files-name]')!, { target: { value: 'sub' } })
    act(() => { fireEvent.click(screen.getByRole('button', { name: zh['dialog.create'] })) })
    expect(mutations.createDirectory).toHaveBeenCalledWith(SESSION, `${ROOT}/src/sub`, expect.any(AbortSignal))
  })

  it('renames a file with its current name offered, and sends the new one', async () => {
    const { script, mutations } = mountBody()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    await choose(`${ROOT}/notes.txt`, zh['menu.rename'])
    const input = document.querySelector<HTMLInputElement>('[data-files-name]')!
    expect(input.value).toBe('notes.txt')
    fireEvent.change(input, { target: { value: 'apuntes.txt' } })
    act(() => { fireEvent.click(screen.getByRole('button', { name: zh['dialog.rename'] })) })
    expect(mutations.move).toHaveBeenCalledWith(SESSION, `${ROOT}/notes.txt`, `${ROOT}/apuntes.txt`, {}, expect.any(AbortSignal))
  })

  it('keeps a refused rename in the dialog, with the refusal in the reader\'s language', async () => {
    const { script, mutations } = mountBody()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    await choose(`${ROOT}/notes.txt`, zh['menu.rename'])
    fireEvent.change(document.querySelector('[data-files-name]')!, { target: { value: 'src' } })
    act(() => { fireEvent.click(screen.getByRole('button', { name: zh['dialog.rename'] })) })
    await act(() => mutations.settle({
      ok: false,
      error: new RemoteError('workspace-file/already-exists', 'taken', { path: 'src' }),
    }))
    const error = document.querySelector('[data-files-error="workspace-file/already-exists"]')
    expect(error?.textContent).toBe(zh['error.alreadyExists'])
    expect(document.querySelector('[data-files-dialog="rename"]')).not.toBeNull()
  })

  it('names the entry before deleting it, and only takes the contents when told to', async () => {
    const { script, mutations } = mountBody()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    await choose(`${ROOT}/src`, zh['menu.delete'])
    expect(screen.getByRole('dialog').textContent).toContain('src')
    const check = document.querySelector('[data-files-dialog="delete"] input[type="checkbox"]')!
    act(() => { fireEvent.click(screen.getByRole('button', { name: zh['dialog.delete'] })) })
    expect(mutations.remove).toHaveBeenLastCalledWith(SESSION, `${ROOT}/src`, {}, expect.any(AbortSignal))
    await act(() => mutations.settle({
      ok: false,
      error: new RemoteError('workspace-file/directory-not-empty', 'full', { path: 'src' }),
    }))
    expect(document.querySelector('[data-files-error="workspace-file/directory-not-empty"]')?.textContent)
      .toBe(zh['error.directoryNotEmpty'])

    act(() => { fireEvent.click(check) })
    act(() => { fireEvent.click(screen.getByRole('button', { name: zh['dialog.delete'] })) })
    expect(mutations.remove).toHaveBeenLastCalledWith(SESSION, `${ROOT}/src`, { recursive: true }, expect.any(AbortSignal))
    await act(() => mutations.settle({ ok: true, value: { operation: 'removed', path: 'src', absolutePath: `${ROOT}/src` } }))
    expect(document.querySelector('[data-files-dialog]')).toBeNull()
  })

  it('answers a file row with rename and delete but no create gestures', async () => {
    const { script } = mountBody()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    act(() => { fireEvent.click(document.querySelector(`[data-files-menu="${ROOT}/notes.txt"]`)!) })
    const labels = (await screen.findAllByRole('menuitem')).map(item => item.textContent)
    expect(labels).toEqual([zh['menu.rename'], zh['menu.delete']])
  })

  it('gives the root row no menu control and closes a menu when the dialog opens', async () => {
    const { script } = mountBody()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    expect(document.querySelector(`[data-files-menu="${ROOT}"]`)).toBeNull()
    act(() => { fireEvent.click(document.querySelector(`[data-files-menu="${ROOT}/src"]`)!) })
    await pick(zh['menu.rename'])
    expect([...document.querySelectorAll('[role="menuitem"]')]).toEqual([])
    // Cancel leaves the tree untouched and the dialog gone.
    act(() => { fireEvent.click(screen.getByRole('button', { name: zh.cancel })) })
    expect(document.querySelector('[data-files-dialog]')).toBeNull()
  })

  it('closes an open menu on Escape or a second click of its own control', async () => {
    const { script } = mountBody()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    const row = document.querySelector(`[data-files-menu="${ROOT}/src"]`)!
    act(() => { fireEvent.click(row) })
    expect(document.querySelectorAll('[role="menuitem"]')).not.toHaveLength(0)
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect([...document.querySelectorAll('[role="menuitem"]')]).toEqual([])
    act(() => { fireEvent.click(row) })
    act(() => { fireEvent.click(row) })
    expect([...document.querySelectorAll('[role="menuitem"]')]).toEqual([])

    const header = document.querySelector('[data-files-new]')!
    act(() => { fireEvent.click(header) })
    expect(document.querySelectorAll('[role="menuitem"]')).not.toHaveLength(0)
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect([...document.querySelectorAll('[role="menuitem"]')]).toEqual([])
    act(() => { fireEvent.click(header) })
    act(() => { fireEvent.click(header) })
    expect([...document.querySelectorAll('[role="menuitem"]')]).toEqual([])
  })

  it('will not confirm a name that is empty or spans more than one segment', async () => {
    const { script } = mountBody()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    await choose(`${ROOT}/src`, zh['menu.newFile'])
    const confirm = (): HTMLButtonElement => screen.getByRole('button', { name: zh['dialog.create'] })
    expect(confirm().disabled).toBe(true)
    fireEvent.change(document.querySelector('[data-files-name]')!, { target: { value: 'a/b' } })
    expect(confirm().disabled).toBe(true)
    fireEvent.change(document.querySelector('[data-files-name]')!, { target: { value: 'a.txt' } })
    expect(confirm().disabled).toBe(false)
  })

  it('submits the name on Enter without touching the tree before the host answers', async () => {
    const { script, mutations } = mountBody()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    await choose(`${ROOT}/src`, zh['menu.newFile'])
    fireEvent.change(document.querySelector('[data-files-name]')!, { target: { value: 'a.txt' } })
    act(() => { fireEvent.keyDown(document.querySelector('[data-files-name]')!, { key: 'a' }) })
    expect(mutations.outstanding()).toEqual([])
    act(() => { fireEvent.keyDown(document.querySelector('[data-files-name]')!, { key: 'Enter' }) })
    expect(mutations.outstanding()).toEqual(['createFile'])
    await act(() => mutations.settle({ ok: true, value: CREATED }))
    expect(document.querySelector('[data-files-dialog]')).toBeNull()
  })
})

describe('failureLine — the mutation refusals', () => {
  const t = makeTranslate(zh)
  const codes = {
    'workspace-file/already-exists': zh['error.alreadyExists'],
    'workspace-file/directory-not-empty': zh['error.directoryNotEmpty'],
    'workspace-file/root-refused': zh['error.rootRefused'],
    'workspace-file/symlink-refused': zh['error.symlinkRefused'],
    'workspace-file/bad-target': zh['error.badTarget'],
    'workspace-file/unsupported-backend': zh['error.unsupportedBackend'],
    'workspace-file/too-large': zh['error.tooLarge'],
  } as const

  it('names each refusal', () => {
    for (const [code, line] of Object.entries(codes)) {
      expect(failureLine(t, { code, message: 'x' } as never)).toBe(line)
    }
  })
})
