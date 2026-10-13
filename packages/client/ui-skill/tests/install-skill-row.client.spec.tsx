// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { InstallSkillRow } from '../src/client/InstallSkillRow.tsx'
import { es, zh } from '../src/client/locales.ts'

type InstallSkillRowProps = Parameters<typeof InstallSkillRow>[0]

const t: InstallSkillRowProps['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

function settled(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 3,
    time: 3_000,
    callId: 'call-install',
    call: { name: 'install_skill', argsRaw: '{"source":"/work/that-folder"}' },
    callTime: 2_000,
    content: [{ type: 'text', text: '{"status":"installed","source":"/work/that-folder","destination":"workspace","outcomes":[]}' }],
    isError: false,
    subCalls: [],
    ...over,
  }
}

function running(argsRaw = '{"source":"/work/that-folder","destination":"global"}'): RunningToolCall {
  return {
    callId: 'call-install', name: 'install_skill', argsRaw, turn: 1, step: 1, time: 2_000, subCalls: [],
  }
}

function props(block: InstallSkillRowProps['block']): InstallSkillRowProps {
  return {
    callId: block.callId,
    toolName: 'install_skill',
    block,
    openFile: vi.fn(),
    loadImage: vi.fn(),
    t,
  } as unknown as InstallSkillRowProps
}

describe('InstallSkillRow', () => {
  it('renders a running install with its folder and chosen scope', () => {
    const view = render(<InstallSkillRow {...props(running())} />)
    expect(view.container.querySelector('[data-tool="install_skill"]')?.getAttribute('data-state')).toBe('running')
    expect(view.container.textContent).toContain('安装 skill')
    expect(view.container.textContent).toContain('/work/that-folder')
    expect(view.container.textContent).toContain('你的全局用户')
    expect(view.container.textContent).toContain('正在安装 skill')
  })

  it('reads the settled outcome and falls back to the result destination', () => {
    const view = render(<InstallSkillRow {...props(settled({
      call: { name: 'install_skill', argsRaw: '{"source":"/work/that-folder"}' },
      content: [{ type: 'text', text: '{"status":"installed","destination":"global"}' }],
    }))} />)
    expect(view.container.textContent).toContain('你的全局用户')
    expect(view.container.textContent).toContain('已安装')
    expect(view.container.querySelector('[data-state="error"]')).toBeNull()
  })

  it('reports a repeat install, a skip, and a refusal with their own copy', () => {
    const cases: [string, string][] = [
      ['already-installed', '已存在，无需重装'],
      ['skipped', '已跳过，同名已存在'],
      ['refused', '已拒绝'],
      ['replaced', '已替换'],
      ['cancelled', '已取消'],
    ]
    for (const [status, copy] of cases) {
      const view = render(<InstallSkillRow {...props(settled({
        content: [{ type: 'text', text: JSON.stringify({ status, destination: 'workspace' }) }],
      }))} />)
      expect(view.container.textContent).toContain(copy)
      expect(view.container.textContent).toContain('仅此工作区')
      cleanup()
    }
  })

  it('renders the invalid-folder status as the not-a-skill copy', () => {
    const view = render(<InstallSkillRow {...props(settled({
      content: [{ type: 'text', text: '{"status":"invalid","reason":"missing-skill-md"}' }],
    }))} />)
    expect(view.container.textContent).toContain('该文件夹不是 skill')
    expect(view.container.textContent).not.toContain('failed')
  })

  it('surfaces the first error line and shows the error state', () => {
    const view = render(<InstallSkillRow {...props(settled({
      content: [{ type: 'text', text: 'InstallError: no permission\nTry another folder.' }],
      isError: true,
    }))} />)
    expect(view.container.querySelector('[data-state="error"]')).not.toBeNull()
    expect(view.container.textContent).toContain('InstallError: no permission')
    expect(view.container.textContent).not.toContain('Try another folder.')

    cleanup()
    const bare = render(<InstallSkillRow {...props(settled({
      call: null,
      content: [],
      isError: true,
    }))} />)
    expect(bare.container.querySelector('[data-state="error"]')).not.toBeNull()
    expect(bare.container.textContent).toContain('安装 skill')
  })

  it('tolerates non-JSON args and result without inventing a scope or status', () => {
    const view = render(<InstallSkillRow {...props(settled({
      call: null,
      content: [],
    }))} />)
    expect(view.container.textContent).toContain('安装 skill')
    expect(view.container.textContent).not.toContain('仅此工作区')
    expect(view.container.textContent).not.toContain('已安装')

    cleanup()
    const streaming = render(<InstallSkillRow {...props(running('{"source":\n'))} />)
    expect(streaming.container.textContent).toContain('{"source":')
  })

  it('ignores a scope and status the wire does not define', () => {
    const view = render(<InstallSkillRow {...props(settled({
      call: { name: 'install_skill', argsRaw: '{"source":"/x","destination":"planetary"}' },
      content: [{ type: 'text', text: '{"status":"teleported","destination":"planetary"}' }],
    }))} />)
    expect(view.container.textContent).not.toContain('space')
    expect(screen.queryByText('已安装')).toBeNull()
  })

  it('treats a non-object JSON payload as absent structured data', () => {
    const arrayArgs = render(<InstallSkillRow {...props(running('[]'))} />)
    expect(arrayArgs.container.textContent).toContain('[]')
    cleanup()

    const nullArgs = render(<InstallSkillRow {...props(running('null'))} />)
    expect(nullArgs.container.textContent).toContain('null')
    cleanup()

    const scalarArgs = render(<InstallSkillRow {...props(running('5'))} />)
    expect(scalarArgs.container.textContent).toContain('5')
  })

  it('ignores non-text result blocks when deriving the row', () => {
    const view = render(<InstallSkillRow {...props(settled({
      call: { name: 'install_skill', argsRaw: '{"source":"/x","destination":"global"}' },
      content: [{ type: 'reasoning', text: 'thinking' }],
    }))} />)
    expect(view.container.textContent).toContain('你的全局用户')
    expect(view.container.textContent).not.toContain('已安装')
  })

  it('carries the neutral Spanish copy for the install surface', () => {
    expect(es['install.title']).toBe('Instalar skill')
    expect(es['install.scope.workspace']).toBe('Solo este espacio')
    expect(es['install.scope.global']).toBe('Global para tu usuario')
    expect(es['install.status.alreadyInstalled']).toBe('Ya estaba instalada')
    expect(es['install.notASkill']).toBe('Esa carpeta no es una skill')
  })
})
