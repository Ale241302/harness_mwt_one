import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { ocrImage, ocrPdf, readTesseract, resolveOcrBinaries, type OcrOptions } from '../src/ocr.ts'
import { tesseractTsv } from './tsv-fixture.ts'

/** What the fake execution world answers. */
interface World {
  /** Tesseract TSV per call, in order. */
  readonly tesseract?: readonly string[]
  /** Pages `pdftoppm` renders. */
  readonly pages?: number
  /** Whether the renderer fails instead of writing pages. */
  readonly renderFails?: boolean
  /** Resolvable executables; every other name is absent. */
  readonly available?: readonly string[]
  /** Helper replies for `deskew`, in order. */
  readonly deskew?: readonly string[]
  /** Helper replies for `rapid`, in order. */
  readonly rapid?: readonly string[]
}

/** A runtime that records every spawn and answers from one script. */
function world(options: World = {}) {
  let tesseractCalls = 0
  let deskewCalls = 0
  let rapidCalls = 0
  const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
    const program = spec.argv[0] ?? ''
    if (program.endsWith('python3')) {
      const verb = spec.argv[2] ?? ''
      if (verb === 'deskew') {
        const reply = (options.deskew ?? ['{"ok":true,"applied":false}'])[Math.min(deskewCalls, (options.deskew ?? ['']).length - 1)]
        deskewCalls += 1
        const parsed = reply === undefined ? undefined : JSON.parse(reply) as Record<string, unknown>
        const output = spec.argv[4] ?? ''
        // The helper writes the straightened copy; the reader only uses it when
        // the file exists.
        if (parsed?.['applied'] === true && output.length > 0) writeFileSync(output, Buffer.from([0xff, 0xd8]))
        return settled(spec, 0, reply ?? '{"ok":true,"applied":false}')
      }
      const reply = (options.rapid ?? ['{"ok":true,"files":[]}'])[Math.min(rapidCalls, (options.rapid ?? ['']).length - 1)]
      rapidCalls += 1
      return settled(spec, 0, reply ?? '{"ok":true,"files":[]}')
    }
    if (program.endsWith('pdftoppm')) {
      if (options.renderFails !== true) {
        const prefix = spec.argv[spec.argv.length - 1] ?? ''
        for (let page = 1; page <= (options.pages ?? 0); page += 1) writeFileSync(`${prefix}-${page}.png`, Buffer.from([0x89]))
      }
      return settled(spec, options.renderFails === true ? 1 : 0, '')
    }
    const replies: readonly string[] = options.tesseract ?? []
    const text = replies[tesseractCalls] ?? ''
    tesseractCalls += 1
    return settled(spec, 0, text)
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

/** Options for one attempt with both binaries present. */
function options(runtime: SubprocessRuntime, overrides: Partial<OcrOptions> = {}): OcrOptions {
  return {
    runtime,
    binaries: { tesseract: '/usr/bin/tesseract', pdftoppm: '/usr/bin/pdftoppm', python: '' },
    tools: '/opt/ocr/ocr-tools.py',
    ...overrides,
  }
}

describe('resolveOcrBinaries', () => {
  it('reports both executables when the world has them', async () => {
    const { runtime } = world()
    expect(await resolveOcrBinaries(runtime)).toEqual({
      tesseract: '/usr/bin/tesseract',
      pdftoppm: '/usr/bin/pdftoppm',
      python: '',
    })
  })

  it('disables local OCR when tesseract is absent', async () => {
    const { runtime } = world({ available: [] })
    expect(await resolveOcrBinaries(runtime)).toBeUndefined()
  })

  it('keeps image OCR when only the PDF renderer is absent', async () => {
    const { runtime } = world({ available: ['tesseract'] })
    expect(await resolveOcrBinaries(runtime)).toEqual({ tesseract: '/usr/bin/tesseract', pdftoppm: '', python: '' })
  })

  it('reports the Python that runs the helper', async () => {
    const { runtime } = world({ available: ['tesseract', 'pdftoppm', 'python3'] })
    expect(await resolveOcrBinaries(runtime)).toEqual({
      tesseract: '/usr/bin/tesseract',
      pdftoppm: '/usr/bin/pdftoppm',
      python: '/usr/bin/python3',
    })
  })
})

describe('readTesseract', () => {
  it('rebuilds lines and returns the median confidence', () => {
    const reading = readTesseract(tesseractTsv('SKU 515007019\n10 337,70', 88))
    expect(reading.text).toBe('SKU 515007019\n10 337,70')
    expect(reading.confidence).toBe(88)
  })

  it('keeps a blank line between paragraphs', () => {
    expect(readTesseract(tesseractTsv('primero\n\nsegundo')).text).toBe('primero\n\nsegundo')
  })

  it('ignores level rows and negative confidences', () => {
    const noise = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t',
      '5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t95\thola',
      '5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t-1\t',
    ].join('\n')
    expect(readTesseract(noise)).toEqual({ text: 'hola', confidence: 95 })
  })

  it('reports no confidence when it recognized nothing', () => {
    expect(readTesseract(tesseractTsv(''))).toEqual({ text: '', confidence: 0 })
  })
})

describe('ocrImage', () => {
  it('writes the bytes and reads the file with Tesseract', async () => {
    const { runtime, spawn } = world({ tesseract: [tesseractTsv('SKU 515007019\n10 337,70')] })
    const dir = scratch()
    const outcome = await ocrImage(Buffer.from([1, 2, 3]), options(runtime), dir)

    expect(outcome).toEqual({ text: 'SKU 515007019\n10 337,70', skipped: null })
    const spec = spawn.mock.calls[0]?.[0] as SubprocessSpawnSpec
    expect(spec.argv).toEqual(['/usr/bin/tesseract', join(dir, 'source.img'), 'stdout', '-l', 'spa+eng', '--psm', '3', 'tsv'])
    expect(spec.stdio.stdin).toBe('ignore')
  })

  it('reports bytes with nothing to read instead of spawning', async () => {
    const { runtime, spawn } = world()
    expect(await ocrImage(new Uint8Array(0), options(runtime), scratch())).toEqual({ text: '', skipped: 'failed' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports the missing binary, not a bad image', async () => {
    const { runtime, spawn } = world()
    const absent = options(runtime, { binaries: { tesseract: '', pdftoppm: '', python: '' } })
    expect(await ocrImage(Buffer.from('x'), absent, scratch())).toEqual({ text: '', skipped: 'converter-missing' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports a non-zero exit as a failure and keeps no partial text', async () => {
    const spawn = vi.fn(() => ({
      stdin: undefined,
      collected: { stdout: { readFrom: () => ({ text: 'basura', nextOffset: 6, lossy: false }) } },
      done: Promise.resolve({ exitCode: 1, signal: null }),
    }))
    const outcome = await ocrImage(Buffer.from('x'), options({ spawn } as unknown as SubprocessRuntime), scratch())
    expect(outcome).toEqual({ text: '', skipped: 'failed' })
  })

  it('reports a spawn failure as a failure instead of throwing', async () => {
    const spawn = vi.fn(() => {
      throw new Error('spawn failed')
    })
    const outcome = await ocrImage(Buffer.from('x'), options({ spawn } as unknown as SubprocessRuntime), scratch())
    expect(outcome).toEqual({ text: '', skipped: 'failed' })
  })

  it('stops a page that exceeds its time bound', async () => {
    vi.useFakeTimers()
    try {
      const spawn = vi.fn((spec: SubprocessSpawnSpec) => ({
        stdin: undefined,
        collected: {},
        done: new Promise((_resolve, reject) => {
          spec.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
        }),
      }))
      const pending = ocrImage(Buffer.from('x'), options({ spawn } as unknown as SubprocessRuntime, { pageTimeoutMs: 500 }), scratch())
      await vi.advanceTimersByTimeAsync(600)
      expect(await pending).toEqual({ text: '', skipped: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-reads a page Tesseract did not trust', async () => {
    const dir = scratch()
    const { runtime, spawn } = world({
      available: ['tesseract', 'pdftoppm', 'python3'],
      // 40 is under the escalation floor: the page was not read well.
      tesseract: [tesseractTsv('Wark Limifoda 3-102-7s1716', 40)],
      rapid: [JSON.stringify({ ok: true, files: [{ file: join(dir, 'source.img'), ok: true, text: 'Muito Work Limitada 3-102-751710', confidence: 93 }] })],
    })
    const outcome = await ocrImage(Buffer.from([1]), options(runtime, { binaries: { tesseract: '/usr/bin/tesseract', pdftoppm: '/usr/bin/pdftoppm', python: '/usr/bin/python3' } }), dir)

    expect(outcome.text).toBe('Muito Work Limitada 3-102-751710')
    const verbs = spawn.mock.calls.map(call => (call[0] as SubprocessSpawnSpec).argv[2])
    expect(verbs).toContain('deskew')
    expect(verbs).toContain('rapid')
  })

  it('keeps the first reading when the second engine is absent', async () => {
    const { runtime } = world({ tesseract: [tesseractTsv('texto debil', 40)] })
    expect((await ocrImage(Buffer.from([1]), options(runtime), scratch())).text).toBe('texto debil')
  })

  it('reads the straightened copy when the helper reports an angle', async () => {
    const dir = scratch()
    const { runtime, spawn } = world({
      available: ['tesseract', 'pdftoppm', 'python3'],
      deskew: [JSON.stringify({ ok: true, applied: true, angle: 7 })],
      tesseract: [tesseractTsv('enderezado')],
    })
    const outcome = await ocrImage(Buffer.from([1]), options(runtime, { binaries: { tesseract: '/usr/bin/tesseract', pdftoppm: '/usr/bin/pdftoppm', python: '/usr/bin/python3' } }), dir)

    expect(outcome.text).toBe('enderezado')
    const tesseractCall = spawn.mock.calls.map(call => call[0] as SubprocessSpawnSpec).find(spec => spec.argv[0]?.endsWith('tesseract'))
    expect(tesseractCall?.argv[1]).toBe(join(dir, 'straight.jpg'))
  })

  it('reads the page as it arrived when straightening fails', async () => {
    const dir = scratch()
    const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
      const program = spec.argv[0] ?? ''
      if (program.endsWith('python3')) return settled(spec, 1, '')
      return settled(spec, 0, tesseractTsv('tal cual'))
    })
    const outcome = await ocrImage(
      Buffer.from([1]),
      options({ spawn } as unknown as SubprocessRuntime, { binaries: { tesseract: '/usr/bin/tesseract', pdftoppm: '/usr/bin/pdftoppm', python: '/usr/bin/python3' } }),
      dir,
    )

    expect(outcome.text).toBe('tal cual')
    const tesseractCall = spawn.mock.calls.map(call => call[0] as SubprocessSpawnSpec).find(spec => spec.argv[0]?.endsWith('tesseract'))
    expect(tesseractCall?.argv[1]).toBe(join(dir, 'source.img'))
  })
})

describe('ocrPdf', () => {
  it('renders every page and marks each one', async () => {
    const { runtime, spawn } = world({ pages: 2, tesseract: [tesseractTsv('primera'), tesseractTsv('segunda')] })
    const dir = scratch()
    const outcome = await ocrPdf(Buffer.from('%PDF'), options(runtime), dir)

    expect(outcome.skipped).toBeNull()
    expect(outcome.text).toBe('--- página 1 ---\nprimera\n\n--- página 2 ---\nsegunda')
    const render = spawn.mock.calls[0]?.[0] as SubprocessSpawnSpec
    expect(render.argv.slice(0, 4)).toEqual(['/usr/bin/pdftoppm', '-r', '200', '-png'])
    expect(render.argv[4]).toBe('-l')
    expect(render.argv[6]).toBe('-')
    expect(spawn).toHaveBeenCalledTimes(3)
    expect(existsSync(join(dir, 'pages'))).toBe(false)
  })

  it('reads no more pages than the cap and says how many it left', async () => {
    const { runtime, spawn } = world({ pages: 4, tesseract: [tesseractTsv('uno'), tesseractTsv('dos')] })
    const outcome = await ocrPdf(Buffer.from('%PDF'), options(runtime, { maxPages: 2 }), scratch())

    expect(outcome.text).toContain('--- página 2 ---')
    expect(outcome.text).toContain('sin leer: 2')
    // The renderer stops one page past the cap, so the caller learns the
    // document continued without rendering all of it.
    const render = spawn.mock.calls[0]?.[0] as SubprocessSpawnSpec
    expect(render.argv[5]).toBe('3')
    expect(spawn).toHaveBeenCalledTimes(3)
  })

  it('reports a protected PDF instead of failing the caller', async () => {
    const { runtime, spawn } = world({ renderFails: true })
    const outcome = await ocrPdf(Buffer.from('%PDF'), options(runtime), scratch())
    expect(outcome).toEqual({ text: '', skipped: 'failed' })
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('reports a document whose pages all failed as a failure, not as markers', async () => {
    const { runtime } = world({ pages: 1, tesseract: [''] })
    const outcome = await ocrPdf(Buffer.from('%PDF'), options(runtime), scratch())
    expect(outcome).toEqual({ text: '', skipped: 'failed' })
  })

  it('reports the missing renderer apart from a missing tesseract', async () => {
    const { runtime, spawn } = world()
    const absent = options(runtime, { binaries: { tesseract: '/usr/bin/tesseract', pdftoppm: '', python: '' } })
    expect(await ocrPdf(Buffer.from('%PDF'), absent, scratch())).toEqual({ text: '', skipped: 'converter-missing' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports empty bytes without spawning', async () => {
    const { runtime, spawn } = world({ pages: 1 })
    expect(await ocrPdf(new Uint8Array(0), options(runtime), scratch())).toEqual({ text: '', skipped: 'failed' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('truncates the text at the retained-text bound', async () => {
    const { runtime } = world({ pages: 1, tesseract: [tesseractTsv('abcdefghij')] })
    const outcome = await ocrPdf(Buffer.from('%PDF'), options(runtime, { maxTextBytes: 4 }), scratch())
    expect(outcome.text).toContain('--- texto truncado: límite alcanzado ---')
    expect(outcome.text).toContain('abcd')
    expect(outcome.text).not.toContain('abcde')
  })

  it('escalates only the pages Tesseract did not trust, in one call', async () => {
    const dir = scratch()
    const { runtime, spawn } = world({
      available: ['tesseract', 'pdftoppm', 'python3'],
      pages: 2,
      tesseract: [tesseractTsv('clara', 95), tesseractTsv('borrosa', 30)],
      rapid: [JSON.stringify({ ok: true, files: [{ file: join(dir, 'pages', 'page-2.png'), ok: true, text: 'legible ahora', confidence: 91 }] })],
    })
    const outcome = await ocrPdf(
      Buffer.from('%PDF'),
      options(runtime, { binaries: { tesseract: '/usr/bin/tesseract', pdftoppm: '/usr/bin/pdftoppm', python: '/usr/bin/python3' } }),
      dir,
    )

    expect(outcome.text).toContain('clara')
    expect(outcome.text).toContain('legible ahora')
    expect(outcome.text).not.toContain('borrosa')
    const rapidCalls = spawn.mock.calls
      .map(call => call[0] as SubprocessSpawnSpec)
      .filter(spec => spec.argv[2] === 'rapid')
    // One model load for the whole document, and only the weak page in it.
    expect(rapidCalls).toHaveLength(1)
    expect(rapidCalls[0]?.argv.slice(3)).toEqual([join(dir, 'pages', 'page-2.png')])
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
  root = mkdtempSync(join(tmpdir(), 'ocr-spec-'))
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})
