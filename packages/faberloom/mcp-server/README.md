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
    publicationRepo: /data/usuarios/<id>/knowledge
```

The endpoint listens on a **unix socket** by default, so several owners served by one container never collide; a loopback `port` is accepted instead, which is what development and the tests use. Nothing listens unless `enabled` is true. `publicationRepo` names the local Git work tree the publication reader serves; empty hides `faberloom_publication_read`.

### Clients and tokens

The owner mints a token in **Conexiones → Servidor MCP** and hands the secret to the other agent; the panel shows it once and from then on lists only a fingerprint. A request authenticates with `Authorization: Bearer <token>`; an unknown, revoked, or foreign-owner token is refused with 401. A token records the company the panel was acting for at mint time, so an external agent reads and writes only that company's items; a token minted with no company reads only company-less items. A token may also name a Space for its proposals; such a token must carry `faberloom_proposal_submit` as its only scope, and it revalidates that the owner can still read that Space on every use, stopping when the membership is lost. `spaceId: null` is the legacy owner-wide token written before the field existed. The scope list narrows the tool surface (`null` is the owner's full surface), and a stored list that names a retired scope keeps working with that entry ignored while an unknown tool is refused at authentication. Tokens live in the product's own domain, so revoking one by fingerprint stops that client without touching the harness.

**Local OAuth and work references.** The same endpoint is the local authorization server. `GET /.well-known/oauth-authorization-server` publishes the issuer, the MCP resource, the S256 method, and the scopes. `GET /authorize` validates the local client `faberloom-local`, an exact loopback redirect, S256 PKCE, the resource/audience, and a scope set that never mixes the proposal tool with another; it then renders a waiting page naming the Space and every scope, with no approving control. The signed-in product panel lists the pending request and approves or denies it through the view; `GET /authorize/status` redirects with the one-time code or `access_denied` once that decision exists. `POST /token` exchanges the code (PKCE, exact redirect/resource, five-minute life) for a one-hour token and a work reference fixed to the connection, the Space, and the revision. Every call from that token must send `x-faberloom-work-reference`; the server revalidates the reference's connection, owner, Space, and current membership, so two conversations keep their own target and no process-wide active Space exists. Revoking the reference or the token stops the calls even if the client keeps the reference. A read token scoped to `faberloom_publication_read` reads only the revision its reference fixed; a proposal token cannot read, and a read token cannot propose (CON-02).

### What the endpoint answers

`initialize`, `ping`, `tools/list`, and `tools/call`; notifications are accepted with 202 and no body. Protocol faults are answered as JSON-RPC errors (`-32700`, `-32600`, `-32601`, `-32602`) rather than a silent hang.

The tools act as the owner and use the same operations the panels do:

- `faberloom_overview`, `faberloom_routines`, `faberloom_executions`;
- `faberloom_teachings`, `faberloom_teaching_record`, `faberloom_teaching_revoke`;
- `faberloom_routine_run`, which goes through the routines engine and therefore obeys the same autonomy guard: a step that records an effect still needs an active grant;
- `faberloom_mirror_export`, which returns this home's product rows and skill files as one versioned transfer document, and `faberloom_mirror_apply`, which applies a document back. Both require the `faberloom-mirror` row; a process without it refuses with a readable error;
- `faberloom_proposal_submit`, which receives one knowledge proposal (`archivo`, `versionBase`, `cambio`, `motivo`, `evidencia`, `claveCliente`, `title`) and answers with `{ recibida: true, id }`. It never approves: the item enters the Mesa as `PENDIENTE_CRITERIO`, and a reused client key with different content is `PROPOSAL_CONFLICT`. It can be the only tool a token is scoped to.
- `faberloom_publication_read`, which reads one repository-relative file at the commit its work reference fixed and answers with `{ revision, path, bytes, sha256, text }`. It never accepts a caller-supplied revision or branch, refuses paths that escape the work tree, and caps the file at 1 MiB. When `publicationRepo` serves a publication, a proposal on that connection must name the same revision as `versionBase`; another base is `PROPOSAL_BASE_MISMATCH`.

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
- **OAuth needs a loopback TCP listener.** The authorization page and `/token` exist only when the server is configured with a `port`; the default Unix socket has no browser-reachable origin and answers `oauth_unavailable`.
- **The bridge does not forward the work reference yet.** A public `/mcp` call routed through the gateway carries the body, token, and accept header only; an OAuth token (which requires `x-faberloom-work-reference`) works on the local loopback endpoint until the bridge forwards that header. Legacy tokens without a reference keep working on both paths.
- **The reference fences local Git reads, not the Space revision or object storage.** `faberloom_publication_read` returns the commit the work reference fixed and refuses a branch or a caller-supplied revision. The reference still only records the Space revision: a later Space change does not reject a board call. The MinIO-backed publication retrieval of 3A.3/3A.4 is not implemented, so a deployment whose publication lives only in object storage cannot read it through this tool.
- **The pending-request list has no per-client quota.** The panel lists every pending authorization of the owner; expired rows are removed on the next authorization, and nothing limits how many a client may leave waiting.
- **Legacy tokens keep the full surface.** A record with `scopes: null`, including tokens written before scopes existed, can call every tool; only a newly minted scoped token is narrowed, and a proposal token is always exclusive.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`dispatch` is pure: it takes a parsed message and the tool host and returns the status and body, so the protocol is tested without a socket. The transport test binds a real endpoint and drives it over HTTP, which is what proved the auth and the guard end to end. Node on Windows cannot bind an arbitrary filesystem path as a socket, which is why `port` exists.

</details>

**Runtime invariant:** No companion is published. The service's own durable state is one token table in `faberloom_mcp`; every other answer is derived from the owner's services at call time.
