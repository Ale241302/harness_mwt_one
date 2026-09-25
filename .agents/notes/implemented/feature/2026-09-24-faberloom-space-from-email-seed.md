# Agent Note: an email opens its Space with the email already in the session

Status: implemented

English | [中文](2026-09-24-faberloom-space-from-email-seed.zh.md)

## Problem

Turning an email into a Space created and opened the Space's Workspace, but the new conversation started empty. The agent had to search the mailbox again to find the message the user had just acted on, and the attachment text the panel had already computed was discarded.

## Decision

`spaceFromEmail` returns a `context` string — sender, subject, the plain-text body, and the extracted attachment Markdown — and the Email panel sends it as the new session's first prompt.

- `FaberLoomSpaceFromEmail` gains `context: string`, additive to `spaceId` / `workspaceId`.
- The panel's Create gesture, after `ctx.sessions.create({ workspaceId })`, resolves the Session (`ctx.sessions.binding(id)?.session`) and calls `session.prompt([{ type: 'text', text: context }], 'queue')` before opening the conversation.
- The gesture lives in `packages/client/ui-faberloom/src/client/space-from-email.ts` (`runSpaceFromEmail`), extracted from the panel's `inject` face so it can be tested without the render machinery; `index.ts` keeps only the one-line wiring.
- The sender line comes from the panel, which already holds the envelope `from`; the IMAP reader exposes no headers.

## Alternatives considered

**Read the message again inside the session from the uid.** That repeats an IMAP round-trip the panel already paid, and it needs a mailbox tool call before the agent can act.

**Put the email in the Space memory only.** Memory is durable context the agent may consult; it is not the first user turn, so the conversation would still open with no visible message.

## Consequences

- A new Space conversation begins with the message as its first user turn; the same text also feeds attachment ingestion, so the agent sees the document Markdown without another call.
- The seed is one queue-mode prompt; when the create or the prompt fails, the panel opens anyway with an empty session.

## Testing

`packages/client/ui-faberloom/tests/space-from-email.client.spec.ts` drives `runSpaceFromEmail` over a stub context: it asserts the session create, the queued prompt with the context, the panel switch, the no-workspace path (no create, no prompt), and the read-failure path. `packages/faberloom/view/tests/space-from-email.spec.ts` asserts the returned `context` carries sender, subject, and body.
