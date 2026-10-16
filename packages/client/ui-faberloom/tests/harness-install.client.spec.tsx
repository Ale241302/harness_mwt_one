// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ComponentProps } from 'react'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { FaberLoomHarnessReport, FaberLoomSkillInstallRow } from '@deepseek-ai/dsh-faberloom-view/types'
import { zh } from '../src/client/locales.ts'
import { HarnessInstallBlock } from '../src/client/harness-install.tsx'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as never

type Props = ComponentProps<typeof HarnessInstallBlock>

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

/** One installed-from-folder row. */
function row(name: string): FaberLoomSkillInstallRow {
  return {
    name,
    sourcePath: `C:/fuentes/${name}`,
    destination: 'global',
    destinationRoot: 'C:/home/skills',
    installedAt: '2026-01-01T00:00:00Z',
  }
}

/** The control over stubbed pickers and Remote calls. */
function props(overrides: Partial<Props> = {}): Props {
  const base: Props = {
    t,
    pickFolder: vi.fn(async () => 'C:/fuentes/ECC'),
    pickArchive: vi.fn(async () => 'C:/fuentes/ECC.zip'),
    install: vi.fn(async (): Promise<Result<FaberLoomHarnessReport>> => ok({
      status: 'installed',
      source: 'C:/fuentes/ECC',
      root: 'C:/fuentes/ECC',
      parts: [
        { kind: 'skills', status: 'installed', count: 5, target: 'C:/home/skills' },
        { kind: 'agents', status: 'installed', count: 2, target: 'C:/home/.agent-presets' },
      ],
      outcomes: [
        { name: 'saluda', status: 'installed' },
        { name: 'contable', status: 'installed' },
      ],
    })),
    loadInstalls: vi.fn(async (): Promise<Result<readonly FaberLoomSkillInstallRow[]>> => ok([])),
    uninstall: vi.fn(async (): Promise<Result<readonly FaberLoomSkillInstallRow[]>> => ok([])),
    onChanged: vi.fn(),
  }
  return { ...base, ...overrides }
}

describe('HarnessInstallBlock', () => {
  it('installs the folder the operator picked and names every part it wrote', async () => {
    const install = props().install
    const onChanged = vi.fn()
    render(<HarnessInstallBlock {...props({ install, onChanged })} />)

    expect(screen.getByText('尚未选择文件夹或文件')).toBeTruthy()
    expect(screen.getByRole('button', { name: '安装' })).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }))
    await waitFor(() => { expect(screen.getByText('C:/fuentes/ECC')).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: '安装' }))

    await waitFor(() => { expect(install).toHaveBeenCalledWith('C:/fuentes/ECC', false) })
    expect(await screen.findByText('5 · 已安装')).toBeTruthy()
    expect(screen.getByText('2 · 已安装')).toBeTruthy()
    expect(screen.getByText('C:/home/.agent-presets')).toBeTruthy()
    expect(screen.getByText('技能')).toBeTruthy()
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('installs an archive the file picker answered, and remembers the replace flag', async () => {
    const pickArchive = vi.fn(async (): Promise<string | null> => null)
    const install = props().install
    const view = render(<HarnessInstallBlock {...props({ pickArchive, install })} />)

    // A cancelled pick leaves the control without a source, whatever the folder
    // picker would have answered.
    fireEvent.click(screen.getByRole('button', { name: '选择 .zip' }))
    await waitFor(() => { expect(pickArchive).toHaveBeenCalledOnce() })
    expect(screen.getByRole('button', { name: '安装' })).toHaveProperty('disabled', true)

    pickArchive.mockResolvedValue('C:/fuentes/ECC.zip')
    fireEvent.click(screen.getByRole('button', { name: '选择 .zip' }))
    await waitFor(() => { expect(screen.getByText('C:/fuentes/ECC.zip')).toBeTruthy() })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '安装' }))

    await waitFor(() => { expect(install).toHaveBeenCalledWith('C:/fuentes/ECC.zip', true) })
    view.unmount()
  })

  it('localizes every whole-call refusal and every part status', async () => {
    const refusals = [
      ['source-missing', '源文件夹不存在'],
      ['not-a-harness', '该文件夹不含技能、代理、规则、命令或脚本'],
      ['archive-unreadable', '无法将该文件作为 .zip 读取'],
      ['read-only', '你的身份为只读'],
    ] as const
    const base = props()
    for (const [refused, text] of refusals) {
      const install = vi.fn(async (): Promise<Result<FaberLoomHarnessReport>> =>
        ok({ status: 'refused', source: 'C:/fuentes/ECC', root: '', refused, parts: [], outcomes: [] }))
      const view = render(<HarnessInstallBlock {...props({ install })} />)
      fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }))
      await screen.findByText('C:/fuentes/ECC')
      fireEvent.click(screen.getByRole('button', { name: '安装' }))
      expect(await screen.findByText(text)).toBeTruthy()
      view.unmount()
    }

    for (const [status, text] of [
      ['installed', '1 · 已安装'],
      ['replaced', '1 · 已替换'],
      ['skipped', '1 · 已跳过，已存在'],
    ] as const) {
      const install = vi.fn(async (): Promise<Result<FaberLoomHarnessReport>> => ok({
        status: 'installed', source: 'C:/fuentes/ECC', root: 'C:/fuentes/ECC',
        parts: [{ kind: 'rules', status, count: 1, target: 'C:/home/AGENTS.md' }], outcomes: [],
      }))
      const view = render(<HarnessInstallBlock {...props({ install })} />)
      fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }))
      await screen.findByText('C:/fuentes/ECC')
      fireEvent.click(screen.getByRole('button', { name: '安装' }))
      expect(await screen.findByText(text)).toBeTruthy()
      expect(screen.getByText('规则')).toBeTruthy()
      view.unmount()
    }

    expect(base.install).not.toHaveBeenCalled()
  })

  it('names the candidates a run refused, with the localized reason', async () => {
    const install = vi.fn(async (): Promise<Result<FaberLoomHarnessReport>> => ok({
      status: 'installed', source: 'C:/fuentes/ECC', root: 'C:/fuentes/ECC',
      parts: [{ kind: 'skills', status: 'installed', count: 1, target: 'C:/home/skills' }],
      outcomes: [
        { name: 'buena', status: 'installed' },
        { name: 'mala', status: 'refused', reason: 'name-illegal' },
        { name: 'rota', status: 'refused', reason: 'name-missing' },
        { name: 'equipo', status: 'refused', reason: 'agent-invalid' },
      ],
    }))
    render(<HarnessInstallBlock {...props({ install })} />)

    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }))
    await screen.findByText('C:/fuentes/ECC')
    fireEvent.click(screen.getByRole('button', { name: '安装' }))

    expect(await screen.findByText(
      '已拒绝: mala (名称不合法：请使用小写字母、数字和连字符), rota (frontmatter 中没有 name), equipo (代理描述不可用)',
    )).toBeTruthy()
  })

  it('surfaces a transport failure without a report', async () => {
    const install = vi.fn(async (): Promise<Result<FaberLoomHarnessReport>> => failed('no se pudo instalar'))
    render(<HarnessInstallBlock {...props({ install })} />)

    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }))
    await screen.findByText('C:/fuentes/ECC')
    fireEvent.click(screen.getByRole('button', { name: '安装' }))

    expect(await screen.findByText('no se pudo instalar')).toBeTruthy()
    expect(screen.queryByText('1 · 已安装')).toBeNull()
  })

  it('lists the recorded installs, caps the list, and removes one', async () => {
    const rows = Array.from({ length: 14 }, (_value, index) => row(`skill-${String(index)}`))
    const loadInstalls = vi.fn()
      .mockResolvedValueOnce(ok(rows))
      .mockResolvedValue(ok([row('skill-0')]))
    const uninstall = vi.fn(async (): Promise<Result<readonly FaberLoomSkillInstallRow[]>> => ok([]))
    render(<HarnessInstallBlock {...props({ loadInstalls, uninstall })} />)

    expect(await screen.findByText('从文件夹安装')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '移除' })).toHaveLength(12)
    expect(screen.getByText('还有: 2')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: '移除' })[0] as HTMLElement)

    await waitFor(() => { expect(uninstall).toHaveBeenCalledWith('skill-0', 'global') })
    await waitFor(() => { expect(screen.queryByText('skill-1')).toBeNull() })
  })
})
