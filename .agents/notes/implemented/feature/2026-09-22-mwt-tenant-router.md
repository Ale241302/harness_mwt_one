# Agent Note: the MWT.ONE tenant router queries every company of the user

Status: implemented

English | [中文](2026-09-22-mwt-tenant-router.zh.md)

## Problem

A user with several `legal_entity_ids` had exactly one tenant per session: the gateway injects one `X-MWT-Client-ID` (the entity chosen at `/entity`, or the single company), so an expediente living in another of the user's companies was invisible to the chat unless the user signed out and switched entities. The plan's promise is the opposite: the assistant should consult all of the user's companies and find which one holds the data.

## Decision

The tenant list travels to each dsh, and the routing lives in three model tools over the existing JSON-RPC client — no per-company MCP client instances (each would multiply the ~175-tool surface per request) and no gateway-side query proxy.

- `gateway/server.mjs` `renderPatch` writes `companyIds` (every `legalEntityIds`) into the `tool-faberloom` and `faberloom-view` configs, next to the active `companyId` the session already had.
- `tool-faberloom` gains `faberloom_companies` (the user's tenants with the active one marked), `faberloom_mwt_call` (one MWT tool against one explicit tenant), and `faberloom_mwt_find` (one read query fanned out to every tenant, reporting which returned data). The `tenant()` helper resolves an explicit company case-insensitively and throws unless it belongs to the user's own list: the router cannot address a tenant the identity does not own, and the console still enforces role and permissions on every call.
- `faberloomView.mwtStatus` returns `companyIds`, and the Conexiones MWT.ONE block renders every company as a chip with the active one marked, so the multi-company reality is visible instead of hidden behind "no single company".

The model-facing guidance keeps the default path first: query the active company through the native `mcp__mwt__*` tools, and reach for `faberloom_mwt_find` when the data may live elsewhere.

## Alternatives considered

- **One MCP client instance per company.** Rejected: each instance would register the full tool catalog again (`mcp__mwt-ent1__*`, `mcp__mwt-ent2__*`), multiplying the tool block on every request and confusing tool selection; the router adds three tools total regardless of tenant count.
- **Restarting the dsh per query with a different tenant.** Rejected: it is what `/entity` already does for a session-wide switch; per-query routing must not interrupt the conversation.
- **A faberloom-side read/write allowlist for routed calls.** Deferred deliberately: tenant membership is the boundary FaberLoom owns, and read-vs-write stays with the console's RBAC, which already validates every call as the user.

## Consequences

- A multi-company user can ask "find expediente X" and the assistant answers which company holds it in one fan-out, without re-login and without switching entities.
- Tenant checks are case-insensitive and the list is the console's own `legal_entity_ids`, so a revoked company disappears from the router at the next login/patch render.
- `mwtStatus` and the panel show ids, not display names; the console does not expose a name mapping yet (recorded in the package README).
- Routed calls do not require a FaberLoom grant beyond what the native `mcp__mwt__*` tools already require; effect steps inside routines keep their own grant path unchanged.
