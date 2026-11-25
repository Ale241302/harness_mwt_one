import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

let scratchRoot: string | undefined
const locked: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of locked.splice(0)) chmodSync(dir, 0o700)
  if (scratchRoot !== undefined) {
    rmSync(scratchRoot, { recursive: true, force: true })
    scratchRoot = undefined
  }
})

/** One temp root per test, so a real folder backs every adoption. */
function scratch(): string {
  scratchRoot ??= mkdtempSync(join(tmpdir(), 'faberloom-view-'))
  return scratchRoot
}

/** A real folder under the test's temp root. */
function folder(name: string): string {
  const dir = join(scratch(), name)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** A folder this process is not allowed to read; skipped where the mode means nothing. */
function unreadableFolder(name: string): string {
  const dir = folder(name)
  chmodSync(dir, 0o000)
  locked.push(dir)
  return dir
}

const canHideFolder = process.platform !== 'win32' && (process.getuid?.() ?? 0) !== 0

/** The minimal service graph `adoptSpaceWorkspace` and `openSpaceWorkspace` touch. */
function harness(options: {
  registry?: boolean
  workspaceId?: string
  entities?: { id: string; path: string; title: string; sessionIds: string[] }[]
} = {}) {
  const entities = options.entities ?? []
  const registry = {
    list: () => entities,
    get: (id: string) => entities.find(entity => entity.id === id),
    create: vi.fn(async (dir: string, title?: string) => {
      const existing = entities.find(entity => entity.path === dir)
      if (existing !== undefined) return existing
      const entity = { id: `ws-${String(entities.length + 1)}`, path: dir, title: title ?? dir, sessionIds: [] as string[] }
      entities.push(entity)
      return entity
    }),
  }
  const space = {
    id: 'sp1',
    title: 'ACME',
    parentId: null,
    inheritContext: true,
    excluded: [],
    members: [],
    sources: [],
    context: {},
    agentId: null,
    ...options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId },
  }
  const spaces = {
    get: vi.fn(async () => space),
    update: vi.fn(async () => ({ ...space, workspaceId: 'ws-1' })),
  }
  const ctx = {
    faberloomSpaces: spaces,
    provide: () => {},
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => name === 'workspaceRegistry' && options.registry !== false ? registry : undefined,
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
  return { view, spaces, registry, entities }
}

describe('adoptSpaceWorkspace', () => {
  it('registers the chosen folder and points the space at it', async () => {
    const { view, spaces, entities } = harness()
    const dir = folder('ACME')

    const result = await view.adoptSpaceWorkspace('sp1', dir)

    expect(result).toEqual({ registered: true, workspaceId: 'ws-1', title: 'ACME', sessions: 0 })
    expect(entities.map(entity => entity.path)).toEqual([dir])
    expect(spaces.update).toHaveBeenCalledWith(expect.anything(), 'sp1', { workspaceId: 'ws-1' })
  })

  it('reuses a workspace already registered at that path', async () => {
    const { view, registry, spaces } = harness()
    const dir = folder('ACME')
    await registry.create(dir, 'Existing')
    const creates = registry.create.mock.calls.length

    const result = await view.adoptSpaceWorkspace('sp1', dir)

    expect(registry.create.mock.calls.length).toBe(creates)
    expect(result.workspaceId).toBe('ws-1')
    expect(spaces.update).toHaveBeenCalledWith(expect.anything(), 'sp1', { workspaceId: 'ws-1' })
  })

  it('refuses a folder that does not exist', async () => {
    const { view, registry, spaces } = harness()

    await expect(view.adoptSpaceWorkspace('sp1', join(scratch(), 'no-existe'))).rejects.toThrow(/no existe/u)
    expect(registry.create).not.toHaveBeenCalled()
    expect(spaces.update).not.toHaveBeenCalled()
  })

  it('refuses a file where a folder is required', async () => {
    const { view, registry } = harness()
    const file = join(scratch(), 'documento.md')
    writeFileSync(file, '# ACME')

    await expect(view.adoptSpaceWorkspace('sp1', file)).rejects.toThrow(/no es una carpeta/u)
    expect(registry.create).not.toHaveBeenCalled()
  })

  it.skipIf(!canHideFolder)('refuses a folder the process cannot read', async () => {
    const { view, registry, spaces } = harness()
    const dir = unreadableFolder('sin-permiso')

    await expect(view.adoptSpaceWorkspace('sp1', dir)).rejects.toThrow(/no tengo permiso/u)
    expect(registry.create).not.toHaveBeenCalled()
    expect(spaces.update).not.toHaveBeenCalled()
  })

  it.skipIf(existsSync('/root/loquesea'))('refuses a system folder typed by hand', async () => {
    const { view, registry, spaces } = harness()

    await expect(view.adoptSpaceWorkspace('sp1', '/root/loquesea')).rejects.toThrow(/no existe|no tengo permiso/u)
    expect(registry.create).not.toHaveBeenCalled()
    expect(spaces.update).not.toHaveBeenCalled()
  })

  it('fails loud when the workspace registry is not mounted', async () => {
    const { view } = harness({ registry: false })

    await expect(view.adoptSpaceWorkspace('sp1', folder('ACME'))).rejects.toThrow(/workspace registry is not mounted/u)
  })
})

describe('openSpaceWorkspace', () => {
  it('refuses a Space whose area was deleted', async () => {
    const { view } = harness({
      workspaceId: 'ws-1',
      entities: [{ id: 'ws-1', path: join(scratch(), 'borrada'), title: 'ACME', sessionIds: [] }],
    })

    await expect(view.openSpaceWorkspace('sp1')).rejects.toThrow(/no existe/u)
  })

  it.skipIf(!canHideFolder)('refuses a Space whose area cannot be read', async () => {
    const { view } = harness({
      workspaceId: 'ws-1',
      entities: [{ id: 'ws-1', path: unreadableFolder('area-sin-permiso'), title: 'ACME', sessionIds: [] }],
    })

    await expect(view.openSpaceWorkspace('sp1')).rejects.toThrow(/no tengo permiso/u)
  })
})
