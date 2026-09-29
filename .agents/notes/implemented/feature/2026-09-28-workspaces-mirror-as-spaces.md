# Agent Note: every harness Workspace mirrors as a Space

Status: implemented

English | [中文](2026-09-28-workspaces-mirror-as-spaces.zh.md)

## Problem

The Space/Workspace link was one-directional. Creating a Space from the Spaces panel materialized its conversation directory and registered it as a harness Workspace, but a Workspace created directly from the New Session picker (a plain folder, e.g. `SICOP`) was invisible to the Spaces panel: the owner saw an empty Spaces list next to a populated Workspaces sidebar. The Spaces panel and the sidebar named two different universes for the same area.

## Decision

A Workspace is the space's area, in both directions.

- The space record gains `workspaceId` — the harness Workspace a space mirrors — as a nullable, defaulted field under the same domain version, exactly like `agentId`. The id is stored, never a path.
- `faberloomView.overview()` adopts every registered Workspace that no space mirrors: it creates a space titled after the Workspace and anchored by id. A legacy space whose deterministic `<DSH_HOME>/spaces/<ref>` directory matches the Workspace is anchored instead of duplicated, so the pass is idempotent and never grows the catalog per read. A read-only identity is not written to.
- `ensureSpaceWorkspace` reuses the mirrored Workspace when the space has one; otherwise it creates the deterministic directory and records the new Workspace's id on the space. `spaceWorkspace`, `openSpaceWorkspace`, `deleteSpace`, and the `workspace/removed` listener all resolve through the anchor, falling back to the deterministic directory for spaces that predate it.
- `deleteSpace` removes the directory only when it lives under the harness home (`isUnderDshHome`); an adopted Workspace outside it is unregistered but not deleted. Deleting a Workspace from the sidebar drops the mirrored space through `workspace/removed`, now matched by id.

## Alternatives considered

**Keep the link one-directional.** The Spaces panel then stays empty for a workspace the owner created, which is the reported defect; the owner chose the automatic mirror.

**An explicit "create a Space from this Workspace" button.** Same anchor, but it leaves the default state (empty Spaces panel) intact and asks the owner to reconcile manually. Rejected for the automatic behavior.

**Store the filesystem path on the space instead of the Workspace id.** The workspace registry id is the durable key; a stored path can go stale after a move and would expose a path from the spaces service, whose work-dir contract is opaque by design. The view resolves the id through the registry.

## Consequences

- Creating a folder from the New Session picker makes it appear in Spaces on the next overview read; both views name the same directory.
- Deleting a Space deletes its conversation directory and Workspace registration (under the harness home); deleting the Workspace drops the Space.
- Renaming a Workspace does not rename its Space, and vice versa, until a later change syncs titles.
- This reverses the "storing the workspace id is rejected" alternative of [the spaces/workspace link note](2026-09-22-spaces-workspace-link-and-bench.md); the deterministic-directory rule stays for spaces that never adopt a Workspace.

## Testing

`packages/faberloom/spaces/tests/spaces.spec.ts` covers the stored mirror and its update/clear. `packages/faberloom/view/tests/workspace-board.spec.ts` covers adoption of an orphan Workspace, anchoring a legacy space instead of duplicating it, and deleting an adopted space through its mirrored Workspace. Host and Client typechecks pass.
