---
description: "Native MCP server registry (ctx.faberloomMcpRegistry): durable per-owner MCP server configuration, header/env secrets through the credential seam, an isolated connection probe, and process-global mounting of every enabled server."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-mcp-registry

English | [中文](README.zh.md)

## Summary

The MCP registry publishes `ctx.faberloomMcpRegistry`: the durable configuration of a user's MCP servers, the probe that proves one works, and the process-global mounts that make an enabled server's tools available without a restart. `save` writes each header or environment value to `ctx.credentials` and keeps only its name and reference; `probe` connects in an isolated scope, lists the tools, and always closes; `remove` unmounts the server and drops its credentials. No returned or stored field ever carries a secret value.

## Table of Contents

- [Use this package](#use-this-package)
- [Transports and secrets](#transports-and-secrets)
- [The probe](#the-probe)
- [Mounting](#mounting)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition that already carries `ctx.storageDomain` and `ctx.tools`; secret-bearing servers additionally need the credential seam, `ctx.credentials`. The service opens the `faberloom_mcp_registry` domain, registers `ctx.faberloomMcpRegistry`, and exposes `list(ownerId)`, `save(ownerId, input)`, `remove(ownerId, name)`, and `probe(input)`. Records are one per owner and server name. `probeTimeoutMs` bounds one probe (default `10000`); `toolCallTimeoutMs` bounds one tool call on a mounted server (default `60000`).

-----

<a id="transports-and-secrets"></a>
## Transports and secrets

One saved server holds its transport, the non-secret entry names with the references their values live under, its enabled flag, and its timestamps.

| Transport | Fields |
|---|---|
| `stdio` | `command`, `args`, `cwd` |
| `streamable-http` | absolute HTTP(S) `url` |

Every `env` and `headers` value is a secret. `save` writes each value to the credential seam under `mcpSecretCredentialRef(ownerId, name, entryName)` and keeps only `{ name, credentialRef }` in the record, so the value never leaves the host and no read — list, save, or probe — can return it. Omitting `env` or `headers` preserves the saved entries; an explicit empty map clears them and drops their stored credentials. A composition without a mounted seam rejects a save that carries a secret, and a saved entry reads as `present: false` until the seam holds a value.

-----

<a id="the-probe"></a>
## The probe

`probe(input)` proves one candidate server works before it is saved. It mounts the MCP client inside an isolated scope under the registry's fiber, awaits the connection, lists the `mcp__<name>__` tools it registered, and always disposes that scope, so a probe leaves no tool in the global registry. It returns `{ ok: true, tools }` or `{ ok: false, failure, detail }`, where `failure` is `unreachable`, `bad-credential`, or `protocol`, and `detail` carries the deepest message from the server with every supplied secret replaced by `[redacted]`. The probe is bounded by `probeTimeoutMs`; a server that never answers reports `unreachable`.

-----

<a id="mounting"></a>
## Mounting

An enabled server mounts in-process through `ctx.plugin(dsh-mcp-client, config)` — the same mechanism `dsh-acp` uses to mount one per session, here at the registry's own scope instead of an agent scope. `save` unmounts the previous client and mounts the new one, `remove` unmounts before deleting, and a disabled server is never mounted. The tools belong to the global tool registry, which the agent loop reassembles on every request: a session already running sees `mcp__<name>__<tool>` in its next request without a restart, while the request already in flight does not. At load, `apply` mounts every enabled record and logs any that cannot mount, so a saved server is available to every workspace and Space from boot. The registry fiber's teardown disposes every mount.

-----

<a id="model-experience"></a>
## Model Experience

### Mounted server tools

#### What the model sees

Nothing from this package directly. It registers no tool, prompt section, or session event; when an enabled server is mounted, `dsh-mcp-client` owns the `mcp__<serverName>__<tool>` schemas and the server's literal instructions, and this package only decides whether that client is mounted.

#### Token effect

Zero direct tokens. Mounting a server adds the MCP client's tool schemas and attributed instructions to the request; unmounting removes them. This package contributes no text of its own.

#### KV Cache effect

Append-only when a mount adds a server between requests and replacing when a mount changes the tool list: the next request's prefix from the tools section onward changes. A save, remove, or disable changes the mounted set and can invalidate reuse from that point; with no change the package preserves an already-reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No panel for the servers.** The model can install, list and remove a server from a chat (`faberloom_mcp_add`, `_list`, `_remove` in `tool-faberloom`), and a user can read and manage one there; a dedicated settings surface for MCP servers is its own later slice.
- **Probing again needs the values again.** `probe` takes a full candidate, so re-testing an already-saved server means supplying its credential values once more; a caller that holds only the reference cannot retest it, which is why no by-name probe tool ships.
- **The mount is process-global.** Records are partitioned per owner, but one process holds one client per server name. A multi-owner deployment that enables two servers of the same name fails the later mount loudly and reports its row as not mounted until a later save or boot retries.
- **A failed mount keeps its row.** `save` commits the record before it mounts, so a server whose mount fails (a missing credential, or a duplicate global namespace) is still listed, reported `mounted: false`, and retried at the next boot.
- **`probe` writes nothing and reads no seam.** The candidate values must travel in the `probe` input, so probing an already-saved server means re-entering its values; a caller that only knows the reference cannot probe without them.

No invariant companion is published because the package's unit specs already assert the round-trip, the seam write with its reference, the probe verdicts against real endpoints, and the mount/unmount transitions.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The reference is `MCP_SECRET_REF_PREFIX` plus the uppercase hexadecimal UTF-8 encoding of `ownerId`, `serverName`, and `entryName`, separated by `_`. Hexadecimal contains no `_`, so the encoding is injective and the result is always a valid POSIX environment-variable name. The record stores that reference, so a read reports the value's presence through `ctx.credentials.describe` without ever resolving it.

</details>
