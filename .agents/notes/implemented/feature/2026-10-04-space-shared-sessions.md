# Agent Note: Space shared Sessions

Status: implemented

English | [中文](2026-10-04-space-shared-sessions.zh.md)

## Problem

Sharing a Space handed a grantee its grants and memory but not its Sessions. Each member runs its own host, so the owner could not see the Sessions a guest started in the Space's area and the guest could not see the owner's; the Session list and content stayed on the host that ran them. The console transport that carries share grants is the only cross-host channel, and no Session catalog used it.

## Decision

`ctx.faberloomSessionShares` (package `@deepseek-ai/dsh-faberloom-session-shares`) owns a durable, per-Space catalog of shared Sessions. `capture(actor, input)` stores one Session's portable snapshot under the Space and POSTs it to the console; `list(actor, spaceId)` returns the Space's rows; `content` returns one row with its snapshot; `remove` retracts it; `sync(readerId)` GETs the console's rows for one member, upserts them, and prunes the imported rows the console no longer carries. Every read resolves the Space through `ctx.faberloomSpaces` and requires `view` through `ctx.faberloomShares`; without either service the actor is trusted.

The view exposes `captureSpaceSessions`, `spaceSessions`, `spaceSessionContent`, and `removeSpaceSession`. Capture reads each local Session's portable snapshot through the mounted `ctx.sessionQuery` (`readSession` plus the folded `readTitle`), falling back to the panel's offered title and an empty body when the query service is absent. The Espacios panel adds a `Sesiones compartidas` field: one `Sincronizar` action syncs the Space in both directions and re-lists, each row opens a read-only transcript modal, and `Quitar` retracts a row.

A Session is published whenever the Space's area holds it, not only when the Space has been granted to somebody. The catalog is now carried by the product mirror as well as by the console (`faberloom_session_shares` is one of `FABERLOOM_MIRROR_DOMAINS`), so the owner's own machines are a reader too: gating the publish on a grant left a conversation written on one machine invisible on the other of the same owner, which is the case the mirror exists for. `Sincronizar` therefore publishes the area's Sessions the catalog does not carry yet before it mirrors the other side's rows, which is also what sends a conversation that already existed; a Session this host imported from another member is never re-published, because the catalog already carries it under its author.

The console contract is `${consoleBase}/harness/sessions`: `POST` one `{ space_id, session_id, owner_email, title, workspace_id, created_at, updated_at, message_count, content }` row, `GET` for the caller's visible rows as `{ incoming: [...] }`, and `DELETE /{id}`. Local captures are keyed `owner:<spaceId>\u0000<ownerId>\u0000<sessionId>`; imported rows are keyed `console:<readerId>\u0000<consoleId>`, so `sync` prunes exactly one reader's imported rows.

## Alternatives considered

**Import a foreign Session into the local Session store.** Rejected: materializing another host's log under a new id touches the durable Session format, lineage, and Workspace attachment, and a read-only catalog already answers "see the list and the content" without corrupting local state.

**Carry Sessions in the existing share payload.** Rejected: the grant payload is a point-in-time resource snapshot, while Sessions change continuously and need their own publish and prune lifecycle.

**A live push channel between members.** Rejected: there is no member-to-member transport; the console is the established cross-host seam, matching the share-grant transport, and polling `sync` reuses it.

## Consequences

Cross-host membership visibility needs the `${consoleBase}/harness/sessions` endpoints; without the console a member sees only its own captures and `sync` is a no-op, so the feature degrades to local. The owner's own machines do not depend on the console: the mirror carries `faberloom_session_shares` between them, and the reading side materializes the rows into its own Session store under the Space's area, so a conversation written on the web appears in the desktop's sidebar. A shared row is a portable snapshot and is read-only: it adds no sidebar Session of its own and is current to the author's last capture, not streaming. Content can be large because it carries the snapshot's events; the service stores it in the durable domain and the viewer renders only text blocks. The `view` authorization is enforced in every operation, so a member without an active grant cannot list, read, or retract a row.

Tests cover the capture/list/content lifecycle, the `view` authorization and its absence-without-services path, remove by author and Space owner with the console delete swallowed on failure, console publish and the 204 answer, the import with missing-field defaults and the prune on the next sync, ordering and the Space filter, and domain disposal. The view specs cover the capture fallbacks (missing query service, rejected title, no workspace), listing, reading, removing, and the not-mounted failure.
