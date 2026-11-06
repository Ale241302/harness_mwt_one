# Agent Note: Tokens list fingerprints, carry an optional Space, and share one authentication path

Status: implemented

English | [中文](2026-11-06-token-scopes-and-space.zh.md)

## Problem

The MCP token panel listed the bearer secret of every client and revoked by that secret. A diagnostic dump, a model reading the panel, or a screenshot carried a working credential. The client also held a hardcoded copy of the tool catalogue, which had already drifted from the server and did not include the proposal tool. The socket transport and the bridge each authenticated a token with their own copy of the checks; the bridge did not validate scopes or a Space, so a stale registration could outlive the token's narrowing. A token had no Space: the proposal tool always wrote an owner-wide item, and a membership the owner lost was never rechecked.

## Decision

**The listing carries a fingerprint, not the secret.** `tokenId(token)` is a 24-character SHA-256 prefix. `listTokens()` returns `FaberLoomMcpTokenRow` with `id`, label, timestamps, scopes, company, and space; `mintToken()` returns `{ token, row }`, and that answer is the only place the bearer leaves the store. `revokeToken(reference)` accepts the fingerprint, and still accepts the exact secret for a legacy caller that holds it. The bridge's gateway registration reads the secrets through a private `liveTokens()`, never through the public listing.

**One authentication path.** `tokenCaller(token, record)` validates revocation, owner, the scope list, and the Space, and `authenticate()` (socket) and `request()` (bridge) both call it. A stored scope list that mixes `faberloom_proposal_submit` with anything else, or names a tool this server does not advertise, is refused instead of silently narrowed. A scope retired by an earlier panel (`faberloom_board_review`) is filtered out and the token keeps working with its surviving scopes, so an upgrade does not brick a legacy connection. A token that names a Space calls `faberloomSpaces.get(owner, space)` on every use, so losing the Space or its membership stops the token with the same 401 as revocation.

**The Space reaches the executor.** `FaberLoomToolHost` receives the token's Space and passes it to the catalogue entry; `faberloom_proposal_submit` forwards it to `board.submitProposal`, which revalidates it through Spaces and includes it in the namespace, `sourceRef`, business key, and item. A Space-scoped token must carry `faberloom_proposal_submit` as its only scope: the Space names where the proposal is filed, not a read confinement, and the server refuses a Space combined with a read or full surface. A token minted without a Space keeps the legacy owner-wide semantics (`null`), and a record written before the field existed reads the same way.

**The panel reads the catalogue.** The view exposes `mcpTools()` from `FaberLoomMcpServer.toolNames()`; the client no longer copies the list. The proposal tool is exclusive in the picker: selecting it clears the others, and the server enforces the same rule for a hand-built request.

## Alternatives considered

**Keeping the token in the row and hiding it in the UI.** A diagnostic or a model still receives it from the remote method. The secret has to stop leaving the store after mint.

**A random row id stored beside the token.** It is one more field to keep unique and migrate; the token hash is already stable, collision-resistant, and derivable from the row key.

**Validating scopes only in `tools/list`.** A caller can invoke a tool by name without listing it; `call` and both transports must refuse, which is why the check sits in `tokenCaller` and the host.

**Revalidating the Space only at mint.** A membership can be removed after the token is issued; the requirement names loss of membership, so the use path rechecks.

**Letting the client send the Space with the proposal.** The Space would become an authority field from untrusted payload. It is stored with the token and revalidated server-side instead.

## Consequences

A leaked panel listing is no longer a leaked credential. Revocation works by fingerprint, and a legacy client that still has the secret can revoke with it once. A scoped proposal token can only submit proposals; a read token cannot propose; a full-surface legacy token can still call every tool, but approval remains human-only from 1.1, so it cannot approve. A Space-scoped token stops working when the owner loses the Space, and the proposal it creates belongs to that Space from the start. The bridge registration and the product backup still carry the bearer secrets inside their own trusted paths; the listing and the panel never do.

The token record gains `spaceId` with a `null` default, so existing records keep their owner-wide meaning and no migration rewrites them. The bridge still needs the raw secrets to register the public endpoint; that access stays inside the process.

## Verification

- `packages/faberloom/mcp-server/tests/tokens.spec.ts`: listing hides the secret and revokes by fingerprint; a legacy record without `spaceId` lists and authenticates owner-wide; a legacy record with the retired `faberloom_board_review` keeps working with that entry ignored; proposal + another scope, an unknown scope, a Space with a non-proposal scope, and a foreign Space are refused at mint; a proposal token lists and calls only the proposal tool while a read token cannot propose; a stored mixed or unknown scope list is 401 on the bridge; a Space-scoped token lands the proposal in that Space and a token whose membership was lost is 401; a full-surface token is refused `HUMAN_ACTION_REQUIRED` when it calls approve; a revoked token is 401 over HTTP and over the bridge.
- `packages/client/ui-faberloom/tests/registration.client.spec.tsx`: the panel renders with the catalogue-backed scope list and the one-time token field.
- `packages/faberloom/view` and `packages/client/ui-faberloom` suites: 394 tests pass with the new row and mint result.
