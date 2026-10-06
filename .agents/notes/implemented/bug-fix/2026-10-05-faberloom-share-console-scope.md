# Agent Note: FaberLoom Space/Work Flow shares across the console

Status: implemented

English | [中文](2026-10-05-faberloom-share-console-scope.zh.md)

## Problem

Sharing a Space from its sidebar Workspace row failed end to end for two independent reasons. The harness routes the share through `ctx.faberloomShares`, whose `create` publishes to `POST {CONSOLA_API_BASE}/harness/shares/`, but the deployed MWT.ONE console accepted only `kind` `agent`/`skill`, so `kind: 'space'` returned 400. And the gateway injected `CONSOLA_TOKEN` into each `dsh` only at spawn; a process that outlived the 30-minute console access token kept sending the expired JWT, so every console call returned 401 until the process was restarted.

## Decision

The console's `core.harness_share` table and `HarnessShareViewSet` now carry two families. Agents/skills keep one row per resource keyed `(owner_email, kind, name)`, shared with many emails. Spaces/Work Flows add `resource_id`, `permissions`, `status`, `grantee_email`, and `accepted_at`, and key one grant per invitee on `(owner_email, kind, resource_id, grantee_email)`, so sharing one Space with a second person no longer overwrites the first grant. `M1_harness_share_scope.sql` is the idempotent migration for the already-applied `M0` schema; `list` and `create` return `resource_id`, `permissions`, and `status`.

The harness publishes `resource_id: input.resource.id` with each grant, so a console row is addressable by the real resource id rather than by its display name.

The gateway writes each user's current console JWT to `<DSH_HOME>/.consola-token` at spawn and whenever `refreshConsolaAccess` rotates it, injects `CONSOLA_TOKEN_FILE`, and preloads `gateway/consola-token-watch.mjs` into every `dsh` through `NODE_OPTIONS`. The watcher re-reads the file into `process.env.CONSOLA_TOKEN` every minute, and a five-minute gateway timer refreshes every stored token ahead of expiry. The services already read `process.env.CONSOLA_TOKEN` per call, so the environment never goes stale.

## Alternatives considered

**Restart the `dsh` when its token is stale.** Rejected: a transparent respawn still drops the user's live connection on every rotation, and the token rotates inside the life of a normal session.

**Proxy console calls through the gateway.** Rejected: the gateway cannot tell which user an in-container call belongs to without a new per-user credential threaded through every console-calling service, while the watcher needs no service change.

**Reject the share locally when the console rejects it.** Rejected as the primary fix: the console is the cross-host transport, and degrading to a local-only grant would silently hide the feature the user asked for.

## Consequences

Sharing a Space or Work Flow reaches the console and stores an id-addressable grant with its permissions and state; agents/skills are unchanged. A `dsh`'s console token no longer expires while the process lives, which also repairs the mail-attachment and shared-Session/context console calls.

The acceptance step and grantee-side materialization remain unbuilt: the emailed link still points at a console `accept` route that does not exist, and incoming Space/Work Flow grants are not materialized into the grantee's store. `FaberLoomShares.sync` is the seam both will use.
