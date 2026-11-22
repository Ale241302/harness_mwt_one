import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

/** The minimal service graph `exportSpaceViewToFolder` touches. */
function harness(options: { manage?: boolean } = {}) {
  const space = { id: 'sp1', title: 'ACME', workspaceId: undefined }
  const spaces = {
    get: vi.fn(async () => space),
    canManage: vi.fn(async () => options.manage !== false),
    resolveWorkdir: vi.fn(async () => ({ kind: 'opaque' as const, ref: 'fw_oc' })),
  }
  const context = {
    export: vi.fn(async () => ({ filename: 'contexto.md', content: '# Contexto ACME', entries: [] })),
  }
  const workflows = {
    get: vi.fn(async () => ({ id: 'wf-1234567890', name: 'Flujo' })),
    exportFlow: vi.fn(async () => '{"nodes":[]}'),
  }
  const ctx = {
    faberloomSpaces: spaces,
    provide: () => {},
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => name === 'faberloomContext' ? context : name === 'faberloomWorkflows' ? workflows : undefined,
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
  return { view, context, workflows }
}

describe('exportSpaceViewToFolder', () => {
  it('writes a context export into the space folder', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-export-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, context } = harness()

    const result = await view.exportSpaceViewToFolder('sp1', 'context', '', 'markdown')

    expect(context.export).toHaveBeenCalledWith({ id: 'owner@muitowork.com' }, { spaceId: 'sp1', format: 'markdown' })
    expect(result.path).toBe(join(home, 'spaces', 'fw_oc', 'exportaciones', 'contexto.md'))
    expect(result.bytes).toBe(Buffer.byteLength('# Contexto ACME', 'utf8'))
    expect(readFileSync(result.path, 'utf8')).toBe('# Contexto ACME')
  })

  it('writes a workflow export into the space folder', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-export-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, workflows } = harness()

    const result = await view.exportSpaceViewToFolder('sp1', 'workflow', 'wf-1234567890', 'json')

    expect(workflows.exportFlow).toHaveBeenCalledWith(expect.anything(), 'wf-1234567890')
    expect(result.path).toBe(join(home, 'spaces', 'fw_oc', 'exportaciones', 'wf-1234567890.json'))
    expect(readFileSync(result.path, 'utf8')).toBe('{"nodes":[]}')
  })

  it('refuses a readable Space the identity cannot manage', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-export-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, context, workflows } = harness({ manage: false })

    await expect(view.exportSpaceViewToFolder('sp1', 'context', '', 'markdown')).rejects.toThrow('cannot manage')
    await expect(view.exportSpaceViewToFolder('sp1', 'workflow', 'wf-1', 'json')).rejects.toThrow('cannot manage')
    expect(context.export).not.toHaveBeenCalled()
    expect(workflows.exportFlow).not.toHaveBeenCalled()
  })

  it('refuses a symlinked export folder', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-export-'))
    const outside = mkdtempSync(join(tmpdir(), 'view-export-outside-'))
    homes.push(home, outside)
    vi.stubEnv('DSH_HOME', home)
    mkdirSync(join(home, 'spaces', 'fw_oc'), { recursive: true })
    symlinkSync(outside, join(home, 'spaces', 'fw_oc', 'exportaciones'), process.platform === 'win32' ? 'junction' : 'dir')
    const { view } = harness()

    await expect(view.exportSpaceViewToFolder('sp1', 'context', '', 'markdown'))
      .rejects.toThrow('MAIL_ATTACHMENT_PATH_UNSAFE')
    expect(existsSync(join(outside, 'contexto.md'))).toBe(false)
  })

  it('refuses a symlinked export target and leaves the outside file untouched', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-export-'))
    const outside = mkdtempSync(join(tmpdir(), 'view-export-outside-'))
    homes.push(home, outside)
    vi.stubEnv('DSH_HOME', home)
    const dir = join(home, 'spaces', 'fw_oc', 'exportaciones')
    mkdirSync(dir, { recursive: true })
    symlinkSync(outside, join(dir, 'contexto.md'), process.platform === 'win32' ? 'junction' : 'dir')
    const { view } = harness()

    await expect(view.exportSpaceViewToFolder('sp1', 'context', '', 'markdown'))
      .rejects.toThrow('the export target is a symbolic link')
    expect(existsSync(join(outside, 'contexto.md'))).toBe(false)
  })
})
