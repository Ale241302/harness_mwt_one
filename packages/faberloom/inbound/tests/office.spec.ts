import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { ocrOffice, resolveOfficeBin, type OfficeOcrOptions } from '../src/office.ts'
import { tesseractTsv } from './tsv-fixture.ts'

/** What the fake execution world answers. */
interface World {
  /** Resolvable executables; every other name is absent. */
  readonly available?: readonly string[]
  /** Pages `pdftoppm` renders. */
  readonly pages?: number
  /** Tesseract stdout per call, in order. */
  readonly tesseract?: readonly string[]
  /** Bytes of the PDF LibreOffice writes; 0 leaves an empty file. */
  readonly pdfBytes?: number
  /** Exit code the fake converter returns. */
  readonly convertExit?: number
  /** Whether the fake converter writes no PDF at all. */
  readonly writeNothing?: boolean
}

/** A runtime that records every spawn and answers from one script. */
function world(options: World = {}) {
  let tesseractCalls = 0
  /** Bytes of the document handed to the converter, read from its real path. */
  let written: Buffer | undefined
  const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
    const program = spec.argv[0] ?? ''
    if (program.endsWith('libreoffice')) {
      written = readFileSync(spec.argv[spec.argv.length - 1] ?? '')
      if (options.writeNothing !== true) {
        const outdir = spec.argv[spec.argv.indexOf('--outdir') + 1] ?? ''
        writeFileSync(join(outdir, 'source.pdf'), Buffer.alloc(options.pdfBytes ?? 8, 0x20))
      }
      return settled(spec, options.convertExit ?? 0, 'convert /work/source.docx -> /work/source.pdf')
    }
    if (program.endsWith('pdftoppm')) {
      const prefix = spec.argv[spec.argv.length - 1] ?? ''
      for (let page = 1; page <= (options.pages ?? 0); page += 1) writeFileSync(`${prefix}-${page}.png`, Buffer.from([0x89]))
      return settled(spec, 0, '')
    }
    const replies: readonly string[] = options.tesseract ?? []
    const text = replies[tesseractCalls] ?? ''
    tesseractCalls += 1
    return settled(spec, 0, tesseractTsv(text))
  })
  const resolveExecutable = vi.fn(async (command: string) => {
    const available = options.available ?? ['tesseract', 'pdftoppm', 'libreoffice']
    if (!available.includes(command)) throw new Error(`${command}: not found`)
    return `/usr/bin/${command}`
  })
  return {
    runtime: { spawn, resolveExecutable } as unknown as SubprocessRuntime,
    spawn,
    written: () => written,
  }
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

/** Options for one attempt with every binary present. */
function options(runtime: SubprocessRuntime, overrides: Partial<OfficeOcrOptions> = {}): OfficeOcrOptions {
  return {
    runtime,
    binaries: { tesseract: '/usr/bin/tesseract', pdftoppm: '/usr/bin/pdftoppm', python: '' },
    libreoffice: '/usr/bin/libreoffice',
    ...overrides,
  }
}

/** The spawn spec of the converter call. */
function converterSpec(spawn: ReturnType<typeof vi.fn>): SubprocessSpawnSpec | undefined {
  return (spawn.mock.calls as [SubprocessSpawnSpec][]).map(call => call[0]).find(spec => (spec.argv[0] ?? '').endsWith('libreoffice'))
}

const docx = Buffer.from('PK\u0003\u0004escaneado')

describe('resolveOfficeBin', () => {
  it('returns the path when the world has LibreOffice', async () => {
    expect(await resolveOfficeBin(world().runtime)).toBe('/usr/bin/libreoffice')
  })

  it('reports absence instead of throwing', async () => {
    expect(await resolveOfficeBin(world({ available: [] }).runtime)).toBe('')
  })
})

describe('ocrOffice', () => {
  it('converts with the extension of the original name and reads the PDF', async () => {
    const { runtime, spawn, written } = world({ pages: 2, tesseract: ['primera', 'segunda'] })
    const dir = scratch()
    const outcome = await ocrOffice(docx, 'pedido.docx', options(runtime, {
      maxPages: 2,
      pageTimeoutMs: 20_000,
      maxTextBytes: 200_000,
      totalTimeoutMs: 150_000,
      convertTimeoutMs: 60_000,
    }), dir)

    expect(outcome.skipped).toBeNull()
    expect(outcome.text).toBe('--- página 1 ---\nprimera\n\n--- página 2 ---\nsegunda')
    // The document reaches LibreOffice byte-identical under its real extension.
    expect(written()).toEqual(docx)
    const spec = converterSpec(spawn)
    expect(spec?.argv[0]).toBe('/usr/bin/libreoffice')
    expect(spec?.argv).toEqual(expect.arrayContaining(['--headless', '--convert-to', 'pdf', '--outdir']))
    expect(spec?.argv.at(-1)?.startsWith(dir)).toBe(true)
    expect(spec?.argv.at(-1)?.endsWith('source.docx')).toBe(true)
    // One conversion, one render, one Tesseract run per page; nothing survives.
    expect(spawn).toHaveBeenCalledTimes(4)
    expect(readdirSync(dir)).toEqual([])
  })

  it('removes its scratch directory when the conversion fails', async () => {
    const { runtime } = world({ convertExit: 1 })
    const dir = scratch()
    const outcome = await ocrOffice(docx, 'acta.xlsx', options(runtime), dir)

    expect(outcome).toEqual({ text: '', skipped: 'failed' })
    expect(readdirSync(dir)).toEqual([])
  })

  it('names the missing converter instead of spawning', async () => {
    const { runtime, spawn } = world()
    const outcome = await ocrOffice(docx, 'acta.docx', options(runtime, { libreoffice: '' }), scratch())

    expect(outcome).toEqual({ text: '', skipped: 'converter-missing' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('needs the OCR binaries too, so the produced PDF is readable', async () => {
    const { runtime, spawn } = world()
    const noTesseract = options(runtime, { binaries: { tesseract: '', pdftoppm: '/usr/bin/pdftoppm', python: '' } })
    const noRenderer = options(runtime, { binaries: { tesseract: '/usr/bin/tesseract', pdftoppm: '', python: '' } })

    expect(await ocrOffice(docx, 'acta.docx', noTesseract, scratch())).toEqual({ text: '', skipped: 'converter-missing' })
    expect(await ocrOffice(docx, 'acta.docx', noRenderer, scratch())).toEqual({ text: '', skipped: 'converter-missing' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports empty bytes without spawning', async () => {
    const { runtime, spawn } = world()
    expect(await ocrOffice(new Uint8Array(0), 'acta.docx', options(runtime), scratch())).toEqual({ text: '', skipped: 'failed' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports an unusable scratch directory instead of throwing', async () => {
    const { runtime, spawn } = world()
    const missing = join(scratch(), 'no-existe')
    expect(await ocrOffice(docx, 'acta.docx', options(runtime), missing)).toEqual({ text: '', skipped: 'failed' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reads the first PDF the conversion wrote, whatever its name', async () => {
    let tesseractCalls = 0
    const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
      if ((spec.argv[0] ?? '').endsWith('libreoffice')) {
        const outdir = spec.argv[spec.argv.indexOf('--outdir') + 1] ?? ''
        writeFileSync(join(outdir, 'otro-nombre.pdf'), Buffer.from('%PDF-1.4'))
        return settled(spec, 0, '')
      }
      if ((spec.argv[0] ?? '').endsWith('pdftoppm')) {
        writeFileSync(`${spec.argv[spec.argv.length - 1] ?? ''}-1.png`, Buffer.from([0x89]))
        return settled(spec, 0, '')
      }
      tesseractCalls += 1
      return settled(spec, 0, tesseractTsv('texto'))
    })
    const runtime = { spawn, resolveExecutable: async (command: string) => `/usr/bin/${command}` } as unknown as SubprocessRuntime
    const outcome = await ocrOffice(docx, 'acta.docx', options(runtime), scratch())

    expect(outcome.text).toBe('--- página 1 ---\ntexto')
    expect(tesseractCalls).toBe(1)
  })

  it('reports a conversion that produced no PDF as a failure', async () => {
    const { runtime } = world({ writeNothing: true })
    expect(await ocrOffice(docx, 'acta.docx', options(runtime), scratch())).toEqual({ text: '', skipped: 'failed' })
  })

  it('reports a zero-byte PDF as a failure without running OCR', async () => {
    const { runtime, spawn } = world({ pdfBytes: 0, pages: 1 })
    const outcome = await ocrOffice(docx, 'acta.docx', options(runtime), scratch())

    expect(outcome).toEqual({ text: '', skipped: 'failed' })
    // The conversion ran; no page was rendered from an empty document.
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('refuses a PDF larger than the bound before loading it', async () => {
    const { runtime, spawn } = world({ pdfBytes: 64, pages: 1 })
    const outcome = await ocrOffice(docx, 'acta.docx', options(runtime, { maxPdfBytes: 8 }), scratch())

    expect(outcome).toEqual({ text: '', skipped: 'failed' })
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('stops a conversion that exceeds its step bound', async () => {
    vi.useFakeTimers()
    try {
      const spawn = vi.fn((spec: SubprocessSpawnSpec) => ({
        stdin: { on: () => {}, end: () => {} },
        collected: {},
        done: new Promise((_resolve, reject) => {
          spec.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
        }),
      }))
      const runtime = { spawn, resolveExecutable: async (command: string) => `/usr/bin/${command}` } as unknown as SubprocessRuntime
      const pending = ocrOffice(docx, 'acta.docx', options(runtime, { convertTimeoutMs: 500 }), scratch())
      await vi.advanceTimersByTimeAsync(600)

      expect(await pending).toEqual({ text: '', skipped: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives the PDF OCR only what is left of the whole-attempt bound', async () => {
    vi.useFakeTimers()
    try {
      const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
        if ((spec.argv[0] ?? '').endsWith('libreoffice')) {
          const outdir = spec.argv[spec.argv.indexOf('--outdir') + 1] ?? ''
          writeFileSync(join(outdir, 'source.pdf'), Buffer.from('%PDF-1.4'))
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
      const pending = ocrOffice(docx, 'acta.docx', options(runtime, { totalTimeoutMs: 1_000 }), scratch())
      await vi.advanceTimersByTimeAsync(1_100)

      expect(await pending).toEqual({ text: '', skipped: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('names the document by a safe extension, not by a path in its name', async () => {
    const { runtime, spawn } = world({ pages: 1, tesseract: ['x'] })
    await ocrOffice(docx, 'raro', options(runtime), scratch())
    expect(converterSpec(spawn)?.argv.at(-1)?.endsWith('source.bin')).toBe(true)

    const upper = world({ pages: 1, tesseract: ['x'] })
    await ocrOffice(docx, 'Informe.XLSX', options(upper.runtime), scratch())
    expect(converterSpec(upper.spawn)?.argv.at(-1)?.endsWith('source.xlsx')).toBe(true)
  })
})

/** One per-test scratch directory under the suite root. */
function scratch(): string {
  sequence += 1
  const dir = join(root, `case-${String(sequence)}`)
  mkdirSync(dir)
  return dir
}

let root = ''
let sequence = 0
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'office-spec-'))
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})
