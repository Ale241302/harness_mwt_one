/**
 * HTML signature rules: what the sanitizer keeps, the plain-text fallback, the
 * alternative built from an approved body, and the inline-image extraction.
 */
import { describe, expect, it } from 'vitest'
import {
  extractInlineImages, messageHtml, plainTextFromHtml, sanitizeSignatureHtml, SIGNATURE_HTML_MAX_CHARS,
  SIGNATURE_INLINE_IMAGE_LIMIT,
} from '../src/signature.ts'

const SIGNATURE = { text: 'Álvaro\nCEO', html: '<p><strong>Álvaro</strong><br>CEO</p>' }

describe('sanitizeSignatureHtml', () => {
  it('keeps styling and drops scripts, embedded documents, handlers, and script URLs', () => {
    expect(sanitizeSignatureHtml(
      '<p style="color:#123" onmouseover="x()"><strong>Álvaro</strong></p>'
      + '<script>alert(1)</script><iframe src="https://x"></iframe>'
      + '<a href="javascript:alert(1)">a</a><img src="https://x/logo.png">',
    )).toBe('<p style="color:#123"><strong>Álvaro</strong></p><a>a</a><img src="https://x/logo.png">')
  })

  it('drops an unclosed script tag and single-quoted handlers', () => {
    expect(sanitizeSignatureHtml("<p onload='x()'>a</p><script src=x>")).toBe('<p>a</p>')
  })

  it('caps the stored body', () => {
    expect(sanitizeSignatureHtml('x'.repeat(SIGNATURE_HTML_MAX_CHARS + 10))).toHaveLength(SIGNATURE_HTML_MAX_CHARS)
  })
})

describe('plainTextFromHtml', () => {
  it('turns block ends into line breaks and decodes the entities a signature uses', () => {
    expect(plainTextFromHtml('<p>Álvaro&nbsp;&amp;&nbsp;hijo</p><p>CEO</p><div>503</div>'))
      .toBe('Álvaro & hijo\nCEO\n503')
  })

  it('collapses runs of blank lines and trailing spaces', () => {
    expect(plainTextFromHtml('<p>uno  </p><p></p><p></p><p>dos</p>')).toBe('uno\n\ndos')
  })
})

describe('messageHtml', () => {
  it('builds paragraphs for the written body and appends the signature', () => {
    expect(messageHtml('Hola,\nva la proforma.\n\nSaludos.\n\nÁlvaro\nCEO', SIGNATURE))
      .toBe('<div><p>Hola,<br>va la proforma.</p><p>Saludos.</p><p><strong>Álvaro</strong><br>CEO</p></div>')
  })

  it('keeps a body that no longer carries the stored signature as plain text', () => {
    expect(messageHtml('Hola,\nreescribí la firma a mano.', SIGNATURE)).toBeNull()
  })

  it('sends the signature alone when the body is only the signature', () => {
    expect(messageHtml('Álvaro\nCEO', SIGNATURE)).toBe('<div><p><strong>Álvaro</strong><br>CEO</p></div>')
  })

  it('escapes markup the owner typed into the plain-text body', () => {
    expect(messageHtml('Ojo con <b>esto</b>.\n\nÁlvaro\nCEO', SIGNATURE))
      .toBe('<div><p>Ojo con &lt;b&gt;esto&lt;/b&gt;.</p><p><strong>Álvaro</strong><br>CEO</p></div>')
  })

  it('has no HTML part without markup or without a plain signature', () => {
    expect(messageHtml('Álvaro\nCEO', { text: 'Álvaro\nCEO', html: '' })).toBeNull()
    expect(messageHtml('Cuerpo', { text: '  ', html: '<p>x</p>' })).toBeNull()
  })
})

describe('extractInlineImages', () => {
  it('moves data images into related parts and keeps their markup position', () => {
    let n = 0
    const result = extractInlineImages(
      '<p><img src="data:image/png;base64,aGVsbG8=" alt="logo"></p>',
      () => `id-${String(++n)}`,
    )
    expect(result.html).toBe('<p><img src="cid:id-1" alt="logo"></p>')
    expect(result.images).toEqual([{ id: 'id-1', mediaType: 'image/png', contentBase64: 'aGVsbG8=' }])
  })

  it('leaves an image over the inline limit as a data URL', () => {
    const payload = 'a'.repeat(SIGNATURE_INLINE_IMAGE_LIMIT + 4)
    const result = extractInlineImages(`<img src="data:image/gif;base64,${payload}">`, () => 'id')
    expect(result.images).toEqual([])
    expect(result.html).toContain('data:image/gif;base64,')
  })
})
