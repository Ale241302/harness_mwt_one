# Agent Note: MWT writes use the deployed MCP field contract

Status: implemented

English | [中文](2026-11-20-mwt-real-mcp-transport.zh.md)

## Problem

The O8A transport sent generic `expediente`, `coleccion`, `campos`, `documentos`, `version_esperada` and `idempotency_key` arguments. The deployed `expediente_obtener` instead requires `expediente_id`, and `expediente_editar` requires `expediente_id` plus a `cambios` object. The MCP response carries the expediente as JSON text, with `updated_at` but no ETag, document list or idempotency guarantee. No production transport was registered.

## Decision

**The MWT service registers its MCP transport when the Cordis tools service is mounted.** It resolves the mounted `expediente_obtener` and `expediente_editar` tools for each call, inherits the owner's identity from that runtime, parses the MCP payload and writes only server-allowed header fields. `mwtPrepareWrite` exposes preparation through the authenticated view without executing the write.

`updated_at` is the local revision observation used by prepare and the pre-write reread. The server does not accept it as a compare-and-write precondition. After writing, the service reads every approved field and refuses to mark a mismatch as written. Documents and unknown fields fail before the MCP write. One single-use authorization still permits only one invocation, and a lost answer remains `unknown`.

## Alternatives considered

**Keep generic arguments until a future server supports them.** Rejected: the deployed tool would reject the payload, and presenting that as a working transport would be false.

**Add server-side versioning and idempotency in this change.** Deferred: those guarantees require a server migration and their own verification. The adapter states their absence rather than claiming equivalent behavior from `updated_at`.

**Wire the transport in the browser panel.** Rejected: the MWT service owns the destination and the board also consumes it; the Cordis tools runtime supplies the identity without a UI dependency.

## Consequences

The real header PATCH path is available with exact proposals and read-back confirmation. Document writes, atomic compare-and-write and server deduplication remain outside this transport. A missing tool or failed read stops preparation; a failed or lost write never becomes a confirmed success by optimism.

## Testing

The transport suite covers MCP unwrapping, root fields, `updated_at`, exact edit arguments, numeric credit days, unsupported fields and documents, and lost responses. The real Cordis composition tests cover transport registration, owner-tool invocation, read refusal and a write error that never becomes `written`. The view suite covers preparation for the authenticated actor and the absent-service refusal. These are local tests; any real operation needs a separate `AUTH-MWT-WRITE` and destination evidence.
