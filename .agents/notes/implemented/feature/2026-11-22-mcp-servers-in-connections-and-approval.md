# Agent Note: MCP servers join the Connections table and their mail tools need approval

Status: implemented

English | [中文](2026-11-22-mcp-servers-in-connections-and-approval.zh.md)

## Problem

FaberLoom kept mail in two places: the Conexiones panel held IMAP and SMTP rows, and Ajustes → Servidores MCP held every API/MCP server. An owner who received a Hostinger mail server as an MCP endpoint saw an empty Conexiones table and concluded their mail was not connected. Separately, a mounted MCP server exposed the mail server's whole tool list to the model, including `send_email` and the destructive message, folder, and webhook tools; FaberLoom's approval governed its own tools but not those calls.

## Decision

**Conexiones reads the MCP registry as a second source for the same table.** The screen loads `connections()` and `mcpServers()` together and projects both into one small discriminated row union: a product connection carries its `FaberLoomConnection`, an MCP server carries its `FaberLoomMcpServerRow` under the row id `mcp:<name>`. Nothing is copied into `faberloom_connections`, whose `kind` stays `imap | smtp | backup`, and no secret leaves the secure store. The kind select gains "Conexión MCP (API)", whose form asks only for the server name, the URL, and one credential name (default `Authorization`) and value; saving calls `saveMcpServer` with `streamable-http` and one `Authorization: Bearer …` header, and the row reads as an MCP connection whose target is the URL and whose security chip follows the URL scheme. Selecting a row reopens the stored name, URL, and credential name with the value empty; Probe calls `probeMcpServer` and reports the tool count; Delete calls `removeMcpServer`. The Settings page stays the advanced surface for transports, env entries, enablement, and probes against a re-entered credential.

**The approval policy is a `tools/pre-execute` listener on the registry fiber.** `packages/faberloom/mcp-registry/src/policy.ts` maps the guarded raw names to a decision, and `apply` registers the waterfall listener through `ctx.effect`, so disposal removes it. For each mounted server the listener derives the public name of every guarded raw tool with `publicToolName(serverName, rawName)` and compares it with the calling name; it never parses the public name, because normalization or truncation may have changed its suffix. `send_email` returns `deny` and directs the model to a FaberLoom draft the owner approves; `messages_delete-bulk`, `messages_move`, `messages_move-bulk`, `messages_update-flags`, `messages_patch`, `folders_create`, `folders_update`, `webhooks_create`, `webhooks_update`, `webhooks_regenerate-secret`, and `webhooks_test` return `ask` with the tool name and the change it makes. Every other call delegates with `next()`, so a read or a non-mail server's tool is unaffected by being MCP.

`publicToolName` is now exported from `@deepseek-ai/dsh-mcp-client`, because a consumer that must match a public name needs the documented `(serverName, rawName)` derivation rather than the suffix.

## Alternatives considered

**Move MCP servers into `faberloom_connections` as another kind.** Rejected: the registry already owns the durable record, the credential references, the mount, and the probe; duplicating them would either copy a secret into a second domain or leave the two records to diverge, and the registry's mount is process-global while connections are per owner.

**Expose a new remote that returns a merged row list.** Rejected: the merge is presentation, and the browser already receives both lists. A host-side merge would move screen state into the view and hide which source owns each field.

**Hide `send_email` and the destructive tools from the model's tool list.** Rejected: hiding a tool is not enforcement when an alternate caller or a PTC sub-dispatch can name it, and the owner needs the tool visible to see why sending is refused. The gate belongs on the call, which is the operation that decides.

**Deny MCP tools whose server name looks like a mail server.** Rejected: the server name is local configuration. The raw tool name is the stable identity that says what the call does, and the requirement is that only those exact names change behavior.

**Persist a by-name probe so a saved MCP row can be retested without its credential.** Deferred: the registry's probe deliberately reads no seam, and a saved-row test would need a new public result or a durable discovery record. The Connections form asks for the value again, which is the same limitation the Settings page states.

## Consequences

One table answers where mail lives, and the owner sees the MCP connection as a connection. The trade-off is that an MCP row cannot be tested or edited without re-entering its credential, and that the target cell shows the URL rather than the mail addresses the server exposes: discovering those needs an MCP tool call the probe does not make.

The policy governs servers this registry mounted. A client mounted elsewhere — an ACP session server or a profile patch row — is not covered, and a mutating mail tool added upstream is unaffected until its raw name is added to the policy map. A denied send produces the ordinary tool-result text, so the tool list and its schema order do not change when a call is refused.

## Testing

`pnpm run typecheck` passes. The focused Vitest run over `packages/faberloom/mcp-registry`, `packages/client/ui-faberloom`, `packages/faberloom/connections`, and `packages/faberloom/view` passes 666 tests in 60 files. The registry suite covers the pure mapping (pass-through, deny, ask), execution through `ctx.tools.execute` for a read, an unrelated tool, the denied send, and all eleven asked tools, and the listener's removal when the registry fiber is disposed. The client suite covers the merged table, the editor reading stored values with an empty credential, Probe and Save sending one bearer header, Delete, and installing a new MCP connection from the kind select.
