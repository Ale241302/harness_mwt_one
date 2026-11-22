// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import {
  WorkspaceSubspaceDialog, createWorkspaceSubspaceStore,
  type WorkspaceSubspaceState,
} from '../src/client/workspace-subspace.tsx'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as never

/** Framework hooks the dialog and row never read, but their prop types require. */
const globals = {
  useSessions: () => undefined,
  useSessionPendingInteraction: () => undefined,
  useWorkspaces: () => undefined,
  usePanelInfo: () => undefined,
}

type DialogProps = ComponentProps<typeof WorkspaceSubspaceDialog>
type Instance = ReturnType<ReturnType<typeof createWorkspaceSubspaceStore>['create']>

function store(): Instance {
  return createWorkspaceSubspaceStore().create()
}

function dialogProps(instance: Instance, overrides: Partial<DialogProps> = {}): DialogProps {
  const useStore = (selector: (state: WorkspaceSubspaceState) => unknown): unknown => selector(instance.getSnapshot())
  return {
    ...globals,
    useStore: useStore as never,
    actions: instance.actions,
    create: vi.fn(async () => ({ ok: true, message: '' })),
    t,
    ...overrides,
  } as unknown as DialogProps
}

describe('createWorkspaceSubspaceStore', () => {
  it('opens, marks saving, records a message, and closes', () => {
    const instance = store()
    expect(instance.getSnapshot()).toEqual({ request: null, saving: false, message: null })
    instance.actions.requestCreate({ workspaceId: 'ws-1', title: 'OC 20845' })
    expect(instance.getSnapshot().request).toEqual({ workspaceId: 'ws-1', title: 'OC 20845' })
    instance.actions.setSaving(true)
    expect(instance.getSnapshot().saving).toBe(true)
    instance.actions.setMessage('boom')
    expect(instance.getSnapshot().message).toBe('boom')
    instance.actions.close()
    expect(instance.getSnapshot()).toEqual({ request: null, saving: false, message: null })
  })
})

describe('WorkspaceSubspaceDialog', () => {
  it('renders nothing while no request is pending', () => {
    const { container } = render(<WorkspaceSubspaceDialog {...dialogProps(store())} />)
    expect(container.firstChild).toBeNull()
  })

  it('requires a name, creates the child, and closes on success', async () => {
    const instance = store()
    instance.actions.requestCreate({ workspaceId: 'ws-1', title: 'OC 20845' })
    const create = vi.fn(async () => ({ ok: true, message: '' }))
    render(<WorkspaceSubspaceDialog {...dialogProps(instance, { create })} />)
    expect(screen.getByText(/OC 20845/u)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(create).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('子空间名称'), { target: { value: '  Documentos  ' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => { expect(create).toHaveBeenCalledWith('ws-1', 'Documentos') })
    await waitFor(() => { expect(instance.getSnapshot().request).toBeNull() })
  })

  it('submits with Enter and surfaces a failure without closing', async () => {
    const instance = store()
    instance.actions.requestCreate({ workspaceId: 'ws-1', title: 'OC 20845' })
    const create = vi.fn(async () => ({ ok: false, message: 'sin permiso' }))
    render(<WorkspaceSubspaceDialog {...dialogProps(instance, { create })} />)
    const input = screen.getByLabelText('子空间名称')
    fireEvent.change(input, { target: { value: 'Documentos' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(instance.getSnapshot().message).toBe('sin permiso') })
    expect(instance.getSnapshot().request).not.toBeNull()
  })

  it('cancels from the footer and resets the draft', () => {
    const instance = store()
    instance.actions.requestCreate({ workspaceId: 'ws-1', title: 'OC 20845' })
    render(<WorkspaceSubspaceDialog {...dialogProps(instance)} />)
    fireEvent.change(screen.getByLabelText('子空间名称'), { target: { value: 'Documentos' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(instance.getSnapshot().request).toBeNull()
  })
})
