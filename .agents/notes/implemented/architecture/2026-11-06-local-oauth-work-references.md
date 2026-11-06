# Agent Note: A local OAuth authorization server and one work reference per conversation

Status: implemented

English | [中文](2026-11-06-local-oauth-work-references.zh.md)

## Problem

A client could only connect by copying a bearer token the owner minted in a panel. That token had no browser consent, no expiry, and no per-conversation target: two tabs shared the same owner-wide surface, and a token scoped to a Space had no durable handle that named the revision the person authorized. The MCP transport had one authentication path for the socket and the bridge, but nothing bound a call to the Space or revision the user actually saw.

## Decision

**The MCP endpoint is the local authorization server.** It publishes `/.well-known/oauth-authorization-server` with the issuer, the MCP `resource`, `S256`, and the advertised scopes. `GET /authorize` accepts only the local client `faberloom-local`, an exact loopback redirect, S256 PKCE, the exact `resource`, and a scope set that never mixes `faberloom_proposal_submit` with another tool. It renders a waiting page that names the Space and every scope and embeds no secret; it has no approving control. The signed-in product panel lists the pending request and calls `decideAuthorization` (through the view); that is the only path that consumes the transaction. `GET /authorize/status` then redirects with the one-time code or `access_denied`; `POST /token` validates the code, client, exact redirect, resource, and PKCE verifier, marks the code used in one atomic update, and answers with a one-hour token and its reference. A local HTTP client cannot approve its own request, and cancelling consumes the transaction without creating a code.

**The reference is the per-conversation target.** The exchange creates a work reference from the connection (`tokenId`), the owner, the authorized Space, and the revision (the client's `revision` or the Space's `updatedAt`). It writes the reference first and then the token row once with its `referenceId`, so a crash leaves no live token without a reference. Every call from that token must present `x-faberloom-work-reference`, and `referenceMatches` revalidates the owner, the connection, the Space, and that the reference is not revoked; the Space itself is re-read from Spaces on every call. There is no process-wide active Space and no use of the MCP session id as a conversation. Two references A1 and A2 cannot cross, and revoking the reference or the token stops the connection.

**The public bridge carries the reference, and the queue is bounded.** `POST /mcp` passes `x-faberloom-work-reference` into `desktopBridge.route`; the gateway includes it in the queued payload and the desktop forwards it to `request()`, so an OAuth token reaches the same connection, Space, and revision validation through the gateway as on loopback. `/authorize` keeps at most `maxPendingAuthorizations` (five by default) unexpired requests per owner and client; a further request answers 429 instead of growing the panel's queue, and expired rows are removed before the count.

**Legacy tokens keep working.** A token without a reference (`referenceId: null`) behaves as before, owner-wide; the reference header is optional for it. Tokens minted by the panel remain owner-wide until an OAuth exchange creates a reference.

## Alternatives considered

**Reusing the minted token in the OAuth response.** The user would still copy a secret, and the token would not be tied to the consent page or the Space. The code exchange now creates the token inside the server.

**A global active Space.** It would make the selection of A2 change the destination of A1, which the acceptance forbids. The target lives in the reference, per connection.

**Using `mcp-session-id` as the conversation.** The session is transport state and the bridge recreates it; it is not a durable authorization record. The reference is stored and revocable.

**A long-lived token.** The exchange issues a one-hour token; the code lives five minutes and the consent transaction ten. Revocation is immediate and does not wait for expiry.

## Consequences

The browser flow never asks the person to copy a secret, and the panel shows exactly the Space and scopes the token will carry before the person approves. The waiting page cannot approve itself, so a local process that reaches the loopback port cannot mint a token in the owner's name; only the signed-in product session can decide. A token from the exchange is narrower than a panel token by construction: a Space-scoped token carries only the proposal tool, and its reference is bound to that Space and revision. A client that loses the reference cannot use the token; a revoked reference closes the conversation even if the client keeps it.

D07 still governs a remote IdP and its client metadata; this cut is the local endpoint D02 allows. The authorization tables live in a separate `faberloom_mcp_oauth` domain, so the token table keeps its existing rows and `spaceId`/`referenceId`/`expiresAt` default to `null` for them.

## Verification

- `packages/faberloom/mcp-server/tests/oauth.spec.ts`: metadata issuer/resource; waiting page names the Space and scopes and contains no token or approving control; the panel decision (`decideAuthorization`) approves; `/authorize/status` returns the code; exchange → token + reference → proposal filed in the Space; missing and foreign references 401; two references A1/A2 cannot cross; no HTTP approval route; code replay and expiry, transaction expiry, wrong verifier, bad redirect, foreign resource, and mixed proposal scope refused; cancel returns `access_denied` and consumes the transaction; revoking the reference or token 401; a legacy token works without a reference; a read token reads at the fixed revision through the bridge host API; a sixth pending request answers 429.
- `gateway/tests/desktop-mcp-route.spec.mjs`: the queued payload carries the public `x-faberloom-work-reference` and omits the field when the client sent none.
- `packages/faberloom/mcp-server/tests/tokens.spec.ts`: the token scope/space contract from 1.3 remains green.
- `packages/faberloom/view` and `packages/client/ui-faberloom`: the token panel shows the Space and the one-time secret; the catalogue-backed scope list remains green.
