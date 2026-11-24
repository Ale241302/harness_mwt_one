---
description: "Native product connections (ctx.faberloomConnections): the per-user IMAP, SMTP, and knowledge-backup settings the owner enters, independent of the MWT.ONE MCP; for users and maintainers of the FaberLoom Conexiones module."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-connections

English | [中文](README.zh.md)

## Summary

The connections service owns the integrations the owner configures for themselves: an IMAP mailbox, an SMTP outgoing server, and a knowledge-backup destination. They are FaberLoom's own data, stored per identity through `ctx.storageDomain`, never an MWT.ONE MCP operation. The password is stored but never returned; `probe` checks the configuration for real. `sendMail` delivers through the owner's SMTP row: plain text, or a `multipart/alternative` whose HTML alternative turns `data:image` sources into related parts referenced by `cid:`. A draft supplies that alternative from its authored markup when the composer wrote one, and otherwise from the approved text plus the account signature. One row per kind is the default: an SMTP row's `primary` flag never clears the primary IMAP mailbox.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.storageDomain` is present. The browser reads and writes it through `ctx.faberloomView.connections()`, `saveConnection`, `removeConnection`, and `probeConnection`.

Draft updates preserve omitted `originUid`, `originReason`, `originMailbox`, and `html`; origin, Space, AI-baseline, and markup changes do change the restorable-state hash. `getDraft` enforces ownership, and only `bindDraftSession` writes `agentSessionId`, without changing `updatedAt` or that hash; binding also CAS-checks the previous session and, for a seeded session, the reviewed revision. `recordDraftRevision` snapshots the exact draft returned by its write, while `listDraftRevisions` and `restoreDraftRevision` maintain owner-scoped, monotonically numbered, append-only history. Snapshots retain complete message and origin fields, including attachment bytes; restoring one appends a `restore` revision with its supplied instruction. Attachment limits are measured from the decoded bytes, never from a caller-supplied size. `html` is the authored markup: every write sanitizes it with `sanitizeMailHtml`, refuses more than 256 000 raw characters, and derives the plain-text part when the draft carries no text. `updateDraft` checks ownership, draft status, and the expected hash in the storage write chain; `updateDraftAndRecord` keeps that CAS and the exact snapshot append in one per-draft operation chain, without making the two table writes transactional. Restores require the editor's current hash and use the same atomic update. Domain v2 reads v1 drafts with absent metadata normalized to null.

An optional egress policy limits which servers a connection may reach. Set `FABERLOOM_EGRESS_DENY` to comma-separated hosts or `*.suffix` patterns and, when it needs exceptions, `FABERLOOM_EGRESS_ALLOW`. Once either variable is present the policy is default-deny: `imap`, `smtp`, `sendMail`, and `probe` refuse a host the policy does not authorize before any socket opens — the accessors throw `EGRESS_DENIED` and `probe` returns a failed result. With neither variable the service behaves as it did before.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomConnections` is a host-side service read by the browser panels: it registers no tools, injects no prompt text, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the service never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The password is stored in the product domain.** There is no field-level encryption yet; at-rest protection relies on the host volume and on the encrypted backups. A managed secret store is deferred.
- **One HTML alternative.** `sendMail` sends a UTF-8 text part plus, when the caller supplies `html`, an HTML alternative whose inline images travel as related parts. A draft's markup is sanitized by `sanitizeMailHtml` on save and again on send; without markup the alternative comes from the approved text plus the account signature, so the formatting is whatever the composer produced. `AUTH LOGIN` is the only authentication mechanism; OAuth providers are out.
- **Remote backup destinations are not probed here.** `probe` reports that an rclone destination is checked by the backup flow instead.
- **The egress policy is read when the service loads.** Changing `FABERLOOM_EGRESS_DENY` or `FABERLOOM_EGRESS_ALLOW` takes effect on the next restart, not on the next call.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The IMAP probe speaks the protocol directly over `node:tls`/`node:net` because the host has no IMAP client; it reads the greeting, sends `LOGIN`, and settles on the tagged reply, always destroying the socket.

The SMTP side (`src/smtp.ts`) follows the same no-dependency policy: `EHLO`, optional `STARTTLS`, `AUTH LOGIN`, then `MAIL FROM`/`RCPT TO`/`DATA` for a send, with dot-stuffing and a generated `Message-ID`. Non-ASCII headers are RFC 2047 base64-encoded and the body is sent base64 so any relay preserves UTF-8.

</details>

**Runtime invariant:** No companion is published. The service holds no derived state: every read resolves the owner's rows from the storage domain at call time.
