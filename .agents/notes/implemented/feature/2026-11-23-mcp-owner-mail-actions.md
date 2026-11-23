# Agent Note: the owner's mailbox gestures work over MCP without opening the model path

Status: implemented

English | [中文](2026-11-23-mcp-owner-mail-actions.zh.md)

## Problem

An MCP mailbox was read-only in the Correo panel: marking a message read, moving it, or sending it to Trash was refused for every MCP row, even when the server published the exact tools for those operations. The model-facing policy denied the mutating tool names on purpose, and the panel reused that denial as its own. A mailbox reachable only over MCP could be read but not tidied; the owner had to add an IMAP connection to the same mailbox to act on it.

## Decision

### Two call paths, one policy table

`callTool` stays the model path and keeps refusing every guarded name, including the message actions. `callOwnerAction` is the owner path used by the Correo panel after a human gesture. It accepts only the reversible message actions: `messages_patch`, `messages_update-flags`, `messages_move`, and `messages_move-bulk`. Sending, permanent deletion (`messages_delete-bulk`), folder edits, and webhooks stay refused on both paths. The allowlist lives in the same `policy.ts` as the denial table, so a future name is classified in one place.

### Capabilities come from the mounted server

`toolsFor` returns the raw tool names the live client registered. The view derives four booleans from them and from the folders the mailbox reports:

- **markSeen** when the server has `messages_patch` or `messages_update-flags`.
- **move** when it has `messages_move` or `messages_move-bulk`.
- **trash** when move is available and a Trash folder is advertised.
- **restore** when move is available and an Inbox folder is advertised.

The mailbox group carries those booleans. The reader shows only the controls the server advertises; a server without them keeps the read-only note instead of failing on click. Any MCP server that follows the same message-tool convention gets the actions, not only Hostinger.

### Trash is a move, never a permanent delete

The Trash gesture moves the message to the server's Trash folder, exactly like IMAP, so a misclick is recoverable. Restore moves it back to the Inbox folder. The panel never calls the permanent `messages_delete-bulk` tool. The discard-pattern teaching is captured after either path, with the same failure containment.

## Alternatives considered

**Reuse `callTool` and weaken the policy.** Rejected: the model would regain the mutating names, which is exactly what the guarded table prevents.

**Expose permanent delete.** Rejected: the panel's contract is recoverable Trash; a permanent delete needs its own confirmation and is not part of this gesture.

**Hard-code Hostinger only.** Rejected: capability discovery is the same amount of code and lets any server with the message tools participate.

## Consequences

A server that names its tools differently stays read-only until a mapping is added; the panel says so through the read-only note. Two write paths can target the same mailbox (IMAP and MCP); both act on the same server state, and the panel's gesture is the approval either way. The model-facing MCP tools remain visible and denied, so an agent cannot use them to bypass the owner.

## Testing

`vitest run packages/faberloom/mcp-registry/tests`: 38/38, including an owner action that runs while `callTool` still denies it, and the refusal of a non-owner action. `vitest run packages/faberloom/view/tests`: 318/318 plus the two new MCP action cases. `vitest run packages/client/ui-faberloom/tests/registration.client.spec.tsx`: 149/149, including the capability-gated mark and trash controls. `tsc -b` for the three packages and `oxlint` return 0.
