# Agent Note: Live mail agent, thread memory, and real attachments

Status: implemented

English | [中文](2026-11-25-live-mail-agent.zh.md)

## Problem

The live mail agent had stopped producing drafts, and three weaknesses in the surrounding code made the failure hard to see.

The "Vigía de correo" routine was provisioned from `marluvasLiveMailRoutine()` for any admin/CEO owning a 506 or alvaro mailbox (`packages/faberloom/inbound/src/index.ts`, `isMarluvasMailbox`). Provisioning converges one routine by name, so the Marluvas expediente steps replaced the generic classify/draft steps. The active routine has no `faberloom_email_draft` call and says "No envíes correos". The last machine-written draft was 2026-10-30; the row the owner saw with a 2026-11-23 date was that same draft saved again.

The Marluvas catalog agent carried `provider: anthropic`, `model: claude-sonnet-4-5`. The Anthropic account has no balance, so every step of every Marluvas run since 2026-11-19 failed with `400 invalid_request_error: Your credit balance is too low`. 1,770 event executions failed that day; the routine kept firing and kept failing.

The inbound receiver keyed an occurrence as `imap:<connection>:<Message-ID>` (`inbound/src/index.ts`, `pollAccount`). The same message delivered to 506 and alejandro produced two executions: 103 messages in the stored history reached two connections. With a draft step that would have produced two drafts.

Drafts had no memory of what had been answered, discarded, or already drafted. `deleteEmailDraft` proposed an `email-skip` lesson candidate, but candidates are inactive and the live routine never read them.

A machine draft carried the signature as plain text only, so the panel never showed a signature block, and the stored signature table for the owner was empty.

Attachments could only be copied from a mailbox message (`attachFromUid`) or from the draft's own Space (`attachFromSpaceFileId`), and the latter required an owner confirmation the live agent cannot perform. A document held in an MWT.ONE expediente had no path into a draft.

A draft answering MCP mail left through the server's `send_email`, whose payload in `mcpDraftDelivery` carried no attachments. A file attached to such a draft was dropped without an error.

## Decision

### Two routines, two names

`LIVE_MAIL_ROUTINE` keeps the name "Vigía de correo" and is the reply routine: one agent step that classifies, trashes what matches an active `email-trash` lesson, and otherwise calls `faberloom_email_draft` once. `marluvasExpedienteRoutine()` is provisioned under "Operadora Marluvas" and keeps the triage/operate/verify steps and the `Operador Marluvas` agent.

`inbound.ensureLiveMailRoutine` and `view.ensureBuiltinRoutines` provision the reply routine for every owner with both mail halves, and the operator routine additionally for Marluvas mailboxes. Each converges on its own name, so neither replaces the other.

### One occurrence per message, one account per reply

The event key is `imap:msg:<Message-ID>` when the envelope carries an id, and the connection-scoped fallback only when it does not. The first mailbox to report the message starts the run; the event still carries `mailbox`, `uid`, and `connectionId` for the step's read.

`faberloom_email_draft` resolves the outgoing account from the message itself: the first `To` address that belongs to one of the owner's IMAP connections, then the first matching `Cc` address, then the reader's connection. A message sent to 506 and copied to alejandro is answered from 506 even when the alejandro copy is the one the watcher reported.

### The thread remembers drafted, sent, and dismissed

`mail_threads` is a new table in the connections domain, keyed by owner, outgoing account, and the thread root (`References[0]`, else the answered `Message-ID`). Each row stores the answered message, the status, the draft, and the owner's reason.

- `drafted` blocks a second pending draft in the same thread; the tool returns `MAIL_DRAFT_EXISTS` and names the existing draft.
- `sent` blocks a new draft for the same answered message; a newer message in the thread authorizes a new one.
- `dismissed` blocks the same answered message; a newer message may still be drafted.
- `removeDraft` writes `dismissed` in the same act that deletes the draft, so the owner's trash gesture is immediate.
- `sendDraft` writes `sent` after a confirmed send, on every transport.
- `emailDraftWithAi` writes `drafted` so a panel draft also counts as the thread's one pending draft.

### Signature HTML, not signature text

`draftHtml(text, signature)` builds the draft's HTML alternative from the written body and the account's `signatureContent`, and wraps the signature in `<div data-email-signature="auto">`. The composer's marker keeps exactly one block when the draft is reopened, and the send transmits the authored markup unchanged. The owner's signature is stored for 506, alvaro, and the primary account; a draft without a stored signature still carries its body as paragraphs.

### Attachments come from the thread, a Space, or a signed URL

`attachFromSpaceFileId` now accepts any Space file the owner may read; the owner-scoped read is the boundary, not the draft's Space. `attachFromUrl` copies the bytes behind an HTTPS signed URL, with `attachUrlName` and `attachUrlMediaType` for the name and type. It refuses non-HTTPS URLs, private and link-local hosts, unknown media types, more than 15 MB, and a non-2xx answer.

The reply routine's instruction orders the sources: thread attachments first; then, only when the message names an OC, SAP, PF, BL, AWB, or container, the expediente's documents or artifacts through `documento_descargar` or `artefacto_archivo_descargar` and `attachFromUrl`; otherwise no MWT lookup at all.

### MCP sends never drop a file

`mcpDraftDelivery` reads the `send_email` schema the server actually declares (`FaberLoomMcpRegistry.toolSchemaFor`). When the draft carries files and the schema declares an `attachments` or `files` array, each file is mapped onto the declared item fields. When it declares none, the send is refused with a stated reason instead of transmitting the message without the files.

### Five-minute head sweep

`FaberLoomInbound` keeps a per-connection sweep instant (`sweepIntervalMs`, default 300 000) and, when due, re-reads the newest 20 envelopes and re-ingests those whose `Date` falls inside the last 15 minutes. The engine dedupes keys it already saw, so the sweep recovers a message the cursor skipped without resurrecting history.

### Every agent runs on the deployment model

The 428 persisted agents across the 12 homes were rewritten to `deepseek-official` / `deepseek-flash` with the Anthropic key cleared, keeping their responsibilities, skills, tools, subagents, and connections. A backup of each store stays beside it as `*.bak-agent-model-*`. New agents inherit the deployment default (`FABERLOOM_AGENT_PROVIDER`, `FABERLOOM_AGENT_MODEL`), so the catalogue needs no pinned provider.

## Contract details

| Field | Owner | Invariant |
|---|---|---|
| `imap:msg:<Message-ID>` | inbound | One execution per message across mailboxes; the fallback stays connection- and uid-scoped. |
| `mail_threads` row | connections | Keyed by owner, account, and thread root; the answered message decides whether a new draft is allowed. |
| `dismissed` | connections | Written when the draft is deleted, before the owner sees the list refresh. |
| `sent` | connections | Written only after the transport confirms the send, on SMTP and MCP alike. |
| `drafts.html` | connections | Authored markup; the signature block carries `data-email-signature`. |
| `attachFromUrl` | tool-faberloom | HTTPS only, public host, declared document media type, at most 15 MB. |
| `toolSchemaFor` | mcp-registry | Reads the mounted tool's declared JSON parameters; null when unknown. |
| `sweepIntervalMs` | inbound | At least 10 s; every sweep only re-ingests mail from the last 15 min. |

## Alternatives considered

**Keep one routine and add a draft step to the Marluvas definition.** Rejected: the Marluvas agent needs the expediente playbook and the reply agent needs the voice and thread rules; one agent doing both doubled the tokens per message and coupled two failures. A name collision also meant deployment of one silently replaced the other.

**Dedupe by subject and sender.** Rejected: two different messages can share a subject, and a reply chain changes the subject prefix. `Message-ID` is the message's own identity.

**Key the thread by `Message-ID` of each message.** Rejected: that is the answered-message key, and it would allow a second pending draft for the same thread. The root id plus a pending-draft check gives one draft per thread.

**Store the signature only in the draft text.** Rejected: the panel renders HTML, and a text-only signature cannot carry bold, a rule, or a mailto link. The marker keeps the editor from stacking a second block.

**Let the host call the MWT MCP itself for documents.** Rejected for this change: the agent already holds the signed URL the MWT tool returned, and the tool only has to fetch public HTTPS bytes. A host MWT client would duplicate the credential and permission path.

**Fail the MCP send silently or send without the files.** Rejected: the owner approved a message with attachments. Refusing names the limitation and keeps the draft.

## Verification

1. `packages/faberloom/routines/tests/equality.spec.ts` asserts the Marluvas definition survives the store's normalized shape and keeps the catalog agent name.
2. `packages/faberloom/inbound/tests/inbound.spec.ts` provisions the reply routine and the Marluvas operator as separate active routines; keeps only the reply routine outside the allowlist; starts one execution when two mailboxes read the same `Message-ID`; and performs the head sweep without re-starting a seen message.
3. `packages/faberloom/connections/tests/mail-threads.spec.ts` round-trips a thread state per mailbox, marks it `sent` through a delivery stub, and marks it `dismissed` on discard.
4. `packages/faberloom/connections/tests/signature.spec.ts` asserts the signature marker, the paragraph fallback, and the no-signature body.
5. `packages/faberloom/tool-faberloom/tests/draft-tools.spec.ts` answers from the `To` mailbox, refuses `sent`/`dismissed`/pending, copies a file from another Space, and copies a signed URL while refusing a private host.
6. `packages/faberloom/view/tests/mcp-send.spec.ts` refuses to drop attachments without a declared list and maps them onto the declared item fields.
7. `tsc -b tsconfig.host.json` and `tsconfig.client.json` are clean; the focused suites of connections, inbound, routines, tool-faberloom, mcp-registry, and view are green.

## Consequences

- The live reply agent now runs on the deployment's DeepSeek model. A future Anthropic balance problem no longer stops it, and a provider switch is a config change.
- Deleting a draft is an immediate "do not answer this message"; the `email-skip` lesson candidate still records the pattern for future mail.
- A reply can now carry an expediente document without a human upload, but the model decides whether the mail names a reference. The instruction forbids any MWT lookup when it does not.
- The MCP `send_email` schema decides whether an attachment leaves; the panel gets a stated refusal, never a silent drop.
- MCP mail still has no inbound watcher: its messages do not start the reply routine. The send path and the draft model are ready for that source; the watcher is the next owner.
- The sweep only covers unread mail from the last 15 minutes. A message the owner read before the agent saw it stays outside the sweep.
