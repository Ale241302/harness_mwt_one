# Agent Note: A B2B client mounts only its own MWT server

Status: implemented

English | [中文](2026-11-20-client-b2b-uses-its-own-mwt-server.zh.md)

## Problem

The Conexiones panel for `contabilidad@comercializadoraummie.com.gt` (role `client_b2b`) listed two MWT servers: `mwt` with 52 tools and `mwt-comercializadora-ummie-s` with 53. The deployment's internal `mwt` row answers with the master catalogue — 61 active Marluvas SKUs — while the client's portal enables 12. The assistant listed products the client cannot order, and the same tools appeared twice under different prefixes.

`renderPatch` injected `mcp-mwt` for every account. A B2B client also registers the MCP server the console provisions for it (`faberloom_mcp_registry.json`, name `mwt-<client>`), so the two surfaces coexisted: the internal one scoped to the client's company id but still reading the master catalogue, the client's own one answering from the portal.

## Decision

**A client with its own MWT server does not receive the internal one.** `renderPatch` skips the `mcp-mwt` row when the console role is `client_b2b` and the account's `faberloom_mcp_registry.json` holds a server whose name starts with `mwt`. Staff accounts, and clients that have not registered a server yet, keep the internal row, so no account is left without MWT tools.

## Alternatives considered

**Keep both and hide the internal one from the panel.** Rejected: the model still sees two catalogues with different products and can call either, so the wrong list remains one tool call away.

**Teach the model to prefer the client server.** Rejected: a prompt preference does not remove the duplicate tools, and the master catalogue still answers when the preference is ignored.

## Consequences

A B2B client sees one MWT server, the one that speaks for its portal, and the assistant can no longer quote products outside its enabled set. The internal row remains the fallback for staff and for a client whose own server is not registered yet. A client whose own server fails to connect has no MWT tools until it reconnects; removing its registry entry restores the internal fallback.

## Testing

`node --check gateway/server.mjs` passes. The rendered patch is verified on the deployed server: `contabilidad@comercializadoraummie.com.gt` no longer carries `mcp-mwt`, and staff patches still do.
