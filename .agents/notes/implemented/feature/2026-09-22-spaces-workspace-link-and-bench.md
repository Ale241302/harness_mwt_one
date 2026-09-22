# Agent Note: spaces own their conversation area and the bench acts on items

Status: implemented

English | [中文](2026-09-22-spaces-workspace-link-and-bench.zh.md)

## Problem

Two seams the plan promises were missing. A FaberLoom space and a harness workspace were disjoint models — sessions grouped under disk directories the space knew nothing about, so "the space's conversations" did not exist. And the Work bench only approved, rejected, or reopened: no prepared-revision submission, no exception states, no effect detail, which is why it read as a demo rather than a bandeja de resultados. Separately, a message opening with `@Agent` reached the model as plain text with no rule telling the assistant to act as that specialist.

## Decision

The link is one directory per space, registered as its workspace; the bench gains the missing verbs as view remotes; the mention rule is one additive prompt section.

- `faberloomView.spaceWorkspace(id)` projects the space's area read-only (the `fw_` workdir resolved by the spaces service, looked up in the workspace registry, session count included, never creating anything), and `openSpaceWorkspace(id)` materializes it: `mkdir` under `<DSH_HOME>/spaces/<fw_ref>`, `workspaceRegistry.create(dir, space.title)`, idempotent per canonical path. The Spaces detail shows the area and "New conversation in this space" starts a session in it, so the sidebar workspace and the space are the same group. The Members and Sources fields leave the detail until they are operable; the data model keeps both.
- New remotes `submitBoardRevision`, `boardException` (request_data / fail / complete), and a `note` on `reviewBoardItem`, all read-only-guarded like the other writes. The bench renders full evidence, effects with detail and date, a revision submission form that restarts review, a review note, and a Complete action that appears only when approved.
- `tool-faberloom` registers a `faberloom:mentions` system-prompt section: a leading `@Name` addresses that catalog agent (act as the specialist via the `faberloom_agents_*` tools), a leading `/name` invokes the skill, and an unknown name is answered with the available list.

## Alternatives considered

- **Storing the workspace id on the space record.** Rejected: the path is deterministic from `ownerId:spaceId` (the same digest `resolveWorkdir` already returns), and `workspaceRegistry.create` is idempotent per canonical path — a stored link could only drift.
- **Creating the workspace on space creation.** Rejected: an untouched space would own an empty sidebar group; materializing on first conversation keeps reads side-effect-free (`spaceWorkspace` creates nothing).
- **A host `delegate` command that runs the agent on Enter.** Deferred, not done: `faberloomAgents.delegate` is admission and budget bookkeeping (no model turn), and a real delegated conversation belongs to the subagent runtime with the agent's policy — a wrong shortcut would fake the gesture. The prompt rule makes today's `faberloom_agents_delegate` path reliable instead.
- **Keeping Members/Sources visible.** Rejected: members has no multi-user semantics yet and sources cannot be added from the UI, so both read as broken; the fields remain in the model and in the MCP tools.

## Consequences

- Selecting a space creates nothing; the first "New conversation in this space" creates its workdir and sidebar group, and from then on the space's sessions live under its own workspace.
- A revision submitted from the bench goes through the same `submitRevision` the routines use, so UI and engine keep one review path; approving still binds the exact version reviewed.
- The mention rule rides every prompt while tool-faberloom is mounted (one section, small token cost, registered as an effect and disposable with the fiber).
- `docs/tool-catalog.md` gains no tools this slice (remotes, not tools); the Typert client was regenerated with the new remotes (`pnpm run build:lib:host`).
