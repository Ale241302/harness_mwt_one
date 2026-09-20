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

`enabled` defaults to off, `intervalMs` to five minutes, `mailbox` to `INBOX`, and a pass reads at most twenty messages. The first pass looks for **unseen** messages; later passes ask for the mailbox UIDs above the connection's stored cursor, so an old mailbox is not replayed.

The receiver reads the owner's credentials through `ctx.faberloomConnections.imap()`, the only accessor that returns a stored secret, which exists for this host-side consumer. The browser still reads the connection list, which never returns it.

### What a pass does

1. Resolves the owner's mailbox connection; a missing or unusable one is reported, not thrown.
2. Reads the envelopes (`Message-ID`, `From`, `Subject`, `Date`) of the new messages.
3. Hands each one to `ingest` as an `email` event and records the highest UID read.
4. Reports what it read, what started, and any failure the mailbox returned.

Idempotency belongs to the engine, not the poller: the event key is the message's `Message-ID` when it has one and the mailbox UID otherwise, so re-reading a message never starts the same run twice.

The receiver never writes to the mailbox. It does not mark messages read, move them, or delete them: the owner's own mail client keeps whatever state it had.

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
