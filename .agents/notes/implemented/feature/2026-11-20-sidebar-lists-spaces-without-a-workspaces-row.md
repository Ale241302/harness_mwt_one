# Agent Note: The sidebar lists Spaces, not a second Workspaces row

Status: implemented

English | [中文](2026-11-20-sidebar-lists-spaces-without-a-workspaces-row.zh.md)

## Problem

The product treats a FaberLoom Space and the Workspace that mirrors it as one entity, but the column carried two rows for it: `Espacios` and `Workspaces`. They opened two screens over the same data — the Spaces table and a device tree of the same Spaces, their folders and their Sessions. A person had to know which row held which gesture, and the two screens drifted: the Workspaces screen owned the folder path and "new conversation here", the Spaces panel owned create, adopt from folder, and delete.

## Decision

**One concept, one row.** `packages/client/ui-faberloom/src/client/panels.tsx` drops the `faberloom-workspaces` entry from `FABERLOOM_SECTIONS`, which removes both the sidebar row and its `main` page, and deletes the now-unused `workspacesScreen`. The `Espacios` panel remains the place to create a Space, adopt a folder, rename it and delete it.

**The browsing region still lists Workspaces.** The sidebar's Workspace browser keeps drawing the machine's folders, their Spaces and their Sessions, so a conversation is still reached from the column without a second panel.

## Alternatives considered

**Keep the row and hide it from the sidebar, leaving the page reachable elsewhere.** Rejected: no other surface links to `faberloom-workspaces`, so the page would be unreachable code pretending to be a feature.

**Merge the Workspaces tree into the Espacios panel.** Deferred: the panel is a table with a detail pane, the deleted screen was a folder tree, and the column already draws that tree. A merge is a redesign, not the removal of a duplicate row.

## Consequences

The Work group lists Conversar, Mesa de trabajo, Espacios and Archivos. The folder path, the per-Workspace Session list and "new conversation here" are no longer a separate page; starting a conversation in a Workspace stays available from the column's Workspace rows.

## Testing

`packages/client/ui-faberloom/tests` passes (271 tests). The registration spec now expects the section list without `faberloom-workspaces`, and the deleted `workspaces.client.spec.tsx` covered only the removed screen.
