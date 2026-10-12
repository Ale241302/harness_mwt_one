// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ComponentProps } from 'react'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type {
  FaberLoomSkillInstallReport, FaberLoomSkillInstallRow, FaberLoomSkillInstallTargets,
} from '@deepseek-ai/dsh-faberloom-view/types'
import { zh } from '../src/client/locales.ts'
import { SkillInstallBlock } from '../src/client/skill-install.tsx'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as never

type Props = ComponentProps<typeof SkillInstallBlock>

/** One Remote result, as the generated client returns it. */
type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** A successful Remote result. */
function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

/** A failed Remote result. */
function failed(message: string): Result<never> {
  return { ok: false, error: { code: 'test', message } }
}

const TARGETS: FaberLoomSkillInstallTargets = { workspace: 'C:/ws/.dsh/skills', global: 'C:/home/skills' }

/** The control over a mounted target pair and stubbed Remote calls. */
function props(overrides: Partial<Props> = {}): Props {
  const base: Props = {
    t,
    pickFolder: vi.fn(async () => 'C:/ws/catalogo'),
    loadTargets: vi.fn(async (): Promise<Result<FaberLoomSkillInstallTargets>> => ok(TARGETS)),
    loadInstalls: vi.fn(async (): Promise<Result<readonly FaberLoomSkillInstallRow[]>> => ok([])),
    install: vi.fn(async (): Promise<Result<FaberLoomSkillInstallReport>> =>
      ok({ destination: 'workspace', root: TARGETS.workspace as string, outcomes: [{ name: 'saluda', status: 'installed' }] })),
    uninstall: vi.fn(async (): Promise<Result<readonly FaberLoomSkillInstallRow[]>> => ok([])),
    onChanged: vi.fn(),
  }
  return { ...base, ...overrides }
}

describe('SkillInstallBlock', () => {
  it('shows the resolved destination root and installs into the chosen one', async () => {
    const install = vi.fn(async (): Promise<Result<FaberLoomSkillInstallReport>> =>
      ok({ destination: 'workspace', root: 'C:/ws/.dsh/skills', outcomes: [{ name: 'saluda', status: 'installed' }] }))
    const onChanged = vi.fn()
    render(<SkillInstallBlock {...props({ install, onChanged })} />)

    // The global root shows first, before any choice is made.
    await waitFor(() => { expect(screen.getByText('C:/home/skills')).toBeTruthy() })
    expect(screen.getByText('尚未选择文件夹')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }))
    await waitFor(() => { expect(screen.getByText('C:/ws/catalogo')).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: '当前工作区' }))
    await waitFor(() => { expect(screen.getByText('C:/ws/.dsh/skills')).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: '安装' }))
    await waitFor(() => { expect(install).toHaveBeenCalledWith('C:/ws/catalogo', 'workspace', false) })
    await waitFor(() => { expect(screen.getByText('saluda: 已安装')).toBeTruthy() })
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('refuses the workspace destination and reports the reason when the session has none', async () => {
    const install = vi.fn(async (): Promise<Result<FaberLoomSkillInstallReport>> =>
      ok({ destination: 'workspace', root: '', refused: 'no-workspace', outcomes: [] }))
    render(<SkillInstallBlock {...props({
      loadTargets: vi.fn(async (): Promise<Result<FaberLoomSkillInstallTargets>> => ok({ workspace: null, global: 'C:/home/skills' })),
      install,
    })} />)

    const workspaceButton = await screen.findByRole('button', { name: '当前工作区' })
    expect(workspaceButton).toHaveProperty('disabled', true)
    expect(await screen.findByText('当前会话没有工作区；请安装到全局。')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }))
    await screen.findByText('C:/ws/catalogo')
    fireEvent.click(screen.getByRole('button', { name: '安装' }))
    await waitFor(() => { expect(install).toHaveBeenCalledWith('C:/ws/catalogo', 'global', false) })
    await waitFor(() => { expect(screen.getByText('当前会话没有工作区')).toBeTruthy() })
  })

  it('localizes every candidate status, reason, and refusal', async () => {
    const cases: readonly { readonly report: FaberLoomSkillInstallReport; readonly text: string }[] = [
      { report: { destination: 'global', root: 'C:/home/skills', refused: 'outside-workspace', outcomes: [] }, text: '源文件夹在工作区之外' },
      { report: { destination: 'global', root: 'C:/home/skills', refused: 'not-a-skill', outcomes: [] }, text: '该文件夹不包含带 SKILL.md 的技能' },
      { report: { destination: 'global', root: 'C:/home/skills', outcomes: [{ name: 'beta', status: 'skipped', reason: 'exists' }] }, text: 'beta: 已跳过，已存在 (已存在同名技能)' },
      { report: { destination: 'global', root: 'C:/home/skills', outcomes: [{ name: 'mala', status: 'refused', reason: 'name-illegal' }] }, text: 'mala: 已拒绝 (名称不合法：请使用小写字母、数字和连字符)' },
      { report: { destination: 'global', root: 'C:/home/skills', outcomes: [{ name: 'nueva', status: 'replaced' }] }, text: 'nueva: 已替换' },
    ]
    for (const entry of cases) {
      const install = vi.fn(async (): Promise<Result<FaberLoomSkillInstallReport>> => ok(entry.report))
      const view = render(<SkillInstallBlock {...props({ install })} />)
      fireEvent.click(await screen.findByRole('button', { name: '选择文件夹' }))
      await screen.findByText('C:/ws/catalogo')
      fireEvent.click(screen.getByRole('button', { name: '安装' }))
      await waitFor(() => { expect(install).toHaveBeenCalledOnce() })
      expect(await screen.findByText(entry.text)).toBeTruthy()
      view.unmount()
    }
  })

  it('surfaces a transport failure without changing the list', async () => {
    const install = vi.fn(async (): Promise<Result<FaberLoomSkillInstallReport>> => failed('no se pudo instalar'))
    render(<SkillInstallBlock {...props({ install })} />)

    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }))
    await screen.findByText('C:/ws/catalogo')
    fireEvent.click(screen.getByRole('button', { name: '安装' }))

    await waitFor(() => { expect(screen.getByText('no se pudo instalar')).toBeTruthy() })
  })

  it('lists recorded installs and removes one', async () => {
    const loadInstalls = vi.fn()
      .mockResolvedValueOnce(ok([{ name: 'saluda', sourcePath: 'C:/ws/catalogo', destination: 'workspace' as const, destinationRoot: 'C:/ws/.dsh/skills', installedAt: '2026-01-01T00:00:00Z' }]))
      .mockResolvedValue(ok([]))
    const uninstall = vi.fn(async (): Promise<Result<readonly FaberLoomSkillInstallRow[]>> => ok([]))
    render(<SkillInstallBlock {...props({ loadInstalls, uninstall })} />)

    expect(await screen.findByText('saluda')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '移除' }))

    await waitFor(() => { expect(uninstall).toHaveBeenCalledWith('saluda', 'workspace') })
    await waitFor(() => { expect(screen.queryByText('saluda')).toBeNull() })
  })

  it('keeps the chosen folder when the pick is cancelled and remembers the replace flag', async () => {
    const pickFolder = vi.fn(async (): Promise<string | null> => null)
    const install = vi.fn(async (): Promise<Result<FaberLoomSkillInstallReport>> =>
      ok({ destination: 'global', root: 'C:/home/skills', outcomes: [{ name: 'saluda', status: 'replaced' }] }))
    render(<SkillInstallBlock {...props({ pickFolder, install })} />)

    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }))
    await waitFor(() => { expect(pickFolder).toHaveBeenCalledOnce() })
    expect(screen.getByRole('button', { name: '安装' })).toHaveProperty('disabled', true)

    // A folder chosen later, with replace on, installs with replace true.
    pickFolder.mockResolvedValue('C:/ws/otra')
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }))
    await waitFor(() => { expect(screen.getByText('C:/ws/otra')).toBeTruthy() })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '安装' }))

    await waitFor(() => { expect(install).toHaveBeenCalledWith('C:/ws/otra', 'global', true) })
  })

  it('leaves the destination on global when the workspace choice is disabled', async () => {
    const install = vi.fn(async (): Promise<Result<FaberLoomSkillInstallReport>> =>
      ok({ destination: 'global', root: 'C:/home/skills', outcomes: [{ name: 'g', status: 'installed' }] }))
    render(<SkillInstallBlock {...props({
      loadTargets: vi.fn(async (): Promise<Result<FaberLoomSkillInstallTargets>> => ok({ workspace: null, global: 'C:/home/skills' })),
      install,
    })} />)

    fireEvent.click(await screen.findByRole('button', { name: '当前工作区' }))
    expect(screen.getByText('C:/home/skills')).toBeTruthy()
    expect(screen.getByText('当前会话没有工作区；请安装到全局。')).toBeTruthy()
  })
})
