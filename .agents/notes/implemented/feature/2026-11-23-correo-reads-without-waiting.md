# Agent Note: Correo reads an MCP body on its own budget and paints images as they arrive

Status: implemented

English | [中文](2026-11-23-correo-reads-without-waiting.zh.md)

## Problem

Reading a message over the Hostinger MCP endpoint failed intermittently with `"messages_text" … did not complete within 5000ms`. The panel held every MCP call to the listing budget, so a large newsletter that took the server more than five seconds to render surfaced as an error. Remote images carried a second, visible cost: the panel published them only after every fetch in the message finished, so a mail with a dozen pictures stayed blank until the slowest image host answered.

## Decision

### A body has its own budget

`MCP_BODY_CALL_TIMEOUT_MS` is 20 seconds and applies only to `messages_text`. `account_current`, `folders_list`, and `messages_list` keep the five-second panel budget, so an unreachable server still yields the rest of the surface quickly. A body read is one gesture the owner waits for, and the server may need several seconds to render it.

### A body is read once and reused

`emailRead` keeps the last 50 MCP bodies per owner for ten minutes, keyed by owner and synthetic message id. A re-opened mail is served from that map without a server call; an expired entry is dropped on read, the oldest is dropped past the bound, and a failed read is never stored. The map belongs to the view service and is disposed with it.

### Each image paints when it lands

The panel still asks `emailImage` once per address and caches the bytes for the session, but it now publishes each resolved address as its own state update instead of waiting for `Promise.all`. The frame's sanitizer and its `img-src data:` policy are unchanged.

## Alternatives considered

**Raise the panel budget for every MCP call.** Rejected: a hung server would hold the mailbox list for twenty seconds before showing what IMAP already has.

**Retry the body read on timeout.** Rejected for this slice: it doubles the worst-case wait and hides the cause; the dedicated budget plus the cache addresses the reported case.

**Keep a durable cache of bodies.** Rejected: a body is a rendered snapshot, not product data, and the session already owns anything the owner keeps.

## Consequences

The intermittent error disappears for bodies that answer within twenty seconds, and reopening a mail costs no server call for ten minutes. Memory is bounded at 50 bodies per service instance. Images appear one by one, so a partially loaded newsletter is readable while the rest arrives. A body that takes longer than twenty seconds still fails loudly.

## Testing

`corepack pnpm run typecheck` passes; `vitest run packages/faberloom/view/tests` (321 tests) and `packages/client/ui-faberloom/tests` (287 tests) pass. New coverage: reading the same body twice calls `messages_text` once; the listings keep the five-second budget while the body uses the twenty-second one; a failed read is retried; an expired entry is read again.
