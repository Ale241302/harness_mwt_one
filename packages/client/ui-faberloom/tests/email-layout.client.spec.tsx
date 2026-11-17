// @vitest-environment jsdom
/**
 * The F1 email surface keeps four promises that a screenshot cannot show: the
 * list is one tab stop with arrow selection, the reading pane returns focus on
 * Escape, an edited draft survives switching messages, and the approval panel
 * shows the whole snapshot before anything is approved.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailLayout } from '../src/client/email-layout.tsx'
import { lookClassName } from '../src/client/appearance.ts'
import { emailEs } from '../src/client/locales/email.ts'
import type { EmailRow } from '../src/client/email-store.ts'

const rows: readonly EmailRow[] = [
  {
    id: 'a',
    from: 'Proveedor Uno',
    to: ['compras@ejemplo.test'],
    cc: ['jefe@ejemplo.test'],
    bcc: ['auditoria@ejemplo.test'],
    subject: 'Proforma 2026-001 (sintética)',
    body: 'Cuerpo de la proforma uno.',
    attachments: ['proforma-001.pdf'],
    received: '09:12',
    unread: true,
    revision: 1,
    synthetic: true,
    suggestion: 'Cuerpo propuesto por el agente.',
  },
  {
    id: 'b',
    from: 'Proveedor Dos',
    to: ['compras@ejemplo.test'],
    cc: [],
    bcc: [],
    subject: 'Proforma 2026-002 (sintética)',
    body: 'Cuerpo de la proforma dos.',
    attachments: [],
    received: '10:41',
    unread: false,
    revision: 3,
    synthetic: true,
  },
]

/** The subject of one fixture row; the fixtures always define it. */
function subjectOf(index: number): string {
  const row = rows[index]
  if (row === undefined) throw new Error(`missing row ${String(index)}`)
  return row.subject
}

const renderSurface = () => render(<EmailLayout rows={rows} labels={emailEs} />)

afterEach(cleanup)

describe('email layout', () => {
  it('renders every message as one listbox option, with the first selected', () => {
    renderSurface()
    const list = screen.getByRole('listbox', { name: emailEs.a11yMessages })
    const options = within(list).getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
    expect(options[1]?.getAttribute('aria-selected')).toBe('false')
    expect(options[0]?.getAttribute('tabIndex')).toBe('0')
    expect(options[1]?.getAttribute('tabIndex')).toBe('-1')
  })

  it('moves the selection with the arrow keys and opens with Enter', () => {
    renderSurface()
    const list = screen.getByRole('listbox', { name: emailEs.a11yMessages })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    const options = within(list).getAllByRole('option')
    expect(options[1]?.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(list, { key: 'Enter' })
    expect(screen.getByRole('heading', { name: subjectOf(1) })).toBeTruthy()
  })

  it('returns to the list and to the selected row on Escape', () => {
    renderSurface()
    const list = screen.getByRole('listbox', { name: emailEs.a11yMessages })
    fireEvent.keyDown(list, { key: 'Enter' })
    const reading = screen.getByRole('heading', { name: subjectOf(0) })

    fireEvent.keyDown(reading, { key: 'Escape' })
    expect(screen.queryByRole('heading', { name: subjectOf(0) })).toBeNull()
    const selected = within(list).getAllByRole('option')[0]
    expect(document.activeElement).toBe(selected)
  })

  it('keeps a draft per message and reports it as unsaved', () => {
    renderSurface()
    const list = screen.getByRole('listbox', { name: emailEs.a11yMessages })
    fireEvent.keyDown(list, { key: 'Enter' })

    const editor = screen.getByRole('textbox', { name: emailEs.readingDraft })
    fireEvent.change(editor, { target: { value: 'texto editado' } })
    expect(screen.getByText(emailEs.readingDirty)).toBeTruthy()

    fireEvent.keyDown(list, { key: 'Escape' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'Enter' })
    fireEvent.keyDown(list, { key: 'Escape' })
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    fireEvent.keyDown(list, { key: 'Enter' })

    const again = screen.getByRole('textbox', { name: emailEs.readingDraft })
    expect((again as HTMLTextAreaElement).value).toBe('texto editado')
  })

  it('shows the whole snapshot in the approval panel and closes on Escape', () => {
    renderSurface()
    const list = screen.getByRole('listbox', { name: emailEs.a11yMessages })
    fireEvent.keyDown(list, { key: 'Enter' })

    const approve = screen.getByRole('button', { name: emailEs.readingApprove })
    fireEvent.click(approve)

    const dialog = screen.getByRole('dialog', { name: emailEs.approvalTitle })
    expect(within(dialog).getByText('compras@ejemplo.test')).toBeTruthy()
    expect(within(dialog).getByText('jefe@ejemplo.test')).toBeTruthy()
    expect(within(dialog).getByText('auditoria@ejemplo.test')).toBeTruthy()
    expect(within(dialog).getByText('proforma-001.pdf')).toBeTruthy()
    expect(within(dialog).getByText('v1')).toBeTruthy()

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(approve)
  })

  it('starts a message from zero and opens it in the reading pane', () => {
    renderSurface()
    fireEvent.click(screen.getByRole('button', { name: emailEs.toolbarNew }))
    expect(screen.getByRole('heading', { name: emailEs.composeTitle })).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: emailEs.composeTo }), { target: { value: 'nuevo@ejemplo.test' } })
    fireEvent.change(screen.getByRole('textbox', { name: emailEs.composeSubject }), { target: { value: 'Asunto nuevo (sintético)' } })
    fireEvent.change(screen.getByRole('textbox', { name: emailEs.composeBody }), { target: { value: 'Cuerpo nuevo.' } })
    fireEvent.click(screen.getByRole('button', { name: emailEs.composePrepare }))

    expect(screen.getByRole('heading', { name: 'Asunto nuevo (sintético)' })).toBeTruthy()
    const options = within(screen.getByRole('listbox', { name: emailEs.a11yMessages })).getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
  })

  it('says nothing waits for a decision when the list is empty', () => {
    render(<EmailLayout rows={[]} labels={emailEs} />)
    expect(screen.getByText(emailEs.listEmpty)).toBeTruthy()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('paints with the requested look and asks for the other one', () => {
    const onLookChange = vi.fn()
    const { container } = render(
      <EmailLayout rows={rows} labels={emailEs} look="b" onLookChange={onLookChange} />,
    )
    const root = container.querySelector('section')
    expect(root?.classList.contains(lookClassName('b'))).toBe(true)
    expect(root?.classList.contains(lookClassName('a'))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: `${emailEs.lookSwitch}: ${emailEs.lookNames.b}` }))
    expect(onLookChange).toHaveBeenCalledWith('a')
  })

  it('offers no look switch when the surface does not own the choice', () => {
    renderSurface()
    expect(screen.queryByRole('button', { name: new RegExp(emailEs.lookSwitch) })).toBeNull()
  })

  it('takes the proposal or keeps the current version, and stops showing it', () => {
    renderSurface()
    const list = screen.getByRole('listbox', { name: emailEs.a11yMessages })
    fireEvent.keyDown(list, { key: 'Enter' })

    fireEvent.click(screen.getByRole('button', { name: emailEs.proposalUse }))
    const editor = screen.getByRole('textbox', { name: emailEs.readingDraft })
    expect((editor as HTMLTextAreaElement).value).toContain('Cuerpo propuesto por el agente')
    expect(screen.queryByRole('button', { name: emailEs.proposalUse })).toBeNull()

    fireEvent.keyDown(list, { key: 'Escape' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'Enter' })
    fireEvent.keyDown(list, { key: 'Escape' })
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(screen.queryByRole('button', { name: emailEs.proposalKeep })).toBeNull()
  })

  it('keeps the current version and hides the proposal', () => {
    renderSurface()
    const list = screen.getByRole('listbox', { name: emailEs.a11yMessages })
    fireEvent.keyDown(list, { key: 'Enter' })
    const before = screen.getByRole('textbox', { name: emailEs.readingDraft })
    const text = (before as HTMLTextAreaElement).value
    fireEvent.click(screen.getByRole('button', { name: emailEs.proposalKeep }))
    expect(screen.getByRole('textbox', { name: emailEs.readingDraft })).toHaveProperty('value', text)
    expect(screen.queryByRole('button', { name: emailEs.proposalKeep })).toBeNull()
  })

  it('shows loading and error instead of an empty list', () => {
    const retry = vi.fn()
    const { rerender } = render(<EmailLayout rows={rows} labels={emailEs} phase="loading" />)
    expect(screen.getByText(emailEs.loading)).toBeTruthy()
    expect(screen.queryByRole('listbox')).toBeNull()

    rerender(<EmailLayout rows={rows} labels={emailEs} phase="error" onRetry={retry} />)
    expect(screen.getByText(emailEs.errorTitle)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: emailEs.retry }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
