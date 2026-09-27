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
- Skills share the same way: `shareSkill` publishes the owner's `SKILL.md`, and a received skill is written under the owner's skills directory with a `.shared-by` marker. `saveSkill` and `removeSkill` refuse a marked skill (unless Admin/CEO), and the panel shows it as "Shared with you" with the publisher and no Delete button. A skill whose share is gone is pruned on the next pull, like an agent copy.
- The panel lists what the owner already shares, with a "stop sharing" action, and shows "Shared by <publisher>" on a received agent.
- The Agents inspector also has a **Connected agents** field: a transfer list over the other agents, writing the agent's `subagents`.
- `agentDetail` also reports `apiKeyTail`, the stored key's last four characters, so the owner can recognize which key is set even though the key itself is write-only; the panel shows it under the key field. The provider and model fields are selects fed by the new `modelCatalog` remote, which reads the live `ctx.llm` providers and their models, so a model the provider adds later appears without a code change.

## What the presets actually carry

The 35 shared presets under `agents-shared/` carry only `preset.yml` (name, description, order) and a generated `agent.cordis.yml`. That composition is the shipped `standard` preset with the generic persona prefix; it does not hold the ECC agent body, concrete skill names, or subagent connections. Those live in the external `affaan-m/ECC` catalog, which the repository does not vendor, and there is no generator in the repository. Assigning skills to the presets or connecting them is therefore authored curation, not extraction from `agent.cordis.yml`.

## Alternatives considered

**A shared filesystem volume across processes.** It has no per-company scoping, no account identity, and no way to say who a share is for; the console already owns all three.

**A host MCP parser for follows.** The console response fields are not contractual, so the harness talks to the console HTTP API directly with the user's own token instead of routing through a tool.

## Consequences

- A recipient cannot edit or delete a shared agent: it is seeded and owned by the publisher, so only the publisher or an Admin/CEO can change it, exactly like the deployment baseline.
- Both agents and skills share; a received skill is a read-only copy under the owner's skills directory, marked `.shared-by`.
- The copy carries no API key, so a shared agent runs with the recipient's own configured provider key.

## Testing

The console suite `backend/tests/test_harness_share.py` covers publish-by-email, share-with-the-company versus a stranger, owner-only deletion, upsert on re-publish, and input validation (4 passed in the container). The harness suite `packages/faberloom/view/tests/workspace-board.spec.ts` covers the share payload never carrying the key, materializing an incoming agent as a seeded copy owned by the publisher, and materializing an incoming skill as a `.shared-by` copy that `removeSkill` refuses.
