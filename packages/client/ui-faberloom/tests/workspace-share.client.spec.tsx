// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import {
  WorkspaceShareDialog, WorkspaceShareMenuItem, createWorkspaceShareStore,
  type WorkspaceShareState,
} from '../src/client/workspace-share.tsx'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as never

/** Framework hooks the dialog and row never read, but their prop types require. */
const globals = {
  useSessions: () => undefined,
  useSessionPendingInteraction: () => undefined,
  useWorkspaces: () => undefined,
  usePanelInfo: () => undefined,
}

type DialogProps = ComponentProps<typeof WorkspaceShareDialog>
type MenuProps = ComponentProps<typeof WorkspaceShareMenuItem>

/** One live store instance type. */
type ShareInstance = ReturnType<ReturnType<typeof createWorkspaceShareStore>['create']>

/** Build one live store instance. */
function shareStore(): { instance: ShareInstance } {
  return { instance: createWorkspaceShareStore().create() }
}

function dialogProps(instance: ShareInstance, overrides: Partial<DialogProps> = {}): DialogProps {
  const useStore = (selector: (state: WorkspaceShareState) => unknown): unknown => selector(instance.getSnapshot())
  return {
    ...globals,
    useStore: useStore as never,
    actions: instance.actions,
    share: vi.fn(async () => ({ ok: true, message: '' })),
    t,
    ...overrides,
  } as unknown as DialogProps
}

function menuProps(overrides: Partial<MenuProps>): MenuProps {
  const { instance } = shareStore()
  return {
    ...globals,
    workspaceId: 'ws-1',
    title: 'SICOP',
    close: vi.fn(),
    actions: instance.actions,
    t,
    ...overrides,
  } as unknown as MenuProps
}

describe('createWorkspaceShareStore', () => {
  it('opens, marks saving, records a message, and closes', () => {
    const { instance } = shareStore()
    expect(instance.getSnapshot()).toEqual({ request: null, saving: false, message: null })
    instance.actions.requestShare({ workspaceId: 'ws-1', title: 'SICOP' })
    expect(instance.getSnapshot().request).toEqual({ workspaceId: 'ws-1', title: 'SICOP' })
    instance.actions.setSaving(true)
    expect(instance.getSnapshot().saving).toBe(true)
    instance.actions.setMessage('boom')
    expect(instance.getSnapshot().message).toBe('boom')
    instance.actions.close()
    expect(instance.getSnapshot()).toEqual({ request: null, saving: false, message: null })
  })
})

describe('WorkspaceShareMenuItem', () => {
  it('closes the dropdown and requests the dialog for its workspace', () => {
    const close = vi.fn()
    const requestShare = vi.fn()
    const { instance } = shareStore()
    render(<WorkspaceShareMenuItem {...menuProps({ close, actions: { ...instance.actions, requestShare } })} />)
    fireEvent.click(screen.getByRole('menuitem', { name: '共享' }))
    expect(close).toHaveBeenCalledOnce()
    expect(requestShare).toHaveBeenCalledWith({ workspaceId: 'ws-1', title: 'SICOP' })
  })
})

describe('WorkspaceShareDialog', () => {
  it('renders nothing while no request is pending', () => {
    const { container } = render(<WorkspaceShareDialog {...dialogProps(shareStore().instance)} />)
    expect(container.firstChild).toBeNull()
  })

  it('needs an email before it shares, then closes on success', async () => {
    const { instance } = shareStore()
    instance.actions.requestShare({ workspaceId: 'ws-1', title: 'SICOP' })
    const share = vi.fn(async () => ({ ok: true, message: '' }))
    render(<WorkspaceShareDialog {...dialogProps(instance, { share })} />)
    expect(screen.getByText('SICOP')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '发送邀请' }))
    expect(share).not.toHaveBeenCalled()
    expect(instance.getSnapshot().message).toBe('至少输入一个邮箱')
    fireEvent.change(screen.getByLabelText('受邀者邮箱'), { target: { value: 'a@x.com, b@x.com' } })
    fireEvent.click(screen.getByRole('button', { name: '发送邀请' }))
    await waitFor(() => { expect(share).toHaveBeenCalledWith('ws-1', ['a@x.com', 'b@x.com'], ['view']) })
    await waitFor(() => { expect(instance.getSnapshot().request).toBeNull() })
  })

  it('shows the submitted permissions, toggles them, and surfaces a failure', async () => {
    const { instance } = shareStore()
    instance.actions.requestShare({ workspaceId: 'ws-1', title: '' })
    instance.actions.setMessage('fallo previo')
    const share = vi.fn(async () => ({ ok: false, message: 'no se pudo' }))
    render(<WorkspaceShareDialog {...dialogProps(instance, { share })} />)
    // Empty title falls back to the dictionary heading.
    expect(screen.getByText('共享空间')).toBeTruthy()
    expect(screen.getByText('fallo previo')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('受邀者邮箱'), { target: { value: 'a@x.com' } })
    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[2]!)
    fireEvent.click(boxes[0]!)
    fireEvent.click(screen.getByRole('button', { name: '发送邀请' }))
    await waitFor(() => { expect(share).toHaveBeenCalledWith('ws-1', ['a@x.com'], ['edit-graph']) })
    await waitFor(() => { expect(instance.getSnapshot().message).toBe('no se pudo') })
  })

  it('cancels from the footer and resets the draft', () => {
    const { instance } = shareStore()
    instance.actions.requestShare({ workspaceId: 'ws-1', title: 'SICOP' })
    render(<WorkspaceShareDialog {...dialogProps(instance)} />)
    fireEvent.change(screen.getByLabelText('受邀者邮箱'), { target: { value: 'a@x.com' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(instance.getSnapshot().request).toBeNull()
  })
})
