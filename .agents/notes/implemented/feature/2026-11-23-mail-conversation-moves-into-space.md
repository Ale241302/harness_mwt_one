# Agent Note: a mail conversation moves into its Space with the chat the owner already had

Status: implemented

English | [中文](2026-11-23-mail-conversation-moves-into-space.zh.md)

## Problem

The floating mail conversation offered to add its email to a Space, and the button attached the files and the memory. The conversation itself stayed outside: the session had been created in the default working directory, and `Workspace.attachSession` refuses a session whose stored `cwd` differs from the workspace path. The card also looked the live session up under the pre-`v2` key, so it usually found none and replaced the conversation with a newly seeded session. The owner pressed Add after a long exchange and landed in a different chat, under no Space, exactly where the conversation was not.

## Decision

### The conversation on screen is the one that moves

`attachMailToSpace` takes the live session, its subject, and the destination Space, and returns the session now living in the Space's workspace. A session whose `cwd` is already the workspace path attaches in place, unchanged. Any other session keeps its immutable directory: the Host creates a Space-owned session with `mailAgents.provision` and injects `mailTransferContext`, a bounded transcript of the last twelve user and assistant messages (4,000 characters each, 12,000 total), delimited as untrusted history. The old session stays readable and unchanged.

### A draft conversation moves through its draft

A session bound to a draft cannot be detached from that binding by copying it. `attachMailToSpace` finds the draft that owns the session and delegates to `draftAttachToSpace`, which links the draft to the Space, transfers or attaches the session, and rebinds the draft to the continuation. The draft keeps working after the move.

### The browser opens the returned session

The client passes `ctx.sessions.list.getSnapshot().current`, the session the float is rendering, instead of guessing from a storage key. After the call it refreshes the list, opens the returned session, closes the float, and clears the panel. When no conversation exists yet, it still creates a Space-born session seeded with the mail and its summary question. The stale `faberloom.mail.chat.<uid>` read is gone; the `v2` key remains a fallback.

## Alternatives considered

**Change the session's `cwd` in place.** Rejected: the stored header and the workspace registry validate `cwd` at attach time; mutating it would move historical turns into a directory where their files and tools never ran.

**Attach the session without a transfer.** Rejected: `attachSession` throws when the directories differ, and swallowing the error is what produced the silent mismatch this note fixes.

**Copy the conversation as real user and assistant events.** Rejected: a second log for the same exchange belongs to the session that owns it; the draft transfer already established bounded injected context as the way across workspaces.

**Keep the per-mail storage key and fix only the version.** Rejected: the draft float shows the same card over a different session, so the key would still name the wrong conversation.

## Consequences

The Space shows the continuation under its own workspace, and the earlier session remains in the list for reference. The transcript is bounded, so a very long exchange arrives summarized by its last messages rather than in full. The transfer needs a mounted `sessionQuery`, a model provider, and the agents service; a deployment without them keeps the earlier behavior of attaching only the mail.

## Testing

`vitest run packages/faberloom/view/tests/mail-space-attach.spec.ts`: four cases covering an in-place attach, a different-cwd continuation, a card with no conversation, and a draft session that keeps its binding. `vitest run packages/faberloom/view/tests` and the client registration suite cover the rest of the panel.
