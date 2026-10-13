import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as skillInstall from '../src/index.ts'

/**
 * Real-composition proof for the installer: boot the actual skill registry and
 * filesystem provider over a real temp root, install a real temp skill folder
 * through `ctx.skillInstall`, and observe the loader pick it up — and drop it
 * again on uninstall — with no restart.
 */

const tempDirs: string[] = []
const fibers: Fiber[] = []

afterEach(async () => {
  for (const fiber of fibers.splice(0)) await fiber.dispose()
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** A temporary directory that this suite removes. */
async function tempDir(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dsh-${name}-`))
  tempDirs.push(dir)
  return dir
}

/** Write one skill directory under `root`, returning its path. */
async function writeSkill(root: string, name: string, body = 'Do the thing.'): Promise<string> {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} routing\n---\n\n${body}\n`, 'utf8')
  return directory
}

/** Boot the real skill stack plus the installer over isolated temp roots. */
async function compose(): Promise<{ ctx: Context; project: string; dshRoot: string }> {
  const home = await tempDir('compose-home')
  const project = await tempDir('compose-project')
  const dshRoot = join(home, '.dsh')
  await mkdir(join(project, '.git'), { recursive: true })
  // Pre-create the two scanned roots so the provider opens a real directory
  // watcher instead of an ancestor probe.
  await mkdir(join(project, '.dsh', 'skills'), { recursive: true })
  await mkdir(join(dshRoot, 'skills'), { recursive: true })

  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  fibers.push(await ctx.plugin(SkillFileSystem, {
    dshHome: dshRoot,
    agentsHome: join(home, '.agents'),
    bundledSkillDir: join(home, 'bundled'),
    watch: true,
    watchUsePolling: true,
    watchPollIntervalMs: 25,
    watchStabilityThresholdMs: 25,
  }))
  fibers.push(await ctx.plugin(skillInstall, { dshHome: dshRoot }))
  return { ctx, project, dshRoot }
}

/** Poll a probe until its predicate holds, or fail with the last observation. */
async function eventually<T>(probe: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | undefined
  while (Date.now() < deadline) {
    last = await probe()
    if (done(last)) return last
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`condition not met within ${timeoutMs}ms; last=${JSON.stringify(last)}`)
}

describe('skill installer real composition', () => {
  it('makes a workspace install loadable through the real registry, and unavailable after uninstall', async () => {
    const { ctx, project } = await compose()
    const source = await writeSkill(await tempDir('compose-source'), 'demo', 'Workspace body.')

    // Retain the watchers and fill the catalog cache before the install, so the
    // later lookup only succeeds if the install invalidated the catalog.
    expect(await ctx.skills.list({ cwd: project })).toEqual([])

    const report = await ctx.skillInstall.install({ source, destination: 'workspace', cwd: project })
    expect(report.status).toBe('installed')

    const loaded = await eventually(() => ctx.skills.get('demo', { cwd: project }), skill => skill !== undefined)
    expect(loaded?.content).toBe('Workspace body.')
    expect(loaded?.source).toBe('project-dsh')

    expect(await ctx.skillInstall.uninstall({ name: 'demo', destination: 'workspace', cwd: project }))
      .toMatchObject({ status: 'removed' })
    await eventually(() => ctx.skills.get('demo', { cwd: project }), skill => skill === undefined)
  })

  it('makes a global install loadable from another workspace with no restart', async () => {
    const { ctx, project, dshRoot } = await compose()
    const other = await tempDir('compose-other')
    await mkdir(join(other, '.git'), { recursive: true })
    const source = await writeSkill(await tempDir('compose-global-source'), 'global-demo', 'Global body.')

    expect(await ctx.skills.list({ cwd: project })).toEqual([])
    expect(await ctx.skillInstall.install({ source, destination: 'global' })).toMatchObject({ status: 'installed' })

    const loaded = await eventually(() => ctx.skills.get('global-demo', { cwd: other }), skill => skill !== undefined)
    expect(loaded?.content).toBe('Global body.')
    expect(loaded?.source).toBe('user-dsh')
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: join(dshRoot, 'skills', 'global-demo') })
  })

  it('lists the install through the service and the loader catalog together', async () => {
    const { ctx, project, dshRoot } = await compose()
    const source = await writeSkill(await tempDir('compose-list-source'), 'listed', 'Listed body.')
    await ctx.skillInstall.install({ source, destination: 'global' })

    await eventually(() => ctx.skills.list({ cwd: project }), skills => skills.some(skill => skill.name === 'listed'))
    expect(await ctx.skillInstall.list(project)).toEqual([
      {
        name: 'listed',
        destination: 'global',
        root: join(dshRoot, 'skills'),
        source,
        installedAt: expect.any(String) as never,
      },
    ])
  })
})
