# Agent Note: Space actions start from the Space the operator selected

Status: implemented

English | [中文](2026-10-22-space-actions-and-add-workspace-start.zh.md)

## Problem

The Workspace row menu could move, rename, share, or delete a Space, but it could not create a child Space. The Spaces panel already had that operation; the sidebar row, where operators work with the folder tree, did not. Creating a child therefore meant leaving the row menu, opening the Spaces panel, and selecting the parent again.

The add-workspace flow had a separate navigation defect. The native directory chooser opened at whatever location the operating system remembered, not at the Workspace the operator had selected. When a new folder inside the parent was adopted and the new Workspace became current, the next add opened inside that child. Reaching the parent again required walking back up in the OS chooser.

## Decision

**The Workspace row menu creates a child Space through the same host operation as the Spaces panel.** `ui-faberloom` registers a row-menu item and an overlay dialog. The dialog collects one name and the host resolves the Space mirrored by the row's `workspaceId`, then calls `createSpace(title, undefined, parent.id, true)`. The new Space inherits its parent's context and receives its own Workspace through the existing creation path, so the row appears under its parent without a separate refresh protocol. A Workspace without a mirrored Space reports that condition in the dialog instead of guessing a parent.

**The add-workspace flow carries a start directory from the selected Workspace.** `DirectoryFlowOwnerProps` gains an optional `startPath`; `WorkspacePickFlow` fills it from the Workspace owning the current session. The native flow forwards it through `uiWorkspace.pickDirectory(startPath)` and the `directoryPicker/pick` wire verb. The native capability accepts the start path beside its cancellation signal, and every backend honors it: Windows calls `IFileDialog::SetFolder` before `Show`; macOS adds `default location (POSIX file ...)` to `choose folder`; Zenity and KDialog receive the directory as their starting location. The in-app browse flow opens its dialog at the same path. An omitted path keeps the backend's previous default, so other callers do not change behavior.

**Creating in the sidebar keeps the current Space selected.** The add flow closes the picker after adoption; it opens the new Workspace only when no Workspace was current. Opening the child automatically would make the next picker start inside it, which is the navigation loop this change removes. The child row is already visible under its parent.

A missing start directory is not fatal: Windows ignores a failed `SetFolder` and lets the shell choose its remembered location; the browse dialog reports its own unreadable-directory error. The start path is a convenience, not a precondition for adding a Workspace.

## Alternatives considered

**Ask for the child name inside the native folder chooser.** The chooser creates the physical folder, but the Space title and the inherited-context choice belong to the product, and the chooser cannot report a creation in a form that distinguishes cancel from conflict. The small product dialog keeps validation and failure messages in one place.

**Reuse the Spaces panel dialog from the sidebar.** The panel dialog also edits agents, permissions, members, and context; opening it from a row would present unrelated fields for a one-field operation. The row menu keeps the action narrow.

**Remember the last parent in client state.** It would fix the immediate sequence but not the general rule: a picker opened for a selected sub-Space should start there. Deriving the start path from the selected Workspace is deterministic and survives reloads.

**Change only the Windows backend.** The wire contract and browse backend would still open at their old location, and the same UI would behave differently by deployment. The optional start path belongs at the flow contract so every composition agrees.

## Consequences

The `directoryPicker/pick` Remote method now takes `startPath` before its cancellation signal. Internal callers pass `undefined` when they have no target; the generated Client signature remains backward-compatible for callers that omit the optional signal. The native capability's `pick(signal, startPath?)` documents the start path as optional.

Windows now imports `SHCreateItemFromParsingName` and uses IFileDialog slot 12 (`SetFolder`). A failed parse or `SetFolder` falls back to the dialog's default. macOS and Linux build their start arguments only when a path is present.

The Spaces hierarchy remains enforced by the host: a grantee without `create-subspace` on the parent receives the host's failure in the dialog. The sidebar action does not widen authorization.

## Testing

`ui-faberloom/tests/workspace-subspace.client.spec.tsx` covers store transitions, the menu request, the empty-name guard, successful creation, failure without closing, and cancellation. `ui-workspace/tests/workspace-picker.client.spec.tsx` asserts the selected Workspace path reaches the directory-flow owner, and `workspaces-service.client.spec.ts` asserts it reaches the Remote call. `ui-directory-picker-native/tests/client-flow.client.spec.tsx` asserts the native occupant forwards it. `directory-browser.client.spec.tsx` asserts the browse dialog lists the requested directory on open. On the host side, `native-picker.spec.ts` covers all three platform argument forms, `win32-dialog.spec.ts` covers the worker payload, `win32-dialog-logic.spec.ts` covers `SetFolder` ordering, and `win32-dialog-bindings.spec.ts` covers the worker's environment and COM call. `directory-picker.host.spec.ts` covers wire forwarding and failure classification.
