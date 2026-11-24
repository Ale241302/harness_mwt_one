# Agent Note: attachments without a text layer are read by local OCR

Status: implemented

English | [中文](2026-11-24-attachment-local-ocr.zh.md)

## Problem

Attachment ingestion converted documents with `anydoc` and nothing else, so two real email cases stayed unread. A PDF whose pages are pictures made the converter exit 3 (`needsOcr`); with `ocr: 'reject'` the attachment was dropped as "sin texto extraíble", and the `hosted` path needed `FIRECRAWL_API_KEY`, which the deployment did not have. An image never even reached conversion: `formatForAttachment` knew no image extension, so a photo of a purchase list was reported `unsupported`. The mail reader deliberately keeps inline images (`imap.ts`) for a consumer that did not exist, and `deepseek-flash` cannot see images, so there was no vision path either.

## Decision

Read attachments without a text layer with **local OCR**, through the subprocess seam, best-effort, and keep `hosted` as an option for a deployment that buys a key.

- `packages/faberloom/inbound/src/ocr.ts` owns both paths. `ocrImage` feeds Tesseract one image on stdin (`tesseract - stdout -l spa+eng --psm 3`) and reads the plain text from stdout. `ocrPdf` renders the PDF with `pdftoppm -r 200 -png` into a scratch directory, then sends each rendered page through `ocrImage`, marking pages with `--- página N ---`. Both spawn through `SubprocessRuntime.spawn` (no shell, no `node:child_process`), resolve their binaries with `resolveExecutable`, and never throw past the caller.
- Bounds are explicit and each one has a reason: 25 MB per attachment (the existing `MAX_INPUT_BYTES`), 10 pages per PDF, 20 s per page, 90 s per PDF, 200 KB of retained text. A failure, a timeout, or a protected PDF returns the text collected so far or the reason it stopped, exactly like the converter does today.
- `packages/faberloom/inbound/src/documents.ts` classifies an attachment before converting it: `IMAGES` maps raster extensions to a media type, and the declared `mediaType` decides when the name carries no usable extension (an inline picture pasted into a message). An image goes to `ocrImage` or is reported `ocr-disabled`; it never reaches `anydoc`, which has no image path and would only produce a fake failure. A document goes to `anydoc` first; its text wins when it exists, and a PDF that yields none falls back to `ocrPdf`.
- `AttachmentSkipReason` gains `ocr-disabled` and `ocr-failed`, so a reader can tell "this deployment has no OCR" from "OCR ran and read nothing". `tool-faberloom` renders both as model-facing notes.
- Configuration: `FABERLOOM_OCR` (`off` | `local` | `hosted`) is the switch, as the `ocr` field of `tool-faberloom` and `faberloom-view`, defaulting to `off` in code. The gateway composes each user's profile and, for now, forwards only `ANYDOC_OCR`; `resolveOcrMode` therefore also accepts `local` there, and an explicit `ocr` wins. `hosted` still tells `anydoc` to use Firecrawl Parse with the deployment's Firecrawl key (`anydocApiKey`).
- `Dockerfile` installs `tesseract-ocr`, `tesseract-ocr-spa`, `tesseract-ocr-eng`, and `poppler-utils`: 69 packages, 38.4 MB of downloads, 115 MB of disk. No capability is added to the container.

## Alternatives considered

**Hosted OCR only.** `anydoc --ocr hosted` already existed, but there is no Firecrawl key in the deployment, every page would cost money, and a purchase order would leave the infrastructure. The owner's decision is the opposite: documents stay here.

**A vision model.** `deepseek-flash` cannot see images and no provider key is deployed; a vision provider would be a second external dependency and a data-class problem for business documents.

**OCR the rendered page instead of the PDF text layer.** `pdftotext` would be cheaper than rendering plus recognition, but a mixed PDF would still need page-level decisions, and `anydoc` already produces the better Markdown (headings, tables) whenever a text layer exists.

**Keep images `unsupported`.** The reader keeps inline images on purpose and the product asks for "la foto de una lista"; reporting a supported case as an unsupported format hides a capability the deployment now has.

## Consequences

- The conversion path is now two converters with one classification in front: `anydoc` for documents, Tesseract for pictures and scanned pages. A bad render cannot break the mail read; it degrades to `timeout`, `ocr-failed`, or `empty` with the reason on the tool result.
- The image is larger by ~115 MB and the build needs `apt-get` reachability. A deployment that cannot install Tesseract reports `converter-missing` and keeps working.
- Local OCR reads PDFs and raster images only. A scanned Word or Excel file has no renderer here and stays unconverted; Tesseract returns text, not layout, so a table arrives as lines.
- The gateway still writes `anydocOcr` only. `FABERLOOM_OCR` becomes effective when that composition gains the field; until then the deployment sets `ANYDOC_OCR=local`.

## Testing

`packages/faberloom/inbound/tests/ocr.spec.ts` covers the resolved binaries (both, none, image-only), one image on stdin with its argv and stdio, empty bytes, a missing binary, a non-zero exit, a spawn failure, a page timeout, page rendering and per-page marks, the page cap and its unread notice, a protected PDF, a document whose pages all failed, a missing renderer, and text truncation. `documents.spec.ts` covers the classification (`imageMediaType`, `resolveOcrMode`), an image read by local OCR, an image with OCR off or hosted, a missing Tesseract, an empty OCR result, a failed OCR process, an image typed by media type, a `needsOcr` PDF that falls back, a clean-but-empty PDF that falls back, a PDF the converter reads (OCR never starts), a non-PDF that is not OCR'd, an OCR page timeout, an attachment with no bytes, and the previous converter paths.

Real evidence on the deployed container: the OC 20845 PDF has a text layer (`pdftotext` returns 1463 bytes) and `anydoc` converts it (exit 0, 1592 bytes of Markdown), so the tool path returns the converter's text and OCR is not invoked for it; `ocrPdf` on the same file as the tenant uid returns the order lines (SKUs, quantities, prices) in ~4 s, and `image005.jpg` (a photo of a business card) returns its name, phone, and e-mail.
