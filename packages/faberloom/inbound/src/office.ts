/**
 * Local OCR for a Word, Excel, PowerPoint, OpenDocument, or RTF file whose pages
 * are pictures: the file is converted to PDF with `libreoffice --headless`, and
 * the PDF goes through {@link ocrPdf} page by page.
 *
 * A scanned office document has no text anydoc can read — the content sits in
 * images inside the package — so this path only matters when the converter
 * yields nothing. Conversion runs on the deployment's own machine through the
 * subprocess seam, so the document never leaves the infrastructure.
 *
 * Extraction is best-effort like the rest of attachment ingestion: a missing
 * converter, a conversion past its deadline, a zero-byte PDF, or a provider
 * failure returns the reason instead of throwing past the caller's conversion.
 * @module
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { ocrPdf, runBounded, type OcrFailure, type OcrOptions, type OcrOutcome } from './ocr.ts'

/** Everything one office conversion needs beyond the bytes. */
export interface OfficeOcrOptions extends OcrOptions {
  /** Absolute path of `libreoffice` (`soffice`), or empty when this world has none. */
  readonly libreoffice: string
  /** Wall-clock bound for the conversion step; the whole attempt is still bounded by `totalTimeoutMs`. */
  readonly convertTimeoutMs?: number
  /** Largest PDF the conversion may produce; a bigger one is reported unread instead of loaded. */
  readonly maxPdfBytes?: number
}

/** LibreOffice's first run in a container unpacks its profile; cold starts take seconds. */
const CONVERT_TIMEOUT_MS = 60_000
/** Conversion plus the PDF OCR it feeds: the converter bound and `ocrPdf`'s whole-document bound. */
const TOTAL_TIMEOUT_MS = 150_000
/** Produced PDF retained for OCR; a bigger one is reported unread before it is loaded. */
const MAX_PDF_BYTES = 50_000_000
/** Retained diagnostics per process; LibreOffice's filter messages are not shown. */
const MAX_DIAGNOSTIC_BYTES = 8_192

/**
 * Resolve the office converter this execution world provides.
 * @param runtime - the host's subprocess provider.
 * @param signal - optional bound for the lookup.
 * @returns the canonical path, or '' when this world has no `libreoffice`.
 */
export async function resolveOfficeBin(runtime: SubprocessRuntime, signal?: AbortSignal): Promise<string> {
  try {
    return await runtime.resolveExecutable('libreoffice', undefined, signal)
  } catch {
    // Absence is a supported deployment: the caller reports `converter-missing`
    // and keeps the converter's own reason for the document.
    return ''
  }
}

/**
 * Convert one office document to PDF, then read every page with local OCR.
 *
 * Each conversion runs under its own LibreOffice profile inside the scratch
 * directory, so two attachments in one batch do not contend for the single
 * profile lock.
 * @param bytes - the document's bytes.
 * @param name - the original file name; its extension tells LibreOffice which filter to use.
 * @param options - runtime, OCR binaries, converter path, and limits.
 * @param dir - the batch's scratch directory; the conversion's own subdirectory is created under it and removed.
 * @returns the page-marked text, or the reason there is none.
 */
export async function ocrOffice(
  bytes: Uint8Array,
  name: string,
  options: OfficeOcrOptions,
  dir: string,
): Promise<OcrOutcome> {
  if (bytes.byteLength === 0) return { text: '', skipped: 'failed' }
  // A missing Tesseract or renderer cannot read the PDF this would produce, so
  // the conversion is not started at all.
  if (options.libreoffice.length === 0 || options.binaries.tesseract.length === 0 || options.binaries.pdftoppm.length === 0) {
    return { text: '', skipped: 'converter-missing' }
  }
  const deadline = Date.now() + (options.totalTimeoutMs ?? TOTAL_TIMEOUT_MS)
  let work: string | undefined
  try {
    work = mkdtempSync(join(dir, 'office-'))
    const input = join(work, `source.${officeExtension(name)}`)
    writeFileSync(input, bytes)
    const conversion = await convertToPdf(options, work, input, remaining(options.convertTimeoutMs ?? CONVERT_TIMEOUT_MS, deadline))
    if (conversion !== null) return { text: '', skipped: conversion }
    const pdf = readProducedPdf(work, options.maxPdfBytes ?? MAX_PDF_BYTES)
    if (pdf === null) return { text: '', skipped: 'failed' }
    const budget = remaining(options.totalTimeoutMs ?? TOTAL_TIMEOUT_MS, deadline)
    return await ocrPdf(pdf, { ...toOcrOptions(options), totalTimeoutMs: budget }, work)
  } catch {
    // A scratch, write, reader, or provider failure skips this attachment only;
    // the mail read still returns its body and the reason this file has no text.
    return { text: '', skipped: 'failed' }
  } finally {
    if (work !== undefined) rmSync(work, { recursive: true, force: true })
  }
}

/**
 * Run one conversion and check that it ended cleanly.
 * @param options - runtime, converter path, and limits.
 * @param work - scratch directory the child runs in and writes the PDF to.
 * @param input - the written document.
 * @param timeoutMs - wall-clock bound for this step.
 * @returns null when the run ended cleanly, or the reason it did not.
 */
async function convertToPdf(
  options: OfficeOcrOptions,
  work: string,
  input: string,
  timeoutMs: number,
): Promise<OcrFailure | null> {
  const run = await runBounded(
    toOcrOptions(options),
    [
      options.libreoffice,
      '--headless',
      '--norestore',
      // A private profile per run: the shared one is a single lock, and a second
      // concurrent conversion would fail with "source file could not be loaded".
      `-env:UserInstallation=${pathToFileURL(join(work, 'profile')).href}`,
      '--convert-to',
      'pdf',
      '--outdir',
      work,
      input,
    ],
    work,
    undefined,
    timeoutMs,
    MAX_DIAGNOSTIC_BYTES,
  )
  if (run.timedOut) return 'timeout'
  return run.exitCode === 0 ? null : 'failed'
}

/**
 * The PDF the conversion wrote, if it is present and within the size bound.
 * @param work - scratch directory the conversion wrote to.
 * @param maxPdfBytes - largest PDF retained.
 * @returns the PDF bytes, or null when there is no usable output.
 */
function readProducedPdf(work: string, maxPdfBytes: number): Buffer | null {
  const name = readdirSync(work).find(entry => entry.toLowerCase().endsWith('.pdf'))
  if (name === undefined) return null
  const path = join(work, name)
  const size = statSync(path).size
  // The size is checked before the read: a runaway conversion must not be
  // loaded only to be rejected.
  if (size === 0 || size > maxPdfBytes) return null
  return readFileSync(path)
}

/**
 * The OCR subset of the office options, for the steps that only recognize pages.
 * @param options - office runtime, binaries, and limits.
 * @returns the same limits without the converter-specific fields.
 */
function toOcrOptions(options: OfficeOcrOptions): OcrOptions {
  return {
    runtime: options.runtime,
    binaries: options.binaries,
    ...options.maxPages === undefined ? {} : { maxPages: options.maxPages },
    ...options.pageTimeoutMs === undefined ? {} : { pageTimeoutMs: options.pageTimeoutMs },
    ...options.totalTimeoutMs === undefined ? {} : { totalTimeoutMs: options.totalTimeoutMs },
    ...options.maxTextBytes === undefined ? {} : { maxTextBytes: options.maxTextBytes },
  }
}

/**
 * Extension LibreOffice uses to pick a filter, from the original file name.
 *
 * The name reaches a path, so only a short alphanumeric extension is accepted;
 * anything else becomes `bin`, which makes LibreOffice refuse the file instead
 * of writing outside the scratch directory.
 * @param name - the original file name.
 * @returns the lower-case extension, or `bin` when the name carries none usable.
 */
function officeExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  const extension = dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
  return /^[a-z0-9]{1,8}$/u.test(extension) ? extension : 'bin'
}

/**
 * Remaining time for one step, never below the provider's minimum useful slice.
 * @param step - the step's own bound in milliseconds.
 * @param deadline - epoch milliseconds this document must finish by.
 * @returns the smaller of the two, and at least one millisecond.
 */
function remaining(step: number, deadline: number): number {
  return Math.max(1, Math.min(step, deadline - Date.now()))
}
