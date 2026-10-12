import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { FaberLoomViewService } from '../src/index.ts'

const homes: string[] = []
const fibers: { dispose: () => Promise<void> }[] = []

afterEach(async () => {
  for (const fiber of fibers.splice(0)) await fiber.dispose()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

/** The skill markdown for one name. */
function skillMarkdown(name: string, description = 'hace algo'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
}

/** Write one skill directory under a root. */
function writeSkill(root: string, dir: string, markdown: string): string {
  const dirPath = join(root, dir)
  mkdirSync(dirPath, { recursive: true })
  writeFileSync(join(dirPath, 'SKILL.md'), markdown, 'utf8')
  return dirPath
}

/** A temporary directory that the suite removes. */
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  homes.push(dir)
  return dir
}

/**
 * Boot the real storage/domain composition plus the view service. `workspaceRoot`
 * omitted leaves `ctx.sandboxPolicy` unmounted, so a workspace install has no
 * workspace to write under.
 */
async function harness(options: { workspaceRoot?: string; readOnly?: boolean; ownerId?: string } = {}) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  for (const name of [
    'faberloomSpaces', 'faberloomAgents', 'faberloomBoard', 'faberloomRoutines',
    'faberloomMemory', 'faberloomAccess', 'faberloomMcpServer', 'faberloomBackup',
  ]) ctx.provide(name, {} as never)
  if (options.workspaceRoot !== undefined) {
    ctx.provide('sandboxPolicy', {
      resolve: () => ({ mode: 'workspace-write', workspaceRoot: options.workspaceRoot as string }),
    } as never)
  }
  const fiber = await ctx.plugin(FaberLoomViewService, {
    ownerId: options.ownerId ?? 'owner@muitowork.com',
    role: 'admin',
    readOnly: options.readOnly === true,
  })
  fibers.push(fiber)
  return { ctx, view: ctx.faberloomView, facility }
}

describe('FaberLoomViewService skill install', () => {
  it('lists the two resolved destination roots, with no workspace root when unmounted', async () => {
    const home = tempDir('view-install-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness()
    expect(await view.skillInstallTargets()).toEqual({ workspace: null, global: join(home, 'skills') })

    const withWorkspace = await harness({ workspaceRoot: join(home, 'proyecto') })
    expect(await withWorkspace.view.skillInstallTargets()).toEqual({
      workspace: join(home, 'proyecto', '.dsh', 'skills'),
      global: join(home, 'skills'),
    })
  })

  it('treats an empty deployment workspace root as no workspace', async () => {
    const home = tempDir('view-install-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ workspaceRoot: '' })
    expect((await view.skillInstallTargets()).workspace).toBeNull()
    const report = await view.installSkill(join(home, 'origen'), 'workspace')
    expect(report).toMatchObject({ refused: 'no-workspace', root: '', outcomes: [] })

    // A global install needs no workspace, so it resolves its source as given.
    writeSkill(home, 'global-sin-ws', skillMarkdown('global-sin-ws'))
    const globalReport = await view.installSkill(join(home, 'global-sin-ws'), 'global')
    expect(globalReport.outcomes).toEqual([{ name: 'global-sin-ws', status: 'installed' }])
    expect((await view.skillInstalls()).map(row => row.name)).toEqual(['global-sin-ws'])
  })

  it('installs one skill directory with its assets and records the install', async () => {
    const home = tempDir('view-install-')
    const workspace = tempDir('view-ws-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ workspaceRoot: workspace })
    const source = writeSkill(join(workspace, 'fuente'), 'saluda', skillMarkdown('saluda', 'saluda al equipo'))
    writeFileSync(join(source, 'assets.txt'), 'peso', 'utf8')
    writeFileSync(join(source, '.shared-by'), 'otro@x.com', 'utf8')

    const report = await view.installSkill(join(workspace, 'fuente', 'saluda'), 'workspace')

    const root = join(workspace, '.dsh', 'skills')
    expect(report).toEqual({
      destination: 'workspace',
      root,
      outcomes: [{ name: 'saluda', status: 'installed' }],
    })
    expect(readFileSync(join(root, 'saluda', 'SKILL.md'), 'utf8')).toContain('name: saluda')
    expect(readFileSync(join(root, 'saluda', 'assets.txt'), 'utf8')).toBe('peso')
    // The publisher marker of a shared skill never travels with the copy.
    expect(existsSync(join(root, 'saluda', '.shared-by'))).toBe(false)

    expect(await view.skillInstalls()).toEqual([{
      name: 'saluda',
      sourcePath: join(workspace, 'fuente', 'saluda'),
      destination: 'workspace',
      destinationRoot: root,
      installedAt: expect.any(String) as never,
    }])
  })

  it('installs a directory of skills, skips an existing name, and replaces on request', async () => {
    const home = tempDir('view-install-')
    const workspace = tempDir('view-ws-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ workspaceRoot: workspace })
    const source = join(workspace, 'catalogo')
    writeSkill(source, 'alfa', skillMarkdown('alfa'))
    writeSkill(source, 'beta', skillMarkdown('beta'))

    const first = await view.installSkill('catalogo', 'workspace')
    expect(first.outcomes).toEqual([
      { name: 'alfa', status: 'installed' },
      { name: 'beta', status: 'installed' },
    ])

    writeSkill(source, 'beta', skillMarkdown('beta', 'version nueva'))
    const second = await view.installSkill('catalogo', 'workspace')
    expect(second.outcomes).toEqual([
      { name: 'alfa', status: 'skipped', reason: 'exists' },
      { name: 'beta', status: 'skipped', reason: 'exists' },
    ])
    expect(readFileSync(join(workspace, '.dsh', 'skills', 'beta', 'SKILL.md'), 'utf8')).toContain('hace algo')

    const replaced = await view.installSkill('catalogo', 'workspace', true)
    expect(replaced.outcomes).toEqual([
      { name: 'alfa', status: 'replaced' },
      { name: 'beta', status: 'replaced' },
    ])
    expect(readFileSync(join(workspace, '.dsh', 'skills', 'beta', 'SKILL.md'), 'utf8')).toContain('version nueva')
  })

  it('installs into the global root from a folder inside the workspace', async () => {
    const home = tempDir('view-install-')
    const workspace = tempDir('view-ws-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ workspaceRoot: workspace })
    writeSkill(join(workspace, 'bajada'), 'global-uno', skillMarkdown('global-uno'))

    const report = await view.installSkill(join(workspace, 'bajada'), 'global')

    expect(report).toEqual({
      destination: 'global',
      root: join(home, 'skills'),
      outcomes: [{ name: 'global-uno', status: 'installed' }],
    })
    expect(existsSync(join(home, 'skills', 'global-uno', 'SKILL.md'))).toBe(true)
    expect((await view.skillInstalls())[0]).toMatchObject({ destination: 'global', destinationRoot: join(home, 'skills') })
  })

  it('validates every candidate before writing, refusing a missing or illegal name', async () => {
    const home = tempDir('view-install-')
    const workspace = tempDir('view-ws-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ workspaceRoot: workspace })
    const source = join(workspace, 'mixto')
    mkdirSync(join(source, 'sin-nombre'), { recursive: true })
    writeFileSync(join(source, 'sin-nombre', 'SKILL.md'), '---\ndescription: sin nombre\n---\n', 'utf8')
    writeSkill(source, 'sin-yaml', '# una skill sin frontmatter\n')
    writeSkill(source, 'Mala Nombre', skillMarkdown('Mala Nombre'))
    writeSkill(source, 'buena', skillMarkdown('buena'))

    const report = await view.installSkill('mixto', 'workspace')

    // Every candidate is validated before any of them is written, so the legal
    // one installs while each illegal one is refused with its own reason.
    expect(report.outcomes).toEqual([
      { name: 'Mala Nombre', status: 'refused', reason: 'name-illegal' },
      { name: 'buena', status: 'installed' },
      { name: 'sin-nombre', status: 'refused', reason: 'name-missing' },
      { name: 'sin-yaml', status: 'refused', reason: 'name-missing' },
    ])
    expect(existsSync(join(workspace, '.dsh', 'skills', 'buena', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(workspace, '.dsh', 'skills', 'sin-nombre'))).toBe(false)
    expect((await view.skillInstalls()).map(row => row.name)).toEqual(['buena'])
  })

  it('refuses an illegal single skill before writing anything', async () => {
    const home = tempDir('view-install-')
    const workspace = tempDir('view-ws-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ workspaceRoot: workspace })
    writeSkill(join(workspace, 'fuente'), 'una', skillMarkdown('Una'))

    const report = await view.installSkill(join(workspace, 'fuente', 'una'), 'workspace')

    expect(report.outcomes).toEqual([{ name: 'una', status: 'refused', reason: 'name-illegal' }])
    expect(existsSync(join(workspace, '.dsh'))).toBe(false)
  })

  it('refuses a source outside the workspace root', async () => {
    const home = tempDir('view-install-')
    const workspace = tempDir('view-ws-')
    const outside = tempDir('view-out-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ workspaceRoot: workspace })
    writeSkill(outside, 'ajena', skillMarkdown('ajena'))

    const relative = await view.installSkill(join('..', '..', '..', 'view-out'), 'workspace')
    expect(relative).toMatchObject({ destination: 'workspace', refused: 'outside-workspace', outcomes: [] })

    const absolute = await view.installSkill(outside, 'workspace')
    expect(absolute.refused).toBe('outside-workspace')
    expect(existsSync(join(workspace, '.dsh'))).toBe(false)
  })

  it('refuses a source that is missing or holds no skill', async () => {
    const home = tempDir('view-install-')
    const workspace = tempDir('view-ws-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ workspaceRoot: workspace })
    writeFileSync(join(workspace, 'plano.md'), skillMarkdown('plano'), 'utf8')
    mkdirSync(join(workspace, 'vacia'), { recursive: true })
    mkdirSync(join(workspace, 'sin-skills', 'notas'), { recursive: true })

    expect((await view.installSkill('no-existe', 'workspace')).refused).toBe('source-missing')
    expect((await view.installSkill('plano.md', 'workspace')).refused).toBe('source-missing')
    expect((await view.installSkill('vacia', 'workspace')).refused).toBe('not-a-skill')
    expect((await view.installSkill('sin-skills', 'workspace')).refused).toBe('not-a-skill')
  })

  it('refuses an install from a read-only identity', async () => {
    const home = tempDir('view-install-')
    const workspace = tempDir('view-ws-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ workspaceRoot: workspace, readOnly: true })
    writeSkill(workspace, 'sola', skillMarkdown('sola'))

    const report = await view.installSkill('sola', 'workspace')

    expect(report).toEqual({
      destination: 'workspace',
      root: join(workspace, '.dsh', 'skills'),
      refused: 'read-only',
      outcomes: [],
    })
  })

  it('lists only this identity’s installs and removes one install at a time', async () => {
    const home = tempDir('view-install-')
    const workspace = tempDir('view-ws-')
    vi.stubEnv('DSH_HOME', home)
    const { view, facility } = await harness({ workspaceRoot: workspace })
    writeSkill(workspace, 'propia', skillMarkdown('propia'))
    writeSkill(workspace, 'alfa', skillMarkdown('alfa'))
    await view.installSkill('propia', 'workspace')
    await view.installSkill('alfa', 'workspace')

    const installsTable = facility.get('faberloom_skill_installs')?.table('installs')
    await installsTable?.put('otro@x.com\u0000global\u0000ajena', {
      ownerId: 'otro@x.com', name: 'ajena', sourcePath: '/tmp/ajena',
      destination: 'global', destinationRoot: join(home, 'skills'), installedAt: '2026-01-01T00:00:00Z',
    })
    expect((await view.skillInstalls()).map(row => row.name)).toEqual(['alfa', 'propia'])

    expect((await view.uninstallSkill('propia', 'workspace')).map(row => row.name)).toEqual(['alfa'])
    expect(existsSync(join(workspace, '.dsh', 'skills', 'propia'))).toBe(false)
    await expect(view.uninstallSkill('propia', 'workspace')).rejects.toThrow('not an install')
  })

  it('refuses to remove an install for a read-only identity', async () => {
    const home = tempDir('view-install-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ readOnly: true })
    await expect(view.uninstallSkill('x', 'global')).rejects.toThrow('read-only')
  })

  it('closes the install domain with the service fiber', async () => {
    const home = tempDir('view-install-')
    const workspace = tempDir('view-ws-')
    vi.stubEnv('DSH_HOME', home)
    const { view, facility } = await harness({ workspaceRoot: workspace })
    writeSkill(workspace, 'efimera', skillMarkdown('efimera'))
    await view.installSkill('efimera', 'workspace')
    expect(Boolean(facility.get('faberloom_skill_installs'))).toBe(true)

    const fiber = fibers.pop()
    await fiber?.dispose()

    expect(Boolean(facility.get('faberloom_skill_installs'))).toBe(false)
  })

  it('disposes cleanly when no install ever opened the domain', async () => {
    await harness()
    const fiber = fibers.pop()
    await fiber?.dispose()
  })
})
