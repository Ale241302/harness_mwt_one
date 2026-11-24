# Agent Note: a two-tool Code Mode facade for external MCP clients

Status: implemented

English | [中文](2026-11-24-mcp-codemode-facade.zh.md)

## Problem

A chat client pointed at MWT, SICOP, or FaberLoom receives every tool schema those servers advertise, and sends all of them in every request. Hundreds of schemas then dominate the prompt before the model reads the question, and every added upstream tool makes every client request larger. The harness already has Code Mode: `run_code` executes a program against `tools.<name>`, and only its output reaches the model. That tool lives inside the Cordis agent loop, which a Claude Desktop, Cursor, or ChatGPT connector cannot mount. The client needs the same two-tool surface as a standalone MCP server.

## Decision

`packages/mcp/mcp-codemode` ships `@deepseek-ai/dsh-mcp-codemode`, a stdio MCP process with exactly two tools. `run_code` takes `code` and `description`; `catalog` takes an optional `server` and returns TypeScript declarations. A client's `tools/list` therefore carries two schemas regardless of how many upstream tools exist.

### The parent owns every upstream connection

At startup the facade connects one MCP client per configured upstream over stdio or Streamable HTTP, lists each server's tools once, and indexes them. HTTP headers, stdio `env`, and every credential stay in the facade process. Each `run_code` call spawns a fresh Node process with `env: {}`, one IPC channel, a heap limit, an output bound, and a deadline; the child wipes its environment again before running the program, which removes the machine defaults Windows supplies to an empty spawn environment. A program reaches data only by calling a declared binding, and only its console output and return value reach the client.

### Bindings and results are the harness's own

A program calls `tools.mcp__<server>__<rawToolName>`, the same key `publicToolName` derives in `@deepseek-ai/dsh-mcp-client`; a test compares the two functions directly, including invalid-character replacement and the 12-hex suffix that keeps lossy names distinct. A binding resolves with the harness MCP bridge's canonical `{ content, structuredContent? }` value, and a tool-level error rejects so the program can catch it. The same program text therefore runs against the same servers inside the harness.

### The program's IPC protocol is a pure state machine

`src/protocol.ts` decides everything a frame can mean: log accounting and the output bound, binding-call identity and sequencing, the in-flight call cap, JSON losslessness at the boundary, terminal frames, and exactly one settlement. It owns no process, timer, or channel, so tests feed it raw frames and lifecycle events as data. `src/drive.ts` wires the child's events, timers, stderr cap, and teardown to that machine; `src/channel.ts` sends frames and performs the soft-then-hard kill; `src/executor.ts` only spawns. `src/upstream.ts`, `src/sdk.ts`, `src/server.ts`, and `src/startup.ts` hold the MCP client set, catalog rendering, the two tool registrations, and the config-file entry.

### Bounds are configuration with explicit defaults

`timeoutMs`, `maxOutputBytes`, `maxUpstreamResultBytes`, `maxCatalogBytes`, `maxPendingCalls`, `maxOldGenerationSizeMb`, `nodeExecutable`, and `cwd` are validated config fields. A non-positive value or an empty upstream list fails at startup instead of silently applying a different bound. Unknown upstream names in `catalog` and colliding bindings are configuration errors.

## Alternatives considered

**Reusing `packages/ptc-runtime/ptc-runtime-node`.** Rejected: `NodePtcRuntime` injects `fs`, `subprocess`, `sandbox`, and `sandboxPolicy`, and the sandbox policy service injects `sessionProjections`, so instantiating it means booting a Cordis application. The Windows sandbox backend is also absent from the Windows test lane. This package implements a smaller executor with the same program contract instead of mounting an application to run one function body.

**A dumb proxy that re-exposes each upstream tool.** Rejected: forwarding every tool preserves both costs this change removes, the schema load in every request and one model round-trip per call. A proxy that forwards `run_code` unchanged to one upstream does not exist, and one that forwards a single call per tool does not compose calls in a program.

**An HTTP facade with per-tenant tokens.** Rejected for now: HTTP tenancy, remote auth, and deployment are a separate operational surface. The shipped entry is one local process whose credentials come from one JSON file the client already controls.

**A general-purpose sandbox in the program process.** Rejected: filesystem confinement, network policy, and approvals are the harness PTC runtime's job. This facade bounds output, heap, and time, and documents that it is not a security sandbox.

## Consequences

- **Not a security sandbox.** Node APIs remain reachable through `await import(...)`; there is no filesystem confinement, network policy, or approval step. A deployment that needs those mounts the harness PTC runtime instead.
- **stdio transport only.** One local process, credentials in the config file. HTTP tenancy, per-tenant tokens, remote auth, and deployment are not implemented.
- **Rich content returns as JSON.** Image, audio, and resource blocks arrive inside `{ content }` as base64 or URI text; the client cannot display them.
- **Catalog types are a bounded JSON Schema subset.** Objects, arrays, scalars, enums, local `$ref`, and `anyOf`/`oneOf`/`allOf` render; anything else becomes `unknown`, and each description is cut at 240 characters.
- **No progress or streaming during a run.** A long program is silent until it settles or its deadline fires, and the upstream tool list is captured at startup.

## Testing

`corepack pnpm exec vitest run packages/mcp/mcp-codemode --coverage --coverage.include="packages/mcp/mcp-codemode/src/**"` passes 9 test files and 93 tests with 100% statements, branches, functions, and lines per file. The protocol state machine has data-only coverage of invalid frames, a dead child, deadline, cancellation, and settlement idempotence; `channel.spec.ts` covers the soft kill and the `SIGKILL` escalation; the driver has a fake child for spawn failure, closed-channel sends, stderr capture, and cancellation before boot; the facade suite runs real stdio upstreams, and `tests/stdio.e2e.spec.ts` launches the source entry through tsx. The only `/* v8 ignore */` directives in `upstream.ts` cover the non-JSON checks after the MCP client has already parsed a tool result from JSON, which is unreachable by construction.

`corepack pnpm exec tsc -b packages/mcp/mcp-codemode/tsconfig.json` and `corepack pnpm exec oxlint packages/mcp/mcp-codemode` were run with no findings.
