/**
 * Attachment ingestion for the mail module: convert one attachment's bytes to
 * GitHub-Flavored Markdown so a reader — the Email panel or a model tool — sees
 * inside spreadsheets, PDFs, and word-processor files instead of only the file
 * name. Two converters cover what an email actually carries: the external
 * `anydoc` converter for documents that have text of their own, and local OCR
 * ({@link ocrImage} / {@link ocrPdf}) for images and for documents whose pages
 * are pictures. Conversion is best-effort: a missing converter, an unsupported
 * format, a scanned PDF, a non-zero exit, a timeout, or an oversized document
 * all leave that attachment unconverted and never fail the caller.
 * @module
 */
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { ocrImage, ocrPdf, resolveOcrBinaries, type OcrBinaries, type OcrMode, type OcrOutcome } from './ocr.ts'

/** Attachment bytes as the mail reader hands them to a consumer. */
export interface EmailAttachmentBytes {
  /** Original file name, the format hint. */
  readonly name: string
  /** Declared MIME type; unused for format selection. */
  readonly mediaType: string
  /** Base64-encoded file bytes. */
  readonly contentBase64: string
}

/** One attachment converted to Markdown. */
export interface ConvertedDocument {
  /** Original file name. */
  readonly name: string
  /** The converted Markdown. */
  readonly markdown: string
}

/** Why one attachment carries no converted text. */
export type AttachmentSkipReason =
  | 'unsupported'
  | 'oversized'
  | 'timeout'
  | 'failed'
  | 'empty'
  | 'converter-missing'
  /** The attachment is an image and this deployment's OCR is off or hosted. */
  | 'ocr-disabled'
  /** Local OCR ran on this attachment and read nothing usable. */
  | 'ocr-failed'

/** One attachment's outcome: its text, or the reason there is none. */
export interface AttachmentConversion {
  /** Original file name. */
  readonly name: string
  /** Converted Markdown; empty when the attachment was skipped. */
  readonly markdown: string
  /** Why it was skipped, or null when it converted. */
  readonly skipped: AttachmentSkipReason | null
}

/** Everything one conversion batch needs; assembled from the caller's config. */
export interface DocumentIngestOptions {
  /** The host's subprocess provider — the only process-spawning seam allowed here. */
  readonly runtime: SubprocessRuntime
  /** Absolute path to the resolved `anydoc` launcher. */
  readonly bin: string
  /** Whether a page without a text layer is read by local OCR, by Firecrawl, or skipped. */
  readonly ocr: OcrMode
  /** Firecrawl API key for hosted OCR; empty falls back to the converter's environment. */
  readonly apiKey: string
  /** Largest input accepted per attachment; defaults to {@link MAX_INPUT_BYTES}. */
  readonly maxInputBytes?: number
  /** Most PDF pages read by local OCR; defaults to the OCR module's bound. */
  readonly maxOcrPages?: number
  /** Wall-clock bound for one image or one rendered page; defaults to the OCR module's bound. */
  readonly ocrPageTimeoutMs?: number
  /** Wall-clock bound for one whole local OCR attempt; defaults to the OCR module's bound. */
  readonly ocrTotalTimeoutMs?: number
}

/** Extensions `anydoc` reads, mapped to the `--format` value it expects. */
const FORMATS: Readonly<Record<string, string>> = {
  csv: 'csv',
  doc: 'doc',
  docm: 'doc',
  docx: 'docx',
  epub: 'epub',
  odp: 'odp',
  ods: 'ods',
  odt: 'odt',
  pdf: 'pdf',
  ppt: 'ppt',
  pptx: 'pptx',
  ppsx: 'pptx',
  rtf: 'rtf',
  xlsx: 'xlsx',
}

/** Raster image extensions Tesseract reads, mapped to their media type. */
const IMAGES: Readonly<Record<string, string>> = {
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
}

/** Media types the OCR path accepts when the file name carries no usable extension. */
const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set(Object.values(IMAGES))

/** In-memory cap for one converted document; the stream keeps its tail past this. */
const MAX_MARKDOWN_BYTES = 200_000
/** Largest attachment the converter accepts; a bigger one is skipped, never read. */
export const MAX_INPUT_BYTES = 25_000_000
/** In-memory cap for the converter's diagnostics, which are not shown. */
const MAX_STDERR_BYTES = 8_192
/** Per-document wall-clock bound before the managed process range is terminated. */
const TIMEOUT_MS = 20_000
/** Grace the provider gets to drain a terminated range. */
const GRACE_MS = 5_000

/**
 * Format `anydoc` should parse one attachment as, from its file extension.
 * @param name - the attachment's original file name.
 * @returns the `--format` value, or undefined when the format is unsupported.
 */
export function formatForAttachment(name: string): string | undefined {
  return FORMATS[extensionOf(name)]
}

/**
 * Media type of an attachment that is a raster image Tesseract reads.
 *
 * The extension decides first, because a photo saved as `foto.jpg` is a JPEG
 * whoever sent it; the declared MIME type decides when the name carries no
 * usable extension, which is what an inline picture pasted into a message
 * looks like.
 * @param name - the attachment's original file name.
 * @param mediaType - the declared MIME type.
 * @returns the image media type, or undefined when this is not an image.
 */
export function imageMediaType(name: string, mediaType: string): string | undefined {
  const byExtension = IMAGES[extensionOf(name)]
  if (byExtension !== undefined) return byExtension
  const declared = mediaType.split(';')[0]?.trim().toLowerCase() ?? ''
  return IMAGE_MEDIA_TYPES.has(declared) ? declared : undefined
}

/**
 * Lower-case extension of one file name.
 * @param name - the attachment's original file name.
 * @returns the extension without its dot, or '' when the name has none.
 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * The OCR mode a deployment declared.
 *
 * `FABERLOOM_OCR` — the plugin's `ocr` field — is the switch. `ANYDOC_OCR`
 * (`anydocOcr`) predates it and the gateway writes only that field into each
 * user's composition, so it also accepts `local` and `hosted`; an explicit
 * `ocr` value wins when both are set.
 * @param ocr - the `FABERLOOM_OCR` value.
 * @param anydocOcr - the `ANYDOC_OCR` value the deployment forwards.
 * @returns the mode to run, defaulting to `off`.
 */
export function resolveOcrMode(ocr: string | undefined, anydocOcr: string | undefined): OcrMode {
  if (ocr === 'local' || ocr === 'hosted' || ocr === 'off') return ocr
  return anydocOcr === 'local' || anydocOcr === 'hosted' ? anydocOcr : 'off'
}

/**
 * Resolve the `anydoc` launcher through the Node module graph so the path is
 * correct in any pnpm layout. Resolution is attempted only when the caller
 * enabled ingestion, and a missing or unreadable package is not an error.
 * @returns the absolute launcher path, or undefined when the package is absent.
 */
export function resolveAnyDocBin(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const manifestPath = require.resolve('@firecrawl/anydoc/package.json')
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (typeof manifest !== 'object' || manifest === null) return undefined
    const bin = (manifest as { bin?: unknown }).bin
    const relative = typeof bin === 'string' ? bin : typeof bin === 'object' && bin !== null ? (bin as Record<string, unknown>).anydoc : undefined
    return typeof relative === 'string' ? resolve(dirname(manifestPath), relative) : undefined
  } catch {
    // The converter is optional: absence disables ingestion, it is not a failure.
    return undefined
  }
}

/**
 * The program and leading arguments that launch the resolved converter. A
 * JavaScript launcher runs under the current Node so Windows needs no exec bit.
 * @param bin - the resolved launcher path.
 * @returns argv with `argv[0]` the executable.
 */
function launcherArgv(bin: string): string[] {
  return /\.(?:c|m)?js$/i.test(bin) ? [process.execPath, bin] : [bin]
}

/**
 * Convert one attachment to Markdown, or say why it yields none.
 * @param file - the attachment bytes and format hint.
 * @param options - the converters, OCR choice, size bound, and abort bound.
 * @param dir - the scratch directory the input file is written under.
 * @param binaries - resolved local OCR executables, or undefined when off.
 * @returns the Markdown with a null reason, or an empty text with the reason.
 */
async function convertOne(
  file: EmailAttachmentBytes,
  options: DocumentIngestOptions,
  dir: string,
  binaries: OcrBinaries | undefined,
): Promise<AttachmentConversion> {
  const skip = (skipped: AttachmentSkipReason): AttachmentConversion => ({ name: file.name, markdown: '', skipped })
  const image = imageMediaType(file.name, file.mediaType)
  if (image !== undefined) {
    // An image is read by local OCR or not at all: the converter has no image
    // path, so the reason names the missing OCR instead of the file format.
    if (options.ocr !== 'local') return skip('ocr-disabled')
    if (binaries === undefined) return skip('converter-missing')
    const photo = decodeAttachment(file, options)
    if ('skipped' in photo) return skip(photo.skipped)
    return fromOcr(file.name, 'ocr-failed', await ocrIn(options, binaries, dir, photo.bytes, 'image'))
  }
  const format = formatForAttachment(file.name)
  if (format === undefined) return skip('unsupported')
  if (options.bin.length === 0) return skip('converter-missing')
  const decoded = decodeAttachment(file, options)
  if ('skipped' in decoded) return skip(decoded.skipped)
  return convertDocument(file, options, dir, binaries, format, decoded.bytes)
}

/** One attachment's decoded bytes, or the reason they cannot be used. */
type DecodedBytes = { readonly bytes: Buffer } | { readonly skipped: AttachmentSkipReason }

/**
 * Decode one attachment and apply the size bound.
 * @param file - the attachment bytes and format hint.
 * @param options - the size bound, when the deployment overrides it.
 * @returns the real bytes, or the reason this attachment yields none.
 */
function decodeAttachment(file: EmailAttachmentBytes, options: DocumentIngestOptions): DecodedBytes {
  let bytes: Buffer
  try {
    bytes = Buffer.from(file.contentBase64, 'base64')
  } catch {
    return { skipped: 'failed' }
  }
  if (bytes.length > (options.maxInputBytes ?? MAX_INPUT_BYTES)) return { skipped: 'oversized' }
  return bytes.length === 0 ? { skipped: 'empty' } : { bytes }
}

/**
 * Run one attachment's bytes through the converter, then fall back to local
 * OCR for a PDF whose pages carry no text.
 *
 * The converter names a scanned PDF with its own exit code (3) and any other
 * unreadable document with 1; both mean it produced no text, so a PDF gets one
 * local OCR attempt whenever the converter yields none.
 * @param file - the attachment bytes and format hint.
 * @param options - the converters, OCR choice, size bound, and abort bound.
 * @param dir - the scratch directory the input file is written under.
 * @param binaries - resolved local OCR executables, or undefined when off.
 * @param format - the `anydoc` format named by the file extension.
 * @param bytes - the attachment's decoded bytes.
 * @returns the converted text, or the reason there is none.
 */
async function convertDocument(
  file: EmailAttachmentBytes,
  options: DocumentIngestOptions,
  dir: string,
  binaries: OcrBinaries | undefined,
  format: string,
  bytes: Buffer,
): Promise<AttachmentConversion> {
  const converted = await convertWithAnyDoc(file, options, dir, format)
  if (converted.markdown.length > 0) return converted
  // The converter's text wins whenever it exists; OCR only covers the pages it
  // cannot read, which is the scanned PDF anydoc reports as `needsOcr`.
  if (options.ocr !== 'local' || binaries === undefined || format !== 'pdf') return converted
  return fromOcr(file.name, 'ocr-failed', await ocrIn(options, binaries, dir, bytes, 'pdf'))
}

/**
 * Convert one document with the external converter.
 * @param file - the attachment bytes and format hint.
 * @param options - the converter, OCR choice, size bound, and abort bound.
 * @param dir - the scratch directory the input file is written under.
 * @param format - the `anydoc` format named by the file extension.
 * @returns the Markdown with a null reason, or an empty text with the reason.
 */
async function convertWithAnyDoc(
  file: EmailAttachmentBytes,
  options: DocumentIngestOptions,
  dir: string,
  format: string,
): Promise<AttachmentConversion> {
  const skip = (skipped: AttachmentSkipReason): AttachmentConversion => ({ name: file.name, markdown: '', skipped })
  const input = join(dir, 'source')
  try {
    writeFileSync(input, Buffer.from(file.contentBase64, 'base64'))
  } catch {
    return skip('failed')
  }
  const argv = [...launcherArgv(options.bin), input, '--format', format]
  if (options.ocr === 'hosted') argv.push('--ocr', 'hosted')
  if (options.ocr === 'hosted' && options.apiKey.length > 0) argv.push('--api-key', options.apiKey)
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, TIMEOUT_MS)
  try {
    const handle = options.runtime.spawn({
      argv,
      cwd: dir,
      stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_MARKDOWN_BYTES }, stderr: { maxBytes: MAX_STDERR_BYTES } },
      graceMs: GRACE_MS,
      signal: controller.signal,
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) return skip('failed')
    const read = handle.collected.stdout?.readFrom(0)
    const markdown = read === undefined ? '' : read.text
    return markdown.trim().length === 0
      ? skip('empty')
      : { name: file.name, markdown, skipped: null }
  } catch {
    // A spawn, provider, or termination failure skips this document only.
    return skip(controller.signal.aborted ? 'timeout' : 'failed')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Run local OCR for one attachment in its own scratch directory.
 * @param options - the converters, OCR choice, size bound, and abort bound.
 * @param binaries - resolved local OCR executables.
 * @param dir - the batch's scratch directory.
 * @param bytes - the attachment's decoded bytes.
 * @param kind - which OCR entry point to use.
 * @returns the OCR outcome.
 */
async function ocrIn(
  options: DocumentIngestOptions,
  binaries: OcrBinaries,
  dir: string,
  bytes: Buffer,
  kind: 'image' | 'pdf',
): Promise<OcrOutcome> {
  const work = mkdtempSync(join(dir, 'ocr-'))
  try {
    const ocr = {
      runtime: options.runtime,
      binaries,
      ...options.maxOcrPages === undefined ? {} : { maxPages: options.maxOcrPages },
      ...options.ocrPageTimeoutMs === undefined ? {} : { pageTimeoutMs: options.ocrPageTimeoutMs },
      ...options.ocrTotalTimeoutMs === undefined ? {} : { totalTimeoutMs: options.ocrTotalTimeoutMs },
    }
    return kind === 'image' ? await ocrImage(bytes, ocr, work) : await ocrPdf(bytes, ocr, work)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * Turn one OCR outcome into an attachment conversion.
 * @param name - the attachment's original file name.
 * @param failure - the reason used when OCR read nothing at all.
 * @param outcome - the OCR result.
 * @returns the text, or the mapped skip reason.
 */
function fromOcr(name: string, failure: AttachmentSkipReason, outcome: OcrOutcome): AttachmentConversion {
  if (outcome.text.trim().length > 0) return { name, markdown: outcome.text, skipped: null }
  switch (outcome.skipped) {
    case null: return { name, markdown: '', skipped: 'empty' }
    case 'converter-missing': return { name, markdown: '', skipped: 'converter-missing' }
    case 'timeout': return { name, markdown: '', skipped: 'timeout' }
    case 'failed': return { name, markdown: '', skipped: failure }
  }
}

/**
 * Convert every attachment in one batch, reporting each outcome.
 *
 * One scratch directory holds the transient inputs and is removed on every exit
 * path. The originals are never modified: the bytes are copied into the scratch
 * file and the caller keeps its own.
 * @param files - the attachments carried by one email.
 * @param options - the converters, OCR choice, size bound, and abort bound.
 * @returns one entry per attachment, in the order received.
 */
export async function convertAttachments(
  files: readonly EmailAttachmentBytes[],
  options: DocumentIngestOptions,
): Promise<AttachmentConversion[]> {
  if (files.length === 0) return []
  const dir = mkdtempSync(join(tmpdir(), 'dsh-faberloom-anydoc-'))
  try {
    // Resolved once per batch: every image and scanned page in this email shares
    // one execution world, and a world without Tesseract costs no spawn.
    const binaries = options.ocr === 'local' ? await resolveOcrBinaries(options.runtime) : undefined
    const conversions: AttachmentConversion[] = []
    for (const file of files) conversions.push(await convertOne(file, options, dir, binaries))
    return conversions
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Convert every supported attachment in one batch to Markdown.
 * @param files - the attachments carried by one email.
 * @param options - the converters, OCR choice, size bound, and abort bound.
 * @returns one entry per attachment that converted to non-empty Markdown.
 */
export async function markdownFromAttachments(
  files: readonly EmailAttachmentBytes[],
  options: DocumentIngestOptions,
): Promise<ConvertedDocument[]> {
  const conversions = await convertAttachments(files, options)
  return conversions
    .filter(conversion => conversion.markdown.length > 0)
    .map(conversion => ({ name: conversion.name, markdown: conversion.markdown }))
}
