# Agent Note: FaberLoom's server face, with the owner's own tokens

Status: implemented

English | [中文](2026-09-18-faberloom-mcp-server.zh.md)

## Problem

The plan puts FaberLoom on both sides of MCP: a client of the MWT.ONE console, and a **server** other AIs connect to, so work can be started and inspected from outside the product's own browser. The first half shipped; this half had nothing. The harness provides `dsh-mcp-client` and resources, so a server had to be built: the protocol, the transport, the identity of the calling client, and a decision about what an outside agent may do.

## Decision

`packages/faberloom/mcp-server` (`ctx.faberloomMcpServer`) owns the server face.

**The protocol** is JSON-RPC 2.0 over an MCP Streamable HTTP endpoint, implemented as a pure `dispatch(host, message)` so the protocol is tested without a socket. It answers `initialize`, `ping`, `tools/list`, and `tools/call`; notifications get 202 with no body; and a fault answers a JSON-RPC error rather than hanging.

**The transport** binds a **unix socket per owner** (`<DSH_HOME>/faberloom-mcp.sock`) by default, so several owners in one container never collide and the deployment decides how to expose it; a loopback `port` is accepted instead, which is what development and the tests use because Node cannot bind an arbitrary filesystem path on Windows. Nothing listens unless the row enables it.

**The identity** is a bearer token the owner mints in Conexiones and hands to that client. Tokens live in the product's own domain (`faberloom_mcp`), and the endpoint refuses a missing, unknown, or revoked token, and a token belonging to a different owner even if this process can read it. Revoking is an owner act in the panel; the harness never holds these tokens.

**The work** is the product's own operations: `faberloom_overview`, `faberloom_routines`, `faberloom_executions`, `faberloom_teachings`, `faberloom_teaching_record`, `faberloom_teaching_revoke`, and `faberloom_routine_run`. Every call acts as the same identity the panels use, and `faberloom_routine_run` goes through the routines engine, so a step that records an effect still needs an active grant — an outside agent cannot widen what the owner authorized.

**The gateway** publishes it: `POST /mcp` resolves the bearer token by reading the product's token file for whichever user holds it, starts that owner's harness from the identity stored at their last login when it is not running, and forwards the request to their socket. The gateway stores no tokens; it only locates them.

## Alternatives considered

- **A TCP port inside each per-user dsh, proxied by nginx.** Rejected: the ports would have to be allocated and routed per user, while one socket per home needs no allocation and dies with the process.
- **A separate MCP container.** Rejected now: it cannot drive per-owner product services, and a resident process per owner is E8's work, not this slice's.
- **Tokens minted by the gateway.** Rejected: the product owns the tokens, so revoking one must not need the gateway; the gateway only resolves them.
- **Letting `tools/call` grant autonomy.** Rejected: the guard enforcement point stays the routines engine, which means an external agent can start work but not authorize an effect.
- **Streaming responses (SSE).** Deferred: the first slice answers one JSON body per request; nothing streams yet, and the tools return quickly.

## Consequences

- Another AI can read the owner's spaces, routines, executions, and teachings, and can record or revoke a teaching, using the same objects the panels show.
- An MCP request arrives only while the owner's harness is running; the gateway starts it from the stored identity, so the owner does not have to keep a browser tab open.
- Tokens are visible in the panel with their client label, so connecting an agent is an explicit, revocable act rather than a hidden credential.
- The seven tools are read-mostly; space, agent, and board writes wait for their own guard semantics.
