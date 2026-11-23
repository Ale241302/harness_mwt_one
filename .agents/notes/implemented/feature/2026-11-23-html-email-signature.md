# Agent Note: HTML email signatures with inline images

Status: implemented

English | [中文](2026-11-23-html-email-signature.zh.md)

## Problem

A signature was plain text only. The owner could not carry a logo or the styled block every real signature has, so every message left as unstyled text. The signature editor also hid the MCP mailboxes from its account list, which read as a missing account rather than as a different mail source.

## Decision

A signature carries two bodies: `text`, which is what the draft and a plain-text client show, and `html`, which travels as the message's HTML alternative. The HTML is sanitized where it is saved — scripts, embedded documents, event-handler attributes, and script URLs are removed, and the body is capped at 64,000 characters. A signature saved with HTML and no text keeps a plain-text fallback derived from its markup, so no message leaves with an empty text part.

The HTML alternative is composed at send time from the body the owner approved, and only while that body still ends with the stored plain-text signature. An edited body therefore ships as plain text instead of contradicting itself; this is why the draft stores no HTML of its own. `data:image` sources in the signature become `multipart/related` parts referenced by `cid:`, because several clients drop `data:` URLs; an image over 800 KB stays a `data:` URL rather than exceeding the message budget.

The editor renders the markup in a sandboxed iframe (`sandbox=""`), so the preview has no scripts and no access to the panel, and accepts an uploaded image up to 400 KB, which it embeds as a `data:` URL.

The signature account list names every account the panel knows, including MCP mailboxes, labelled read-only. A signature for a read-only mailbox is stored and applies to any send from that address; the product still refuses to send from an MCP mailbox, so the label states the limit instead of hiding the account.

## Alternatives considered

**Compose HTML at draft time instead of send time.** A draft would carry its own HTML alongside the text, and every draft writer — the panel, the agent, the restore path — would have to keep both in step, including the signature stripping that a sender change performs. Building the alternative at send time keeps one approved body as the source of truth and makes a mismatch impossible rather than merely unlikely.

**Keep images as `data:` URLs only.** It needs no related parts and no content ids, but Gmail, Outlook, and most webmail strip `data:` images, which would have left the logo invisible exactly where signatures are read.

**Send the signature HTML without a plain-text twin.** An HTML-only message reads worse in text clients and raises spam scoring; the plain text is also what the draft already shows, so deriving the markup from it costs nothing.

**Hide read-only mailboxes from the signature list.** That is what the editor did before, and it reads as a missing account. Listing them with the read-only label states the real constraint and still lets a signature exist for an address that later gains an outgoing route.

## Consequences

- `FaberLoomEmailSignature` and its Remote row gain `html`; the stored record defaults it to an empty string, so signatures written before this change read unchanged.
- `sendMail` accepts an optional `html` body and builds `multipart/alternative`, wrapping the HTML part in `multipart/related` when it carries inline images.
- `saveEmailSignature` takes a fourth argument, `html`.
- The panel's signature editor keeps the plain-text field as the source of truth for what the draft shows.

## Verification

`packages/faberloom/connections/tests/signature.spec.ts` covers the sanitizer, the plain-text fallback, the alternative composer, and the inline-image extraction. `connections.spec.ts` sends real messages through the fake SMTP server and asserts the alternative, the related part, the mixed body with attachments, and the plain-text outcome when the body no longer carries the signature. `signatures.spec.ts` covers storage and the per-account content lookup. The panel specs cover the MCP account label, the preview, the upload, and the four-argument save.
