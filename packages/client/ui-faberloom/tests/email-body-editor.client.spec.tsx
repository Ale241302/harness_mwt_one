// @vitest-environment jsdom
/**
 * The compose body editor: authored markup enters the region, typing and toolbar
 * commands leave as markup plus plain text, pasted files go to the panel, and
 * the sender's signature stays exactly one block at the end of the body.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  EmailBodyEditor,
  type EmailBodyEditorLabels,
  type EmailBodyEditorProps,
} from '../src/client/email-body-editor.tsx'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(document, 'execCommand')
})

const labels: EmailBodyEditorLabels = {
  body: 'Cuerpo del mensaje',
  placeholder: 'Escribe tu mensaje',
  bold: 'Negrita',
  italic: 'Cursiva',
  underline: 'Subrayado',
  colour: 'Color del texto',
  alignLeft: 'Alinear a la izquierda',
  alignCentre: 'Centrar',
  alignRight: 'Alinear a la derecha',
  bulletList: 'Lista con viñetas',
  numberList: 'Lista numerada',
  code: 'Código',
  quote: 'Cita',
  clear: 'Borrar formato',
}

/** Sanitized signature markup, as the account settings hand it to the panel. */
const signature = '<p>Ana Solano</p><p>Muito Work</p>'

/** The panel's wiring, with no signature and an empty body unless a case says otherwise. */
function props(overrides: Partial<EmailBodyEditorProps> = {}): EmailBodyEditorProps {
  return {
    html: '',
    signatureHtml: null,
    signatureKey: 'ana@muitowork.example',
    labels,
    onChange: () => {},
    onPasteFiles: () => {},
    ...overrides,
  }
}

/** Render the editor and hand back its editing region and the render result. */
function renderEditor(overrides: Partial<EmailBodyEditorProps> = {}) {
  const view = render(<EmailBodyEditor {...props(overrides)} />)
  return { region: screen.getByRole('textbox', { name: labels.body }), view }
}

/** Record the platform editing commands; jsdom ships none. */
function stubExecCommand() {
  const exec = vi.fn(() => true)
  Object.defineProperty(document, 'execCommand', { configurable: true, writable: true, value: exec })
  return exec
}

describe('the editing region', () => {
  it('shows the authored markup and the placeholder hint', () => {
    const { region } = renderEditor({ html: '<p>Hola <b>cliente</b></p>' })

    expect(region.innerHTML).toBe('<p>Hola <b>cliente</b></p>')
    expect(region.getAttribute('data-placeholder')).toBe(labels.placeholder)
    expect(region.getAttribute('aria-multiline')).toBe('true')
    expect(region.getAttribute('contenteditable')).toBe('true')
  })

  it('publishes the markup and the plain text after every edit', () => {
    const onChange = vi.fn()
    const { region } = renderEditor({ onChange })
    // Mounting an empty body with no signature changes nothing the panel must store.
    expect(onChange).not.toHaveBeenCalled()

    region.textContent = 'Hola cliente'
    fireEvent.input(region)

    expect(onChange).toHaveBeenCalledWith({ html: 'Hola cliente', text: 'Hola cliente' })
  })

  it('prefers the innerText an engine generates over the raw text content', () => {
    const onChange = vi.fn()
    const { region } = renderEditor({ onChange })
    region.textContent = 'Hola cliente'
    Object.defineProperty(region, 'innerText', { configurable: true, value: 'Hola\ncliente' })

    fireEvent.input(region)

    expect(onChange).toHaveBeenCalledWith({ html: 'Hola cliente', text: 'Hola\ncliente' })
  })

  it('stores no markup when the owner deletes everything', () => {
    const onChange = vi.fn()
    const { region } = renderEditor({ html: '<p>Hola</p>', onChange })
    onChange.mockClear()

    // An emptied editing region keeps a placeholder break; a draft must not.
    region.innerHTML = '<br>'
    fireEvent.input(region)

    expect(onChange).toHaveBeenCalledWith({ html: '', text: '' })
  })
})

describe('the formatting toolbar', () => {
  const commands: ReadonlyArray<readonly [string, string, string?]> = [
    [labels.bold, 'bold'],
    [labels.italic, 'italic'],
    [labels.underline, 'underline'],
    [labels.alignLeft, 'justifyLeft'],
    [labels.alignCentre, 'justifyCenter'],
    [labels.alignRight, 'justifyRight'],
    [labels.bulletList, 'insertUnorderedList'],
    [labels.numberList, 'insertOrderedList'],
    [labels.code, 'formatBlock', 'pre'],
    [labels.quote, 'formatBlock', 'blockquote'],
    [labels.clear, 'removeFormat'],
  ]

  it('runs each documented command and republishes the result', () => {
    const exec = stubExecCommand()
    const onChange = vi.fn()
    renderEditor({ html: '<p>Hola</p>', onChange })

    for (const [name, command, value] of commands) {
      exec.mockClear()
      onChange.mockClear()
      fireEvent.click(screen.getByRole('button', { name }))

      expect(exec).toHaveBeenCalledWith(command, false, value)
      expect(onChange).toHaveBeenCalledWith({ html: '<p>Hola</p>', text: 'Hola' })
    }
  })

  it('keeps the caret by cancelling the press that would move it', () => {
    const exec = stubExecCommand()
    renderEditor()

    // A cancelled mousedown leaves the selection in the region the command edits.
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: labels.bold }))).toBe(false)
    expect(exec).not.toHaveBeenCalled()
  })

  it('applies the colour chosen in the native picker', () => {
    const exec = stubExecCommand()
    const { view } = renderEditor()
    const picker = view.container.querySelector('input[type="color"]')
    expect(picker).not.toBeNull()
    expect((picker as HTMLInputElement).value).toBe('#b4232a')

    // The button is the keyboard route to a picker that is itself out of the tab order.
    const colour = screen.getByRole('button', { name: labels.colour })
    expect(fireEvent.mouseDown(colour)).toBe(false)
    fireEvent.click(colour)
    fireEvent.change(picker as HTMLInputElement, { target: { value: '#1f6feb' } })

    expect(exec).toHaveBeenCalledWith('foreColor', false, '#1f6feb')
  })

  it('stays usable on a host without editing commands', () => {
    const onChange = vi.fn()
    renderEditor({ html: '<p>Hola</p>', onChange })

    expect(() => { fireEvent.click(screen.getByRole('button', { name: labels.bold })) }).not.toThrow()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('paste', () => {
  it('hands pasted files to the panel and blocks the text paste', () => {
    const onPasteFiles = vi.fn()
    const { region } = renderEditor({ onPasteFiles })
    const file = new File(['hola'], 'nota.txt', { type: 'text/plain' })

    const accepted = fireEvent.paste(region, { clipboardData: { files: [file], getData: () => '<b>texto</b>' } })

    expect(accepted).toBe(false)
    expect(onPasteFiles).toHaveBeenCalledWith([file])
  })

  it('inserts only the plain text of a pasted fragment', () => {
    const exec = stubExecCommand()
    const onChange = vi.fn()
    const { region } = renderEditor({ onChange })

    const accepted = fireEvent.paste(region, { clipboardData: { files: [], getData: () => 'texto pegado' } })

    expect(accepted).toBe(false)
    expect(exec).toHaveBeenCalledWith('insertText', false, 'texto pegado')
    expect(onChange).toHaveBeenCalledWith({ html: '', text: '' })
  })

  it('leaves the browser paste alone when the host has no editing commands', () => {
    const onChange = vi.fn()
    const { region } = renderEditor({ onChange })

    const accepted = fireEvent.paste(region, { clipboardData: { files: [], getData: () => 'texto' } })

    expect(accepted).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('the signature block', () => {
  it('appends the sender signature once, after the authored body', () => {
    const onChange = vi.fn()
    const { region, view } = renderEditor({ html: '<p>Hola</p>', signatureHtml: signature, onChange })
    const blocks = view.container.querySelectorAll('[data-email-signature]')

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.innerHTML).toBe(signature)
    expect(region.lastElementChild?.getAttribute('data-email-signature')).toBe('1')
    expect(onChange).toHaveBeenCalledWith({ html: region.innerHTML, text: region.textContent })
  })

  it('never stacks a second block on a body that already carries one', () => {
    const onChange = vi.fn()
    const authored = `<p>Hola</p><div data-email-signature="1">${signature}</div>`
    const { region, view } = renderEditor({ html: authored, signatureHtml: signature, onChange })

    expect(view.container.querySelectorAll('[data-email-signature]')).toHaveLength(1)
    // The markup already agreed with the account, so the mount publishes nothing.
    expect(onChange).not.toHaveBeenCalled()
    expect(region.innerHTML).toBe(authored)
  })

  it('stays single when the panel re-renders the same account', () => {
    const onChange = vi.fn()
    const { view } = renderEditor({ html: '<p>Hola</p>', signatureHtml: signature, onChange })
    onChange.mockClear()

    view.rerender(<EmailBodyEditor {...props({ html: '<p>Hola</p>', signatureHtml: signature, onChange })} />)

    expect(view.container.querySelectorAll('[data-email-signature]')).toHaveLength(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('swaps the signature in place when the sending account changes', () => {
    const onChange = vi.fn()
    const { view } = renderEditor({ html: '<p>Hola</p>', signatureHtml: signature, onChange })
    onChange.mockClear()

    view.rerender(<EmailBodyEditor {...props({
      html: '<p>Hola</p>',
      signatureHtml: '<p>Luis Vega</p>',
      signatureKey: 'luis@muitowork.example',
      onChange,
    })} />)

    const blocks = view.container.querySelectorAll('[data-email-signature]')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.innerHTML).toBe('<p>Luis Vega</p>')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('appends the signature when the next account has one', () => {
    const onChange = vi.fn()
    const { view } = renderEditor({ html: '<p>Hola</p>', onChange })

    view.rerender(<EmailBodyEditor {...props({
      html: '<p>Hola</p>',
      signatureHtml: signature,
      signatureKey: 'luis@muitowork.example',
      onChange,
    })} />)

    expect(view.container.querySelectorAll('[data-email-signature]')).toHaveLength(1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('drops the signature when the next account has none', () => {
    const onChange = vi.fn()
    const { view, region } = renderEditor({ html: '<p>Hola</p>', signatureHtml: signature, onChange })
    onChange.mockClear()

    view.rerender(<EmailBodyEditor {...props({
      html: '<p>Hola</p>',
      signatureKey: 'luis@muitowork.example',
      onChange,
    })} />)

    expect(view.container.querySelectorAll('[data-email-signature]')).toHaveLength(0)
    expect(region.innerHTML).toBe('<p>Hola</p>')
    expect(onChange).toHaveBeenCalledWith({ html: '<p>Hola</p>', text: 'Hola' })
  })

  it('keeps the body as it stands when neither account has one', () => {
    const onChange = vi.fn()
    const { view, region } = renderEditor({ html: '<p>Hola</p>', onChange })
    onChange.mockClear()

    view.rerender(<EmailBodyEditor {...props({
      html: '<p>Hola</p>',
      signatureKey: 'luis@muitowork.example',
      onChange,
    })} />)

    expect(region.innerHTML).toBe('<p>Hola</p>')
    expect(onChange).toHaveBeenCalledWith({ html: '<p>Hola</p>', text: 'Hola' })
  })
})

describe('external markup', () => {
  it('reloads the region and republishes it when the prop changes', () => {
    const onChange = vi.fn()
    const { view, region } = renderEditor({ html: '<p>borrador</p>', onChange })

    view.rerender(<EmailBodyEditor {...props({
      html: '<p class="lead">Redactado por el asistente</p><blockquote>cita</blockquote>',
      onChange,
    })} />)

    expect(region.innerHTML).toBe('<p class="lead">Redactado por el asistente</p><blockquote>cita</blockquote>')
    expect(onChange).toHaveBeenCalledWith({ html: region.innerHTML, text: region.textContent })
  })

  it('keeps the signature of the account when a reload omits it', () => {
    const onChange = vi.fn()
    const { view } = renderEditor({ html: '<p>borrador</p>', signatureHtml: signature, onChange })
    onChange.mockClear()

    view.rerender(<EmailBodyEditor {...props({ html: '<p>dos</p>', signatureHtml: signature, onChange })} />)

    const blocks = view.container.querySelectorAll('[data-email-signature]')
    expect(blocks).toHaveLength(1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('leaves the region alone while the prop still matches what it acted on', () => {
    const onChange = vi.fn()
    const { view, region } = renderEditor({ html: '<p>borrador</p>', onChange })
    region.textContent = 'texto escrito'
    onChange.mockClear()

    view.rerender(<EmailBodyEditor {...props({ html: '<p>borrador</p>', onChange })} />)

    expect(region.textContent).toBe('texto escrito')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not reload when the prop echoes the markup the editor emitted', () => {
    const onChange = vi.fn()
    const { view, region } = renderEditor({ html: '<p>borrador</p>', onChange })
    region.innerHTML = '<p>editado</p>'
    fireEvent.input(region)
    onChange.mockClear()

    view.rerender(<EmailBodyEditor {...props({ html: '<p>editado</p>', onChange })} />)

    expect(region.innerHTML).toBe('<p>editado</p>')
    expect(onChange).not.toHaveBeenCalled()
  })
})
