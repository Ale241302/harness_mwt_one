// @vitest-environment jsdom
/**
 * The assistant answer renderer keeps the mail panel self-contained: headings,
 * emphasis, code, and both list kinds become real elements, and consecutive
 * prose lines stay one paragraph.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantMarkdown } from '../src/client/assistant-markdown.tsx'

afterEach(cleanup)

describe('assistant markdown', () => {
  it('renders headings, emphasis, code, and both list kinds', () => {
    const { container } = render(
      <AssistantMarkdown text={[
        '## Resumen del correo',
        '',
        '**Quién lo envía:** Cyberfuel con `factura.pdf`.',
        '',
        '- Primer punto',
        '- Segundo punto',
        '',
        '1. Primer paso',
        '2. Segundo paso',
        '',
        'Texto con *énfasis* y cierre.',
      ].join('\n')} />,
    )
    expect(screen.getByText('Resumen del correo')).toBeTruthy()
    expect(screen.getByText('Quién lo envía:')).toBeTruthy()
    expect(screen.getByText('factura.pdf').tagName).toBe('CODE')
    expect(screen.getByText('énfasis').tagName).toBe('EM')
    expect(container.querySelectorAll('ul > li')).toHaveLength(2)
    expect(container.querySelectorAll('ol > li')).toHaveLength(2)
  })

  it('keeps consecutive prose lines in one paragraph', () => {
    const { container } = render(<AssistantMarkdown text={'Primera línea\nSegunda línea\n\nPárrafo aparte.'} />)
    expect(container.querySelectorAll('p')).toHaveLength(2)
    expect(container.textContent).toContain('Primera línea Segunda línea')
  })

  it('renders an empty answer without blocks', () => {
    const { container } = render(<AssistantMarkdown text={'  \n'} />)
    expect(container.querySelectorAll('p, ul, ol')).toHaveLength(0)
  })
})
