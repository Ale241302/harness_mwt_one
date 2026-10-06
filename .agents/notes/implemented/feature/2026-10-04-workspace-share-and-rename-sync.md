# Agent Note: Workspace row Share and Workspace↔Space rename sync

Status: implemented

English | [中文](2026-10-04-workspace-share-and-rename-sync.zh.md)

## Problem

In the MWT.ONE product the sidebar Workspace and the FaberLoom Space are one area: the view anchors each registered Workspace to a Space by `workspaceId`. Two gaps follow. The sidebar row's menu offered only Rename and Delete, so sharing a Space was reachable only from the Espacios panel, not from the Workspace it mirrors. And the two names could drift: renaming the Workspace through the sidebar called the harness `workspaceRegistry` and never touched `ctx.faberloomSpaces`, so the Espacios module kept the old title, while renaming a Space never touched the mirrored Workspace.

## Decision

`ui-workspace` declares a `list` child slot `sidebar.workspaces.rowMenu` on the `sidebar.workspaces` registration and renders it as the leading rows of a real Workspace row's dropdown. `ui-primitives` `Menu` gains an optional `leading` node rendered above its own items inside the same list card. The `WorkspaceBrowser` passes `renderSlot('sidebar.workspaces.rowMenu', { workspaceId, title, close })` down to `ProjectRowItem`, which forwards it as the Menu's `leading`.

`ui-faberloom` contributes two registrations that share one `createWorkspaceShareStore()` handle: `WorkspaceShareMenuItem` into `sidebar.workspaces.rowMenu` (ordering before the owner's Rename/Delete) and `WorkspaceShareDialog` into `shell.overlay`. The row closes the dropdown and requests the dialog; the overlay host owns the form and calls the injected `share`, wired to the new `faberloomView.shareSpaceByWorkspace(workspaceId, emails, permissions)`. That remote resolves the Space whose `workspaceId` matches and delegates to `shareSpace`, so the permission and grant path is unchanged.

The workspace registry declares and emits `workspace/renamed(workspaceId, title)` from `WorkspaceEntity.setTitle` through its host. `FaberLoomViewService` listens and adopts the title into the Space that mirrors the id, and `renameSpace` writes the same title back to the mirrored Workspace (`workspaceRegistry.get(space.workspaceId).setTitle(title)`), guarded so an already-matching title writes nothing.

## Alternatives considered

**An injected `shareWorkspace` callback on `ui-workspace`.** Rejected: a feature plugin must not runtime-import or call another feature plugin, and the injected face is owned by the workspace plugin. The sanctioned cross-package route for UI is a slot.

**A standalone Share icon beside the ellipsis.** Rejected: the menu is the requested location, and a separate control would not sit before Rename.

**Resolving the Space from the client.** Rejected: the `workspaceId`→Space mapping is durable host state behind `ctx.faberloomSpaces`; a host remote keeps the authorization check in one place.

**A generic workspace-events listener instead of a dedicated event.** Rejected: the registry publishes changes by named events (`workspace/removed` already mirrors one), and a dedicated `workspace/renamed` payload carries the new title without a second read.

## Consequences

A Workspace row's menu now leads with any contributed rows before the owner's Rename and Delete. The share dialog is hosted at the shell overlay so dismissing the dropdown does not unmount it, and the dropdown closes on request. Sharing authorizes exactly as `shareSpace` does; a Workspace with no mirrored Space fails loud. Renaming flows both ways through the same title, with the Space-side write first so the resulting `workspace/renamed` event finds the names already equal and stops without a loop. The new `workspace/renamed` event is additive; no caller is required to listen, and no durable format changes.

Tests cover the contributed menu row leading Rename and closing the dropdown, the dialog's validation, permission toggling, success, failure, and cancel paths, `shareSpaceByWorkspace` resolving and refusing to resolve a mirror, the `workspace/renamed` adoption and its failure logging, and the reverse Workspace write from `renameSpace` including the no-mirror and already-matching guards. The registry spec asserts `setTitle` emits `workspace/renamed`.
