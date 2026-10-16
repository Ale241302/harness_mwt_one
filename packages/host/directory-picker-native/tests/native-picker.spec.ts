/**
 * Native picker tier selection and the execFile adapter: the Win32 dialog
 * primary (failures surface as-is, no fallback tier), the abort rule, and
 * the POSIX command tiers (osascript, Zenity → KDialog).
 */

type ExecFileCallback = (
  error: (Error & { code?: string | number }) | null,
  stdout: string,
  stderr: string,
) => void
type ExecFileMock = (
  command: string,
  args: readonly string[],
  options: { encoding: string; signal: AbortSignal; windowsHide: boolean },
  callback: ExecFileCallback,
) => void

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn<ExecFileMock>() }))

vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import { describe, expect, it, vi } from 'vitest'
import { pickNativeDirectory, pickNativeFile, type DirectoryPickerRunner } from '../src/native-picker.ts'

function failure(code: string | number, stderr = ''): Error {
  return Object.assign(new Error(`command failed: ${String(code)}`), { code, stderr })
}

const signal = () => new AbortController().signal

/** A Win32 dialog that always fails — the no-fallback case. */
const noDialog = async (): Promise<string | null> => { throw new Error('dialog unavailable') }

describe('native directory picker', () => {
  it('uses the macOS folder chooser and maps user cancellation to null', async () => {
    const run = vi.fn<DirectoryPickerRunner>(async () => ({ stdout: '/Users/test/project/\n', stderr: '' }))
    await expect(pickNativeDirectory(signal(), { platform: 'darwin', run })).resolves.toBe('/Users/test/project/')
    expect(run).toHaveBeenCalledWith('osascript', expect.arrayContaining(['POSIX path of selectedFolder']), expect.any(AbortSignal))

    run.mockRejectedValueOnce(failure(1, 'execution error: User canceled. (-128)'))
    await expect(pickNativeDirectory(signal(), { platform: 'darwin', run })).resolves.toBeNull()

    run.mockRejectedValueOnce(failure(2, 'permission denied'))
    await expect(pickNativeDirectory(signal(), { platform: 'darwin', run })).rejects.toThrow('command failed')
  })

  it.each([
    ['a primitive error', 'failed'],
    ['an invalid code type', { code: true }],
    ['a missing stderr property', { code: 1 }],
    ['a non-string stderr property', { code: 1, stderr: 42 }],
  ])('does not mistake %s for macOS cancellation', async (_label, reason) => {
    const run = vi.fn<DirectoryPickerRunner>(async () => { throw reason })
    await expect(pickNativeDirectory(signal(), { platform: 'darwin', run })).rejects.toBe(reason)
  })

  it('uses the Win32 dialog and never spawns a command when it answers', async () => {
    const run = vi.fn<DirectoryPickerRunner>()
    const pickWin32Dialog = vi.fn(async (): Promise<string | null> => 'C:\\work\\selected')
    await expect(pickNativeDirectory(signal(), { platform: 'win32', run, pickWin32Dialog })).resolves.toBe('C:\\work\\selected')
    pickWin32Dialog.mockResolvedValueOnce(null)
    await expect(pickNativeDirectory(signal(), { platform: 'win32', run, pickWin32Dialog })).resolves.toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it('surfaces the Win32 dialog failure with no fallback', async () => {
    const run = vi.fn<DirectoryPickerRunner>()
    await expect(pickNativeDirectory(signal(), { platform: 'win32', run, pickWin32Dialog: noDialog }))
      .rejects.toThrow('dialog unavailable')
    expect(run).not.toHaveBeenCalled()
  })

  it('wires the real Win32 dialog as the default tier', async () => {
    // A pre-aborted signal makes the DEFAULT dialog deterministic on every
    // host: pickWin32Directory throws before spawning any worker or window.
    const abort = new AbortController()
    abort.abort()
    const run = vi.fn<DirectoryPickerRunner>()
    await expect(pickNativeDirectory(abort.signal, { platform: 'win32', run }))
      .rejects.toThrow('native directory picker aborted')
    expect(run).not.toHaveBeenCalled()
  })

  it('does not fall back when the caller aborted the dialog', async () => {
    const abort = new AbortController()
    abort.abort(new Error('closed'))
    const run = vi.fn<DirectoryPickerRunner>()
    await expect(pickNativeDirectory(abort.signal, { platform: 'win32', run, pickWin32Dialog: noDialog })).rejects.toThrow('dialog unavailable')
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the default command adapter without a shell and preserves command failures', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(null, '/home/test/project\n', '')
    })
    await expect(pickNativeDirectory(signal(), { platform: 'linux' })).resolves.toBe('/home/test/project')
    const [command, args, options] = execFileMock.mock.calls[0]!
    expect(command).toBe('zenity')
    expect(args).toEqual(expect.arrayContaining(['--file-selection', '--directory']))
    expect(options.encoding).toBe('utf8')
    expect(options.windowsHide).toBe(true)
    expect(options.signal).toBeInstanceOf(AbortSignal)

    // A non-cancellation command failure surfaces as-is with its cause and
    // captured stdio attached; no tier masks or rewraps it.
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(Object.assign(new Error('zenity failed'), { code: 7 }), 'partial output', 'failure details')
    })
    const surfaced = await pickNativeDirectory(signal(), { platform: 'linux' })
      .then(() => { throw new Error('expected rejection') }, (error: unknown) => error as Error)
    expect(surfaced).toMatchObject({
      message: 'zenity failed', code: 7,
      stdout: 'partial output', stderr: 'failure details',
    })
    expect((surfaced as { cause?: unknown }).cause).toBeInstanceOf(Error)
  })

  it('uses the current process platform when no platform override is supplied', async () => {
    // Deterministic on every host: the win32 tier answers from the dialog,
    // the POSIX tiers from the command runner.
    const run = vi.fn<DirectoryPickerRunner>(async () => ({ stdout: '/default/platform\n', stderr: '' }))
    const pickWin32Dialog = async (): Promise<string | null> => 'C:\\default\\platform'
    const expected = process.platform === 'win32' ? 'C:\\default\\platform' : '/default/platform'
    await expect(pickNativeDirectory(signal(), { run, pickWin32Dialog })).resolves.toBe(expected)
  })

  it('maps empty command output to cancellation', async () => {
    const run = vi.fn<DirectoryPickerRunner>(async () => ({ stdout: '', stderr: '' }))
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run })).resolves.toBeNull()
  })

  it('uses Zenity on Linux and falls back to KDialog only when Zenity is missing', async () => {
    const run = vi.fn<DirectoryPickerRunner>()
      .mockRejectedValueOnce(failure('ENOENT'))
      .mockResolvedValueOnce({ stdout: '/home/test/project\n', stderr: '' })
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run })).resolves.toBe('/home/test/project')
    expect(run.mock.calls.map(call => call[0])).toEqual(['zenity', 'kdialog'])

    const zenity = vi.fn<DirectoryPickerRunner>(async () => ({ stdout: '/home/test/direct\n', stderr: '' }))
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run: zenity }))
      .resolves.toBe('/home/test/direct')
    expect(zenity).toHaveBeenCalledOnce()
  })

  it('maps Linux cancellation to null and reports a missing desktop picker', async () => {
    const cancelled = vi.fn<DirectoryPickerRunner>(async () => { throw failure(1) })
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run: cancelled })).resolves.toBeNull()

    const missing = vi.fn<DirectoryPickerRunner>(async () => { throw failure('ENOENT') })
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run: missing }))
      .rejects.toThrow('install zenity or kdialog')

    const kdialogCancelled = vi.fn<DirectoryPickerRunner>()
      .mockRejectedValueOnce(failure('ENOENT'))
      .mockRejectedValueOnce(failure(1))
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run: kdialogCancelled }))
      .resolves.toBeNull()

    const zenityFailed = vi.fn<DirectoryPickerRunner>(async () => { throw failure(2) })
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run: zenityFailed }))
      .rejects.toThrow('command failed')

    const kdialogFailed = vi.fn<DirectoryPickerRunner>()
      .mockRejectedValueOnce(failure('ENOENT'))
      .mockRejectedValueOnce(failure(2))
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run: kdialogFailed }))
      .rejects.toThrow('command failed')
  })

  it('does not convert caller aborts into user cancellation', async () => {
    const abort = new AbortController()
    abort.abort(new Error('closed'))
    const run = vi.fn<DirectoryPickerRunner>(async () => { throw failure('ABORT_ERR') })
    await expect(pickNativeDirectory(abort.signal, { platform: 'linux', run })).rejects.toThrow('command failed')
  })

  it('reports unsupported platforms', async () => {
    await expect(pickNativeDirectory(signal(), { platform: 'aix' })).rejects.toThrow('unsupported on aix')
  })
})

describe('native file picker', () => {
  it('uses the macOS file chooser and maps user cancellation to null', async () => {
    const run = vi.fn<DirectoryPickerRunner>(async () => ({ stdout: '/Users/test/equipo.zip\n', stderr: '' }))
    await expect(pickNativeFile(signal(), { platform: 'darwin', run })).resolves.toBe('/Users/test/equipo.zip')
    expect(run).toHaveBeenCalledWith('osascript', expect.arrayContaining(['POSIX path of selectedFile']), expect.any(AbortSignal))

    run.mockRejectedValueOnce(failure(1, 'execution error: User canceled. (-128)'))
    await expect(pickNativeFile(signal(), { platform: 'darwin', run })).resolves.toBeNull()

    run.mockRejectedValueOnce(failure(1, 'execution error: another failure'))
    await expect(pickNativeFile(signal(), { platform: 'darwin', run })).rejects.toThrow('command failed')
  })

  it('uses the Win32 file dialog, and wires it as the default tier', async () => {
    const run = vi.fn<DirectoryPickerRunner>()
    const pickWin32Dialog = vi.fn(async (): Promise<string | null> => 'C:\\work\\equipo.zip')
    await expect(pickNativeFile(signal(), { platform: 'win32', run, pickWin32Dialog })).resolves.toBe('C:\\work\\equipo.zip')
    pickWin32Dialog.mockResolvedValueOnce(null)
    await expect(pickNativeFile(signal(), { platform: 'win32', run, pickWin32Dialog })).resolves.toBeNull()
    expect(run).not.toHaveBeenCalled()

    // A pre-aborted signal makes the DEFAULT dialog deterministic on every
    // host: pickWin32File throws before spawning any worker or window.
    const abort = new AbortController()
    abort.abort()
    await expect(pickNativeFile(abort.signal, { platform: 'win32' })).rejects.toThrow('native file picker aborted')
  })

  it('asks Zenity without the directory flag and falls back to KDialog', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(null, '/home/test/equipo.zip\n', '')
    })
    await expect(pickNativeFile(signal(), { platform: 'linux' })).resolves.toBe('/home/test/equipo.zip')
    const [command, args] = execFileMock.mock.calls.at(-1)!
    expect(command).toBe('zenity')
    expect(args).toEqual(expect.arrayContaining(['--file-selection']))
    expect(args).not.toContain('--directory')

    const run = vi.fn<DirectoryPickerRunner>()
      .mockRejectedValueOnce(failure('ENOENT'))
      .mockResolvedValueOnce({ stdout: '/home/test/otro.zip\n', stderr: '' })
    await expect(pickNativeFile(signal(), { platform: 'linux', run })).resolves.toBe('/home/test/otro.zip')
    expect(run.mock.calls.map(call => call[0])).toEqual(['zenity', 'kdialog'])
  })

  it('maps Linux cancellation to null and reports a missing desktop picker', async () => {
    const cancelled = vi.fn<DirectoryPickerRunner>(async () => { throw failure(1) })
    await expect(pickNativeFile(signal(), { platform: 'linux', run: cancelled })).resolves.toBeNull()

    const missing = vi.fn<DirectoryPickerRunner>(async () => { throw failure('ENOENT') })
    await expect(pickNativeFile(signal(), { platform: 'linux', run: missing }))
      .rejects.toThrow('install zenity or kdialog')

    const kdialogCancelled = vi.fn<DirectoryPickerRunner>()
      .mockRejectedValueOnce(failure('ENOENT'))
      .mockRejectedValueOnce(failure(1))
    await expect(pickNativeFile(signal(), { platform: 'linux', run: kdialogCancelled })).resolves.toBeNull()

    const zenityFailed = vi.fn<DirectoryPickerRunner>(async () => { throw failure(2) })
    await expect(pickNativeFile(signal(), { platform: 'linux', run: zenityFailed })).rejects.toThrow('command failed')

    const kdialogFailed = vi.fn<DirectoryPickerRunner>()
      .mockRejectedValueOnce(failure('ENOENT'))
      .mockRejectedValueOnce(failure(2))
    await expect(pickNativeFile(signal(), { platform: 'linux', run: kdialogFailed })).rejects.toThrow('command failed')
  })

  it('uses the current process platform when no platform override is supplied', async () => {
    const run = vi.fn<DirectoryPickerRunner>(async () => ({ stdout: '/default/file.zip\n', stderr: '' }))
    const pickWin32Dialog = async (): Promise<string | null> => 'C:\\default\\file.zip'
    const expected = process.platform === 'win32' ? 'C:\\default\\file.zip' : '/default/file.zip'
    await expect(pickNativeFile(signal(), { run, pickWin32Dialog })).resolves.toBe(expected)
  })

  it('reports unsupported platforms', async () => {
    await expect(pickNativeFile(signal(), { platform: 'aix' })).rejects.toThrow('native file picker is unsupported on aix')
  })
})
