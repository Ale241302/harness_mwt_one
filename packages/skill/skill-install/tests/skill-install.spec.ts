import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as skillInstall from '../src/index.ts'
import { INSTALL_MARKER_FILE } from '../src/install.ts'

const signal = new AbortController().signal

/** Every temp dir created by this file, removed after each test. */
const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** A temporary directory that this suite removes. */
async function tempDir(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dsh-${name}-`))
  tempDirs.push(dir)
  return dir
}

/** Write one skill directory under `root`, returning its path. */
async function writeSkill(root: string, dir: string, markdown: string): Promise<string> {
  const directory = join(root, dir)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), markdown, 'utf8')
  return directory
}

/** The canonical valid skill markdown for one name. */
function skillMarkdown(name: string, description = 'does something useful', body = 'Do the thing.'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
}

/** A workspace project root holding `.git`, so the provider resolves it as the project root. */
async function makeProject(name = 'project'): Promise<string> {
  const root = await tempDir(name)
  await mkdir(join(root, '.git'), { recursive: true })
  return root
}

/** Boot the installer over a real tool registry and an isolated home. */
async function harness(home: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(skillInstall, { dshHome: home })
  return ctx
}

/** A minimal agent carrying a session cwd, enough for a tool's `exec.agent`. */
function agentForCwd(cwd: string): Agent {
  const id = SessionId(`skill-install-${cwd}`)
  const session = Session.create(id, [] as SessionEvent[], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false,
  })
  const options = {}
  return {
    ctx: new Context(),
    id,
    options,
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('skill-install tests never inject') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

describe('detectSkillFolder', () => {
  it('accepts one skill directory and reads its front matter', async () => {
    const home = await tempDir('detect-one')
    const dir = await writeSkill(home, 'demo', skillMarkdown('demo', 'routes the demo'))
    const ctx = await harness(home)
    expect(await ctx.skillInstall.detect(dir)).toEqual({
      kind: 'found',
      source: dir,
      skills: [{ name: 'demo', description: 'routes the demo', directory: dir }],
      refused: [],
    })
  })

  it('accepts a catalog and reports each refused candidate with its reason', async () => {
    const home = await tempDir('detect-catalog')
    const source = join(home, 'catalog')
    await writeSkill(source, 'good', skillMarkdown('good'))
    await writeSkill(source, 'no-name', '---\ndescription: missing name\n---\n\nBody.\n')
    await writeSkill(source, 'Bad Name', skillMarkdown('Bad Name'))
    await writeSkill(source, 'no-frontmatter', '# no front matter\n')
    // A directory with no SKILL.md and a hidden directory are skipped entirely.
    await mkdir(join(source, 'ignored'), { recursive: true })
    await writeSkill(source, '.hidden', skillMarkdown('hidden'))
    const ctx = await harness(home)

    const detected = await ctx.skillInstall.detect(source)
    expect(detected).toEqual({
      kind: 'found',
      source,
      skills: [{ name: 'good', description: 'does something useful', directory: join(source, 'good') }],
      refused: [
        { directory: join(source, 'Bad Name'), reason: 'invalid-name' },
        { directory: join(source, 'no-frontmatter'), reason: 'bad-frontmatter' },
        { directory: join(source, 'no-name'), reason: 'missing-name' },
      ],
    })
  })

  it('rejects a missing path, a file, an empty directory, and a folder with no skill', async () => {
    const home = await tempDir('detect-invalid')
    const ctx = await harness(home)
    await writeFile(join(home, 'file.md'), skillMarkdown('file'), 'utf8')
    const empty = join(home, 'empty')
    await mkdir(empty, { recursive: true })
    const notes = join(home, 'notes')
    await mkdir(join(notes, 'sub'), { recursive: true })

    expect(await ctx.skillInstall.detect(join(home, 'ghost'))).toEqual({
      kind: 'invalid', source: join(home, 'ghost'), reason: 'missing',
    })
    expect(await ctx.skillInstall.detect(join(home, 'file.md'))).toEqual({
      kind: 'invalid', source: join(home, 'file.md'), reason: 'not-a-directory',
    })
    expect(await ctx.skillInstall.detect(empty)).toEqual({
      kind: 'invalid', source: empty, reason: 'empty',
    })
    expect(await ctx.skillInstall.detect(notes)).toEqual({
      kind: 'invalid', source: notes, reason: 'missing-skill-md',
    })
  })

  it('distinguishes invalid front matter from a missing name and an illegal name', async () => {
    const home = await tempDir('detect-single-invalid')
    const ctx = await harness(home)
    const one = await writeSkill(home, 'one', '# just prose\n')
    const two = await writeSkill(home, 'two', '---\nname: two\n---\n\nBody.\n')
    const three = await writeSkill(home, 'three', skillMarkdown('Bad_Name'))

    expect(await ctx.skillInstall.detect(one)).toMatchObject({ reason: 'bad-frontmatter' })
    expect(await ctx.skillInstall.detect(two)).toMatchObject({ reason: 'missing-name' })
    expect(await ctx.skillInstall.detect(three)).toMatchObject({ reason: 'invalid-name' })
  })
})

describe('scope resolution', () => {
  it('resolves the workspace project root and the global home', async () => {
    const home = await tempDir('scope-home')
    const project = await makeProject()
    const ctx = await harness(home)
    expect(await ctx.skillInstall.targets(project)).toEqual({
      workspace: join(project, '.dsh', 'skills'),
      global: join(home, 'skills'),
    })
    expect(await ctx.skillInstall.targets()).toEqual({
      workspace: null,
      global: join(home, 'skills'),
    })
  })
})

describe('install, idempotence, and reversibility', () => {
  it('installs one skill with its assets, then reports a repeat install unchanged', async () => {
    const home = await tempDir('install-home')
    const project = await makeProject()
    const ctx = await harness(home)
    const source = await writeSkill(join(project, 'source'), 'greet', skillMarkdown('greet'))
    await writeFile(join(source, 'asset.txt'), 'payload', 'utf8')

    const first = await ctx.skillInstall.install({ source, destination: 'workspace', cwd: project })
    const root = join(project, '.dsh', 'skills')
    expect(first).toEqual({
      status: 'installed',
      source,
      destination: 'workspace',
      root,
      outcomes: [{ name: 'greet', status: 'installed' }],
    })
    expect(await readFile(join(root, 'greet', 'asset.txt'), 'utf8')).toBe('payload')
    expect(JSON.parse(await readFile(join(root, 'greet', INSTALL_MARKER_FILE), 'utf8'))).toMatchObject({
      name: 'greet', destination: 'workspace', source,
    })

    const second = await ctx.skillInstall.install({ source, destination: 'workspace', cwd: project })
    expect(second).toMatchObject({ status: 'already-installed', outcomes: [{ name: 'greet', status: 'already-installed' }] })
  })

  it('skips a changed skill unless replace is set', async () => {
    const home = await tempDir('install-replace')
    const project = await makeProject()
    const ctx = await harness(home)
    const source = await writeSkill(join(project, 'source'), 'greet', skillMarkdown('greet', 'first'))
    await ctx.skillInstall.install({ source, destination: 'workspace', cwd: project })

    await writeFile(join(source, 'SKILL.md'), skillMarkdown('greet', 'second'), 'utf8')
    const skipped = await ctx.skillInstall.install({ source, destination: 'workspace', cwd: project })
    expect(skipped).toMatchObject({ status: 'skipped', outcomes: [{ name: 'greet', status: 'skipped', reason: 'exists' }] })
    expect(await readFile(join(project, '.dsh', 'skills', 'greet', 'SKILL.md'), 'utf8')).toContain('first')

    const replaced = await ctx.skillInstall.install({ source, destination: 'workspace', cwd: project, replace: true })
    expect(replaced).toMatchObject({ status: 'installed', outcomes: [{ name: 'greet', status: 'replaced' }] })
    expect(await readFile(join(project, '.dsh', 'skills', 'greet', 'SKILL.md'), 'utf8')).toContain('second')
  })

  it('installs into the global root without a workspace', async () => {
    const home = await tempDir('install-global')
    const ctx = await harness(home)
    const source = await writeSkill(home, 'source', skillMarkdown('global-one'))
    const report = await ctx.skillInstall.install({ source, destination: 'global' })
    expect(report).toEqual({
      status: 'installed',
      source,
      destination: 'global',
      root: join(home, 'skills'),
      outcomes: [{ name: 'global-one', status: 'installed' }],
    })
  })

  it('refuses an invalid source and a workspace install without a workspace', async () => {
    const home = await tempDir('install-refuse')
    const ctx = await harness(home)
    const empty = join(home, 'empty')
    await mkdir(empty, { recursive: true })

    expect(await ctx.skillInstall.install({ source: empty, destination: 'global' })).toMatchObject({
      status: 'invalid', reason: 'empty', outcomes: [],
    })
    const source = await writeSkill(home, 'source', skillMarkdown('one'))
    expect(await ctx.skillInstall.install({ source, destination: 'workspace' })).toMatchObject({
      status: 'refused', destination: 'workspace', reason: 'unavailable-destination', outcomes: [],
    })
  })

  it('installs a catalog and reports refused candidates', async () => {
    const home = await tempDir('install-catalog')
    const project = await makeProject()
    const ctx = await harness(home)
    const source = join(project, 'catalog')
    await writeSkill(source, 'alpha', skillMarkdown('alpha'))
    await writeSkill(source, 'Beta', skillMarkdown('Beta'))

    const report = await ctx.skillInstall.install({ source, destination: 'workspace', cwd: project })
    expect(report.status).toBe('installed')
    expect(report.outcomes).toHaveLength(2)
    expect(report.outcomes).toContainEqual({ name: 'Beta', status: 'refused', reason: 'invalid-name' })
    expect(report.outcomes).toContainEqual({ name: 'alpha', status: 'installed' })
  })

  it('reports a catalog whose every candidate was refused', async () => {
    const home = await tempDir('install-all-refused')
    const project = await makeProject()
    const ctx = await harness(home)
    const source = join(project, 'catalog')
    await writeSkill(source, 'Bad Name', skillMarkdown('Bad Name'))

    const report = await ctx.skillInstall.install({ source, destination: 'workspace', cwd: project })
    expect(report).toMatchObject({ status: 'refused', outcomes: [{ name: 'Bad Name', status: 'refused', reason: 'invalid-name' }] })
  })

  it('removes a marked install, reports absence, and never removes an unmarked skill', async () => {
    const home = await tempDir('uninstall-home')
    const project = await makeProject()
    const ctx = await harness(home)
    const source = await writeSkill(join(project, 'source'), 'greet', skillMarkdown('greet'))
    await ctx.skillInstall.install({ source, destination: 'workspace', cwd: project })

    expect(await ctx.skillInstall.uninstall({ name: 'ghost', destination: 'workspace', cwd: project }))
      .toMatchObject({ status: 'not-found' })
    const handAuthored = join(project, '.dsh', 'skills', 'mine')
    await mkdir(handAuthored, { recursive: true })
    await writeFile(join(handAuthored, 'SKILL.md'), skillMarkdown('mine'), 'utf8')
    expect(await ctx.skillInstall.uninstall({ name: 'mine', destination: 'workspace', cwd: project }))
      .toMatchObject({ status: 'not-an-install' })

    expect(await ctx.skillInstall.uninstall({ name: 'greet', destination: 'workspace', cwd: project })).toEqual({
      status: 'removed', name: 'greet', destination: 'workspace', root: join(project, '.dsh', 'skills'),
    })
    await expect(stat(join(project, '.dsh', 'skills', 'greet'))).rejects.toThrow()
    await expect(ctx.skillInstall.uninstall({ name: 'greet', destination: 'global' }))
      .resolves.toMatchObject({ status: 'not-found' })
  })

  it('treats an unreadable or malformed marker as not-an-install', async () => {
    const home = await tempDir('uninstall-marker')
    const project = await makeProject()
    const ctx = await harness(home)
    const root = join(project, '.dsh', 'skills')
    const unreadable = join(root, 'unreadable')
    await mkdir(unreadable, { recursive: true })
    await writeFile(join(unreadable, 'SKILL.md'), skillMarkdown('unreadable'), 'utf8')
    await mkdir(join(unreadable, INSTALL_MARKER_FILE), { recursive: true })
    const malformed = join(root, 'malformed')
    await mkdir(malformed, { recursive: true })
    await writeFile(join(malformed, INSTALL_MARKER_FILE), '{ broken', 'utf8')
    const wrongShape = join(root, 'wrong-shape')
    await mkdir(wrongShape, { recursive: true })
    await writeFile(join(wrongShape, INSTALL_MARKER_FILE), '{"name":"wrong-shape"}', 'utf8')

    for (const name of ['unreadable', 'malformed', 'wrong-shape']) {
      expect(await ctx.skillInstall.uninstall({ name, destination: 'workspace', cwd: project }))
        .toMatchObject({ status: 'not-an-install' })
    }
  })

  it('lists marked installs across the global and workspace roots', async () => {
    const home = await tempDir('list-home')
    const project = await makeProject()
    const ctx = await harness(home)
    expect(await ctx.skillInstall.list(project)).toEqual([])

    const global = await writeSkill(home, 'source', skillMarkdown('global-one'))
    const workspace = await writeSkill(join(project, 'foo'), 'proj', skillMarkdown('proj'))
    await ctx.skillInstall.install({ source: global, destination: 'global' })
    await ctx.skillInstall.install({ source: workspace, destination: 'workspace', cwd: project })

    const rows = await ctx.skillInstall.list(project)
    expect(rows.map(row => [row.name, row.destination, row.root])).toEqual([
      ['global-one', 'global', join(home, 'skills')],
      ['proj', 'workspace', join(project, '.dsh', 'skills')],
    ])
    expect(await ctx.skillInstall.list()).toHaveLength(1)
  })

  it('ignores files and unmarked directories when listing', async () => {
    const home = await tempDir('list-skip')
    const ctx = await harness(home)
    const root = join(home, 'skills')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'loose.md'), '# loose\n', 'utf8')
    await mkdir(join(root, 'plain'), { recursive: true })
    expect(await ctx.skillInstall.list()).toEqual([])
  })
})

describe('model-facing tools', () => {
  it('registers install_skill and uninstall_skill', async () => {
    const home = await tempDir('tools-register')
    const ctx = await harness(home)
    expect(ctx.tools.schemas().map(tool => tool.name).sort()).toEqual(['install_skill', 'uninstall_skill'])
    expect(ctx.tools.get('install_skill')?.presentCall?.({ source: '/tmp/demo' })).toEqual({
      card: 'generic', title: 'Install skill /tmp/demo', kind: 'edit', rawInput: '/tmp/demo',
    })
    expect(ctx.tools.get('uninstall_skill')?.presentCall?.({ name: 'demo', destination: 'global' })).toEqual({
      card: 'generic', title: 'Uninstall skill demo', kind: 'delete', rawInput: 'demo',
    })
  })

  it('installs into a named destination without asking', async () => {
    const home = await tempDir('tools-destination')
    const project = await makeProject()
    const ctx = await harness(home)
    const source = await writeSkill(join(project, 'source'), 'demo', skillMarkdown('demo'))
    const result = await ctx.tools.execute({
      signal, callId: ToolCallId('install-named'), name: 'install_skill',
      arguments: { source, destination: 'workspace', replace: true }, agent: agentForCwd(project),
    })
    expect(result.isError).toBe(false)
    expect(JSON.parse(textOf(result.content))).toMatchObject({ status: 'installed', outcomes: [{ name: 'demo', status: 'installed' }] })

    const withoutAgent = await ctx.tools.execute({
      signal, callId: ToolCallId('install-no-agent'), name: 'install_skill',
      arguments: { source, destination: 'global' },
    })
    expect(JSON.parse(textOf(withoutAgent.content))).toMatchObject({ status: 'installed', destination: 'global' })
  })

  it('uninstalls through the tool and reports not-found', async () => {
    const home = await tempDir('tools-uninstall')
    const ctx = await harness(home)
    const source = await writeSkill(home, 'source', skillMarkdown('demo'))
    await ctx.skillInstall.install({ source, destination: 'global' })
    const removed = await ctx.tools.execute({
      signal, callId: ToolCallId('uninstall'), name: 'uninstall_skill', arguments: { name: 'demo', destination: 'global' },
    })
    expect(JSON.parse(textOf(removed.content))).toMatchObject({ status: 'removed', name: 'demo' })
    const missing = await ctx.tools.execute({
      signal, callId: ToolCallId('uninstall-again'), name: 'uninstall_skill', arguments: { name: 'demo', destination: 'global' },
    })
    expect(JSON.parse(textOf(missing.content))).toMatchObject({ status: 'not-found' })
  })

  it('resolves the workspace root for tool uninstall and omits it when there is none', async () => {
    const home = await tempDir('tools-uninstall-workspace')
    const project = await makeProject()
    const ctx = await harness(home)
    const source = await writeSkill(join(project, 'source'), 'demo', skillMarkdown('demo'))
    await ctx.skillInstall.install({ source, destination: 'workspace', cwd: project })

    const withAgent = await ctx.tools.execute({
      signal, callId: ToolCallId('uninstall-ws'), name: 'uninstall_skill',
      arguments: { name: 'demo', destination: 'workspace' }, agent: agentForCwd(project),
    })
    expect(JSON.parse(textOf(withAgent.content))).toEqual({
      status: 'removed', name: 'demo', destination: 'workspace', root: join(project, '.dsh', 'skills'),
    })

    const withoutWorkspace = await ctx.tools.execute({
      signal, callId: ToolCallId('uninstall-no-ws'), name: 'uninstall_skill',
      arguments: { name: 'demo', destination: 'workspace' },
    })
    expect(JSON.parse(textOf(withoutWorkspace.content))).toEqual({ status: 'not-found', name: 'demo', destination: 'workspace' })
  })

  it('asks the user which scope to use and installs into the chosen one', async () => {
    const home = await tempDir('tools-ask')
    const project = await makeProject()
    const ctx = await harness(home)
    const asked: unknown[] = []
    ctx.provide('userQuestions', {
      ask: (request: { questions: { options?: { label: string }[] }[] }) => {
        asked.push(request)
        return Promise.resolve({
          answers: [{ id: 'skill-install-scope', selected: [request.questions[0]?.options?.[0]?.label ?? ''] }],
        })
      },
    } as never)
    const source = await writeSkill(join(project, 'source'), 'demo', skillMarkdown('demo'))
    const result = await ctx.tools.execute({
      signal, callId: ToolCallId('install-ask'), name: 'install_skill', arguments: { source }, agent: agentForCwd(project),
    })
    expect(JSON.parse(textOf(result.content))).toMatchObject({ status: 'installed', destination: 'workspace' })
    expect(asked).toHaveLength(1)
    expect((asked[0] as { questions: { question: string }[] }).questions[0]?.question)
      .toBe('Where should this skill be available?')
  })

  it('cancels the install when no answer selects a scope', async () => {
    const home = await tempDir('tools-cancel')
    const project = await makeProject()
    const ctx = await harness(home)
    ctx.provide('userQuestions', { ask: () => Promise.resolve({ answers: [] }) } as never)
    const source = await writeSkill(join(project, 'source'), 'demo', skillMarkdown('demo'))
    const result = await ctx.tools.execute({
      signal, callId: ToolCallId('install-cancel'), name: 'install_skill', arguments: { source }, agent: agentForCwd(project),
    })
    expect(JSON.parse(textOf(result.content))).toMatchObject({ status: 'cancelled' })
  })

  it('reports an invalid source without asking', async () => {
    const home = await tempDir('tools-invalid')
    const project = await makeProject()
    const ctx = await harness(home)
    const asked = { called: false }
    ctx.provide('userQuestions', { ask: () => { asked.called = true; return Promise.resolve({ answers: [] }) } } as never)
    const result = await ctx.tools.execute({
      signal, callId: ToolCallId('install-invalid'), name: 'install_skill', arguments: { source: join(project, 'ghost') }, agent: agentForCwd(project),
    })
    expect(JSON.parse(textOf(result.content))).toMatchObject({ status: 'invalid', reason: 'missing' })
    expect(asked.called).toBe(false)
  })

  it('cancels when no user-questions seam is mounted, and honours the destination key form', async () => {
    const home = await tempDir('tools-no-seam')
    const project = await makeProject()
    const ctx = await harness(home)
    const source = await writeSkill(join(project, 'source'), 'demo', skillMarkdown('demo'))
    const cancelled = await ctx.tools.execute({
      signal, callId: ToolCallId('install-no-seam'), name: 'install_skill', arguments: { source }, agent: agentForCwd(project),
    })
    expect(JSON.parse(textOf(cancelled.content))).toMatchObject({ status: 'cancelled' })

    ctx.provide('userQuestions', {
      ask: () => Promise.resolve({ answers: [{ id: 'skill-install-scope', selected: ['global'] }] }),
    } as never)
    const byKey = await ctx.tools.execute({
      signal, callId: ToolCallId('install-key'), name: 'install_skill', arguments: { source }, agent: agentForCwd(project),
    })
    expect(JSON.parse(textOf(byKey.content))).toMatchObject({ destination: 'global' })
  })
})

/** Flatten one tool result's content blocks to text. */
function textOf(content: readonly { type: string; text?: string }[]): string {
  return content.map(block => block.text ?? '').join('')
}

describe('install marker file', () => {
  it('is the only file the installer writes beside SKILL.md and survives a readdir', async () => {
    const home = await tempDir('marker-shape')
    const ctx = await harness(home)
    const source = await writeSkill(home, 'source', skillMarkdown('demo'))
    await ctx.skillInstall.install({ source, destination: 'global' })
    expect((await readdir(join(home, 'skills', 'demo'))).sort()).toEqual([INSTALL_MARKER_FILE, 'SKILL.md'])
  })
})
