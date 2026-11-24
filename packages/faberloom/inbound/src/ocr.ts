/**
 * Local OCR for attachments that carry no text of their own: Tesseract reads one
 * image, and a scanned PDF is rendered page by page with `pdftoppm` before each
 * page goes through the same reading. Everything runs through the host's
 * subprocess provider on the deployment's own machine, so a document never
 * leaves the infrastructure and no provider key is needed.
 *
 * Two repairs sit in front of Tesseract, both measured on real mail attachments:
 *
 * - A tilted page is straightened first (`deploy/ocr/ocr-tools.py deskew`).
 *   Tesseract reads a page rotated by 7 degrees as line noise: on four real
 *   receipts it recovered every checked amount only after the rotation.
 * - A page Tesseract reports below {@link ESCALATE_BELOW} median word
 *   confidence is re-read with RapidOCR in the same call. A photographed
 *   hand-written invoice scored 52 where printed receipts score above 90, and
 *   RapidOCR read four fields Tesseract could not.
 *
 * Extraction is best-effort: a missing binary, a protected PDF, a page that
 * exceeds its time bound, or a provider failure returns whatever text was
 * collected together with the reason it stopped, and never throws past the
 * caller's attachment conversion.
 * @module
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

/**
 * How attachments without a text layer are handled: `off` skips them, `local`
 * reads them on this machine, and `hosted` leaves the document to the
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

/**
 * One page's reading plus how much the engine trusted it.
 *
 * The confidence is the median word confidence Tesseract reports, not a mean:
 * a page of clean headings with one blurred table is a good page, and a mean
 * over few words swings on a single misread.
 */
export interface OcrReading {
  /** Recognized text, one line per detected text line. */
  readonly text: string
  /** Median word confidence in percent, 0 when nothing was recognized. */
  readonly confidence: number
}

/** The executables local OCR needs, resolved in the host's execution world. */
export interface OcrBinaries {
  /** Absolute path of `tesseract`, or empty when the deployment has no local OCR. */
  readonly tesseract: string
  /** Absolute path of `pdftoppm`; empty means scanned PDFs cannot be rendered. */
  readonly pdftoppm: string
  /**
   * Absolute path of `python3`, or empty when this world has none. It runs the
   * helper in {@link OcrOptions.tools} for deskew and RapidOCR; without it the
   * reading is plain Tesseract on the page as it arrived.
   */
  readonly python: string
}

/** Everything one OCR attempt needs beyond the bytes. */
export interface OcrOptions {
  /** The host's subprocess provider — the only process-spawning seam allowed here. */
  readonly runtime: SubprocessRuntime
  /** Resolved executables; see {@link resolveOcrBinaries}. */
  readonly binaries: OcrBinaries
  /** Absolute path of the OCR helper script; defaults to {@link TOOLS_PATH}. */
  readonly tools?: string
  /** Most PDF pages read in one attempt; the rest is reported as unread. */
  readonly maxPages?: number
  /** Wall-clock bound for one page's Tesseract run. */
  readonly pageTimeoutMs?: number
  /** Wall-clock bound for one whole PDF, rendering included. */
  readonly totalTimeoutMs?: number
  /** Characters of text retained from one attempt; the tail is dropped. */
  readonly maxTextBytes?: number
}

/** Where the image installs the OCR helper. */
const TOOLS_PATH = '/opt/ocr/ocr-tools.py'
/**
 * Median word confidence under which Tesseract's reading is treated as
 * unreliable and the page is re-read with RapidOCR. Measured on real
 * attachments: printed receipts and purchase orders land between 90 and 96,
 * while the hand-written phone photo that Tesseract misread scored 52.
 */
const ESCALATE_BELOW = 75
/** Pages read from one scanned PDF before the rest is reported as unread. */
const MAX_PAGES = 10
/** Per-page bound for Tesseract: a 200 dpi letter page takes seconds, so this is generous. */
const PAGE_TIMEOUT_MS = 20_000
/**
 * Whole-document bound, rendering plus every page. A page that escalates to
 * RapidOCR costs about 14 s instead of 4 s, so a ten-page document needs more
 * than the 90 s a Tesseract-only pass used.
 */
const TOTAL_TIMEOUT_MS = 180_000
/** Bound for straightening one page; measured 0.2 s to 0.6 s on real pages. */
const DESKEW_TIMEOUT_MS = 20_000
/** Bound for re-reading a batch of pages with RapidOCR, which loads its model once. */
const RAPID_TIMEOUT_MS = 90_000
/** Retained text per attempt, matching the converter's Markdown cap. */
const MAX_TEXT_BYTES = 200_000
/** Retained diagnostics per process; the engines' warnings are not shown. */
const MAX_DIAGNOSTIC_BYTES = 8_192
/**
 * Stdout bound for one Tesseract run. Its word-level TSV carries about twenty
 * bytes of metadata per word, so a dense page produces ten times the bytes of
 * the text it describes; capping stdout at the text bound would cut a row in
 * half and silently drop the tail of the page.
 */
const MAX_TESSERACT_STDOUT_BYTES = 1_000_000
/** Stdout bound for one second-engine batch: its JSON carries the text of every weak page. */
const MAX_RAPID_STDOUT_BYTES = 1_000_000
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
/**
 * Tesseract reads the named image and writes word-level TSV on stdout. TSV, not
 * plain text, because the same pass carries the confidence that decides whether
 * the page needs a second engine; rebuilding the lines from its word rows
 * produced byte-identical text to the plain-text renderer on both real
 * documents measured for this change.
 */
const TESSERACT_ARGV = ['stdout', '-l', LANGUAGES, '--psm', PAGE_SEGMENTATION, 'tsv']

/**
 * Resolve the executables local OCR needs.
 *
 * A world without `tesseract` disables local OCR entirely; a world without
 * `pdftoppm` still reads standalone images, and a world without `python3` reads
 * every page without straightening it or escalating to RapidOCR. Each binary is
 * reported separately and the caller decides.
 * @param runtime - the host's subprocess provider.
 * @param signal - optional bound for the lookup.
 * @returns both resolved paths, or undefined when `tesseract` is unavailable.
 */
export async function resolveOcrBinaries(runtime: SubprocessRuntime, signal?: AbortSignal): Promise<OcrBinaries | undefined> {
  const tesseract = await resolveOne(runtime, 'tesseract', signal)
  if (tesseract.length === 0) return undefined
  return {
    tesseract,
    pdftoppm: await resolveOne(runtime, 'pdftoppm', signal),
    python: await resolveOne(runtime, 'python3', signal),
  }
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
export interface BoundedRun {
  /** Exit code, or null when the process died from a signal. */
  readonly exitCode: number | null
  /** Collected stdout text. */
  readonly stdout: string
  /** True when this run was aborted at its deadline. */
  readonly timedOut: boolean
}

/**
 * Run one binary under a deadline, feeding `input` on stdin when given.
 *
 * Shared with {@link ../office.ts}'s converter step, which brackets a
 * LibreOffice run and the OCR it feeds with one deadline.
 * @param options - runtime, binaries, and limits.
 * @param argv - executable and arguments; never shell-interpreted.
 * @param dir - working directory for the child.
 * @param input - bytes for stdin, or undefined to leave stdin closed.
 * @param timeoutMs - wall-clock bound for this run.
 * @param maxStdoutBytes - retained stdout bound.
 * @returns the exit facts and the collected text.
 * @throws when the provider cannot spawn the process.
 */
export async function runBounded(
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
 * Rebuild one page's text from Tesseract's word rows, with its median confidence.
 *
 * Rows arrive in reading order; a change of paragraph starts a blank line, and a
 * change of line starts a new line. Rows the engine emits for page, block, and
 * line levels carry no text and are skipped, as is anything with a negative
 * confidence.
 * @param stdout - the TSV Tesseract wrote on stdout.
 * @returns the page's text and median word confidence in percent.
 */
export function readTesseract(stdout: string): OcrReading {
  const lines: string[] = []
  const confidences: number[] = []
  let words: string[] = []
  let lineKey = ''
  let paragraph = ''
  const flush = (): void => {
    if (words.length === 0) return
    lines.push(words.join(' '))
    words = []
  }
  for (const row of stdout.split('\n').slice(1)) {
    const cells = row.split('\t')
    if (cells.length < 12) continue
    // A word containing a tab splits into more cells; the text carries the rest.
    const word = cells.slice(11).join(' ').trim()
    const confidence = Number(cells[10])
    if (word.length === 0 || !Number.isFinite(confidence) || confidence < 0) continue
    const block = cells[2] ?? ''
    const paragraphNumber = cells[3] ?? ''
    const key = `${block}.${paragraphNumber}.${cells[4] ?? ''}`
    if (lineKey.length > 0 && key !== lineKey) flush()
    const paragraphKey = `${block}.${paragraphNumber}`
    if (paragraph.length > 0 && paragraphKey !== paragraph) {
      flush()
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
    }
    paragraph = paragraphKey
    lineKey = key
    words.push(word)
    confidences.push(confidence)
  }
  flush()
  return { text: normalizeText(lines.join('\n')), confidence: median(confidences) }
}

/**
 * Straighten one page when the helper measures a tilt worth correcting.
 *
 * A failure at any step keeps the page as it arrived: straightening is an
 * improvement, never a precondition.
 * @param options - runtime, binaries, and limits.
 * @param source - the page image on disk.
 * @param output - where the straightened copy goes.
 * @param dir - working directory for the helper.
 * @param deadline - epoch milliseconds this document must finish by.
 * @returns the path to recognize, which is `source` when nothing was applied.
 */
async function straighten(options: OcrOptions, source: string, output: string, dir: string, deadline: number): Promise<string> {
  if (options.binaries.python.length === 0) return source
  try {
    const run = await runBounded(
      options,
      [options.binaries.python, toolsPath(options), 'deskew', source, output],
      dir,
      undefined,
      bounded(DESKEW_TIMEOUT_MS, deadline),
      MAX_DIAGNOSTIC_BYTES,
    )
    if (run.timedOut || run.exitCode !== 0) return source
    const report = readReport(run.stdout)
    // The helper reports the angle even when it improved nothing, so the copy
    // is only used when the reading changed.
    return report?.['applied'] === true && existsSync(output) ? output : source
  } catch {
    // A missing helper or a provider failure leaves the page untouched.
    return source
  }
}

/**
 * Re-read pages with RapidOCR in one model load.
 *
 * The engine loads ~50 MB of ONNX models per process, so a whole page set goes
 * in one call instead of one call per page.
 * @param options - runtime, binaries, and limits.
 * @param files - page images to read, in the order they should come back.
 * @param dir - working directory for the helper.
 * @param deadline - epoch milliseconds this document must finish by.
 * @returns text by file path; empty when the engine is absent or failed.
 */
async function rapidRead(
  options: OcrOptions,
  files: readonly string[],
  dir: string,
  deadline: number,
): Promise<Map<string, OcrReading>> {
  const readings = new Map<string, OcrReading>()
  if (options.binaries.python.length === 0 || files.length === 0) return readings
  try {
    const run = await runBounded(
      options,
      [options.binaries.python, toolsPath(options), 'rapid', ...files],
      dir,
      undefined,
      bounded(RAPID_TIMEOUT_MS, deadline),
      MAX_RAPID_STDOUT_BYTES,
    )
    if (run.timedOut || run.exitCode !== 0) return readings
    const report = readReport(run.stdout)
    const pages = report?.['files']
    if (!Array.isArray(pages)) return readings
    for (const page of pages) {
      if (typeof page !== 'object' || page === null) continue
      const entry = page as Record<string, unknown>
      const file = entry['file']
      const text = entry['text']
      if (typeof file !== 'string' || typeof text !== 'string' || text.trim().length === 0) continue
      const confidence = typeof entry['confidence'] === 'number' ? entry['confidence'] : 0
      readings.set(file, { text: normalizeText(text), confidence })
    }
    return readings
  } catch {
    // Escalation is an improvement over the first reading, not a requirement.
    return readings
  }
}

/**
 * Read the single JSON document the helper prints, tolerating leading noise.
 * @param stdout - the helper's stdout.
 * @returns the parsed object, or undefined when it printed none.
 */
function readReport(stdout: string): Record<string, unknown> | undefined {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed: unknown = JSON.parse(stdout.slice(start, end + 1))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** A reading with no text, used where an attempt produced none. */
const EMPTY_READING: OcrReading = { text: '', confidence: 0 }

/**
 * Run Tesseract on one image file and rebuild its text.
 * @param options - runtime, binaries, and limits.
 * @param path - the image on disk.
 * @param dir - working directory for the child.
 * @param deadline - epoch milliseconds this document must finish by.
 * @returns the reading, and the reason there is none.
 */
/** One page's first reading, and why it has none. */
interface Recognized {
  /** The text Tesseract read, with its median word confidence. */
  readonly reading: OcrReading
  /** Why the run produced no text, or null when it ran to completion. */
  readonly failed: OcrFailure | null
}

async function recognize(options: OcrOptions, path: string, dir: string, deadline: number): Promise<Recognized> {
  try {
    const run = await runBounded(
      options,
      [options.binaries.tesseract, path, ...TESSERACT_ARGV],
      dir,
      undefined,
      bounded(options.pageTimeoutMs ?? PAGE_TIMEOUT_MS, deadline),
      MAX_TESSERACT_STDOUT_BYTES,
    )
    if (run.timedOut) return { reading: EMPTY_READING, failed: 'timeout' }
    if (run.exitCode !== 0) return { reading: EMPTY_READING, failed: 'failed' }
    return { reading: readTesseract(run.stdout), failed: null }
  } catch {
    // A provider or decode failure skips this attachment only; the caller still
    // returns the mail body and the reason this attachment carries no text.
    return { reading: EMPTY_READING, failed: 'failed' }
  }
}

/**
 * Read one image: straighten it, read it with Tesseract, and re-read it with
 * RapidOCR when Tesseract's own confidence says the page was not read well.
 * @param bytes - the image file's bytes, written to the scratch directory.
 * @param options - runtime, binaries, and limits.
 * @param dir - scratch directory this attempt owns.
 * @returns the recognized text, or the reason there is none.
 */
export async function ocrImage(bytes: Uint8Array, options: OcrOptions, dir: string): Promise<OcrOutcome> {
  if (bytes.byteLength === 0) return { text: '', skipped: 'failed' }
  if (options.binaries.tesseract.length === 0) return { text: '', skipped: 'converter-missing' }
  const deadline = Date.now() + (options.totalTimeoutMs ?? TOTAL_TIMEOUT_MS)
  const source = join(dir, 'source.img')
  try {
    writeFileSync(source, bytes)
  } catch {
    return { text: '', skipped: 'failed' }
  }
  const page = await straighten(options, source, join(dir, 'straight.jpg'), dir, deadline)
  const first = await recognize(options, page, dir, deadline)
  if (first.failed !== null) return { text: '', skipped: first.failed }
  if (first.reading.confidence >= ESCALATE_BELOW) return { text: clamp(first.reading.text, options), skipped: null }
  const escalated = (await rapidRead(options, [page], dir, deadline)).get(page)
  if (escalated !== undefined) return { text: clamp(escalated.text, options), skipped: null }
  // No second engine: the first reading is still the answer, however weak.
  return { text: clamp(first.reading.text, options), skipped: null }
}

/**
 * Read a PDF page by page: render with `pdftoppm`, straighten each page, then
 * recognize it.
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

/** One page's place in the assembled answer. */
interface PageReading {
  /** The page image the reading came from. */
  readonly path: string
  /** Text this page contributes. */
  text: string
  /** Median word confidence of the first reading. */
  readonly confidence: number
  /** Why this page produced no text, when it did not. */
  readonly failed: OcrFailure | null
}

/**
 * Recognize the rendered pages in order, escalate the weak ones, and mark each
 * page's text.
 *
 * Escalation runs once for the whole page set: the second engine loads its
 * models per process, and a document where several pages photographed badly
 * should pay that once.
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
  const read = Math.min(pages.length, maxPages)
  const readings: PageReading[] = []
  let timedOut = false
  for (let index = 0; index < read; index += 1) {
    if (deadline - Date.now() <= 0) {
      timedOut = true
      break
    }
    const source = join(pagesDir, pages[index] ?? '')
    const page = await straighten(options, source, join(pagesDir, `straight-${String(index + 1)}.jpg`), pagesDir, deadline)
    const first = await recognize(options, page, pagesDir, deadline)
    readings.push({ path: page, text: first.reading.text, confidence: first.reading.confidence, failed: first.failed })
    if (first.failed === 'timeout') {
      timedOut = true
      break
    }
  }
  // Pages the first engine read poorly, or not at all, get one shared second
  // reading; a page it read confidently is left alone.
  const weak = readings.filter(page => page.failed === null && page.confidence < ESCALATE_BELOW)
  if (weak.length > 0) {
    const escalated = await rapidRead(options, weak.map(page => page.path), pagesDir, deadline)
    for (const page of readings) {
      const better = escalated.get(page.path)
      if (better !== undefined) page.text = better.text
    }
  }
  const sections: string[] = []
  let budget = options.maxTextBytes ?? MAX_TEXT_BYTES
  let recognized = 0
  let truncated = false
  for (let index = 0; index < readings.length; index += 1) {
    const page = readings[index]
    if (page === undefined) continue
    if (page.failed === 'timeout') {
      sections.push(`--- página ${String(index + 1)}: tiempo límite ---`)
      break
    }
    if (page.failed !== null) {
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
 * Absolute path of the OCR helper.
 * @param options - the attempt's limits, which may name another installation.
 * @returns the script path the image installs by default.
 */
function toolsPath(options: OcrOptions): string {
  return options.tools ?? TOOLS_PATH
}

/**
 * Trim one attachment's text to the retained-text bound.
 * @param text - the text an engine produced.
 * @param options - the attempt's limits.
 * @returns the text, cut at the bound when it exceeds it.
 */
function clamp(text: string, options: OcrOptions): string {
  const limit = options.maxTextBytes ?? MAX_TEXT_BYTES
  return text.length > limit ? text.slice(0, limit) : text
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
 * Middle value of a list of numbers.
 * @param values - the confidences, in reading order.
 * @returns the median, or 0 when the list is empty.
 */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/**
 * Tesseract's text without its form feeds, trailing blank lines, or padding.
 * @param text - the rebuilt text.
 * @returns the trimmed text.
 */
function normalizeText(text: string): string {
  return text.replaceAll('\f', '').trim()
}
