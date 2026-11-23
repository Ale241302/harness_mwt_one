# Agent Note: an MCP server takes the name the owner types and keeps a plain identifier

Status: implemented

English | [中文](2026-11-23-mcp-server-name-derives-identifier.zh.md)

## Problem

The New connection dialog demanded that the typed name match `[A-Za-z0-9_-]{1,32}`, and the field repeated the same rules. An owner who typed `MCP Hostinger` filled the type, the URL, and the credential, pressed Save, and read `Connection failed: faberloom-mcp-registry: server name "MCP Hostinger" must match /…/`. The name is a display choice; the grammar belongs to the namespace the MCP client builds its tool names from. The form presented the second as a rule for the first.

## Decision

### One derivation owns the identifier

`mcpServerId` in `packages/client/ui-faberloom/src/client/connections.ts` turns a typed name into the saved identifier. A name that already matches the identifier grammar is kept unchanged, so a saved server such as `hostinger-email` keeps its namespace and its tool names. Any other name loses its diacritics and every character outside ASCII letters and digits, then is cut to 32 characters. Only an empty result is invalid: a name with no letter and no digit.

### Both MCP surfaces derive and show it

The Connections dialog and the MCP-servers Settings section validate and save through the same function, so a name is never refused for its shape. The candidate test and the tool list use the derived identifier, because that is the namespace each public tool name carries. The Name field shows the identifier whenever derivation changes the typed text, so the owner sees what the server is saved as before pressing Save.

### The registry still refuses an unusable name

`validateServerName` in the MCP registry is unchanged. A caller that reaches the registry directly must not create a namespace the MCP client cannot mount, and a refused name there still names the grammar it broke.

## Alternatives considered

**Accept the typed name with its spaces.** Rejected: the name is the tool-name namespace (`mcp__<name>__<tool>`), and the MCP client's grammar has no space.

**Replace each separator with a hyphen.** Rejected: it still asks the owner to know a punctuation rule, which is the problem being fixed.

**Store a display label beside the identifier.** Deferred: the durable record would gain a field read by every surface, so the table, the Settings list, and the probe would all have to prefer it. Deriving the identifier fixes the refusal now; a separate display name is its own change.

## Consequences

The Connections table and the Settings list show the saved identifier, `MCPHostinger` rather than `MCP Hostinger`, because no separate label is stored. Two names that reduce to the same identifier address the same server: saving the second replaces the first, exactly as saving an existing identifier always has.

## Testing

`vitest run packages/client/ui-faberloom/tests/registration.client.spec.tsx packages/client/ui-faberloom/tests/mcp-servers-section.client.spec.tsx` covers a natural name saved as its derived identifier, a name the derivation leaves empty, and the hint that states the result. `tsc -b tsconfig.client.json` passes.
