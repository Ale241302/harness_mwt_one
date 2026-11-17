// @vitest-environment jsdom
/**
 * The F1 iteration window proves what a screenshot cannot: it moves and resizes
 * by pointer and by keyboard, keeps its draft when closed and reopened, and
 * returns focus to the launcher on Escape.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskChatWindow } from '../src/client/task-chat-window.tsx'
import { taskChatEs } from '../src/client/locales/email.ts'
import { KEYBOARD_STEP, WINDOW_MIN_WIDTH } from '../src/client/task-chat-store.ts'

const context = { title: 'Proforma 2026-001 (sintética)', detail: 'Proveedor Uno' }

/** Default no-op so a case that only checks presentation need not pass a callback. */
const noIterate = (_instruction: string): void => {}

const renderWindow = (onIterate: (instruction: string) => void = noIterate) =>
  render(<TaskChatWindow labels={taskChatEs} context={context} onIterate={onIterate} />)

/** Open the window and return its dialog element. */
function open(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: taskChatEs.launcher }))
  return screen.getByRole('dialog', { name: taskChatEs.title })
}

afterEach(cleanup)

describe('iteration window', () => {
  it('starts closed behind its launcher', () => {
    renderWindow()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: taskChatEs.launcher })).toBeTruthy()
  })

  it('opens with focus in the draft and closes on Escape back to the launcher', () => {
    renderWindow()
    const dialog = open()
    const area = screen.getByRole('textbox', { name: taskChatEs.draftLabel })
    expect(document.activeElement).toBe(area)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: taskChatEs.launcher }))
  })

  it('moves with the arrow keys and with the pointer', () => {
    renderWindow()
    const dialog = open()
    const handle = screen.getByLabelText(taskChatEs.move)

    const startLeft = Number.parseInt(dialog.style.left, 10)
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(Number.parseInt(dialog.style.left, 10)).toBe(startLeft + KEYBOARD_STEP)

    const startTop = Number.parseInt(dialog.style.top, 10)
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 140, clientY: 130 })
    fireEvent.pointerUp(window)
    expect(Number.parseInt(dialog.style.top, 10)).toBe(startTop + 30)
  })

  it('resizes with the keyboard and never goes below the minimum', () => {
    renderWindow()
    const dialog = open()
    const handle = screen.getByRole('button', { name: taskChatEs.resize })

    const startWidth = Number.parseInt(dialog.style.width, 10)
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(Number.parseInt(dialog.style.width, 10)).toBe(startWidth + KEYBOARD_STEP * 2)

    for (let step = 0; step < 20; step += 1) fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
    expect(Number.parseInt(dialog.style.width, 10)).toBe(WINDOW_MIN_WIDTH)
  })

  it('takes the whole surface and hides the resize control', () => {
    renderWindow()
    const dialog = open()
    expect(dialog.style.width).not.toBe('')
    fireEvent.click(screen.getByRole('button', { name: taskChatEs.fullscreen }))
    expect(dialog.style.width).toBe('')
    expect(screen.queryByRole('button', { name: taskChatEs.resize })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: taskChatEs.restore }))
    expect(dialog.style.width).not.toBe('')
  })

  it('keeps the draft when closed and reopened, and reports its state', () => {
    renderWindow()
    const dialog = open()
    const area = screen.getByRole('textbox', { name: taskChatEs.draftLabel })
    fireEvent.change(area, { target: { value: 'Cambia el precio a 120' } })
    expect(screen.getByText(taskChatEs.dirty)).toBeTruthy()

    const save = screen.getByRole('button', { name: taskChatEs.save })
    fireEvent.click(save)
    expect(screen.getByText(taskChatEs.saved)).toBeTruthy()
    expect((save as HTMLButtonElement).disabled).toBe(true)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    open()
    expect(screen.getByRole('textbox', { name: taskChatEs.draftLabel }))
      .toHaveProperty('value', 'Cambia el precio a 120')
  })

  it('does not iterate an empty instruction', () => {
    const onIterate = vi.fn()
    renderWindow(onIterate)
    open()
    const iterate = screen.getByRole('button', { name: taskChatEs.iterate }) as HTMLButtonElement
    expect(iterate.disabled).toBe(true)

    fireEvent.change(screen.getByRole('textbox', { name: taskChatEs.draftLabel }), { target: { value: 'Acorta el párrafo' } })
    expect(iterate.disabled).toBe(false)
    fireEvent.click(iterate)
    expect(onIterate).toHaveBeenCalledWith('Acorta el párrafo')
  })
})
