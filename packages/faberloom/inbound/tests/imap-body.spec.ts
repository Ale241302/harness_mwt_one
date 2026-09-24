import { describe, expect, it } from 'vitest'
import { decodeBodyText, decodeQuotedPrintable } from '../src/imap.ts'

describe('imap body decoding', () => {
  it('decodes a base64 body and drops the trailing fetch paren', () => {
    const encoded = Buffer.from('Hola mundo', 'utf8').toString('base64')
    expect(decodeBodyText(`${encoded}\n)`)).toBe('Hola mundo')
  })

  it('decodes quoted-printable soft breaks and hex escapes byte by byte', () => {
    expect(decodeQuotedPrintable('Hola =\r\nmundo')).toBe('Hola mundo')
    // UTF-8 bytes decode one octet at a time; multibyte stays as two code points.
    expect(decodeQuotedPrintable('caf=C3=A9')).toBe('caf\u00c3\u00a9')
  })

  it('keeps plain text as-is', () => {
    expect(decodeBodyText('Linea 1\nLinea 2\n)')).toBe('Linea 1\nLinea 2')
  })
})
