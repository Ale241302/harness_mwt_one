/**
 * Local OCR for attachments that carry no text of their own: Tesseract reads one
 * image, and a scanned PDF is rendered page by page with `pdftoppm` before each
 * page goes through Tesseract. Both run through the host's subprocess provider
 * on the deployment's own machine, so a document never leaves the
 * infrastructure and no provider key is needed.
 *
 * Extraction is best-effort: a missing binary, a protected PDF, a page that
 * exceeds its time bound, or a provider failure returns whatever text was
 * collected together with the reason it stopped, and never throws past the
 * caller's attachment conversion.
 * @module
 */

import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

/**
 * How attachments without a text layer are handled: `off` skips them, `local`
 * runs Tesseract on this machine, and `hosted` leaves the document to the
 * converter's Firecrawl Parse path.
 */
export type OcrMode = 'off' | 'local' | 'hosted'

/** Why local OCR produced no text for one attachment. */
export type OcrFailure =
  /** `tesseract` or `pdftoppm` is not installed for this execution world. */
  | 'converter-missing'
  /** A render or recognition step exceeded its time bound. */
  | 'timeout'
  /** The binary exited non-zero, or the page rendering produced no image. */
  | 'failed'

/** One OCR attempt: the text it read, or the reason it read none. */
export interface OcrOutcome {
  /** Extracted text; empty when the attempt failed. */
  readonly text: string
  /** Why no text was extracted, or null when the attempt ran to completion. */
  readonly skipped: OcrFailure | null
}

/** The two executables local OCR needs, resolved in the host's execution world. */
export interface OcrBinaries {
  /** Absolute path of `tesseract`, or empty when the deployment has no local OCR. */
  readonly tesseract: string
  /** Absolute path of `pdftoppm`; empty means scanned PDFs cannot be rendered. */
  readonly pdftoppm: string
}

/** Everything one OCR attempt needs beyond the bytes. */
export interface OcrOptions {
  /** The host's subprocess provider — the only process-spawning seam allowed here. */
  readonly runtime: SubprocessRuntime
  /** Resolved executables; see {@link resolveOcrBinaries}. */
  readonly binaries: OcrBinaries
  /** Most PDF pages read in one attempt; the rest is reported as unread. */
  readonly maxPages?: number
  /** Wall-clock bound for one rendered page or one standalone image. */
  readonly pageTimeoutMs?: number
  /** Wall-clock bound for one whole PDF, rendering included. */
  readonly totalTimeoutMs?: number
  /** Characters of text retained from one attempt; the tail is dropped. */
  readonly maxTextBytes?: number
}

/** Pages read from one scanned PDF before the rest is reported as unread. */
const MAX_PAGES = 10
/** Per-page bound: a 200 dpi letter page takes seconds, so this is generous. */
const PAGE_TIMEOUT_MS = 20_000
/** Whole-PDF bound, rendering plus every page. */
const TOTAL_TIMEOUT_MS = 90_000
/** Retained text per attempt, matching the converter's Markdown cap. */
const MAX_TEXT_BYTES = 200_000
/** Retained diagnostics per process; Tesseract's warnings are not shown. */
const MAX_DIAGNOSTIC_BYTES = 8_192
/** Grace the provider gets to drain a terminated range. */
const GRACE_MS = 5_000
/** Render resolution; 200 dpi keeps 10 pt body text legible to Tesseract. */
const RENDER_DPI = '200'
/** Languages installed in the image; Spanish orders carry Spanish column labels. */
const LANGUAGES = 'spa+eng'
/**
 * Page segmentation. `3` (automatic, with orientation detection) is kept over
 * `6` (one text block): on the real purchase orders measured for this change,
 * `6` preserved table headings better but misread a part number that drives the
 * order line, and `3` read every part number correctly.
 */
const PAGE_SEGMENTATION = '3'
/** Tesseract reads the image on stdin and writes the plain text on stdout. */
const TESSERACT_ARGV = ['-', 'stdout', '-l', LANGUAGES, '--psm', PAGE_SEGMENTATION]

/**
 * Resolve the two executables local OCR needs.
 *
 * A world without `tesseract` disables local OCR entirely; a world without
 * `pdftoppm` still reads standalone images, so each binary is reported
 * separately and the caller decides.
 * @param runtime - the host's subprocess provider.
 * @param signal - optional bound for the lookup.
 * @returns both resolved paths, or undefined when `tesseract` is unavailable.
 */
export async function resolveOcrBinaries(runtime: SubprocessRuntime, signal?: AbortSignal): Promise<OcrBinaries | undefined> {
  const tesseract = await resolveOne(runtime, 'tesseract', signal)
  if (tesseract.length === 0) return undefined
  return { tesseract, pdftoppm: await resolveOne(runtime, 'pdftoppm', signal) }
}

/**
 * Resolve one executable, reporting absence instead of throwing.
 * @param runtime - the host's subprocess provider.
 * @param command - bare PATH name of the executable.
 * @param signal - optional bound for the lookup.
 * @returns the canonical path, or '' when this world has no such executable.
 */
async function resolveOne(runtime: SubprocessRuntime, command: string, signal?: AbortSignal): Promise<string> {
  try {
    return await runtime.resolveExecutable(command, undefined, signal)
  } catch {
    // Absence is a supported deployment, not a failure: the caller reports
    // `converter-missing` and the mail read still returns its body.
    return ''
  }
}

/** One bounded process run's facts. */
interface BoundedRun {
  /** Exit code, or null when the process died from a signal. */
  readonly exitCode: number | null
  /** Collected stdout text. */
  readonly stdout: string
  /** True when this run was aborted at its deadline. */
  readonly timedOut: boolean
}

/**
 * Run one binary under a deadline, feeding `input` on stdin when given.
 * @param options - runtime, binaries, and limits.
 * @param argv - executable and arguments; never shell-interpreted.
 * @param dir - working directory for the child.
 * @param input - bytes for stdin, or undefined to leave stdin closed.
 * @param timeoutMs - wall-clock bound for this run.
 * @param maxStdoutBytes - retained stdout bound.
 * @returns the exit facts and the collected text.
 * @throws when the provider cannot spawn the process.
 */
async function runBounded(
  options: OcrOptions,
  argv: readonly string[],
  dir: string,
  input: Uint8Array | undefined,
  timeoutMs: number,
  maxStdoutBytes: number,
): Promise<BoundedRun> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    const handle = options.runtime.spawn({
      argv,
      cwd: dir,
      stdio: {
        stdin: input === undefined ? 'ignore' : 'pipe',
        stdout: { maxBytes: maxStdoutBytes },
        stderr: { maxBytes: MAX_DIAGNOSTIC_BYTES },
      },
      graceMs: GRACE_MS,
      signal: controller.signal,
    })
    if (input !== undefined && handle.stdin !== undefined) {
      // The child can exit before it reads all of stdin; its exit code carries
      // the verdict, so a write error is not a failure of this run.
      handle.stdin.on('error', () => {})
      handle.stdin.end(input)
    }
    const outcome = await handle.done
    const read = handle.collected.stdout?.readFrom(0)
    return { exitCode: outcome.exitCode, stdout: read === undefined ? '' : read.text, timedOut }
  } catch (error) {
    // A terminated run rejects at its deadline; the caller needs the timeout
    // fact, not the provider's abort error.
    if (controller.signal.aborted) return { exitCode: null, stdout: '', timedOut: true }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Read one image with Tesseract.
 * @param bytes - the image file's bytes, read on stdin.
 * @param options - runtime, binaries, and limits.
 * @param dir - scratch directory the child runs in.
 * @returns the recognized text, or the reason there is none.
 */
export async function ocrImage(bytes: Uint8Array, options: OcrOptions, dir: string): Promise<OcrOutcome> {
  if (bytes.byteLength === 0) return { text: '', skipped: 'failed' }
  if (options.binaries.tesseract.length === 0) return { text: '', skipped: 'converter-missing' }
  try {
    const run = await runBounded(
      options,
      [options.binaries.tesseract, ...TESSERACT_ARGV],
      dir,
      bytes,
      options.pageTimeoutMs ?? PAGE_TIMEOUT_MS,
      options.maxTextBytes ?? MAX_TEXT_BYTES,
    )
    if (run.timedOut) return { text: '', skipped: 'timeout' }
    if (run.exitCode !== 0) return { text: '', skipped: 'failed' }
    return { text: normalizeText(run.stdout), skipped: null }
  } catch {
    // A provider or decode failure skips this attachment only; the caller still
    // returns the mail body and the reason this attachment carries no text.
    return { text: '', skipped: 'failed' }
  }
}

/**
 * Read a PDF page by page: render with `pdftoppm`, then recognize each image.
 * @param bytes - the PDF's bytes, read on stdin.
 * @param options - runtime, binaries, and limits.
 * @param dir - scratch directory for the rendered pages.
 * @returns the page-marked text, or the reason there is none.
 */
export async function ocrPdf(bytes: Uint8Array, options: OcrOptions, dir: string): Promise<OcrOutcome> {
  if (bytes.byteLength === 0) return { text: '', skipped: 'failed' }
  const { pdftoppm, tesseract } = options.binaries
  if (pdftoppm.length === 0 || tesseract.length === 0) return { text: '', skipped: 'converter-missing' }
  const maxPages = options.maxPages ?? MAX_PAGES
  const deadline = Date.now() + (options.totalTimeoutMs ?? TOTAL_TIMEOUT_MS)
  const pagesDir = join(dir, 'pages')
  try {
    mkdirSync(pagesDir, { recursive: true })
    // One page past the cap tells the caller whether the document continued.
    const rendered = await runBounded(
      options,
      [pdftoppm, '-r', RENDER_DPI, '-png', '-l', String(maxPages + 1), '-', join(pagesDir, 'page')],
      dir,
      bytes,
      bounded(options.totalTimeoutMs ?? TOTAL_TIMEOUT_MS, deadline),
      MAX_DIAGNOSTIC_BYTES,
    )
    if (rendered.timedOut) return { text: '', skipped: 'timeout' }
    if (rendered.exitCode !== 0) return { text: '', skipped: 'failed' }
    const pages = readdirSync(pagesDir)
      .filter(name => name.endsWith('.png'))
      .sort((left, right) => pageNumber(left) - pageNumber(right))
    if (pages.length === 0) return { text: '', skipped: 'failed' }
    return await readPages(options, pagesDir, pages, maxPages, deadline)
  } finally {
    rmSync(pagesDir, { recursive: true, force: true })
  }
}

/**
 * Recognize the rendered pages in order and mark each one's text.
 * @param options - runtime, binaries, and limits.
 * @param pagesDir - directory holding the rendered PNGs.
 * @param pages - rendered page names, in page order.
 * @param maxPages - most pages read from this document.
 * @param deadline - epoch milliseconds after which no page is started.
 * @returns the marked text plus the reason it stopped early, when it did.
 */
async function readPages(
  options: OcrOptions,
  pagesDir: string,
  pages: readonly string[],
  maxPages: number,
  deadline: number,
): Promise<OcrOutcome> {
  const sections: string[] = []
  let budget = options.maxTextBytes ?? MAX_TEXT_BYTES
  let recognized = 0
  let timedOut = false
  let truncated = false
  const read = Math.min(pages.length, maxPages)
  for (let index = 0; index < read; index += 1) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      timedOut = true
      break
    }
    const page = await ocrImage(readFileSync(join(pagesDir, pages[index] ?? '')), {
      ...options,
      pageTimeoutMs: bounded(options.pageTimeoutMs ?? PAGE_TIMEOUT_MS, deadline),
    }, pagesDir)
    if (page.skipped === 'timeout') {
      timedOut = true
      sections.push(`--- página ${String(index + 1)}: tiempo límite ---`)
      break
    }
    if (page.skipped !== null) {
      sections.push(`--- página ${String(index + 1)}: no se pudo leer ---`)
      continue
    }
    if (page.text.length === 0) continue
    if (page.text.length > budget) {
      sections.push(`--- página ${String(index + 1)} ---\n${page.text.slice(0, budget)}`)
      recognized += budget
      truncated = true
      break
    }
    sections.push(`--- página ${String(index + 1)} ---\n${page.text}`)
    recognized += page.text.length
    budget -= page.text.length
  }
  if (truncated) sections.push('--- texto truncado: límite alcanzado ---')
  if (pages.length > read) sections.push(`--- sin leer: ${String(pages.length - read)}+ página(s) más, límite de ${String(maxPages)} ---`)
  // The page markers alone are not text: a document where every page failed is
  // reported as a failure, not as a conversion that produced markers.
  if (recognized === 0) return { text: '', skipped: timedOut ? 'timeout' : 'failed' }
  return { text: sections.join('\n\n'), skipped: null }
}

/**
 * Remaining time for one step, never below the provider's minimum useful slice.
 * @param step - the step's own bound in milliseconds.
 * @param deadline - epoch milliseconds this document must finish by.
 * @returns the smaller of the two, and at least one millisecond.
 */
function bounded(step: number, deadline: number): number {
  return Math.max(1, Math.min(step, deadline - Date.now()))
}

/**
 * Trailing page number of one rendered file name.
 * @param name - a `pdftoppm` output name such as `page-12.png`.
 * @returns its page number, or 0 when the name carries none.
 */
function pageNumber(name: string): number {
  const match = /(\d+)\.png$/u.exec(name)
  return match === null ? 0 : Number(match[1])
}

/**
 * Tesseract's plain-text output, without its page breaks or padding.
 * @param text - the process's stdout.
 * @returns the trimmed text with form feeds removed.
 */
function normalizeText(text: string): string {
  return text.replaceAll('\f', '').trim()
}
