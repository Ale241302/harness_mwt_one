# Agent Note: mail bodies decode with the charset their headers declare

Status: implemented

English | [中文](2026-09-24-faberloom-imap-charset-decode.zh.md)

## Problem

The IMAP reader decoded the whole socket stream as UTF-8 and every text part as UTF-8 regardless of its `Content-Type` charset. A message sent as `iso-8859-1` or `windows-1252` — most Spanish correspondence — lost its accented bytes: the socket decode replaced them with U+FFFD before the body was even sliced, so `Buen día` reached the panel, the space seed, and the read tool as `Buen d�a`.

## Decision

Read the stream byte-for-byte and decode each text part with the charset its header declares.

- The socket handlers decode each chunk as Latin-1, so every received byte survives as one code point and a FETCH literal's length still matches its byte count.
- `decodeTransfer` returns the part bytes unchanged for the `7bit`/`8bit`/`binary` case (`Buffer.from(body, 'latin1')`) instead of re-encoding them as UTF-8.
- A new `decodeText(bytes, charset)` reads the `charset` parameter of the part's `Content-Type` and decodes through `TextDecoder`, falling back to UTF-8 for an absent or unknown charset.
- `parseMessage`, and through it the panel, the space seed, and `faberloom_mail_read`, share the fix.

## Alternatives considered

**Assume UTF-8 and repair the mojibake afterwards.** The lossy decode discards the original byte at the socket, so nothing downstream can recover it; the fix has to preserve the bytes.

**Default to `iso-8859-1`.** It fixes the Spanish case but breaks the common UTF-8 body; the header names the charset, so read it.

## Consequences

- Latin-1 ASCII headers and IMAP protocol text are unaffected; non-ASCII header bytes now survive to `decodeMimeWords`.
- `TextDecoder('iso-8859-1')` follows the WHATWG mapping to windows-1252, matching what a mail client shows for `€` and curly quotes.

## Testing

`packages/faberloom/inbound/tests/imap-body.spec.ts` adds an `iso-8859-1` body (`Buen día`) and a `windows-1252` `€`, and keeps the existing UTF-8 and quoted-printable cases.
