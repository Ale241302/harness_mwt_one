/**
 * Attachment ingestion for the mail module: convert one attachment's bytes to
 * GitHub-Flavored Markdown with the external `anydoc` converter, so a reader —
 * the Email panel or a model tool — sees inside spreadsheets, PDFs, and
 * word-processor files instead of only the file name. Conversion is
 * best-effort: a missing converter, an unsupported format, a scanned PDF that
 * needs OCR, a non-zero exit, a timeout, or an oversized document all leave
 * that attachment unconverted and never fail the caller.
 * @module
 */
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

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

/** Everything one conversion batch needs; assembled from the caller's config. */
export interface DocumentIngestOptions {
  /** The host's subprocess provider — the only process-spawning seam allowed here. */
  readonly runtime: SubprocessRuntime
  /** Absolute path to the resolved `anydoc` launcher. */
  readonly bin: string
  /** How a scanned PDF is handled: `reject` skips it, `hosted` sends it to Firecrawl Parse. */
  readonly ocr: 'reject' | 'hosted'
  /** Firecrawl API key for hosted OCR; empty falls back to the converter's environment. */
  readonly apiKey: string
  /** Bound for the whole batch, so one slow document cannot hold the caller open. */
  readonly signal?: AbortSignal | undefined
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

/** In-memory cap for one converted document; the stream keeps its tail past this. */
const MAX_MARKDOWN_BYTES = 200_000
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
  const dot = name.lastIndexOf('.')
  if (dot < 0) return undefined
  return FORMATS[name.slice(dot + 1).toLowerCase()]
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
 * Convert one attachment to Markdown, or skip it on any tolerated failure.
 * @param file - the attachment bytes and format hint.
 * @param options - the converter, OCR choice, and abort bound.
 * @param dir - the scratch directory the input file is written under.
 * @returns the Markdown, or undefined when this attachment yields none.
 */
async function convertOne(file: EmailAttachmentBytes, options: DocumentIngestOptions, dir: string): Promise<string | undefined> {
  const format = formatForAttachment(file.name)
  if (format === undefined) return undefined
  const input = join(dir, 'source')
  try {
    writeFileSync(input, Buffer.from(file.contentBase64, 'base64'))
  } catch {
    return undefined
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
    if (outcome.exitCode !== 0) return undefined
    const read = handle.collected.stdout?.readFrom(0)
    const markdown = read === undefined ? '' : read.text
    return markdown.trim().length === 0 ? undefined : markdown
  } catch {
    // A spawn, provider, or termination failure skips this document only.
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Convert every supported attachment in one batch to Markdown. One scratch
 * directory holds the transient inputs and is removed on every exit path.
 * @param files - the attachments carried by one email.
 * @param options - the converter, OCR choice, and abort bound.
 * @returns one entry per attachment that converted to non-empty Markdown.
 */
export async function markdownFromAttachments(
  files: readonly EmailAttachmentBytes[],
  options: DocumentIngestOptions,
): Promise<ConvertedDocument[]> {
  if (files.length === 0) return []
  const dir = mkdtempSync(join(tmpdir(), 'dsh-faberloom-anydoc-'))
  try {
    const documents: ConvertedDocument[] = []
    for (const file of files) {
      const markdown = await convertOne(file, options, dir)
      if (markdown !== undefined) documents.push({ name: file.name, markdown })
    }
    return documents
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
