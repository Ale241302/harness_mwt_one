# Agent Note: the agent can read a mailbox message and its documents

Status: implemented

English | [中文](2026-09-24-faberloom-mail-read-tool.zh.md)

## Problem

The Email panel could show a message and hand back its attachments, and a routine could learn from a message, but the model could not read one on request. `faberloom_mail_search` returned envelopes only, and the MWT.ONE Correo module holds only the messages already imported; an attached order or proforma sitting in the IMAP mailbox was invisible to the agent, which then answered that it could not read the body or the attachment even though the panel showed the PDF.

## Decision

A new model tool `faberloom_mail_read(uid)` returns the message's plain-text body and every attachment converted to Markdown, so the agent reads the order, proforma, or spec text itself.

- The tool resolves the mounted inbound receiver (`ctx.get('faberloomInbound')`), calls `readEmail(ownerId, uid)`, and converts the attachments with the shared `markdownFromAttachments` helper.
- `faberloom_mail_search` prints each message's `uid` in its rendered line, so the model calls `faberloom_mail_read` with a real uid instead of probing the sequence by hand; the read tool's description and the workspace mail rule forbid that probing and forbid rebuilding an attached file with a report tool, pointing at the Email panel for the original.
- Attachment ingestion moved from `packages/faberloom/view/src/documents.ts` to `packages/faberloom/inbound/src/documents.ts` and is re-exported from the inbound entry, so the panel and the tool share one converter and one `@firecrawl/anydoc` dependency. The tool reads the converter options from its own `Config` (`anydoc`, `anydocOcr`, `anydocApiKey`), which the gateway fills from the same `ANYDOC_*` / `FIRECRAWL_API_KEY` variables as the view.
- Degradation matches the panel: with anydoc off, the subprocess provider absent, the converter missing, or OCR needed, the tool still returns the body and lists the attachments with empty Markdown; it never fails the call.
- A companion `faberloom_mail_attachment(uid, name?)` writes the original attachment bytes into `correo-adjuntos/` under the session workspace and returns their paths, so the user receives the real file and the agent can upload it with the business document tools; the mailbox stays read-only.

## Alternatives considered

**Let the model read the MWT.ONE Correo module instead.** That module only holds imported mail — the threads that motivated this (a live Sondel message) are not imported — and its tools return envelopes, not bodies or attachments.

**Hand the user a download route and have them paste the file.** That keeps the agent blind and pushes the work back to the user, which is exactly the integration gap this closes.

**Duplicate the converter inside `tool-faberloom`.** Two copies of the same bounded subprocess protocol drift; the helper belongs with the mail reader that both consumers already depend on.

## Consequences

- A model request can now spend a document's Markdown in context; the helper's 200 KB per-document cap and the message body bound the added tokens.
- The tool returns document text, not the original binary: the user downloads the original file from the Email panel, and the agent is told not to fabricate a replacement.
- `faberloom_mail_read` reads the primary IMAP connection, like the panel; choosing another connection is left to the search tool's `connectionId` until a consumer needs it here.
- The `@firecrawl/anydoc` runtime dependency and the subprocess peer now sit on `inbound`, not `view`.

## Testing

`packages/faberloom/inbound/tests/documents.spec.ts` covers the converter's format mapping and tolerance paths; the tool's registration and wiring are exercised by the host build and the faberloom tool suite.
