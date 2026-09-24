import { describe, expect, it } from 'vitest'
import { decodeBodyText, decodeMimeWords, decodeQuotedPrintable } from '../src/imap.ts'

describe('imap header decoding', () => {
  it('decodes Q-encoded and B-encoded words', () => {
    expect(decodeMimeWords('=?UTF-8?q?Matr=C3=ADcula?=')).toBe('Matrícula')
    const base64 = Buffer.from('Educación!', 'utf8').toString('base64')
    expect(decodeMimeWords(`=?utf-8?B?${base64}?=`)).toBe('Educación!')
  })

  it('decodes a name beside an address', () => {
    expect(decodeMimeWords('=?UTF-8?q?Escuela_de_Ciencias?= <a@b.cr>')).toBe('Escuela de Ciencias <a@b.cr>')
  })
})

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
