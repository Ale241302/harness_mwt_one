# Agent Note: MCP mail reads inside Correo

Status: implemented

English | [中文](2026-11-22-mcp-mail-in-correo.zh.md)

## Problem

The owner connected Hostinger's mail MCP server in Conexiones and the row appeared, but Correo still listed only IMAP accounts. The mailbox the MCP server can read was invisible in the panel that exists to read mail, and the connection form reported "Herramientas disponibles: 24" without naming one of them, so the owner could neither find the mail nor know what the agent could do with the server.

## Decision

### The registry calls the live mount

`@deepseek-ai/dsh-mcp-client` now separates its startup from its plugin entry: `mount(ctx, config)` performs the existing body and returns the live `ConnectionHandle`, and `apply` awaits `mount` and discards the handle. The handle gains `callTool(rawName, args, { signal?, timeoutMs? })`, which calls the current generation and rejects when no generation is connected.

`ctx.faberloomMcpRegistry.callTool(ownerId, serverName, rawName, args)` uses that handle. The registry mounts each saved server through a small plugin object that calls `McpClient.mount` and keeps the handle in a `WeakMap` keyed by the mount's own context, so a host-side read reuses the client the agent already has instead of opening a second connection. Before any transport work it asks `mcpToolDecision(rawName)`; a governed name throws with the same Spanish reason the model would read, so `send_email` and the eleven mutating mail tools can never leave through this path. The call is bounded by `toolCallTimeoutMs` (a dedicated timeout error, not the probe's), and the payload unwraps to `structuredContent`, else the first text block that parses as JSON, else the whole MCP result; a tool-level `isError` throws with the server's own words. The payload is untrusted and the caller narrows it.

### The view merges MCP mail into the existing RPCs

`emailFolders`, `emailInbox`, and `emailRead` keep their signatures. A mounted server is discovered with `account_current`; each mailbox becomes one account whose account id is `mcp-mail:<server>:<resourceId>`. Folders come from `folders_list`, envelopes from `messages_list` for the selected folder (or the server's `\Inbox`), and a body from `messages_text`. A message id is `mcp-mail:<server>:<resourceId>:<encoded folder>:<uid>`, so a read needs no second lookup and can never collide with an IMAP `<connection>:<uid>`. Selecting an IMAP account keeps MCP out of that page; an unreachable server becomes a `FaberLoomInboxFailure` beside the accounts that answered; an empty or failing mailbox is never presented as healthy. The mutating RPCs (`emailMarkSeen`, `emailMove`, `emailRestore`, `emailTrash`, `emailAttachment`, and the draft/Space paths that start from a uid) refuse an MCP id through `requireInbound`.

The mapping lives in `packages/faberloom/view/src/mcp-mail.ts`, with no I/O, so the id, envelope, folder, address, and message rules are unit-tested.

### The panel reads it and names the tools

Correo's existing account rail already groups by account, so the MCP accounts appear there with a localized label (`MCP · <server> · <address>`), their folders, their envelopes, and their bodies. An MCP row shows a read-only note where the mark/move/reply/trash controls are, and the mail assistant, signature account list, and compose-from list exclude MCP accounts. A failed MCP account renders through the existing `email.accountFailed` state.

The probe result now carries `toolInfo` (each tool's public name and the server's own description) beside the names. The connection form lists them, prefix-stripped to the server's raw name and with a bounded description line, under a locale title. No new RPC was added.

## What was verified against the live server

The Hostinger endpoint at `https://mcp.mail.hostinger.com/mcp` (server info `hostinger-email` 0.1.0) lists 24 tools. Read through the owner's stored OAuth credential, after a token refresh: `account_current` answers one text block holding `{ status, headers, body: { data: { mailboxes: [{ resourceId, address }] } } }`; `folders_list` answers `body.data` as an array of `{ path, name, delimiter, specialUse, messageCount, unreadCount }` with `\Inbox`, `\Drafts`, `\Junk`, `\Sent`, `\Trash`; `messages_list` answers `body.data` as an array of `{ uid, path, date, flags, unseen, subject, from: { name, address }, to, cc, messageId, inReplyTo, attachments }` plus `body.pagination { page, perPage, total, totalPages }`; `messages_text` answers `body.data` as `{ text, html }`. The token in use saw one mailbox (`alejandro@muitowork.com`); the mapper handles every mailbox the server reports, not a fixed list. Only read tools were called while inspecting.

## Alternatives considered

**Call the model-facing tool through `ctx.tools.execute`.** Rejected for this consumer: it routes a panel read through the model dispatch pipeline (presenters, `tools/result` observers, and the PTC mode collapse, under which a call without a parent is denied), and it would construct a `ToolRunContext` the panel does not own.

**Open an isolated connection per panel read, as `probe` does.** Rejected: the owner's panel read would handshake several times per refresh and bypass the connection the agent already keeps alive. The probe stays isolated because it tests an unsaved candidate with values that are not stored yet.

**Add a parallel `mcp-mail` RPC surface.** Rejected: the Correo panel already models accounts, folders, envelopes, and bodies, and a second surface would duplicate selection, paging, labels, and error presentation. Extending the three reads keeps one list and one set of states.

**Reuse IMAP uids or parse the MCP id in the client.** Rejected: ids must stay unique across sources and the panel must not decode routing. The synthetic id travels whole, and the host owns its meaning.

## Consequences

The mailbox the MCP server can read is now visible in Correo, and the agent's mail tools are named where the owner configures the server. MCP mail is read-only in the panel this slice: marking, moving, trashing, replying, forwarding, and attachments stay unavailable, and a body read returns no attachment list because `messages_attachment` is out of scope. The MCP listing also ignores the unread/flagged/important/awaiting criteria and the search box; `messages_search` is not part of this slice. Every read depends on the mount: a server that failed to mount contributes a visible failure, not an empty account.

## Testing

`corepack pnpm run typecheck` passes. The focused Vitest run over `packages/faberloom/mcp-registry`, `packages/faberloom/view`, `packages/client/ui-faberloom`, and `packages/faberloom/connections` passes 684 tests in 61 files. The new coverage: `callTool` refuses a governed name before the fixture server sees the call, returns a read payload, returns the whole result for non-JSON text, reports a tool-level failure, and rejects an unmounted owner; the probe reports `toolInfo`; the view maps accounts, folders, envelopes, bodies, failures, and id round-trips, keeps MCP out of an IMAP-selected page, and refuses a mutation on an MCP row; the panel test renders the MCP account label and the read-only reader, and renders the probe's tool names and descriptions.
