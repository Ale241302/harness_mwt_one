/**
 * The workspace file tools: which filesystem operations they invoke, what they
 * refuse before touching the filesystem, and how the outcome reads.
 *
 * The filesystem is a recording stub, because this suite owns the tool layer:
 * confinement itself belongs to the `dsh-fs` providers and the sandbox.
 */
import { describe, expect, it, vi } from 'vitest'
import { registerWorkspaceTools } from '../src/workspace.ts'

interface Mutation {
  readonly operation: string
  readonly path: string
  readonly absolutePath: string
  readonly from?: string
}

interface CapturedTool {
  readonly name: string
  readonly description: string
  readonly output: { render: (args: unknown, value: Mutation) => { type: string; text: string }[] }
  readonly presentCall?: (args: never) => unknown
  readonly execute: (args: Record<string, unknown>, exec?: unknown) => Promise<Mutation>
}

interface Recorded {
  readonly calls: { method: string; path: string }[]
  readonly fs: Record<string, unknown>
}

/** A `ctx.fs` stub that records every operation and answers with one target. */
function recording(): Recorded {
  const calls: Recorded['calls'] = []
  const target = (path: string) => ({ displayPath: path, targetKey: `/work/app/${path}` })
  return {
    calls,
    fs: {
      resolve: vi.fn(async (path: string) => {
        calls.push({ method: 'resolve', path })
        return target(path)
      }),
      processPath: (value: { targetKey: string }) => value.targetKey,
      createDirectory: vi.fn(async (value: { displayPath: string }) => {
        calls.push({ method: 'createDirectory', path: value.displayPath })
      }),
      writeText: vi.fn(async (value: { displayPath: string }, content: string) => {
        calls.push({ method: 'writeText', path: `${value.displayPath}:${content}` })
        return {}
      }),
      moveEntry: vi.fn(async (source: { displayPath: string }, destination: { displayPath: string }) => {
        calls.push({ method: 'moveEntry', path: `${source.displayPath}->${destination.displayPath}` })
      }),
      removeEntry: vi.fn(async (value: { displayPath: string }, options: { recursive?: boolean }) => {
        calls.push({ method: 'removeEntry', path: `${value.displayPath}:${String(options.recursive === true)}` })
      }),
    },
  }
}

/** Boot the workspace tools over a stub registry and capture the definitions. */
function harness(fs: unknown): Map<string, CapturedTool> {
  const registered = new Map<string, CapturedTool>()
  const ctx = {
    tools: { register: (definition: CapturedTool) => { registered.set(definition.name, definition); return () => {} } },
    get: () => undefined,
    fs,
  }
  registerWorkspaceTools(ctx as never)
  return registered
}

const SESSION = { id: 's-1', header: { cwd: '/work/app' } }
const signal = new AbortController().signal
const exec = { agent: { session: SESSION }, signal }

describe('faberloom workspace file tools', () => {
  it('registers create, rename, and delete', () => {
    const tools = harness(recording().fs)
    expect([...tools.keys()].sort()).toEqual([
      'faberloom_files_create', 'faberloom_files_delete', 'faberloom_files_rename',
    ])
  })

  it('creates a file with its content and its parent folders', async () => {
    const { calls, fs } = recording()
    const tool = harness(fs).get('faberloom_files_create')!
    const result = await tool.execute({ path: 'informes/2026.md', kind: 'file', content: '# Plan' }, exec)
    expect(result).toMatchObject({
      operation: 'created-file', path: 'informes/2026.md', absolutePath: '/work/app/informes/2026.md',
    })
    expect(calls).toContainEqual({ method: 'createDirectory', path: '/work/app/informes' })
    expect(calls).toContainEqual({ method: 'writeText', path: 'informes/2026.md:# Plan' })
  })

  it('creates a folder without writing a file', async () => {
    const { calls, fs } = recording()
    const result = await harness(fs).get('faberloom_files_create')!
      .execute({ path: 'informes', kind: 'directory' }, exec)
    expect(result).toMatchObject({ operation: 'created-directory', path: 'informes' })
    expect(calls.some(call => call.method === 'writeText')).toBe(false)
  })

  it('renames within the same folder and refuses a name with a separator', async () => {
    const { calls, fs } = recording()
    const rename = harness(fs).get('faberloom_files_rename')!
    const result = await rename.execute({ path: 'informes/2026.md', name: '2027.md' }, exec)
    expect(result).toMatchObject({ operation: 'moved', path: 'informes/2027.md', from: 'informes/2026.md' })
    expect(calls).toContainEqual({ method: 'moveEntry', path: 'informes/2026.md->informes/2027.md' })

    await expect(rename.execute({ path: 'informes/2026.md', name: '../fuera.md' }, exec))
      .rejects.toThrow('is not a single file or folder name')
  })

  it('deletes with the caller recursive choice', async () => {
    const { calls, fs } = recording()
    const remove = harness(fs).get('faberloom_files_delete')!
    await remove.execute({ path: 'informes', recursive: true }, exec)
    expect(calls).toContainEqual({ method: 'removeEntry', path: 'informes:true' })
  })

  it('refuses a call with no session workspace', async () => {
    const remove = harness(recording().fs).get('faberloom_files_delete')!
    await expect(remove.execute({ path: 'x' }, { agent: { session: { id: 's-2', header: {} } }, signal }))
      .rejects.toThrow('no workspace root')
  })

  it('renders the outcome with what changed and where', async () => {
    const tool = harness(recording().fs).get('faberloom_files_create')!
    const text = tool.output.render({}, {
      operation: 'created-file', path: 'a.md', absolutePath: '/work/app/a.md',
    })
    expect(text).toEqual([{ type: 'text', text: 'Created file a.md at /work/app/a.md.' }])
  })
})
