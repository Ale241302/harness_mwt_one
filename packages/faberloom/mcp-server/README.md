---
description: "Native product MCP server (ctx.faberloomMcpServer): FaberLoom's own server face, so another AI can read and manage the owner's work over MCP Streamable HTTP with a token the owner mints and revokes; for users and maintainers of the FaberLoom Conexiones module."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-mcp-server

English | [中文](README.zh.md)

## Summary

The plan has FaberLoom on both sides of MCP: a client of the MWT.ONE console, and a server other AIs connect to. This package is the server face. The harness ships an MCP client and resources but no server, so the protocol, the transport, and the identity live here: JSON-RPC 2.0 over an MCP Streamable HTTP endpoint, a bearer token per client, and every call answered through the product services.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where the owner's product services are present, with the identity and the transport:

```yaml
- id: faberloom-mcp-server
  config:
    ownerId: usuario@ejemplo.com
    enabled: true
    socketPath: /data/users/<id>/faberloom-mcp.sock
```

The endpoint listens on a **unix socket** by default, so several owners served by one container never collide; a loopback `port` is accepted instead, which is what development and the tests use. Nothing listens unless `enabled` is true.

### Clients and tokens

The owner mints a token in **Conexiones → Servidor MCP** and hands the secret to the other agent; the panel shows it once and from then on lists only a fingerprint. A request authenticates with `Authorization: Bearer <token>`; an unknown, revoked, or foreign-owner token is refused with 401. A token records the company the panel was acting for at mint time, so an external agent reads and writes only that company's items; a token minted with no company reads only company-less items. A token may also name a Space for its proposals; such a token must carry `faberloom_proposal_submit` as its only scope, and it revalidates that the owner can still read that Space on every use, stopping when the membership is lost. `spaceId: null` is the legacy owner-wide token written before the field existed. The scope list narrows the tool surface (`null` is the owner's full surface), and a stored list that names a retired scope keeps working with that entry ignored while an unknown tool is refused at authentication. Tokens live in the product's own domain, so revoking one by fingerprint stops that client without touching the harness.

### What the endpoint answers

`initialize`, `ping`, `tools/list`, and `tools/call`; notifications are accepted with 202 and no body. Protocol faults are answered as JSON-RPC errors (`-32700`, `-32600`, `-32601`, `-32602`) rather than a silent hang.

The tools act as the owner and use the same operations the panels do:

- `faberloom_overview`, `faberloom_routines`, `faberloom_executions`;
- `faberloom_teachings`, `faberloom_teaching_record`, `faberloom_teaching_revoke`;
- `faberloom_routine_run`, which goes through the routines engine and therefore obeys the same autonomy guard: a step that records an effect still needs an active grant;
- `faberloom_mirror_export`, which returns this home's product rows and skill files as one versioned transfer document, and `faberloom_mirror_apply`, which applies a document back. Both require the `faberloom-mirror` row; a process without it refuses with a readable error;
- `faberloom_proposal_submit`, which receives one knowledge proposal (`archivo`, `versionBase`, `cambio`, `motivo`, `evidencia`, `claveCliente`, `title`) and answers with `{ recibida: true, id }`. It never approves: the item enters the Mesa as `PENDIENTE_CRITERIO`, and a reused client key with different content is `PROPOSAL_CONFLICT`. It can be the only tool a token is scoped to.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing by itself: `ctx.faberloomMcpServer` registers no tools and writes no prompt text. What an external model sees is the tool catalogue above, with the same JSON results the panels read, so an outside agent and the product surface cannot disagree about the same case.

#### Token effect

Zero direct tokens on every request. Each call forwards to the product services, which cost what they cost: a read is free, a routine run costs what its steps cost.

#### KV Cache effect

Independent of live requests: the endpoint never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The dsh must be running for its socket to exist.** The deployment's gateway starts the owner's harness when an MCP request arrives, using the identity stored at the owner's last login; a deployment with no stored identity answers 503. A resident process per owner is the E8 work.
- **One request per HTTP call, no streaming.** The transport answers a single JSON body and does not implement server-sent events, so long-running work is not streamed to the client; `notifications` are accepted but nothing is pushed.
- **Seven tools, read-mostly.** The catalogue covers the plan's discovery needs; space, agent, and board writes are deferred until the guard semantics for each are decided.
- **Legacy tokens keep the full surface.** A record with `scopes: null`, including tokens written before scopes existed, can call every tool; only a newly minted scoped token is narrowed, and a proposal token is always exclusive.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`dispatch` is pure: it takes a parsed message and the tool host and returns the status and body, so the protocol is tested without a socket. The transport test binds a real endpoint and drives it over HTTP, which is what proved the auth and the guard end to end. Node on Windows cannot bind an arbitrary filesystem path as a socket, which is why `port` exists.

</details>

**Runtime invariant:** No companion is published. The service's own durable state is one token table in `faberloom_mcp`; every other answer is derived from the owner's services at call time.
