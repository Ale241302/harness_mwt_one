import { describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'

interface CapturedTool {
  readonly name: string
  readonly execute: (args: never, exec: never) => Promise<unknown>
  readonly output: { render: (args: never, value: never) => readonly { type: string; text?: string }[] }
  readonly presentCall: (args: never) => unknown
}

/** Boot the product tools over a stub registry and capture the definitions. */
function harness(services: Record<string, unknown> = {}): Map<string, CapturedTool> {
  const registered = new Map<string, CapturedTool>()
  const ctx = {
    tools: { register: (definition: CapturedTool) => { registered.set(definition.name, definition); return () => {} } },
    get: (name: string) => services[name],
    effect: (callback: () => unknown) => { callback(); return () => {} },
  }
  apply(ctx as never, CONFIG)
  return registered
}

const CONFIG: Config = { ownerId: 'compras2@sondelsa.com', role: 'client_b2b', companyId: 'co-sondel', readOnly: false }

const render = (tool: CapturedTool, value: Record<string, unknown>): string =>
  tool.output.render({} as never, value as never)[0]?.text ?? ''

/** The session-bearing tool-execution context one install call runs under. */
function exec(session?: { header: { cwd: string } }): never {
  return { agent: session === undefined ? undefined : { session } } as never
}

describe('faberloom_skill_install', () => {
  it('installs through the view service, passing the session workspace root from sandboxPolicy', async () => {
    const installSkill = vi.fn(async () => ({
      destination: 'workspace', root: 'C:/ws/.dsh/skills',
      outcomes: [{ name: 'alfa', status: 'installed' }, { name: 'beta', status: 'skipped', reason: 'exists' }],
    }))
    const resolve = vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: 'C:/ws' }))
    const tools = harness({ faberloomView: { installSkill }, sandboxPolicy: { resolve } })
    const tool = tools.get('faberloom_skill_install')!

    const value = await tool.execute(
      { source: 'catalogo', destination: 'workspace', replace: true } as never,
      exec({ header: { cwd: 'C:/otro' } }),
    ) as Record<string, unknown>

    expect(resolve).toHaveBeenCalledWith({ session: { header: { cwd: 'C:/otro' } } })
    expect(installSkill).toHaveBeenCalledWith('catalogo', 'workspace', true, 'C:/ws')
    expect(value).toEqual({
      destination: 'workspace',
      root: 'C:/ws/.dsh/skills',
      outcomes: [
        { name: 'alfa', status: 'installed' },
        { name: 'beta', status: 'skipped', reason: 'exists' },
      ],
    })
    const text = render(tool, value)
    expect(text).toContain('Installed into this workspace at C:/ws/.dsh/skills:')
    expect(text).toContain('- alfa: installed')
    expect(text).toContain('- beta: skipped (exists)')
    expect(tool.presentCall({ source: 'catalogo', destination: 'workspace' } as never)).toMatchObject({ card: 'generic' })
  })

  it('falls back to the session cwd when no sandbox policy is mounted', async () => {
    const installSkill = vi.fn(async () => ({ destination: 'global', root: 'C:/home/skills', outcomes: [] }))
    const tools = harness({ faberloomView: { installSkill } })
    const tool = tools.get('faberloom_skill_install')!

    await tool.execute(
      { source: 'bajada', destination: 'global' } as never,
      exec({ header: { cwd: 'C:/sesion' } }),
    )

    expect(installSkill).toHaveBeenCalledWith('bajada', 'global', undefined, 'C:/sesion')
  })

  it('passes no workspace root for a caller without a session', async () => {
    const installSkill = vi.fn(async () => ({ destination: 'global', root: 'C:/home/skills', outcomes: [] }))
    const tools = harness({ faberloomView: { installSkill }, sandboxPolicy: { resolve: vi.fn() } })
    const tool = tools.get('faberloom_skill_install')!

    await tool.execute({ source: 'x', destination: 'global' } as never, exec())

    expect(installSkill).toHaveBeenCalledWith('x', 'global', undefined, undefined)
  })

  it('reports a whole-call refusal', async () => {
    const installSkill = vi.fn(async () => ({ destination: 'workspace', root: '', refused: 'no-workspace', outcomes: [] }))
    const tools = harness({ faberloomView: { installSkill } })
    const tool = tools.get('faberloom_skill_install')!

    const value = await tool.execute({ source: 'x', destination: 'workspace' } as never, exec()) as Record<string, unknown>

    expect(value).toMatchObject({ refused: 'no-workspace', outcomes: [] })
    expect(render(tool, value)).toBe('Nothing was installed into this workspace: no-workspace.')
  })

  it('fails loud when the workspace view service is not mounted', async () => {
    const tools = harness()
    await expect(tools.get('faberloom_skill_install')!.execute({ source: 'x', destination: 'global' } as never, exec()))
      .rejects.toThrow('workspace view service is not mounted')
  })

  it('rejects a call that omits the required destination before touching the view', async () => {
    const installSkill = vi.fn(async () => ({ destination: 'global', root: 'C:/home/skills', outcomes: [] }))
    const tools = harness({ faberloomView: { installSkill } })
    const tool = tools.get('faberloom_skill_install')!

    await expect(tool.execute({ source: 'x' } as never, exec())).rejects.toThrow('destination')
    expect(installSkill).not.toHaveBeenCalled()
  })
})
