import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { ocrImage, ocrPdf, resolveOcrBinaries, type OcrOptions } from '../src/ocr.ts'

/** What the fake execution world answers. */
interface World {
  /** Tesseract stdout per call, in order. */
  readonly tesseract?: readonly string[]
  /** Pages `pdftoppm` renders. */
  readonly pages?: number
  /** Whether the renderer fails instead of writing pages. */
  readonly renderFails?: boolean
  /** Resolvable executables; every other name is absent. */
  readonly available?: readonly string[]
}

/** A runtime that records every spawn and answers from one script. */
function world(options: World = {}) {
  let tesseractCalls = 0
  const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
    const program = spec.argv[0] ?? ''
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
  return { runtime, binaries: { tesseract: '/usr/bin/tesseract', pdftoppm: '/usr/bin/pdftoppm' }, ...overrides }
}

describe('resolveOcrBinaries', () => {
  it('reports both executables when the world has them', async () => {
    const { runtime } = world()
    expect(await resolveOcrBinaries(runtime)).toEqual({ tesseract: '/usr/bin/tesseract', pdftoppm: '/usr/bin/pdftoppm' })
  })

  it('disables local OCR when tesseract is absent', async () => {
    const { runtime } = world({ available: [] })
    expect(await resolveOcrBinaries(runtime)).toBeUndefined()
  })

  it('keeps image OCR when only the PDF renderer is absent', async () => {
    const { runtime } = world({ available: ['tesseract'] })
    expect(await resolveOcrBinaries(runtime)).toEqual({ tesseract: '/usr/bin/tesseract', pdftoppm: '' })
  })
})

describe('ocrImage', () => {
  it('runs tesseract on stdin and returns its text', async () => {
    const { runtime, spawn } = world({ tesseract: ['SKU 515007019\n10  337,70'] })
    const outcome = await ocrImage(Buffer.from([1, 2, 3]), options(runtime), scratch())

    expect(outcome).toEqual({ text: 'SKU 515007019\n10  337,70', skipped: null })
    const spec = spawn.mock.calls[0]?.[0] as SubprocessSpawnSpec
    expect(spec.argv).toEqual(['/usr/bin/tesseract', '-', 'stdout', '-l', 'spa+eng', '--psm', '3'])
    expect(spec.stdio.stdin).toBe('pipe')
  })

  it('reports bytes with nothing to read instead of spawning', async () => {
    const { runtime, spawn } = world()
    expect(await ocrImage(new Uint8Array(0), options(runtime), scratch())).toEqual({ text: '', skipped: 'failed' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports the missing binary, not a bad image', async () => {
    const { runtime, spawn } = world()
    const absent = options(runtime, { binaries: { tesseract: '', pdftoppm: '' } })
    expect(await ocrImage(Buffer.from('x'), absent, scratch())).toEqual({ text: '', skipped: 'converter-missing' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports a non-zero exit as a failure and keeps no partial text', async () => {
    const spawn = vi.fn(() => ({
      stdin: { on: () => {}, end: () => {} },
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
        stdin: { on: () => {}, end: () => {} },
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
})

describe('ocrPdf', () => {
  it('renders every page and marks each one', async () => {
    const { runtime, spawn } = world({ pages: 2, tesseract: ['primera', 'segunda'] })
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
    const { runtime, spawn } = world({ pages: 4, tesseract: ['uno', 'dos'] })
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
    const absent = options(runtime, { binaries: { tesseract: '/usr/bin/tesseract', pdftoppm: '' } })
    expect(await ocrPdf(Buffer.from('%PDF'), absent, scratch())).toEqual({ text: '', skipped: 'converter-missing' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports empty bytes without spawning', async () => {
    const { runtime, spawn } = world({ pages: 1 })
    expect(await ocrPdf(new Uint8Array(0), options(runtime), scratch())).toEqual({ text: '', skipped: 'failed' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('truncates the text at the retained-text bound', async () => {
    const { runtime } = world({ pages: 1, tesseract: ['abcdefghij'] })
    const outcome = await ocrPdf(Buffer.from('%PDF'), options(runtime, { maxTextBytes: 4 }), scratch())
    expect(outcome.text).toContain('--- texto truncado: límite alcanzado ---')
    expect(outcome.text).toContain('abcd')
    expect(outcome.text).not.toContain('abcde')
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
