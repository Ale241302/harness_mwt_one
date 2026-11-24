/**
 * The markup the composer assembles itself: a plain-text body, the quote a reply
 * answers, and the block a forward carries. Every value that comes from a
 * message must travel as text, never as markup.
 */
import { describe, expect, it } from 'vitest'
import { forwardQuoteHtml, replyQuoteHtml, textHtml } from '../src/client/mail-compose-html.ts'

describe('textHtml', () => {
  it('splits blank lines into paragraphs and keeps single breaks', () => {
    expect(textHtml('Hola\ncliente.\n\nTotal 23.780')).toBe('<p>Hola<br>cliente.</p><p>Total 23.780</p>')
  })

  it('normalizes CRLF and drops empty paragraphs', () => {
    expect(textHtml('uno\r\n\r\n\r\n\r\ndos')).toBe('<p>uno</p><p>dos</p>')
    expect(textHtml('\n\n')).toBe('')
    expect(textHtml('')).toBe('')
  })

  it('escapes markup so a body can never carry elements of its own', () => {
    expect(textHtml('<b>no</b> & "comillas"'))
      .toBe('<p>&lt;b&gt;no&lt;/b&gt; &amp; &quot;comillas&quot;</p>')
  })
})

describe('replyQuoteHtml', () => {
  it('writes the attribution then quotes the answered body', () => {
    const html = replyQuoteHtml('El 20 nov, Ana escribió:', 'Precio 100\n\nEntrega lunes')

    expect(html).toContain('<p>El 20 nov, Ana escribió:</p>')
    expect(html).toContain('<blockquote style="margin:0 0 0 12px')
    expect(html).toContain('<p>Precio 100</p><p>Entrega lunes</p>')
  })

  it('escapes both the attribution and the quoted text', () => {
    const html = replyQuoteHtml('Ana <ana@ejemplo.com>', '<script>alert(1)</script>')

    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Ana &lt;ana@ejemplo.com&gt;')
  })
})

describe('forwardQuoteHtml', () => {
  it('writes the header, the envelope and the forwarded body', () => {
    const html = forwardQuoteHtml('---------- Mensaje reenviado ----------', [
      'De: Ana <ana@ejemplo.com>',
      'Para: Álvaro',
      'Asunto: Pedido',
      'Fecha: 20 nov 2026',
    ], 'Adjunto el pedido.')

    expect(html).toContain('<p>---------- Mensaje reenviado ----------</p>')
    expect(html).toContain('<p>De: Ana &lt;ana@ejemplo.com&gt;<br>Para: Álvaro')
    expect(html).toContain('<blockquote')
    expect(html).toContain('<p>Adjunto el pedido.</p>')
  })

  it('keeps the header meaningful when the envelope is missing', () => {
    const html = forwardQuoteHtml('Reenviado', ['', '   '], 'Cuerpo')

    expect(html).toBe('<p>Reenviado</p><blockquote style="margin:0 0 0 12px;padding-left:12px;border-left:2px solid #d4d4d4;color:#4a4a4a"><p>Cuerpo</p></blockquote>')
  })
})
