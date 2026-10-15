# Agent Note: A memory names the conversation that captured it

Status: implemented

English | [中文](2026-10-15-memory-source-conversation.zh.md)

## Problem

The Memoria panel lists the Space memory, and every line the agent captures at the end of a turn is a distillation of that turn: `captureTurnToMemory` stores the Space's question and result through `faberloomSpaces.remember(actor, text, [space.id], session.id)`, so the stored record has always carried the Session that produced it. That field is not decoration: `forgetMemoryBySession` uses it to remove a Session's memory when the Session is deleted, so a fact does not outlive the conversation behind it.

The dialog showed the distilled text, the Space, and the date, and nothing else. A line such as `Resultado: The user just said "hola"...` therefore read as an orphan statement: the operator could not tell which conversation it came from, and could not read that conversation from where the line was. The wire row (`FaberLoomSpaceMemoryRow`) omitted the field the storage layer kept, so the client could not show it even if the dialog had wanted to. The dialog pattern itself is the one [the panel dialogs decision](2026-10-14-panel-record-dialogs.md) settled, with Memoria as its reference; what was missing was the record's own source.

## Decision

**The row carries the Session, and the dialog names it and opens it.** `FaberLoomSpaceMemoryRow.sessionId` is a required, nullable field, and the `spaceMemory` mapping passes the stored value through instead of dropping it.

**The dialog resolves the Session's label from the client's own list.** The panel reads the standard `useSessions` feed and shows `displayTitle` under `Origen`, so the line states which conversation produced it without a round trip and without a second source for that label.

**`Abrir conversación` opens the real conversation.** The action is the injected `openSession`, which is `ctx.sessions.open(id)` followed by `ctx.layout.selectPanel(null)`: the same operation the Espacios panel's shared-session row already performed, which is why the injected member is renamed from `openSharedSession` to `openSession`. One gesture, one name, two callers.

**A Session the host no longer lists reads as gone.** The dialog says so instead of offering a control that cannot run, and a line with no Session at all (recorded by hand, or captured from an email or a document) states that origin instead, which is the same derivation the table's type chip uses.

**The origin row is a block, not a `Field`.** A button inside the `Field` `<label>` takes the whole field's text as its accessible name, because a button is a labelable element; the first test run failed on exactly that, and it would have shipped a control announced as "Origin Saludo inicial Open conversation".

## Alternatives considered

**Rendering the conversation inside the dialog.** The conversation domain owns that rendering. A second renderer in this panel would be a degraded copy, missing tool results and streaming state, and `ctx.sessions` exposes no transcript read at all: create, open, binding, fork, and search are the whole face. Opening the conversation shows the messages the operator asked for, keeps one renderer, and lets them continue from there.

**A new Remote method returning a transcript.** It would duplicate the conversation rendering and widen the host API for a fact the client can already reach through the standard feed.

**A new Remote method resolving the Session's title.** The client list already carries `displayTitle` for every listed Session. A round trip would add a second source for the same label and a way for the two to disagree.

**Showing only "captured from a conversation", with no name.** It states the fact and still leaves the operator unable to tell which conversation it was, which is the complaint the change answers.

**Deriving the source from the row's text.** The `Resultado: ...` prefix is content, not a link; the record's own `sessionId` is the fact, and a line whose text happens to resemble another is not evidence of anything.

## Consequences

The dialog answers where a line came from, and reading the conversation is one click away. The wire row gains a required field, so every producer of that row states it; the storage record and the spaces service already carried it, so nothing new is persisted.

The cost is deliberate: an operator who wants the messages rendered inside the dialog still opens the Session. Buying that would mean a host transcript API plus a second conversation renderer, and the fidelity of the real conversation is worth the click. The rename of the injected member touches its two callers, both inside this package.

## Testing

`packages/faberloom/view/tests/workspace-board.spec.ts` pins the row's pass-through of the stored value. `packages/client/ui-faberloom/tests/registration.client.spec.tsx` pins the dialog naming the conversation, the open action reaching the sessions service with the panel left, and the gone state offering no action. `test:gui`, `verify-client-ui-i18n`, oxlint, and both TypeScript faces pass.
