import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as skillInstall from '@deepseek-ai/dsh-skill-install'
import { FaberLoomViewService } from '../src/index.ts'

/**
 * The view's install surface is a thin adapter over the native installer, so
 * these tests boot the real installer (and the real filesystem) to assert the
 * observable reports and the copied directories, not the adapter internals.
 */

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
 * Boot the view over the real native installer. `workspaceRoot` omitted leaves
 * `ctx.sandboxPolicy` unmounted, so a workspace install has no workspace to write
 * under; `mountInstaller: false` boots the view without the installer.
 */
async function harness(
  options: { workspaceRoot?: string; readOnly?: boolean; ownerId?: string; mountInstaller?: boolean } = {},
) {
  const ctx = new Context()
  ctx.provide('tools', { register: () => () => {} } as never)
  for (const name of [
    'faberloomSpaces', 'faberloomAgents', 'faberloomBoard', 'faberloomRoutines',
    'faberloomMemory', 'faberloomAccess', 'faberloomMcpServer', 'faberloomBackup',
  ]) ctx.provide(name, {} as never)
  if (options.workspaceRoot !== undefined) {
    ctx.provide('sandboxPolicy', {
      resolve: () => ({ mode: 'workspace-write', workspaceRoot: options.workspaceRoot as string }),
    } as never)
  }
  if (options.mountInstaller !== false) await ctx.plugin(skillInstall)
  const fiber = await ctx.plugin(FaberLoomViewService, {
    ownerId: options.ownerId ?? 'owner@muitowork.com',
    role: 'admin',
    readOnly: options.readOnly === true,
  })
  fibers.push(fiber)
  return { ctx, view: ctx.faberloomView }
}

describe('FaberLoomViewService skill install', () => {
  it('installs a harness folder into the user home, with its rules always on', async () => {
    const home = tempDir('view-install-')
    const source = tempDir('view-harness-')
    vi.stubEnv('DSH_HOME', home)
    writeSkill(join(source, 'skills'), 'conciliacion', skillMarkdown('conciliacion'))
    mkdirSync(join(source, 'agents'), { recursive: true })
    writeFileSync(join(source, 'agents', 'contable.md'), '---\nname: Contable\ndescription: Cierra el mes.\n---\n\nEres el contable.\n', 'utf8')
    mkdirSync(join(source, 'rules'), { recursive: true })
    writeFileSync(join(source, 'rules', 'grafo.md'), 'Consulta el grafo antes de leer codigo.\n', 'utf8')
    mkdirSync(join(source, 'scripts'), { recursive: true })
    writeFileSync(join(source, 'scripts', 'run-gates.ts'), 'export {}\n', 'utf8')
    const { view } = await harness()

    const report = await view.installHarness(source)

    expect(report.status).toBe('installed')
    expect(report.root).toBe(source)
    expect(report.parts.map(part => part.kind)).toEqual(['skills', 'agents', 'rules', 'scripts'])
    expect(report.parts.find(part => part.kind === 'rules')).toMatchObject({ count: 1, target: join(home, 'AGENTS.md') })
    expect(report.outcomes).toEqual([
      { name: 'conciliacion', status: 'installed' },
      { name: 'contable', status: 'installed' },
    ])
    expect(existsSync(join(home, 'skills', 'conciliacion', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(home, '.agent-presets', 'contable', 'preset.yml'))).toBe(true)
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toContain('Consulta el grafo antes de leer codigo.')
    expect(readFileSync(join(home, 'scripts', 'run-gates.ts'), 'utf8')).toBe('export {}\n')

    const repeated = await view.installHarness(source, true)
    expect(repeated.parts.find(part => part.kind === 'rules')?.status).toBe('replaced')
  })

  it('reports each refusal a harness source can hit, and never installs for a read-only identity', async () => {
    const home = tempDir('view-install-')
    const source = tempDir('view-harness-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness()
    mkdirSync(join(source, 'vacia'), { recursive: true })
    writeFileSync(join(source, 'roto.zip'), Buffer.from([1, 2, 3, 4]))

    expect(await view.installHarness(join(source, 'no-existe')))
      .toMatchObject({ status: 'refused', refused: 'source-missing', parts: [], outcomes: [] })
    expect(await view.installHarness(join(source, 'vacia')))
      .toMatchObject({ status: 'refused', refused: 'not-a-harness' })
    expect(await view.installHarness(join(source, 'roto.zip')))
      .toMatchObject({ status: 'refused', refused: 'archive-unreadable' })

    const readOnly = await harness({ readOnly: true })
    expect(await readOnly.view.installHarness(source))
      .toEqual({ status: 'refused', source, root: '', refused: 'read-only', parts: [], outcomes: [] })
    expect(existsSync(join(home, 'skills'))).toBe(false)
  })

  it('treats an empty deployment workspace root as no workspace', async () => {
    const home = tempDir('view-install-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ workspaceRoot: '' })
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
    // The installer copies the whole directory; the install marker is the
    // record, so a publisher marker travels with the copy.
    expect(readFileSync(join(root, 'saluda', '.shared-by'), 'utf8')).toBe('otro@x.com')
    expect(existsSync(join(root, 'saluda', '.dsh-skill-install.json'))).toBe(true)

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
    // `alfa` is unchanged, so the installer reports it already installed; the
    // changed `beta` is skipped until replace is asked for.
    expect(second.outcomes).toEqual([
      { name: 'alfa', status: 'skipped' },
      { name: 'beta', status: 'skipped', reason: 'exists' },
    ])
    expect(readFileSync(join(workspace, '.dsh', 'skills', 'beta', 'SKILL.md'), 'utf8')).toContain('hace algo')

    const replaced = await view.installSkill('catalogo', 'workspace', true)
    // `alfa` still matches its marker, so only the changed `beta` is replaced.
    expect(replaced.outcomes).toEqual([
      { name: 'alfa', status: 'skipped' },
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
    expect(Object.fromEntries(report.outcomes.map(outcome => [outcome.name, outcome]))).toEqual({
      'Mala Nombre': { name: 'Mala Nombre', status: 'refused', reason: 'name-illegal' },
      buena: { name: 'buena', status: 'installed' },
      'sin-nombre': { name: 'sin-nombre', status: 'refused', reason: 'name-missing' },
      'sin-yaml': { name: 'sin-yaml', status: 'refused', reason: 'name-missing' },
    })
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

    expect(report).toMatchObject({ refused: 'name-illegal', outcomes: [] })
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

  it('refuses a source that is missing, a file, empty, or holds no skill', async () => {
    const home = tempDir('view-install-')
    const workspace = tempDir('view-ws-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ workspaceRoot: workspace })
    writeFileSync(join(workspace, 'plano.md'), skillMarkdown('plano'), 'utf8')
    mkdirSync(join(workspace, 'vacia'), { recursive: true })
    mkdirSync(join(workspace, 'sin-skills', 'notas'), { recursive: true })

    expect((await view.installSkill('no-existe', 'workspace')).refused).toBe('source-missing')
    expect((await view.installSkill('plano.md', 'workspace')).refused).toBe('not-a-skill')
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
      root: '',
      refused: 'read-only',
      outcomes: [],
    })
  })

  it('lists the marked installs under the roots and removes one install at a time', async () => {
    const home = tempDir('view-install-')
    const workspace = tempDir('view-ws-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ workspaceRoot: workspace })
    writeSkill(workspace, 'propia', skillMarkdown('propia'))
    writeSkill(workspace, 'alfa', skillMarkdown('alfa'))
    writeSkill(join(workspace, 'global-fuente'), 'global-uno', skillMarkdown('global-uno'))
    await view.installSkill('propia', 'workspace')
    await view.installSkill('alfa', 'workspace')
    await view.installSkill(join(workspace, 'global-fuente', 'global-uno'), 'global')

    expect((await view.skillInstalls()).map(row => row.name)).toEqual(['alfa', 'global-uno', 'propia'])

    expect((await view.uninstallSkill('propia', 'workspace')).map(row => row.name)).toEqual(['alfa', 'global-uno'])
    expect(existsSync(join(workspace, '.dsh', 'skills', 'propia'))).toBe(false)
    await expect(view.uninstallSkill('propia', 'workspace')).rejects.toThrow('not an install')
  })

  it('refuses to remove an install for a read-only identity', async () => {
    const home = tempDir('view-install-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ readOnly: true })
    await expect(view.uninstallSkill('x', 'global')).rejects.toThrow('read-only')
  })

  it('fails loudly when the deployment mounts no installer', async () => {
    const home = tempDir('view-install-')
    vi.stubEnv('DSH_HOME', home)
    const { view } = await harness({ mountInstaller: false })
    await expect(view.installHarness(join(home, 'origen'))).rejects.toThrow('not mounted')
    await expect(view.skillInstalls()).rejects.toThrow('not mounted')
  })
})
