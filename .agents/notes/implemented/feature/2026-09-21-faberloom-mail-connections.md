# Agent Note: FaberLoom mail connections send and search as the owner

Status: implemented

English | [中文](2026-09-21-faberloom-mail-connections.zh.md)

## Problem

Conexiones stored only an IMAP mailbox and a backup destination, so the owner could receive routine events from mail but the assistant could neither answer "find this mail in my inbox" nor "send this message as me". Sending is also an external effect, and the plan reserves it for a live grant, so a send path had to check the autonomy surface instead of firing from any chat turn.

## Decision

Mail is one connection kind per direction inside the existing product services; no new package was created.

`packages/faberloom/connections` gains the `smtp` connection kind and `src/smtp.ts`, a dependency-free SMTP client that mirrors the IMAP probe's policy: `EHLO`, optional `STARTTLS`, `AUTH LOGIN`, then `MAIL FROM`/`RCPT TO`/`DATA` with dot-stuffing and a generated `Message-ID`. Non-ASCII headers are RFC 2047 base64-encoded and the body goes base64 so any relay preserves UTF-8. `probe()` checks an SMTP row for real by logging in and leaving without sending; `smtp(ownerId, id?)` returns the stored credentials to host-side consumers only; `sendMail(ownerId, mail, connectionId?)` delivers through the primary (or first complete) SMTP row. The `primary` flag is now per kind: one primary mailbox feeds the receiver and one primary SMTP row carries outbound mail, and neither clears the other.

`packages/faberloom/inbound` gains `searchMailbox(ownerId, query, limit?, connectionId?)`, which answers a chat query against the same mailbox, newest first. It prefers the server's `UID SEARCH CHARSET UTF-8 TEXT` and falls back to matching `From`/`Subject` over the most recent envelopes when the server refuses the charset. It never advances the receiver's cursor and never touches mailbox flags, so searching hides no mail from the triggers.

`packages/faberloom/tool-faberloom` registers two model tools: `faberloom_mail_search` (read-only envelopes) and `faberloom_mail_send`, which passes through the existing `authorize` soft guard with the `mail.send` action, so a chat-initiated send requires the same live grant a routine effect requires. The Conexiones panel edits SMTP rows with the usual ports (465/587/25), runs the same automatic test, and shows a new MWT.ONE block — identity, active company, and the connected external MCP servers with their tools, grouped from the `mcp__<server>__<tool>` registrations — above the (relabeled, advanced) FaberLoom token section.

## Alternatives considered

- **A separate outbound package mirroring `faberloom/inbound`.** Rejected: the sender is one client plus one accessor over the same credentials table, and a whole package (manifest, tsconfig, profile rows, README) buys no isolation the connections service does not already provide. The symmetry that mattered — probe like IMAP, read-only like the poller — lives in the two client modules.
- **A mail library dependency (e.g. nodemailer).** Rejected for consistency with the existing IMAP client: the repo already speaks IMAP over raw sockets for the same reason (no client library in the host), and the send slice needs only the plain-text subset.
- **Sending without a grant when the user just asked in chat.** Rejected: the autonomy model separates preparing from sending regardless of channel, and the grant UI already grants any action string; the error message names exactly what to grant.

## Consequences

- A probe or send that fails reports the server's own reply (timeout, `535`, socket error); nothing about the test is simulated, and a probe never sends a message.
- Outbound mail needs no model-visible credentials: the browser never receives the secret, and the tools resolve it host-side through the connections service.
- `AUTH LOGIN` and plain-text bodies are the whole SMTP slice; attachments, HTML, and OAuth providers are deferred and recorded in the connections README.
- The MWT.ONE block reads the live tool registry at call time, so a deployment with no MCP client mounted shows the empty state rather than a fabricated server list.
