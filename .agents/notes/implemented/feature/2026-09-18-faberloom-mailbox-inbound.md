# Agent Note: The owner's own mailbox feeds their routines

Status: implemented

English | [中文](2026-09-18-faberloom-mailbox-inbound.zh.md)

## Problem

An `email` trigger was the plan's flagship start — a purchase order arrives and the routine runs — and it could never fire. The dispatcher advanced and reconciled, but a pass cannot invent an event, and nothing read the owner's mail. The connection the owner configured in Conexiones was only ever used to press *Probar*.

## Decision

`packages/faberloom/inbound` (`ctx.faberloomInbound`) polls the mailbox the owner configured and turns its new messages into routine events.

The service reads the credentials through a new `ctx.faberloomConnections.imap(ownerId, id?)`, the only accessor that returns a stored secret. It exists for this host-side consumer; the panel keeps reading `list()`, which never returns the secret, so the browser's view of a connection does not change.

One pass, on its own timer (`enabled` off by default, `intervalMs` five minutes, `mailbox` `INBOX`, at most twenty messages):

1. resolves the owner's mailbox; a missing or unusable one is reported and the pass ends without throwing;
2. reads the envelopes — `Message-ID`, `From`, `Subject`, `Date` — of the messages above the connection's stored cursor, or of the unseen ones on the first pass;
3. hands each to the routines engine's `ingest` as an `email` event;
4. stores the highest UID it read as the connection's cursor.

Three properties decide the design:

- **The receiver never writes to the mailbox.** It does not set `\Seen`, move, or delete anything, so logs and boxes checked by the owner's phone are unchanged. The price is a small cursor table (`faberloom_inbound`) instead of a flag on the server.
- **Idempotency is the engine's.** The event key is the message's `Message-ID` when it has one and the mailbox UID otherwise; the routines engine already dedupes on it, so a re-read, a restart, or a second process never starts the same case twice.
- **The protocol subset is ours.** The client speaks tagged commands over `node:tls`/`node:net`: greeting, `LOGIN`, `SELECT`, `UID SEARCH`, `UID FETCH` of header fields, `LOGOUT`, with a literal-aware buffer. It is tested end-to-end against a fake IMAP server built on `node:net`.

## Alternatives considered

- **An internet-facing webhook endpoint.** Still the right answer for services that can call us, and still absent: it needs a public route, a per-user token, and replay protection. A mailbox is the channel the plan's pilot uses, and it needs none of that.
- **`imapflow` and `mailparser`.** Rejected for this slice: the plan's flow needs the envelope, the repository has no mail dependency today, and the connections package already speaks IMAP over a raw socket for its probe. The cost is that bodies are not decoded yet, which is recorded below rather than hidden.
- **IMAP `IDLE` (server push).** Deferred: it holds one connection per user open indefinitely and needs reconnect handling; polling every five minutes satisfies the use case first.
- **Marking messages seen after ingesting.** Rejected: it changes state the owner sees in their own client. A cursor is invisible to them.

## Consequences

- A routine with an `email` trigger now starts with the browser closed, using the mailbox the owner configured.
- The event carries the envelope, not the message text: a step that needs the body cannot read it from the event yet.
- `STARTTLS` and multiple mailboxes are not implemented; the connection's `secure` flag decides between TLS on connect and plain IMAP, and the receiver reads the first usable IMAP connection.
- A pass reads; it does not subscribe. A message waits up to one interval, and the failure of one mailbox is logged and retried on the next pass rather than stopping the poller.
