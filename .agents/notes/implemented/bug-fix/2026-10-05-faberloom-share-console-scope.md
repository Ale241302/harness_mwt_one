# Agent Note: FaberLoom Space/Work Flow shares across the console

Status: implemented

English | [中文](2026-10-05-faberloom-share-console-scope.zh.md)

## Problem

Sharing a Space from its sidebar Workspace row failed end to end for two independent reasons. The harness routes the share through `ctx.faberloomShares`, whose `create` publishes to `POST {CONSOLA_API_BASE}/harness/shares/`, but the deployed MWT.ONE console accepted only `kind` `agent`/`skill`, so `kind: 'space'` returned 400. And the gateway injected `CONSOLA_TOKEN` into each `dsh` only at spawn; a process that outlived the 30-minute console access token kept sending the expired JWT, so every console call returned 401 until the process was restarted.

## Decision

The console's `core.harness_share` table and `HarnessShareViewSet` now carry two families. Agents/skills keep one row per resource keyed `(owner_email, kind, name)`, shared with many emails. Spaces/Work Flows add `resource_id`, `permissions`, `status`, `grantee_email`, and `accepted_at`, and key one grant per invitee on `(owner_email, kind, resource_id, grantee_email)`, so sharing one Space with a second person no longer overwrites the first grant. `M1_harness_share_scope.sql` is the idempotent migration for the already-applied `M0` schema; `list` and `create` return `resource_id`, `permissions`, and `status`.

The harness publishes `resource_id: input.resource.id` with each grant, so a console row is addressable by the real resource id rather than by its display name.

The console serves the invite link at `GET {consoleBase}/harness/shares/accept?grant=<id>`: the action is unauthenticated (the row id travels only in the grantee's email, so it is the link's secret), marks the row `active` with `accepted_at`, and returns a small HTML confirmation through `StaticHTMLRenderer`. Each grant emails that console row id rather than the owner-local grant id, so the link a grantee opens resolves in the console.

The grantee side imports and materializes what it accepts. `shareSpace` publishes a portable snapshot with the grant — the Space title and context, its Memory entries, its Context entries, its Space-scoped Work Flows, and the Routines those flows back — while `shareWorkflow` publishes `{ scope, definition }`. The view's `overview` calls `FaberLoomShares.sync` once per process and, for every active incoming grant, reads the snapshot through `FaberLoomShares.snapshotFor`. A Space is materialized with `faberloomSpaces.importShared` under the remote resource id and owned by the publisher, so the same grant authorizes it; the member's sidebar Workspace is mirrored for it, and its Memory, Context entries, Work Flows, and Routines are recreated as the member's own copies, each skipped when one of the same text, title, name, or name already exists, so a repeated sync or a re-share adds only what is new. A Work Flow is materialized with `faberloomWorkflows.importShared` under the remote id. A grant with no published snapshot is skipped, so an older invite never materializes an empty resource. The console normalizes a `jsonb` `payload` returned as text into an object, and `sync` parses a text payload defensively.

FaberLoom's own Memory fills from explicit records, not from the chat log. `faberloom-tool` adds a `faberloom:memory` system-prompt section directing the assistant to store durable Space facts with `faberloom_spaces_remember`, resolved from the area, and the view captures each completed turn in a Space's area into that Space's memory — its last question and result, deduped by text — through a `session/event` `turn/end` listener that resolves the Session's `cwd` to its Workspace and then its Space.

A Space's conversation Sessions travel beside the grant. The console stores them in `core.harness_shared_session` through `HarnessSessionViewSet` at `{CONSOLA_API_BASE}/harness/sessions/`: the author POSTs one row per `(owner_email, space_id, session_id)` with the portable log, an active grantee or the Space owner lists the incoming rows, and either may DELETE. `shareSpace` publishes the area's Sessions through `ctx.faberloomSessionShares.capture` — best effort and off the share's critical path, so a slow or unwired catalog never fails the grant — and the member's `spaceSessions` syncs from the console and lists them under the Space. `M2_harness_shared_session.sql` is the idempotent migration that adds the table. The member's `overview` and `spaceSessions` also recreate each imported Session on its own host through `sessionPersistence.create`+`append`, adopting the mirrored area as the header `cwd` and attaching it to the Workspace, so the sidebar lists the transcript beside the Space; the copy is idempotent by stored Session id. Publishing is continuous: each completed turn captures its Session into the catalog and the actor's `overview` publishes the actor's own new Sessions for each shared Space and mirrors every shared Space's Sessions, so the owner sees the member's transcripts and the member the owner's. The auto-captured Memory text drops the harness's `<system-reminder>` block.

The gateway writes each user's current console JWT to `<DSH_HOME>/.consola-token` at spawn and whenever `refreshConsolaAccess` rotates it, injects `CONSOLA_TOKEN_FILE`, and preloads `gateway/consola-token-watch.mjs` into every `dsh` through `NODE_OPTIONS`. The watcher re-reads the file into `process.env.CONSOLA_TOKEN` every minute, and a five-minute gateway timer refreshes every stored token ahead of expiry. The services already read `process.env.CONSOLA_TOKEN` per call, so the environment never goes stale.

## Alternatives considered

**Restart the `dsh` when its token is stale.** Rejected: a transparent respawn still drops the user's live connection on every rotation, and the token rotates inside the life of a normal session.

**Proxy console calls through the gateway.** Rejected: the gateway cannot tell which user an in-container call belongs to without a new per-user credential threaded through every console-calling service, while the watcher needs no service change.

**Reject the share locally when the console rejects it.** Rejected as the primary fix: the console is the cross-host transport, and degrading to a local-only grant would silently hide the feature the user asked for.

## Consequences

Sharing a Space or Work Flow reaches the console and stores an id-addressable grant with its permissions and state; agents/skills are unchanged. A `dsh`'s console token no longer expires while the process lives, which also repairs the mail-attachment and shared-Session/context console calls.

Accepting the invite marks the console grant active, and the grantee's next overview imports the grant and materializes the shared Space or Work Flow under the remote id. A shared Space also appears as a sidebar Workspace, and its Memory, Context, Work Flows, and Routines are copied to the member. A copied Work Flow is materialized `draft` and a copied Routine may reference the publisher's connection ids, so it can appear in the Routines panel without a working mailbox on the member's host; a shared Space is context-only and carries no attached files. The Space's area Sessions are published beside the grant and read by the member under the Space's shared-Session list; a direct capture from the Spaces panel updates the same rows.
