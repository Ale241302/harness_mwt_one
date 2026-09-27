# Agent Note: seeded agents are admin-only; user agents belong to their owner

Status: implemented

English | [中文](2026-09-27-agent-ownership-and-permissions.zh.md)

## Problem

The agent catalog had no owner, and the view's agent writes did not even check `readOnly`, so any user could edit or delete every catalog agent through the panel. Every user runs their own dsh process with its own `DSH_HOME` and its own copy of the seeded catalog, so "shared with everyone" is the seeded set, and there was no field that told a seeded agent apart from one a user made. The provider API-key field always offered the reveal toggle, so the stored key could be shown to anyone who opened the panel.

## Decision

Ownership is recorded on the agent and enforced where the write is accepted.

- `AgentRecord` gains `ownerId` (`''` for a seeded/global agent) and `seeded`, both defaulted so existing records keep loading.
- `FaberLoomViewService` treats `admin`, `superadmin`, and `ceo` as privileged; a privileged actor may manage any agent, while every other role may manage only a non-seeded agent it owns. Every agent write also requires `!readOnly`, which the agent writes previously omitted.
- `createAgent` and `createAgentFromWork` stamp the acting identity as `ownerId`.
- `faberloom-defaults` seeds agents with `seeded: true` and, when the deployment configures them, `provider`, `model`, and an API key read from the environment variable named by `agentApiKeyEnv` (the gateway defaults it to `DEEPSEEK_API_KEY`). The key never enters the repository; it is stored per agent and a read only ever reports `hasApiKey`.
- The overview agent row carries `editable`; the Agents panel hides Delete/Deactivate and disables Save and the API-key field for an agent the actor cannot manage. `SecretInput` gains `revealable`, so the reveal toggle is absent for a key the actor may not see.
- Skills keep their file model: the role and shared catalogs are deployment files the API never writes, and only the owner's `DSH_HOME/skills` directory is creatable or removable. A normal user can therefore create and manage their own skill while the shipped catalog stays an Admin/deployment concern.

## Alternatives considered

**A sharing registry so one user's agent reaches another by email or by MCP.** Cross-user sharing has no medium today: each user's agents and skills live in that user's own process and `DSH_HOME`, so a share to another email or to the other users of a company has nowhere to be written. The ownership fields here are the local half; the share list and its transport wait for the shared store (console/MCP).

**Gate only the panel.** The panel is presentation; the Remote returned and accepted the write regardless, so the check has to live in the view.

## Consequences

- A normal user can no longer edit or delete a seeded agent; only Admin/CEO can. An agent records whose owner is another identity is equally refused.
- The stored provider key is never revealable for an agent the actor cannot manage.
- Seeding stamps the configured provider/model/key only on agents it creates; agents seeded by an earlier deployment keep their own values until they are re-created or an admin saves them.

## Testing

`packages/faberloom/view/tests/workspace-board.spec.ts` covers a privileged save, a non-admin refusal on a seeded agent, an owner's save, and the `editable` overview flag. `packages/faberloom/agents/tests` keeps the catalog green over the new fields.
