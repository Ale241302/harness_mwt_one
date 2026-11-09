# Agent Note: A fixed reference distinguishes published from loaded and rolls back only to an activated revision

Status: implemented

English | [中文](2026-11-09-fixed-reference-load-and-rollback.zh.md)

## Problem

Wave 3A.4 fixed reads to a work reference and revoked them correctly, but the product could not say whether a revision was merely published or had actually been read. A restarted runtime had no test that the same reference still knew its load state. The A1/A2 test used a local Git repository rather than published objects. A rollback had no path that rechecked the Space and refused a revoked source.

## Decision

**Publication and load are two durable facts on the reference.** A work reference row records `loadedAt`, `loadRevision`, and `lastReadPath` when a read succeeds. `referenceState(id)` resolves the publication service's stage for the fixed revision (`none`, `pending`, `committed`, `uploaded`, `activated`, `failed`, or `unavailable`), marks `published` only for `uploaded`/`activated`, and marks `loaded` only when `loadRevision` equals the fixed revision. The read tool records the observation after the bytes and manifest verify; a bookkeeping failure never fails the read.

**The connection view shows both facts.** Each token row carries its reference id, fixed revision, publication stage, published flag, load instant, read revision, and last path. The Connections panel renders revision, publication, and load columns; a published but unread revision says `Unconfirmed`. The facts live in `faberloom_mcp_oauth`, so a restarted runtime reads the same row.

**A1/A2 is tested against published revisions, not a work tree.** The MCP test mounts the real publication service over a temporary Git repository and a memory object store, publishes two revisions, fixes one work reference to each, and reads both through the same endpoint. A1 returns only its own published bytes, A2 only its own; a reference is never re-resolved to the other revision.

**Rollback is a new reference to an activated publication.** `rollbackReference(id, targetRevision)` requires a live source reference, a target different from the source revision, an `activated` publication of the same Space, and a Space the owner can still read. It creates a new reference with no load state and refuses a revoked source instead of reviving it. It returns the reference; the client still completes an authorization exchange to obtain a token for it.

## Alternatives considered

**Treat an activated publication as loaded.** Publication is a server-side fact; load is an observation by the reader. Reporting activation as load would claim a conversation saw content it never requested.

**Keep load state in the process.** A restart would erase the distinction. The reference row is the durable place for the observation.

**Mutate the reference's revision on rollback.** A reference is the fixed handle a conversation presents; changing its revision would break the A1/A2 guarantee. Rollback creates a new reference.

**Roll back by reactivating an older object.** Activation is conditional and already happened; the immutable object is still there. The missing control was an authorized reference to it, not a second activation.

**Create a token inside rollback.** Token exchange is the authorization boundary; a service method must not mint a bearer secret. Rollback returns the reference and leaves the exchange to the OAuth flow.

## Consequences

The Connections panel now shows whether a published revision was actually read, and that state survives a restart. A rollback cannot silently resurrect a revoked reference or a failed publication; an operator must complete a new authorization for the returned reference. The cost is three fields on the reference row, an extra publication lookup when listing tokens, and one more authorization step after rollback.

## Verification

- `packages/faberloom/mcp-server/tests/oauth.spec.ts`: published-versus-loaded state; restart over the same durable medium; A1/A2 against two real published revisions; rollback to an activated revision, refusal after source revocation, and refusal of a non-activated target.
- `packages/client/ui-faberloom/tests/registration.client.spec.tsx`: the connection panel shows the fixed revision, publication stage, and unconfirmed load.
- `packages/faberloom/publication/tests/publication.spec.ts`: the published object and signed manifest that the A1/A2 test reads.
