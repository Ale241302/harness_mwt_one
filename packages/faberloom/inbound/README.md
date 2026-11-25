---
description: "Native product inbound receiver (ctx.faberloomInbound): polls the IMAP mailboxes the owner configured in Conexiones and the MCP mail servers mounted for them, and turns new messages into routine events without touching their mail; for users and maintainers of the FaberLoom Rutinas module."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-inbound

English | [中文](README.zh.md)

## Summary

This package closes the loop between the owner's mailbox and their routines. The owner configures an IMAP connection in Conexiones, or mounts an MCP server that carries their mail; the receiver polls both on a timer, reads the envelopes of the messages that arrived since its own cursor, and hands each one to the routines engine, where an active routine whose `email` trigger matches the subject starts a run. Nobody has to open the panel, and no mail server has to call us.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.faberloomRoutines`, `ctx.faberloomConnections`, and `ctx.storageDomain` are present. `ctx.faberloomMcpRegistry` is optional: when it is mounted, the receiver also watches the MCP mail servers that owner saved.

```yaml
- id: faberloom-inbound
  config:
    ownerId: usuario@ejemplo.com
    enabled: true
    intervalMs: 300000
    sweepIntervalMs: 300000
    sweepBatch: 200
    mailbox: INBOX
```

`enabled` defaults to off, `intervalMs` and `sweepIntervalMs` to five minutes, `sweepBatch` to 200 (between 1 and 1000), and `mailbox` to `INBOX`. A poll reads up to `maxMessages` (twenty) **per batch** and keeps reading past a full batch until the mailbox has no more mail above the cursor, so a backlog is not cut at twenty messages. The first view of an account stores the mailbox top as its baseline and ingests nothing: installing the watcher never answers the history, whatever its flags or dates.

The receiver reads the owner's credentials through `ctx.faberloomConnections.imap()`, the only accessor that returns a stored secret, which exists for this host-side consumer. The browser still reads the connection list, which never returns it.

### Fetching what a message points at

`fetchPublicResource` is this package's guard for an address a message carries: a downloaded link, a picture the reader paints. It resolves the host, refuses the request when any answer is private, loopback, link-local, multicast or reserved, pins the connection to the checked address with the original `Host` and TLS name, repeats the whole check on every redirect, and bounds time and bytes for the chain. `tool-faberloom` uses it for `faberloom_mail_download`; `view` uses it for `emailImage`. It is exported from the package root because both consumers are mail-facing and neither may depend on the other.

### Reading inside an attachment

`convertAttachments` turns one message's files into Markdown so a reader — the Email panel or `faberloom_mail_read` — sees inside them instead of only the file name. Documents that carry text go through the external `anydoc` converter. Images, and PDF pages that are pictures, go through local OCR: `pdftoppm` renders a scanned PDF page by page at 200 dpi, `deploy/ocr/ocr-tools.py deskew` straightens the page when it arrives tilted, and `tesseract` reads it, with a `--- página N ---` mark per page. A page whose median word confidence falls under 75 is re-read with RapidOCR in the same pass. Every process runs on this machine through `ctx.subprocess`, so under `local` a document never leaves the deployment and no provider key is needed.

Extraction is best-effort by contract: a missing binary, a protected PDF, a page past its time bound, an attachment past its size bound or a page cap each leave that attachment without text and name the reason — `ocr-disabled`, `ocr-failed`, `timeout`, `empty`, `oversized`, `unsupported`, `converter-missing` — while the mail read still returns its body. An image never reaches the local document converter: `off` reports it `ocr-disabled` and only `hosted` sends it to Parse, because handing a picture to the local converter would only produce a fake failure.

`FABERLOOM_OCR` selects the path: `off` (the code's default) skips attachments without text, `local` reads them here with Tesseract, RapidOCR, LibreOffice and Poppler, and `hosted` sends scanned PDFs to Firecrawl Parse with `FIRECRAWL_API_KEY`. Images have no hosted path in this package: a picture is read locally or not at all, so a deployment that pays for nothing keeps every attachment on its own machine. `ANYDOC_OCR` names the same modes and the gateway still forwards it, so a deployment that sets only that variable gets the same behavior. Bounds are safety invariants, not tunables: 25 MB per attachment, 200 KB of retained text, 20 s per converter run, 20 s per Tesseract page, 20 s per straightened page, 90 s per second-engine batch, 180 s per PDF, 10 pages per PDF, 60 s per office conversion, 150 s per office document, 50 MB per produced PDF.

### A tilted or hand-written page

A page that arrives crooked loses most of its text: on four real receipts rotated by 7 degrees either way, Tesseract recovered between zero and two of the five checked amounts. `straighten` (`src/ocr.ts`, running `deploy/ocr/ocr-tools.py deskew`) searches the rotation between -12 and 12 degrees that concentrates the ink on the fewest rows and rewrites the page before recognition; the same receipts then returned all five. A page whose median word confidence is still under 75 — a phone photo of a hand-written invoice measured 52 where printed pages score 90 to 96 — is re-read with RapidOCR (PP-OCR over ONNX, on this machine's CPU), which read five of five checked fields where Tesseract read three. Pages of one document escalate together, in one call, because the engine loads its models per process. Without `python3` or without `/opt/ocr/py` both steps are skipped and the page is read exactly as Tesseract reads it, so the deployment degrades instead of failing.

The second engine keeps the page's rows: lines whose centres coincide become one row of cells joined by ` | `, so the real receipt's `Sirloin 450 gr … 11.382` arrives as `Sirloin 450 gr | 11.382` and a photographed table keeps its columns instead of collapsing into single lines. Printed pages are read with the Latin recognition model, which keeps the spaces between words and the accents the default model drops (`Muito Work Limitada`, `Ensalada Caprese`); a page whose median line confidence is under 0.98 keeps the default model, which read twice as many fields on the hand-written photo. A line the engine scores under 0.85 with at least four characters is prefixed `[?]`, because the hand-written identification number on the real photo is read wrong by every engine measured and the mark keeps a guess from being taken as a value.

### A scanned Word, Excel, or PowerPoint file

A `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.odt`, `.ods`, `.odp`, or `.rtf` whose content is pictures carries no text anydoc can read, so the converter returns nothing and the attachment used to be reported `empty`. Under `local`, `ocrOffice` (`src/office.ts`) writes the file under its own extension, runs `libreoffice --headless --convert-to pdf` in a scratch directory, and hands the produced PDF to the same per-page OCR. The converter's text still wins whenever it exists; this path only covers a document that yields none. Each conversion runs with a private LibreOffice profile, so two attachments in one pass do not contend for the same lock, and the scratch directory is removed on success and on failure. Without LibreOffice the attachment is reported `converter-missing`; a conversion that exits non-zero, writes no PDF, or writes an empty one is `ocr-failed`.

### An image

A picture has no text for the converter to read, so it never reaches `anydoc`. Under `local`, `ocrImage` writes the bytes to a scratch directory and reads that file with `tesseract <file> stdout -l spa+eng`, which takes the format from the bytes themselves, so a `.png` that is really a GIF still works. Under `off` or `hosted` the attachment is `ocr-disabled`: this package has no path that sends a picture to a third party, and a deployment that wants one reads it here or not at all. Tesseract is not a layout engine, so a photographed table arrives as lines. On a 150-400 dpi render of a real purchase order it read both part numbers and the total correctly, so the digits are not the weak point there; a phone photograph, handwriting, or a bent page is, which is what the straightening and the second engine above are for. A part number read from a picture stays a hint until a person compares it with the document.

### Two accounts

A pass reads **every** IMAP connection the owner saved, each with its own cursor. One failing account is reported for that account and the others still run: the report carries an `accounts` array plus the joined `error`, and the failure never stops the pass or hides the working mailbox. The cursor of a failed account keeps the last batch it completed, so the next pass retries exactly what it missed; re-reading is safe because the event key carries the message's own id, and the engine dedupes the repeat.

### A mailbox that only exists over MCP

A mounted MCP server that publishes `account_current`, `folders_list`, `messages_list`, and `messages_text` is watched like an IMAP account, with no IMAP row at all. The watcher lists the server's mailboxes, opens each one's inbox, and keeps one cursor per mailbox folder. Its first view stores the top of the mailbox as the baseline and ingests nothing; later polls walk `messages_list` newest-first (`perPage: 100`, `sort: '-uid'`) until a UID at or below the cursor appears, up to twenty pages per pass, and ingest the new messages oldest first. The event carries `origin: 'mcp'`, the `originId` (`mcp-mail:<server>:<resourceId>:<folder>:<uid>`) the mail tools read and draft by, the mailbox address, and the folder; its key is `mail:msg:<message-id>` when the message has one, the same key an IMAP read produces. One failing server or mailbox becomes its own report entry and the rest still run.

### What a pass does

1. Resolves every IMAP connection and every enabled MCP mail server; a missing or unusable one is reported for that account, not thrown.
2. Fixes the baseline at the mailbox top the first time an account or MCP mailbox is seen, and ingests nothing from it.
3. Reads the envelopes (`Message-ID`, `From`, `Subject`, `Date`) above each cursor in batches and hands each one to `ingest` as an `email` event, persisting the cursor after each batch.
4. Runs the durable sweep of each account when `sweepIntervalMs` elapses (below).
5. Reports what each account read, what started, and every failure the mailboxes returned.

### The durable sweep

A poll answers what is above its cursor; the sweep guarantees that no message is lost, read or not, whatever its date. Each sweep reads up to `sweepBatch` messages above `sweepUid` - the highest UID the previous cycle reached - and advances `sweepUid` to the highest UID of that batch. A sweep that finds nothing above `sweepUid` resets it to the cycle's floor, and the next cycle walks the mailbox again. `hasEvent` skips what a poll or an earlier cycle already delivered, so a re-read never appends the same evidence to a case. Mail below `baselineUid` is the history the mailbox already held when the watcher was installed and is never ingested; a cursor written before the baseline existed has no such floor, so it walks from the first message and ingests its unread mail while skipping what was already read.

The MCP sweep reads the newest `sweepBatch` messages of each mailbox (read or not), skips everything at or below the mailbox baseline, and applies the same `hasEvent` dedupe. A poll that hits its twenty-page budget leaves the older part of a huge gap to that sweep.

Idempotency belongs to the engine, not the poller: the event key is `mail:msg:<message-id>` when the message has one — for IMAP and MCP alike, so one mail in several mailboxes or transports is one event — and the mailbox generation plus UID otherwise.

A desktop that mirrors to the VPS (`FABERLOOM_MIRROR_ENABLED=1`, platform not `web`) reads the same mailbox the VPS reads, and executions do not travel between the two. The VPS owns the mail-triggered runs of cloud-ready routines, so the desktop ingests with `skipCloudReady` and only starts the routines whose steps need the PC; the same message never runs the same routine on both.

The receiver never writes to the mailbox. It does not mark messages read, move them, or delete them: the owner's own mail client keeps whatever state it had. `markSeen` and `moveToTrash` exist in the service as E1 refusals (`WRITE_NOT_APPROVED`), not as silent no-ops, so a caller that tries to mutate the mailbox sees the rejection and the server stays byte-identical.

`searchMailbox(ownerId, query, limit?, connectionId?)` answers a chat query against one mailbox, newest first, and reports its own coverage. It prefers the server's `UID SEARCH`; servers that refuse a UTF-8 charset fall back to matching `From`/`Subject` over the most recent envelopes, and then the result says `complete: false` with `scanned` and `total` instead of presenting the window as the whole mailbox. It is as read-only as the poller and never advances the receiver's cursor, so searching never hides mail from the triggers. The model reaches it through the `faberloom_mail_search` tool, which copies the account into every row and repeats the coverage warning.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing directly. `ctx.faberloomInbound` registers no tools and writes no prompt text; what reaches a model is the step turn of each run it starts, which receives the event in its case context as JSON. An IMAP event carries `mailbox`, `connectionId`, `uid`, `from`, `date`, and `receivedAt`; an MCP event carries `origin: 'mcp'`, `originId`, `server`, `resourceId`, `folder`, `uid`, `mailbox`, `connectionId`, `from`, `to`, `cc`, `messageId`, `date`, and `receivedAt`, so the reply step reads and drafts by `originId` instead of guessing a connection.

#### Token effect

Zero direct tokens. Each started run costs what its steps cost.

#### KV Cache effect

Independent of live requests: the poller never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Envelopes only, no body.** A pass fetches header fields; transfer encodings, multiparts, and attachments are not decoded, so a step that needs the message text cannot read it from the event yet.
- **An office document is read as a picture of its pages.** A scanned `.docx`, `.xlsx`, or `.pptx` only reaches local OCR after LibreOffice renders it to PDF, so the deployment needs `libreoffice` installed or the attachment is `converter-missing`; Tesseract returns text, not layout, so a table arrives as lines and its columns have to be placed by the reader.
- **Implicit TLS and plain IMAP only.** STARTTLS negotiation is not implemented; the connection's `secure` flag decides between TLS on connect and a plain connection.
- **A pass reads, it does not subscribe.** `IDLE` (server push) is absent by design for now, so a message waits up to one interval. New mail is found by polling.
- **An MCP poll stops after twenty pages.** A mailbox that gained more than twenty pages of mail between two polls has the older part of that gap answered by the MCP sweep's newest window instead of the poll; the IMAP sweep walks the whole mailbox.
- **The MCP watcher reads only the inbox.** Each mailbox's inbox folder is watched; Sent, Drafts, and Trash are not.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The client is a tagged-command subset with a literal-aware buffer: a FETCH response arrives as `* n FETCH (UID n BODY[…]{size}` followed by exactly `size` bytes of headers. It is tested end-to-end against a fake IMAP server built on `node:net`, which also proves the pass does not depend on a real provider.

</details>

**Runtime invariant:** No companion is published. The receiver's own durable state is one cursor per connection, in `faberloom_inbound`; every scheduling decision is derived from that cursor and the mailbox.
