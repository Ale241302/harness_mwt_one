# Agent Note: sharing agents through the MWT.ONE console

Status: implemented

English | [中文](2026-09-27-sharing-agents-through-the-console.zh.md)

## Problem

Every user runs their own harness process with their own `DSH_HOME`, so an agent a user builds lives only in that user's store. A user had no way to give a colleague the agent they built, and the Agents panel had no sharing at all. The account identity, the user's company, and the per-client MCP all live in the MWT.ONE console, which the harness already reaches as the signed-in user (the gateway injects `CONSOLA_API_BASE` and `CONSOLA_TOKEN` into each user's process, the pattern `faberloom_mail_attachment_link` already uses).

## Decision

The console is the shared store; the harness reads it and materializes read-only copies.

- The console gains the table `core.harness_share` (applied once by `backend/sql/M0_harness_share.sql`) and a self-scoped viewset at `GET/POST/DELETE /api/harness/shares/` (`apps/core/harness_share_views.py`, `rbac_bypass = True`). A user publishes one agent by name with `shared_emails` or `share_all`; the list returns what they published (`outgoing`) and what others shared with them (`incoming`, matching a named email or the user's company).
- `FaberLoomViewService` gains `shares`, `shareAgent`, `unshareShare`, and `syncShared`. `shareAgent` sends the agent's responsibility, skills, tools, provider, and model, and **never its provider API key** — the key belongs to the owner's account and is not portable.
- On the first `overview()`, and on `syncShared`, the view pulls the incoming shares and materializes each agent as a local copy with `seeded: true`, `ownerId` set to the publisher's email, and `originRef` `share:<publisher>`. The existing ownership rule then makes the copy read-only for everyone but that publisher or an Admin/CEO. A copy whose share is gone is pruned on the next pull.
- The Agents panel shows a Share field (named emails plus "my whole company") for an agent the actor manages.

## Alternatives considered

**A shared filesystem volume across processes.** It has no per-company scoping, no account identity, and no way to say who a share is for; the console already owns all three.

**A host MCP parser for follows.** The console response fields are not contractual, so the harness talks to the console HTTP API directly with the user's own token instead of routing through a tool.

## Consequences

- A recipient cannot edit or delete a shared agent: it is seeded and owned by the publisher, so only the publisher or an Admin/CEO can change it, exactly like the deployment baseline.
- Sharing is agent-only in this increment; sharing a skill needs the same table with `kind='skill'` (the API already accepts it) and a skill-materialization path, which is the next step.
- The copy carries no API key, so a shared agent runs with the recipient's own configured provider key.

## Testing

The console suite `backend/tests/test_harness_share.py` covers publish-by-email, share-with-the-company versus a stranger, owner-only deletion, upsert on re-publish, and input validation (4 passed in the container). The harness suite `packages/faberloom/view/tests/workspace-board.spec.ts` covers the share payload never carrying the key and materializing an incoming share as a seeded copy owned by the publisher.
