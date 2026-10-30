# Agent Note: Mail a Space file as an attachment

Status: implemented

English | [中文](2026-10-11-mail-space-file.zh.md)

## Problem

The Email composer could only send a plain-text body: `OutgoingMail` carried `from`, `to`, `subject`, and `text`, and `buildMessage` emitted a single `text/plain; base64` part. Choosing files in the composer merely appended their names to the body ("Adjuntos: …"), so the recipient received no file. A user who wanted to send a document that already lived in a Space's folder — the purchase order just saved there, a generated proforma — had no way to attach it.

## Decision

Two layers carry the feature.

- **Wire contract.** `faberloom-connections` gains `OutgoingAttachment` (`name`, `mediaType`, `contentBase64`) and the optional `OutgoingMail.attachments`. `buildMessage` emits `text/plain; base64` unchanged when no attachment is present, and a `multipart/mixed` body otherwise: the text part first, then one part per attachment with `Content-Type: <mediaType>; name="…"`, `Content-Transfer-Encoding: base64`, and `Content-Disposition: attachment`. A filename that is not printable ASCII is carried as the RFC 2231 `filename*=UTF-8''…` parameter; quotes and line breaks in a name are replaced so they cannot break the header. `sendSmtp` is unchanged: it dot-stuffs and writes whatever `buildMessage` produced.
- **Panel action.** `faberloom-view` gains the Remote `sendSpaceFileByEmail(id, path, to, subject, text)`. It resolves the space folder through `resolveSpaceDir` and **refuses a path that escapes it** (`resolve` must stay at or under the folder root), reads the file, and calls `connections.sendMail(actor.id, { to, subject, text, attachments: [{ name: basename(path), mediaType: 'application/octet-stream', contentBase64 }] })`. The Email composer adds a destination Space select, a file path field, and a **"Send Space file"** action that calls it and reports the resulting `Message-ID`.

## Alternatives considered

**Attach the browser-chosen file directly.** Rejected for this action: the panel would have to read the user's local file and ship its bytes over the wire, while the point of the product is that the file already lives in the Space the agent works in. (`onFiles` remains the browser-side affordance and still only notes names.)

**Guess the media type from the extension.** Rejected: the SMTP layer must not carry a media-type table; `application/octet-stream` is always valid and the recipient's client still sees the real name. A later change can pass an explicit type from a caller that knows it.

**Build the MIME message in the view instead of the connections service.** Rejected: message construction belongs beside the SMTP session that writes it, and the existing `buildMessage` is the one place a test can assert the wire.

**Allow an absolute path anywhere on the host.** Rejected: a panel action must not be able to mail an arbitrary host file; the folder-containment check is the enforcement.

## Consequences

A Space file can be mailed as a real attachment, and a message with attachments is now a valid multipart document that any mail client reads. A path outside the destination Space is refused with a clear error, so the action cannot exfiltrate files the user did not place there. The attachment is read into memory and base64-encoded, so very large files are bounded by the caller; a size ceiling is deferred until a consumer needs one.

## Testing

`packages/faberloom/connections/tests/connections.spec.ts` sends a message with one attachment through the fake SMTP server and asserts the wire carries `multipart/mixed` with the boundary, the `application/pdf` part header, the `attachment; filename="proforma.pdf"` disposition, and the base64 payload. `packages/faberloom/view/tests/send-space-file-by-email.spec.ts` covers mailing a Space file, refusing an escaping path, refusing an empty recipient list, and refusing when no mail connection is mounted.
