# Agent Note: the floating mail conversation opens answered

Status: implemented

English | [中文](2026-11-22-mail-floater-opens-answered.zh.md)

## Problem

Opening a mail with the orange button raised the floating conversation on an empty composer: the owner clicked a summary affordance and got no summary. The email never reached the Session because `openMailChat` read the new binding immediately after `sessions.create()`, before the browser refreshed its list, so the rename and the seed were skipped without an error. The draft editor had the opposite problem: a text pill, “Pedir un cambio a la IA”, opened the same Session in the main workspace and said nothing about the draft or the thread it answered.

## Decision

### The mail Session receives a first turn

`openMailChat` awaits `sessions.refresh()` after `create()` and reads the binding only then, so the rename and the seed run. `seedMailSession(sessionId, seed, defer?, question?)` injects the mail context as a durable context message and, when `question` is present, delivers it as the first user turn; the floating panel therefore renders a question and its answer instead of nothing. The mail body travels inside an `<untrusted-email>` block, bounded to 6000 characters, beside the uid, sender, subject, Space, and attachments, so the summary does not depend on a tool call.

### The draft editor uses the same button

The draft editor drops the pill and renders the same orange `emailAssistantFab` button, offset above its own toolbar. Its action saves the draft, then opens the floating conversation (`sessions.open` plus `layout.openFloatConversation`) instead of navigating to the main workspace. `draftSessionAsk(draftId, question)` delivers that first turn into the Session the draft already owns and refuses a draft with no Session, so no client can prompt an arbitrary session. The Client asks once per Session in that browser (`faberloom.draft.greeted.<sessionId>`), so a second click continues the conversation rather than repeating the summary.

### A fresh Host Session is awaited, not assumed

Both paths wait up to three seconds for a Session the Host just created to appear in the agent registry before delivering anything: the wait lives in one private `sessionAgent` lookup, which returns undefined instead of throwing when the Session never appears. The previous code returned false and the Client swallowed it, which is why the failure was silent.

### The Space offer waits and points at a real Space

The panel no longer publishes a Space card when a mail opens. `mailSpaceBrief(subject, from, body)` ranks every Space the identity may read and returns the strongest candidates with each one's bounded memory and file names; the floating conversation receives that block, so its answer can name the Space — including a sub-space's parent — instead of guessing. `mailSessionTurns(sessionId)` counts the assistant answers already in the conversation, and the card appears only when the conversation holds four of them and the Host ranks a match of at least two. A mail with no matching Space shows nothing instead of asking to create one, and the card carries one gesture: add the mail and its session to that Space.

## Alternatives considered

**Reuse `emailChat` to produce the summary.** Rejected: that RPC owns its own Session keyed by uid/route and returns text to the panel, so the float would show a second, parallel conversation instead of the one the owner opens.

**Send the whole mail as the user turn (the previous `defer: false` default).** Rejected for this path: the question the owner reads must be the summary request, not a wall of headers and body. Injection keeps the transcript readable and the context durable.

**Poll from the Client until the Host lists the Session.** Rejected: it duplicates the Host's registry knowledge in the browser and still leaves the race in every other consumer of `seedMailSession`.

**Keep the draft in the main workspace.** Rejected: the owner asked for the same floating surface as mail, and two different destinations for one button is the inconsistency this note removes.

## Consequences

Both entry points now cost one model turn when the conversation is opened, which is the point of the affordance. A mail re-opened from the same browser reuses its Session and does not repeat the turn; a draft does the same once its greeting marker exists. A draft Session keeps its draft-only tool restriction, so the summary cannot read other mail or send anything. The greeting is browser state, not Session state: clearing site data repeats it.

## Testing

`corepack pnpm run typecheck` passes. The focused Vitest run over `packages/faberloom/mcp-registry`, `packages/faberloom/view`, `packages/client/ui-faberloom`, `packages/faberloom/connections`, and `packages/mcp/mcp-client` passes 817 tests in 70 files. New coverage: `seedMailSession` injects the context and then asks the question as its own turn; `draftSessionAsk` reaches the bound Session, refuses a draft without one, and rejects a read-only identity; the Client opens the float, asks once per Session, keeps a docked conversation docked, and asks nothing without a prompt. The Registry also proves a caller-supplied budget is applied per call and raised to its floor, so the Correo panel cannot be held by a slow MCP server.
