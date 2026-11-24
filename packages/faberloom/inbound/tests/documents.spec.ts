import { writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { convertAttachments, formatForAttachment, imageMediaType, markdownFromAttachments, resolveOcrMode, type DocumentIngestOptions } from '../src/documents.ts'

const bin = '/opt/anydoc/cli.js'

/** One scripted converter reply. */
interface Reply {
  /** Exit code, or null for a signal death. */
  readonly exitCode: number | null
  /** Text the converter wrote to stdout. */
  readonly stdout?: string
}

/** What the fake execution world answers besides the converter. */
interface World {
  /** Converter replies in call order; the last one repeats. */
  readonly anydoc?: readonly Reply[]
  /** Tesseract stdout per call, in order. */
  readonly tesseract?: readonly string[]
  /** Pages `pdftoppm` renders for a PDF. */
  readonly pages?: number
  /** Exit code the fake Tesseract returns. */
  readonly tesseractExit?: number
  /** Resolvable executables; every other name is absent. */
  readonly available?: readonly string[]
}

/**
 * A runtime with a converter script, a fake Tesseract, and a fake renderer.
 * `resolveExecutable` answers from `available`, so a world without the OCR
 * binaries behaves like the slim image.
 */
function fakeWorld(options: World = {}) {
  let anydocCalls = 0
  let tesseractCalls = 0
  const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
    const program = spec.argv[0] ?? ''
    if (spec.argv.includes(bin)) {
      const replies: readonly Reply[] = options.anydoc ?? [{ exitCode: 0, stdout: '' }]
      const reply = replies[Math.min(anydocCalls, replies.length - 1)]
      anydocCalls += 1
      return settled(spec, reply?.exitCode ?? 0, reply?.stdout ?? '')
    }
    if (program.endsWith('pdftoppm')) {
      const prefix = spec.argv[spec.argv.length - 1] ?? ''
      for (let page = 1; page <= (options.pages ?? 0); page += 1) writeFileSync(`${prefix}-${page}.png`, Buffer.from([0x89]))
      return settled(spec, 0, '')
    }
    const replies: readonly string[] = options.tesseract ?? []
    const text = replies[tesseractCalls] ?? ''
    tesseractCalls += 1
    return settled(spec, options.tesseractExit ?? 0, text)
  })
  const resolveExecutable = vi.fn(async (command: string) => {
    const available = options.available ?? ['tesseract', 'pdftoppm']
    if (!available.includes(command)) throw new Error(`${command}: not found`)
    return `/usr/bin/${command}`
  })
  return { runtime: { spawn, resolveExecutable } as unknown as SubprocessRuntime, spawn }
}

/** A batch-mode handle that settles at once. */
function settled(spec: SubprocessSpawnSpec, exitCode: number | null, stdout: string) {
  const stdin = spec.stdio.stdin === 'pipe' ? { on: () => {}, end: () => {} } : undefined
  return {
    stdin,
    collected: { stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) } },
    done: Promise.resolve({ exitCode, signal: null }),
  }
}

/** The spawn spec of the first call, for argv assertions. */
function firstSpec(spawn: ReturnType<typeof vi.fn>): SubprocessSpawnSpec | undefined {
  return (spawn.mock.calls as [SubprocessSpawnSpec][])[0]?.[0]
}

/** Converter options for one batch. */
function ingest(runtime: SubprocessRuntime, overrides: Partial<DocumentIngestOptions> = {}): DocumentIngestOptions {
  return { runtime, bin, ocr: 'off', apiKey: '', ...overrides }
}

describe('formatForAttachment', () => {
  it('maps supported extensions regardless of case', () => {
    expect(formatForAttachment('pedido.XLSX')).toBe('xlsx')
    expect(formatForAttachment('oferta.pdf')).toBe('pdf')
    expect(formatForAttachment('notas.docx')).toBe('docx')
  })

  it('returns undefined for a file the converter cannot read', () => {
    expect(formatForAttachment('LEEME')).toBeUndefined()
    expect(formatForAttachment('foto.png')).toBeUndefined()
  })
})

describe('imageMediaType', () => {
  it('recognises a raster image by extension, whatever the declared type', () => {
    expect(imageMediaType('foto.JPG', 'application/octet-stream')).toBe('image/jpeg')
    expect(imageMediaType('lista.png', 'application/pdf')).toBe('image/png')
  })

  it('falls back to the declared type when the name carries no usable extension', () => {
    expect(imageMediaType('adjunto', 'image/png')).toBe('image/png')
    expect(imageMediaType('inline', 'IMAGE/JPEG; name=x.jpg')).toBe('image/jpeg')
  })

  it('leaves documents, archives, and vectors alone', () => {
    expect(imageMediaType('pedido.pdf', 'application/pdf')).toBeUndefined()
    expect(imageMediaType('logo.svg', 'image/svg+xml')).toBeUndefined()
    expect(imageMediaType('LEEME', 'text/plain')).toBeUndefined()
  })
})

describe('resolveOcrMode', () => {
  it('prefers the explicit mode over the legacy converter variable', () => {
    expect(resolveOcrMode('off', 'local')).toBe('off')
    expect(resolveOcrMode('hosted', 'reject')).toBe('hosted')
  })

  it('accepts the modes the deployed gateway forwards as anydocOcr', () => {
    expect(resolveOcrMode(undefined, 'local')).toBe('local')
    expect(resolveOcrMode(undefined, 'hosted')).toBe('hosted')
    expect(resolveOcrMode(undefined, 'reject')).toBe('off')
    expect(resolveOcrMode(undefined, undefined)).toBe('off')
  })
})

describe('markdownFromAttachments', () => {
  it('returns nothing for an empty batch without spawning', async () => {
    const { runtime, spawn } = fakeWorld({ anydoc: [{ exitCode: 0, stdout: '| a |' }] })
    expect(await markdownFromAttachments([], ingest(runtime))).toEqual([])
    expect(spawn).not.toHaveBeenCalled()
  })

  it('skips a file no converter reads without spawning', async () => {
    const { runtime, spawn } = fakeWorld({ anydoc: [{ exitCode: 0, stdout: '| a |' }] })
    const documents = await markdownFromAttachments(
      [{ name: 'LEEME', mediaType: 'text/plain', contentBase64: 'AA==' }],
      ingest(runtime),
    )
    expect(documents).toEqual([])
    expect(spawn).not.toHaveBeenCalled()
  })

  it('converts a supported attachment and names the input by format', async () => {
    const { runtime, spawn } = fakeWorld({ anydoc: [{ exitCode: 0, stdout: '| sku | cantidad |\n| --- | --- |\n| 1234 | 1200 |' }] })
    const documents = await markdownFromAttachments(
      [{ name: 'pedido.xlsx', mediaType: 'application/vnd.ms-excel', contentBase64: 'AA==' }],
      ingest(runtime),
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
    const { runtime, spawn } = fakeWorld({ anydoc: [{ exitCode: 0, stdout: 'texto' }] })
    await markdownFromAttachments(
      [{ name: 'acta.pdf', mediaType: 'application/pdf', contentBase64: 'AA==' }],
      ingest(runtime, { ocr: 'hosted', apiKey: 'fc-secret' }),
    )
    expect(firstSpec(spawn)?.argv).toEqual(expect.arrayContaining(['--ocr', 'hosted', '--api-key', 'fc-secret']))
  })

  it('skips a document whose conversion exits non-zero', async () => {
    const { runtime } = fakeWorld({ anydoc: [{ exitCode: 3 }] })
    const documents = await markdownFromAttachments(
      [{ name: 'acta.pdf', mediaType: 'application/pdf', contentBase64: 'AA==' }],
      ingest(runtime),
    )
    expect(documents).toEqual([])
  })

  it('converts the rest when one spawn fails', async () => {
    let call = 0
    const spawn = vi.fn(() => {
      call += 1
      if (call === 1) throw new Error('spawn failed')
      return settled({ stdio: { stdin: 'ignore' } } as SubprocessSpawnSpec, 0, 'ok')
    })
    const runtime = { spawn, resolveExecutable: async () => '/usr/bin/tesseract' } as unknown as SubprocessRuntime
    const documents = await markdownFromAttachments(
      [
        { name: 'a.pdf', mediaType: 'application/pdf', contentBase64: 'AA==' },
        { name: 'b.xlsx', mediaType: 'application/vnd.ms-excel', contentBase64: 'AA==' },
      ],
      ingest(runtime),
    )
    expect(documents.map(document => document.name)).toEqual(['b.xlsx'])
  })
})

describe('images', () => {
  const photo = (name = 'lista.png', mediaType = 'image/png') => ({
    name,
    mediaType,
    contentBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
  })

  it('reads a photo of a list with local OCR', async () => {
    const { runtime, spawn } = fakeWorld({ tesseract: ['SKU 515007019 10 337,70'] })
    const documents = await markdownFromAttachments([photo()], ingest(runtime, { ocr: 'local' }))

    expect(documents).toEqual([{ name: 'lista.png', markdown: 'SKU 515007019 10 337,70' }])
    expect(firstSpec(spawn)?.argv[0]).toBe('/usr/bin/tesseract')
  })

  it('names the switched-off OCR instead of the file format', async () => {
    const { runtime, spawn } = fakeWorld()
    const conversions = await convertAttachments([photo()], ingest(runtime))
    expect(conversions).toEqual([{ name: 'lista.png', markdown: '', skipped: 'ocr-disabled' }])
    expect(spawn).not.toHaveBeenCalled()
  })

  it('does not send an image to the hosted converter either', async () => {
    const { runtime, spawn } = fakeWorld()
    const conversions = await convertAttachments([photo()], ingest(runtime, { ocr: 'hosted' }))
    expect(conversions[0]?.skipped).toBe('ocr-disabled')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports a missing tesseract as a missing converter', async () => {
    const { runtime, spawn } = fakeWorld({ available: [] })
    const conversions = await convertAttachments([photo()], ingest(runtime, { ocr: 'local' }))
    expect(conversions[0]?.skipped).toBe('converter-missing')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports an image OCR read as empty when the page carries no text', async () => {
    const { runtime } = fakeWorld({ tesseract: ['   '] })
    const conversions = await convertAttachments([photo()], ingest(runtime, { ocr: 'local' }))
    expect(conversions[0]?.skipped).toBe('empty')
  })

  it('reports an OCR process that failed as ocr-failed', async () => {
    const { runtime } = fakeWorld({ tesseract: ['texto parcial'], tesseractExit: 1 })
    const conversions = await convertAttachments([photo()], ingest(runtime, { ocr: 'local' }))
    expect(conversions[0]?.skipped).toBe('ocr-failed')
  })

  it('reads an image whose name carries no extension from its media type', async () => {
    const { runtime } = fakeWorld({ tesseract: ['total 763,20'] })
    const conversions = await convertAttachments([photo('adjunto', 'image/jpeg')], ingest(runtime, { ocr: 'local' }))
    expect(conversions[0]?.markdown).toBe('total 763,20')
  })
})

describe('scanned PDFs', () => {
  const pdf = { name: 'oc.pdf', mediaType: 'application/pdf', contentBase64: Buffer.from('%PDF-1.4').toString('base64') }

  it('falls back to OCR when the converter reports pages that need it', async () => {
    const { runtime, spawn } = fakeWorld({ anydoc: [{ exitCode: 3 }], pages: 1, tesseract: ['10 515007019 337,70'] })
    const documents = await markdownFromAttachments([pdf], ingest(runtime, { ocr: 'local' }))

    expect(documents[0]?.markdown).toBe('--- página 1 ---\n10 515007019 337,70')
    // The converter, the renderer, and one Tesseract run for the single page.
    expect(spawn).toHaveBeenCalledTimes(3)
  })

  it('falls back to OCR when the converter exits clean with no text', async () => {
    const { runtime } = fakeWorld({ anydoc: [{ exitCode: 0, stdout: '   ' }], pages: 1, tesseract: ['contenido'] })
    const documents = await markdownFromAttachments([pdf], ingest(runtime, { ocr: 'local' }))
    expect(documents[0]?.markdown).toContain('contenido')
  })

  it("keeps the converter's text and never starts OCR when it has text", async () => {
    const { runtime, spawn } = fakeWorld({ anydoc: [{ exitCode: 0, stdout: '# Purchase Order 20845' }], pages: 1 })
    const documents = await markdownFromAttachments([pdf], ingest(runtime, { ocr: 'local' }))

    expect(documents[0]?.markdown).toBe('# Purchase Order 20845')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('leaves the converter reason when local OCR is off', async () => {
    const { runtime, spawn } = fakeWorld({ anydoc: [{ exitCode: 3 }] })
    const conversions = await convertAttachments([pdf], ingest(runtime))
    expect(conversions[0]?.skipped).toBe('failed')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('does not OCR a document that is not a PDF', async () => {
    const { runtime, spawn } = fakeWorld({ anydoc: [{ exitCode: 1 }] })
    const conversions = await convertAttachments(
      [{ name: 'acta.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', contentBase64: 'AA==' }],
      ingest(runtime, { ocr: 'local' }),
    )
    expect(conversions[0]?.skipped).toBe('failed')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('reports an OCR page timeout as a timeout', async () => {
    vi.useFakeTimers()
    try {
      const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
        if (spec.argv.includes(bin)) return settled(spec, 3, '')
        if ((spec.argv[0] ?? '').endsWith('pdftoppm')) {
          const prefix = spec.argv[spec.argv.length - 1] ?? ''
          writeFileSync(`${prefix}-1.png`, Buffer.from([0x89]))
          return settled(spec, 0, '')
        }
        return {
          stdin: { on: () => {}, end: () => {} },
          collected: {},
          done: new Promise((_resolve, reject) => {
            spec.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
          }),
        }
      })
      const runtime = { spawn, resolveExecutable: async (command: string) => `/usr/bin/${command}` } as unknown as SubprocessRuntime
      const pending = convertAttachments([pdf], ingest(runtime, { ocr: 'local', ocrPageTimeoutMs: 500 }))
      await vi.advanceTimersByTimeAsync(1_000)
      const conversions = await pending
      expect(conversions[0]?.skipped).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('convertAttachments', () => {
  it('names why each attachment carried no text', async () => {
    const { runtime } = fakeWorld({ anydoc: [{ exitCode: 0, stdout: '| a |' }] })
    const conversions = await convertAttachments(
      [
        { name: 'script.sh', mediaType: 'text/x-sh', contentBase64: 'AA==' },
        { name: '', mediaType: 'application/octet-stream', contentBase64: 'AA==' },
        { name: 'pedido.xlsx', mediaType: 'application/vnd.ms-excel', contentBase64: 'AA==' },
      ],
      ingest(runtime),
    )

    expect(conversions.map(conversion => conversion.skipped)).toEqual(['unsupported', 'unsupported', null])
    expect(conversions[2]?.markdown).toContain('| a |')
  })

  it('skips an oversized attachment without spawning the converter', async () => {
    const { runtime, spawn } = fakeWorld({ anydoc: [{ exitCode: 0, stdout: 'texto' }] })
    const conversions = await convertAttachments(
      [{ name: 'grande.pdf', mediaType: 'application/pdf', contentBase64: Buffer.from('123456789').toString('base64') }],
      ingest(runtime, { maxInputBytes: 4 }),
    )

    expect(conversions[0]?.skipped).toBe('oversized')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('skips an attachment that carries no bytes at all', async () => {
    const { runtime, spawn } = fakeWorld()
    const conversions = await convertAttachments(
      [
        { name: 'vacio.pdf', mediaType: 'application/pdf', contentBase64: '' },
        { name: 'vacia.png', mediaType: 'image/png', contentBase64: '' },
      ],
      ingest(runtime, { ocr: 'local' }),
    )

    expect(conversions.map(conversion => conversion.skipped)).toEqual(['empty', 'empty'])
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
      const runtime = { spawn, resolveExecutable: async () => '/usr/bin/tesseract' } as unknown as SubprocessRuntime
      const pending = convertAttachments(
        [{ name: 'lento.pdf', mediaType: 'application/pdf', contentBase64: 'AA==' }],
        ingest(runtime),
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
      ingest(fakeWorld({ anydoc: [{ exitCode: 2, stdout: 'parcial' }] }).runtime),
    )
    const empty = await convertAttachments(
      [{ name: 'acta.pdf', mediaType: 'application/pdf', contentBase64: 'AA==' }],
      ingest(fakeWorld({ anydoc: [{ exitCode: 0, stdout: '   ' }] }).runtime),
    )

    expect(failed[0]?.skipped).toBe('failed')
    expect(empty[0]?.skipped).toBe('empty')
  })

  it('says the converter is missing instead of pretending the file is empty', async () => {
    const conversions = await convertAttachments(
      [{ name: 'acta.pdf', mediaType: 'application/pdf', contentBase64: 'AA==' }],
      ingest(fakeWorld({ anydoc: [{ exitCode: 0, stdout: 'texto' }] }).runtime, { bin: '' }),
    )
    expect(conversions[0]?.skipped).toBe('converter-missing')
  })
})
