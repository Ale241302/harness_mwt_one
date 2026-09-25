import { describe, expect, it } from 'vitest'
import { decodeBodyText, decodeMimeWords, decodeQuotedPrintable, parseMessage } from '../src/imap.ts'

describe('imap MIME parsing', () => {
  it('picks the HTML part and lists a base64 attachment', () => {
    const pdf = Buffer.from('%PDF-1.4 hola', 'utf8')
    const raw = [
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="B"',
      '',
      '--B',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('<p>Hola</p>', 'utf8').toString('base64'),
      '--B',
      'Content-Type: application/pdf; name="f.pdf"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="f.pdf"',
      '',
      pdf.toString('base64'),
      '--B--',
    ].join('\r\n')

    const content = parseMessage(raw)
    expect(content.html).toBe('<p>Hola</p>')
    expect(content.attachments).toHaveLength(1)
    expect(content.attachments[0]).toMatchObject({ name: 'f.pdf', mediaType: 'application/pdf', size: pdf.length })
    expect(content.attachments[0]?.contentBase64).toBe(pdf.toString('base64'))
  })

  it('decodes a quoted-printable plain-text part', () => {
    const raw = [
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Hola =C3=A9',
    ].join('\r\n')
    expect(parseMessage(raw).text).toBe('Hola é')
  })

  it('decodes a non-UTF-8 charset from the Content-Type header', () => {
    const raw = [
      'Content-Type: text/plain; charset=iso-8859-1',
      'Content-Transfer-Encoding: 8bit',
      '',
      `Buen d${String.fromCharCode(0xed)}a`,
    ].join('\r\n')
    expect(parseMessage(raw).text).toBe('Buen día')
  })

  it('reads windows-1252 bytes the way a mail client does', () => {
    const raw = [
      'Content-Type: text/plain; charset=windows-1252',
      '',
      `Total ${String.fromCharCode(0x80)} 10`,
    ].join('\r\n')
    expect(parseMessage(raw).text).toBe('Total € 10')
  })
})

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
