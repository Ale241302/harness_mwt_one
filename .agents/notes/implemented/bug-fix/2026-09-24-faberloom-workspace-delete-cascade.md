# Agent Note: deleting a Space's workspace deletes the Space

Status: implemented

English | [中文](2026-09-24-faberloom-workspace-delete-cascade.zh.md)

## Problem

A Space's conversation area is a registered dsh Workspace. Deleting that workspace from the sidebar removed only the registry record: the FaberLoom Space stayed, and its `agentId` kept the agent linked to it, so the two looked disconnected.

## Decision

The workspace registry emits `workspace/removed(workspaceId, path)` after a committed delete, and the FaberLoom view drops the Space whose workdir matches the removed path.

- `packages/workspace/workspace` declares the `workspace/removed` event and emits it in `deleteKnown` after the record and registry order commit.
- `FaberLoomViewService` subscribes in its constructor, resolves the Space by comparing each Space's `<DSH_HOME>/spaces/<ref>` against the removed path, and removes it, which also deletes its files and detaches the agent.
- Deleting a Space from the panel already removed its workspace; with the new event that path now runs through the same handler, and the idempotent removal makes the second call harmless.
- The removed Space's agent is kept and marked `detached`, so the Agentes panel shows it as unassigned ("sin asignar") instead of still pointing at the deleted Space; assigning the agent to another Space clears the mark.
- Removing the workspace also archives the sessions recorded under its directory (`archiveSessionsUnder`), so its conversations leave the sidebar instead of falling into the ungrouped bucket.

## Alternatives considered

**Reconcile on every overview read.** Deleting records as a side effect of a read is surprising and unsafe when a workspace is briefly absent.

**Disable workspace deletion for Space areas.** The sidebar's workspace group and the Space are the same thing; hiding the delete would leave no way to remove the area from the sidebar.

**Have the API workspace-controller call FaberLoom.** That layer must not depend on a product package.

## Consequences

- The Agentes panel's Space column clears for the deleted Space, because the overview derives it from the Space records.
- Any other consumer that mirrors a workspace can now react to the same event.

## Testing

`packages/faberloom/view/tests/workspace-board.spec.ts` drives the removal handler, the unassigned marker (kept while another Space uses the agent, set once none does, contained when the write fails), and the agent assignment on save. `packages/workspace/workspace/tests/workspace.spec.ts` covers `archiveSessionsUnder` selecting only the directory's sessions. The workspace registry's existing delete tests exercise the emit.
