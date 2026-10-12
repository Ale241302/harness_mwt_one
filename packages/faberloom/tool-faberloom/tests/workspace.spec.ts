/**
 * The workspace file tools: what they send to the host capability, what they
 * refuse before sending anything, and how the host's answer reads.
 *
 * The host is a recording stub, because this suite owns the tool layer: the
 * confinement itself is `api/workspace-files`' own suite.
 */
import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceFileMutation, WorkspaceFileScope, WorkspaceFiles } from '@deepseek-ai/dsh-api-workspace-files'
import { registerWorkspaceTools } from '../src/workspace.ts'

interface CapturedTool {
  readonly name: string
  readonly description: string
  readonly output: { render: (args: unknown, value: WorkspaceFileMutation) => { type: string; text: string }[] }
  readonly presentCall?: (args: never) => unknown
  readonly execute: (args: never, exec?: never) => Promise<WorkspaceFileMutation>
}

/** The mutation verbs the stub records. */
interface Recorded {
  readonly calls: { name: string; scope: WorkspaceFileScope; args: unknown[] }[]
  readonly files: WorkspaceFiles
}

/** A `workspaceFiles` stub that records each call and answers with one created file. */
function recording(): Recorded {
  const calls: Recorded['calls'] = []
  const invoke = (name: string) => (scope: WorkspaceFileScope, ...args: unknown[]) => {
    calls.push({ name, scope, args })
    return Promise.resolve({ operation: 'created-file', path: 'p', absolutePath: '/w/p' })
  }
  const files = {
    createFile: vi.fn(invoke('createFile')),
    createDirectory: vi.fn(invoke('createDirectory')),
    move: vi.fn(invoke('move')),
    remove: vi.fn(invoke('remove')),
  } as unknown as WorkspaceFiles
  return { calls, files }
}

/** Boot the workspace tools over a stub registry and capture the definitions. */
function harness(services: Record<string, unknown>): Map<string, CapturedTool> {
  const registered = new Map<string, CapturedTool>()
  const ctx = {
    tools: { register: (definition: CapturedTool) => { registered.set(definition.name, definition); return () => {} } },
    get: (name: string) => services[name],
  }
  registerWorkspaceTools(ctx as never)
  return registered
}

const SESSION = { id: 's-1', header: { cwd: '/work/app' } }
const signal = new AbortController().signal
const exec = { agent: { session: SESSION }, signal }

describe('faberloom workspace file tools', () => {
  it('registers create, rename, and delete', () => {
    const tools = harness({ workspaceFiles: recording().files })
    expect([...tools.keys()]).toEqual(['faberloom_files_create', 'faberloom_files_rename', 'faberloom_files_delete'])
  })

  it('creates a file with its content in the calling session root', async () => {
    const { calls, files } = recording()
    const tool = harness({ workspaceFiles: files }).get('faberloom_files_create')!
    const result = await tool.execute({ path: 'informes/2026.md', kind: 'file', content: '# hola' } as never, exec as never)
    expect(calls).toEqual([{
      name: 'createFile',
      scope: { sessionId: 's-1', workspaceRoot: '/work/app' },
      args: ['informes/2026.md', '# hola', signal],
    }])
    expect(result).toEqual({ operation: 'created-file', path: 'p', absolutePath: '/w/p' })
    expect(tool.output.render({}, result)[0]?.text).toBe('Created file p at /w/p.')
  })

  it('creates a folder, with no content, when kind is directory', async () => {
    const { calls, files } = recording()
    const tool = harness({ workspaceFiles: files }).get('faberloom_files_create')!
    await tool.execute({ path: 'src', kind: 'directory' } as never, exec as never)
    expect(calls).toEqual([{ name: 'createDirectory', scope: { sessionId: 's-1', workspaceRoot: '/work/app' }, args: ['src', signal] }])
  })

  it('defaults a created file to empty content', async () => {
    const { calls, files } = recording()
    const tool = harness({ workspaceFiles: files }).get('faberloom_files_create')!
    await tool.execute({ path: 'a.txt', kind: 'file' } as never, exec as never)
    expect(calls[0]?.args).toEqual(['a.txt', '', signal])
  })

  it('falls back to the deployment workspace root for a session without a cwd', async () => {
    const { calls, files } = recording()
    const tool = harness({ workspaceFiles: files, sandboxPolicy: { workspaceRoot: '/fallback' } }).get('faberloom_files_delete')!
    await tool.execute({ path: 'a.txt' } as never, { agent: { session: { id: 's-2', header: {} } }, signal } as never)
    expect(calls[0]?.scope).toEqual({ sessionId: 's-2', workspaceRoot: '/fallback' })
  })

  it('deletes without recursive by default, and with it when asked', async () => {
    const { calls, files } = recording()
    const tool = harness({ workspaceFiles: files }).get('faberloom_files_delete')!
    const removed = await tool.execute({ path: 'src' } as never, exec as never)
    expect(calls[0]?.args).toEqual(['src', {}, signal])
    expect(tool.output.render({}, removed)[0]?.text).toBe('Created file p at /w/p.')
    await tool.execute({ path: 'src', recursive: true } as never, exec as never)
    expect(calls[1]?.args).toEqual(['src', { recursive: true }, signal])
  })

  it('renames in place, keeping the folder part of the path', async () => {
    const { calls, files } = recording()
    const tool = harness({ workspaceFiles: files }).get('faberloom_files_rename')!
    await tool.execute({ path: 'src/deep/a.txt', name: 'b.txt' } as never, exec as never)
    expect(calls[0]?.args).toEqual(['src/deep/a.txt', 'src/deep/b.txt', {}, signal])
    await tool.execute({ path: 'a.txt', name: 'b.txt', overwrite: true } as never, exec as never)
    expect(calls[1]?.args).toEqual(['a.txt', 'b.txt', { overwrite: true }, signal])
    await tool.execute({ path: 'C:\\work\\a.txt', name: 'b.txt' } as never, exec as never)
    expect(calls[2]?.args).toEqual(['C:\\work\\a.txt', 'C:\\work\\b.txt', {}, signal])
  })

  it('refuses a name that is not one path segment, before calling the host', async () => {
    const { calls, files } = recording()
    const tool = harness({ workspaceFiles: files }).get('faberloom_files_rename')!
    for (const name of ['', '.', '..', 'a/b', 'a\\b']) {
      await expect(tool.execute({ path: 'a.txt', name } as never, exec as never))
        .rejects.toThrow(`"${name}" is not a single file or folder name`)
    }
    expect(calls).toEqual([])
  })

  it('carries the host refusal through as the model-facing failure', async () => {
    const files = {
      createFile: vi.fn(() => Promise.reject(new RemoteError('workspace-file/already-exists', '"a.txt" already exists', { path: 'a.txt' }))),
    } as unknown as WorkspaceFiles
    const tool = harness({ workspaceFiles: files }).get('faberloom_files_create')!
    await expect(tool.execute({ path: 'a.txt', kind: 'file' } as never, exec as never))
      .rejects.toThrow('"a.txt" already exists')
  })

  it('fails loud without a session, without a workspace root, or without the service', async () => {
    const files = recording().files
    const create = harness({ workspaceFiles: files }).get('faberloom_files_create')!
    await expect(create.execute({ path: 'a.txt', kind: 'file' } as never, { signal } as never))
      .rejects.toThrow('this call has no session')
    const noRoot = harness({ workspaceFiles: files }).get('faberloom_files_create')!
    await expect(noRoot.execute({ path: 'a.txt', kind: 'file' } as never, { agent: { session: { id: 's-2', header: {} } }, signal } as never))
      .rejects.toThrow('no workspace root')
    const unmounted = harness({}).get('faberloom_files_create')!
    await expect(unmounted.execute({ path: 'a.txt', kind: 'file' } as never, exec as never))
      .rejects.toThrow('not mounted')
  })

  it('renders a folder, a move, and a removal in the model-facing wording', () => {
    const tool = harness({ workspaceFiles: recording().files }).get('faberloom_files_create')!
    expect(tool.output.render({}, { operation: 'created-directory', path: 'src', absolutePath: '/w/src' })[0]?.text)
      .toBe('Created folder src at /w/src.')
    expect(tool.output.render({}, { operation: 'moved', path: 'b.txt', absolutePath: '/w/b.txt', from: 'a.txt' })[0]?.text)
      .toBe('Renamed a.txt to b.txt at /w/b.txt.')
    expect(tool.output.render({}, { operation: 'moved', path: 'b.txt', absolutePath: '/w/b.txt' })[0]?.text)
      .toBe('Renamed b.txt at /w/b.txt.')
    expect(tool.output.render({}, { operation: 'removed', path: 'b.txt', absolutePath: '/w/b.txt' })[0]?.text)
      .toBe('Deleted b.txt at /w/b.txt.')
    expect(tool.presentCall?.({ path: 'a.txt', kind: 'file' } as never)).toEqual({
      card: 'generic', title: 'faberloom_files_create', kind: 'other', rawInput: { path: 'a.txt', kind: 'file' },
    })
  })
})
