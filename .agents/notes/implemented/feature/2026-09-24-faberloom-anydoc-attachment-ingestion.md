# Agent Note: email attachments are ingested as Markdown

Status: implemented

English | [中文](2026-09-24-faberloom-anydoc-attachment-ingestion.zh.md)

## Problem

The Email panel could attach a file to a space and hand it back to the user, but the model never read inside it. `spaceFromEmail` and `learnFromEmail` only ever saw the message body, so a routine that creates or updates an expediente could not learn the SKU, tallas, cantidad, or precio that live inside an attached xlsx, and an emailed PDF was opaque noise. The workflow the product promises — "the routine updates the record from the email" — stalled at the attachment.

## Decision

Email attachments are converted to GitHub-Flavored Markdown with the external `anydoc` converter and remembered as Space memory, opt-in and best-effort.

- `packages/faberloom/inbound/src/documents.ts` (owned by the mail reader, so every consumer shares it) resolves the converter through the Node module graph (`createRequire` on `@firecrawl/anydoc/package.json`, then its `bin` entry) and spawns its `cli.js` launcher through the harness subprocess provider (`ctx.get('subprocess')`), never through `node:child_process`. A JavaScript launcher runs under the current Node so Windows needs no exec bit.
- Conversion is tolerant by construction: an unsupported extension, an absent subprocess provider, an unresolvable or uninstalled converter, a non-zero exit (including exit 3, "the PDF needs OCR"), a spawn failure, or a timeout all skip that one attachment and leave the caller working with the body alone. Its scratch directory is removed on every exit path.
- `spaceFromEmail` remembers each converted document in the new space; `learnFromEmail` remembers it owner-wide and appends the Markdown to the extraction prompt. Memory text and prompt share the same bounded slice.
- The choice is deployment configuration: `anydoc` (boolean, default `false`), `anydocOcr` (`reject` skips a scanned PDF; `hosted` sends it to Firecrawl Parse, default `reject`), and `anydocApiKey` (empty defers to the converter's environment). Bounds are fixed safety invariants, not tunables: 200 KB of retained Markdown, 8 KB of diagnostics, 20 s per document, 5 s termination grace.

## Alternatives considered

**Import the package as a library.** `@firecrawl/anydoc` ships only a `cli.js` launcher that drives a prebuilt native binary; there is no programmatic API, so spawning its bin is the supported surface.

**Spawn with `node:child_process`.** It bypasses the harness subprocess provider, its terminated-range management, and its scrubbed environment; the repo routes every process through that seam.

**Ingest always, not opt-in.** A process spawn and a new host dependency on every email is a real cost for deployments that never receive a convertible attachment; an off-by-default flag keeps them byte-identical to today.

**Fix OCR to `reject`.** Scanned PDFs are a common real case, and hosted OCR costs a Firecrawl call and needs a key, so the mode and the key are deployment choices rather than a literal.

## Consequences

- The `inbound` package gains the runtime dependency `@firecrawl/anydoc` and the peer `@deepseek-ai/dsh-subprocess`, with a project reference from its `tsconfig.json`; `pnpm-lock.yaml` moves. The view and the `faberloom_mail_read` tool both reach the converter through `inbound`.
- Failure is soft by design: a conversion failure degrades to the previous body-only behavior and never fails the panel, so the feature is invisible until it works.
- The deployed host must install `@firecrawl/anydoc`, and the first conversion may fetch the platform binary; a deployment that cannot download it simply skips ingestion.

## Testing

`packages/faberloom/inbound/tests/documents.spec.ts` covers format mapping, the no-spawn paths (empty batch, unsupported attachment), a successful conversion with its argv and stdio, hosted-OCR argv, a non-zero exit, and one failing spawn among two documents. A real invocation of `node <anydoc>/cli.js <file> --format csv` was run once on Windows to confirm the binary converts.
