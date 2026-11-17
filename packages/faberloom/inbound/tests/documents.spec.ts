import { describe, expect, it, vi } from 'vitest'
import type { SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { convertAttachments, formatForAttachment, markdownFromAttachments } from '../src/documents.ts'

const bin = '/opt/anydoc/cli.js'

/** A runtime whose one spawn settles with the given exit code and stdout text. */
function runtimeWith(exitCode: number | null, stdout: string): { runtime: SubprocessRuntime; spawn: ReturnType<typeof vi.fn> } {
  const spawn = vi.fn((_spec: SubprocessSpawnSpec) => ({
    collected: { stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) } },
    done: Promise.resolve({ exitCode, signal: null }),
  }))
  return { runtime: { spawn } as unknown as SubprocessRuntime, spawn }
}

/** The spawn spec of the first call, for argv assertions. */
function firstSpec(spawn: ReturnType<typeof vi.fn>): SubprocessSpawnSpec | undefined {
  return (spawn.mock.calls as [SubprocessSpawnSpec][])[0]?.[0]
}

describe('formatForAttachment', () => {
  it('maps supported extensions regardless of case', () => {
    expect(formatForAttachment('pedido.XLSX')).toBe('xlsx')
    expect(formatForAttachment('oferta.pdf')).toBe('pdf')
    expect(formatForAttachment('notas.docx')).toBe('docx')
  })

  it('returns undefined for an unsupported or extensionless name', () => {
    expect(formatForAttachment('foto.png')).toBeUndefined()
    expect(formatForAttachment('LEEME')).toBeUndefined()
  })
})

describe('markdownFromAttachments', () => {
  it('returns nothing for an empty batch without spawning', async () => {
    const { runtime, spawn } = runtimeWith(0, '| a |')
    expect(await markdownFromAttachments([], { runtime, bin, ocr: 'reject', apiKey: '' })).toEqual([])
    expect(spawn).not.toHaveBeenCalled()
  })

  it('skips an unsupported attachment without spawning', async () => {
    const { runtime, spawn } = runtimeWith(0, '| a |')
    const documents = await markdownFromAttachments(
      [{ name: 'escaneo.png', mediaType: 'image/png', contentBase64: 'AA==' }],
      { runtime, bin, ocr: 'reject', apiKey: '' },
    )
    expect(documents).toEqual([])
    expect(spawn).not.toHaveBeenCalled()
  })

  it('converts a supported attachment and names the input by format', async () => {
    const { runtime, spawn } = runtimeWith(0, '| sku | cantidad |\n| --- | --- |\n| 1234 | 1200 |')
    const documents = await markdownFromAttachments(
      [{ name: 'pedido.xlsx', mediaType: 'application/vnd.ms-excel', contentBase64: 'AA==' }],
      { runtime, bin, ocr: 'reject', apiKey: '' },
    )
    expect(documents).toHaveLength(1)
    expect(documents[0]?.name).toBe('pedido.xlsx')
    expect(documents[0]?.markdown).toContain('1234')
    const spec = firstSpec(spawn)
    expect(spec?.argv.slice(0, 3)).toEqual([process.execPath, bin, expect.stringContaining('source')])
    expect(spec?.argv).toEqual(expect.arrayContaining(['--format', 'xlsx']))
    expect(spec?.stdio.stdin).toBe('ignore')
  })

  it('passes hosted OCR and the key only when hosted is requested', async () => {
    const { runtime, spawn } = runtimeWith(0, 'texto')
    await markdownFromAttachments(
      [{ name: 'acta.pdf', mediaType: 'application/pdf', contentBase64: 'AA==' }],
      { runtime, bin, ocr: 'hosted', apiKey: 'fc-secret' },
    )
    expect(firstSpec(spawn)?.argv).toEqual(expect.arrayContaining(['--ocr', 'hosted', '--api-key', 'fc-secret']))
  })

  it('skips a document whose conversion exits non-zero', async () => {
    const documents = await markdownFromAttachments(
      [{ name: 'acta.pdf', mediaType: 'application/pdf', contentBase64: 'AA==' }],
      { runtime: runtimeWith(3, '').runtime, bin, ocr: 'reject', apiKey: '' },
    )
    expect(documents).toEqual([])
  })

  it('converts the rest when one spawn fails', async () => {
    let call = 0
    const spawn = vi.fn(() => {
      call += 1
      if (call === 1) throw new Error('spawn failed')
      return {
        collected: { stdout: { readFrom: () => ({ text: 'ok', nextOffset: 2, lossy: false }) } },
        done: Promise.resolve({ exitCode: 0, signal: null }),
      }
    })
    const runtime = { spawn } as unknown as SubprocessRuntime
    const documents = await markdownFromAttachments(
      [
        { name: 'a.pdf', mediaType: 'application/pdf', contentBase64: 'AA==' },
        { name: 'b.xlsx', mediaType: 'application/vnd.ms-excel', contentBase64: 'AA==' },
      ],
      { runtime, bin, ocr: 'reject', apiKey: '' },
    )
    expect(documents.map(document => document.name)).toEqual(['b.xlsx'])
  })
})

describe('convertAttachments', () => {
  it('names why each attachment carried no text', async () => {
    const conversions = await convertAttachments(
      [
        { name: 'foto.png', mediaType: 'image/png', contentBase64: 'AA==' },
        { name: '', mediaType: 'application/octet-stream', contentBase64: 'AA==' },
        { name: 'pedido.xlsx', mediaType: 'application/vnd.ms-excel', contentBase64: 'AA==' },
      ],
      { runtime: runtimeWith(0, '| a |').runtime, bin, ocr: 'reject', apiKey: '' },
    )

    expect(conversions.map(conversion => conversion.skipped)).toEqual(['unsupported', 'unsupported', null])
    expect(conversions[2]?.markdown).toContain('| a |')
  })

  it('skips an oversized attachment without spawning the converter', async () => {
    const { runtime, spawn } = runtimeWith(0, 'texto')
    const conversions = await convertAttachments(
      [{ name: 'grande.pdf', mediaType: 'application/pdf', contentBase64: Buffer.from('123456789').toString('base64') }],
      { runtime, bin, ocr: 'reject', apiKey: '', maxInputBytes: 4 },
    )

    expect(conversions[0]?.skipped).toBe('oversized')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports a timeout apart from a failed conversion', async () => {
    vi.useFakeTimers()
    try {
      const spawn = vi.fn((spec: SubprocessSpawnSpec) => ({
        collected: {},
        done: new Promise((_resolve, reject) => {
          spec.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
        }),
      }))
      const pending = convertAttachments(
        [{ name: 'lento.pdf', mediaType: 'application/pdf', contentBase64: 'AA==' }],
        { runtime: { spawn } as unknown as SubprocessRuntime, bin, ocr: 'reject', apiKey: '' },
      )
      await vi.advanceTimersByTimeAsync(20_000)
      const conversions = await pending
      expect(conversions[0]?.skipped).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('separates a non-zero exit from an empty conversion', async () => {
    const failed = await convertAttachments(
      [{ name: 'acta.pdf', mediaType: 'application/pdf', contentBase64: 'AA==' }],
      { runtime: runtimeWith(2, 'parcial').runtime, bin, ocr: 'reject', apiKey: '' },
    )
    const empty = await convertAttachments(
      [{ name: 'acta.pdf', mediaType: 'application/pdf', contentBase64: 'AA==' }],
      { runtime: runtimeWith(0, '   ').runtime, bin, ocr: 'reject', apiKey: '' },
    )

    expect(failed[0]?.skipped).toBe('failed')
    expect(empty[0]?.skipped).toBe('empty')
  })

  it('says the converter is missing instead of pretending the file is empty', async () => {
    const conversions = await convertAttachments(
      [{ name: 'acta.pdf', mediaType: 'application/pdf', contentBase64: 'AA==' }],
      { runtime: runtimeWith(0, 'texto').runtime, bin: '', ocr: 'reject', apiKey: '' },
    )
    expect(conversions[0]?.skipped).toBe('converter-missing')
  })
})
