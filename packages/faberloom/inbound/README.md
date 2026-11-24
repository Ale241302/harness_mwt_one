---
description: "Native product inbound receiver (ctx.faberloomInbound): polls the IMAP mailbox the owner configured in Conexiones and turns new messages into routine events, without touching their mail; for users and maintainers of the FaberLoom Rutinas module."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-inbound

English | [中文](README.zh.md)

## Summary

This package closes the loop between the owner's mailbox and their routines. The owner configures an IMAP connection in Conexiones; the receiver polls it on a timer, reads the envelopes of the messages that arrived since its own cursor, and hands each one to the routines engine, where an active routine whose `email` trigger matches the subject starts a run. Nobody has to open the panel, and no mail server has to call us.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.faberloomRoutines`, `ctx.faberloomConnections`, and `ctx.storageDomain` are present:

```yaml
- id: faberloom-inbound
  config:
    ownerId: usuario@ejemplo.com
    enabled: true
    intervalMs: 300000
    mailbox: INBOX
```

`enabled` defaults to off, `intervalMs` to five minutes, `mailbox` to `INBOX`, and a pass reads at most twenty messages **per account**. The first pass of an account looks for **unseen** messages; later passes ask for the mailbox UIDs above that account's stored cursor, so an old mailbox is not replayed.

The receiver reads the owner's credentials through `ctx.faberloomConnections.imap()`, the only accessor that returns a stored secret, which exists for this host-side consumer. The browser still reads the connection list, which never returns it.

### Fetching what a message points at

`fetchPublicResource` is this package's guard for an address a message carries: a downloaded link, a picture the reader paints. It resolves the host, refuses the request when any answer is private, loopback, link-local, multicast or reserved, pins the connection to the checked address with the original `Host` and TLS name, repeats the whole check on every redirect, and bounds time and bytes for the chain. `tool-faberloom` uses it for `faberloom_mail_download`; `view` uses it for `emailImage`. It is exported from the package root because both consumers are mail-facing and neither may depend on the other.

### Reading inside an attachment

`convertAttachments` turns one message's files into Markdown so a reader — the Email panel or `faberloom_mail_read` — sees inside them instead of only the file name. Documents that carry text go through the external `anydoc` converter. Images, and PDF pages that are pictures, go through local OCR: `tesseract` reads one image on stdin, and `pdftoppm` renders a scanned PDF page by page at 200 dpi before each page goes back through Tesseract, with a `--- página N ---` mark per page. Both binaries run on this machine through `ctx.subprocess`, so a document never leaves the deployment and no provider key is needed.

Extraction is best-effort by contract: a missing binary, a protected PDF, a page past its time bound, an attachment past its size bound or a page cap each leave that attachment without text and name the reason — `ocr-disabled`, `ocr-failed`, `timeout`, `empty`, `oversized`, `unsupported`, `converter-missing` — while the mail read still returns its body. An image never reaches the converter: without local OCR it is reported `ocr-disabled`, because sending a picture to the document converter would only produce a fake failure.

`FABERLOOM_OCR` selects the path: `off` (the code's default) skips attachments without text, `local` reads them here, and `hosted` sends PDFs to Firecrawl Parse with `FIRECRAWL_API_KEY`. `ANYDOC_OCR` names the same modes and the gateway still forwards it, so a deployment that sets only that variable gets the same behavior. Bounds are safety invariants, not tunables: 25 MB per attachment, 200 KB of retained text, 20 s per converter run, 20 s per OCR page, 90 s per PDF, 10 pages per PDF.

### Two accounts

A pass reads **every** IMAP connection the owner saved, each with its own cursor. One failing account is reported for that account and the others still run: the report carries an `accounts` array plus the joined `error`, and the failure never stops the pass or hides the working mailbox. The cursor of a failed account is not advanced, so the next pass retries exactly what it missed; re-reading is safe because the event key carries the connection and the message, and the engine dedupes the repeat.

### What a pass does

1. Resolves every IMAP connection; a missing or unusable one is reported for that account, not thrown.
2. Reads the envelopes (`Message-ID`, `From`, `Subject`, `Date`) of the new messages, at most `maxMessages` per account per pass.
3. Hands each one to `ingest` as an `email` event and records the highest UID read.
4. Reports what each account read, what started, and every failure the mailboxes returned.

Idempotency belongs to the engine, not the poller: the event key is the message's `Message-ID` when it has one and the mailbox UID otherwise, so re-reading a message never starts the same run twice.

A desktop that mirrors to the VPS (`FABERLOOM_MIRROR_ENABLED=1`, platform not `web`) reads the same mailbox the VPS reads, and executions do not travel between the two. The VPS owns the mail-triggered runs of cloud-ready routines, so the desktop ingests with `skipCloudReady` and only starts the routines whose steps need the PC; the same message never runs the same routine on both.

The receiver never writes to the mailbox. It does not mark messages read, move them, or delete them: the owner's own mail client keeps whatever state it had. `markSeen` and `moveToTrash` exist in the service as E1 refusals (`WRITE_NOT_APPROVED`), not as silent no-ops, so a caller that tries to mutate the mailbox sees the rejection and the server stays byte-identical.

`searchMailbox(ownerId, query, limit?, connectionId?)` answers a chat query against one mailbox, newest first, and reports its own coverage. It prefers the server's `UID SEARCH`; servers that refuse a UTF-8 charset fall back to matching `From`/`Subject` over the most recent envelopes, and then the result says `complete: false` with `scanned` and `total` instead of presenting the window as the whole mailbox. It is as read-only as the poller and never advances the receiver's cursor, so searching never hides mail from the triggers. The model reaches it through the `faberloom_mail_search` tool, which copies the account into every row and repeats the coverage warning.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing directly. `ctx.faberloomInbound` registers no tools and writes no prompt text; what reaches a model is the step turn of each run it starts, which receives the event in its case context as JSON (`mailbox`, `uid`, `from`, `date`, `receivedAt`).

#### Token effect

Zero direct tokens. Each started run costs what its steps cost.

#### KV Cache effect

Independent of live requests: the poller never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Envelopes only, no body.** A pass fetches header fields; transfer encodings, multiparts, and attachments are not decoded, so a step that needs the message text cannot read it from the event yet.
- **Local OCR covers PDFs and raster images only.** A scanned Word or Excel file stays unconverted: nothing renders its pages to images. Tesseract returns text, not layout, so a table arrives as lines and its columns have to be placed by the reader.
- **Implicit TLS and plain IMAP only.** STARTTLS negotiation is not implemented; the connection's `secure` flag decides between TLS on connect and a plain connection.
- **A pass reads, it does not subscribe.** `IDLE` (server push) is absent by design for now, so a message waits up to one interval. New mail is found by polling.
- **One mailbox per owner.** The receiver reads the first usable IMAP connection; choosing among several is deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The client is a tagged-command subset with a literal-aware buffer: a FETCH response arrives as `* n FETCH (UID n BODY[…]{size}` followed by exactly `size` bytes of headers. It is tested end-to-end against a fake IMAP server built on `node:net`, which also proves the pass does not depend on a real provider.

</details>

**Runtime invariant:** No companion is published. The receiver's own durable state is one cursor per connection, in `faberloom_inbound`; every scheduling decision is derived from that cursor and the mailbox.
