# Agent Note: The sidebar renders the registered Workspace browser again

Status: implemented

English | [中文](2026-11-20-sidebar-restores-the-registered-workspace-browser.zh.md)

## Problem

The sidebar lost every Workspace gesture a person used daily: renaming and deleting a Workspace, archiving and deleting a Session, searching, dragging the order, and the share, move and create-sub-Space rows. The stock contribution still registered; the shell just stopped rendering it.

The regression came from the change that made the column draw its own Workspace tree. `packages/client/ui-faberloom/src/client/sidebar/sidebar.tsx` replaced `renderSlot('sidebar.workspaces', …)` with a local `SidebarTree` component. `ui-workspace`'s browser owns that slot: it renders the Workspace and Session rows and is the only surface that renders `sidebar.workspaces.rowMenu`, the slot where `ui-faberloom` registers Share, Move, and Create sub-Space. With the shell drawing its own tree, the browser's rows and menus were never mounted, while those three contributions stayed registered against a slot nobody rendered.

The tree's comment justified the replacement by an empty list: "the stock browser reads a stream this composition does not feed". The browser and the tree read the same framework hook, `useWorkspaces(state => state.items)`, so a composition that fills the tree also fills the browser.

## Decision

**The registered browser owns the browsing region.** `sidebar.tsx` renders `sidebar.workspaces` with the shell's `wide` and `expandSidebar` owner props again, and the local tree is removed with its contract member `openSession`. The share, move, and create-sub-Space rows register against `sidebar.workspaces.rowMenu` as before and appear in the browser's Workspace row menu, above its own Rename and Delete.

**The shell keeps no second tree.** A parallel surface would need its own row menu, confirmation dialogs, search, and drag order to match the browser, and the product already treats a FaberLoom Space and its Workspace as one entity.

## Alternatives considered

**Keep the tree and add the four gestures inside it.** Rejected for now: it duplicates the browser's row menu, rename, delete, archive, search, and drag ordering, and it would need a second host for the three `sidebar.workspaces.rowMenu` contributions or a renamed slot for each. It is the path if the column later needs Spaces-with-folders as a distinct surface from Workspaces.

**Render the browser only when the tree finds no Workspaces.** Rejected: the two read the same snapshot, so the condition cannot separate them; it would add a branch that never fires.

## Consequences

The column is the stock browser again: Workspace and Session rows, their menus, search, drag order, and the product's Share, Move and Create sub-Space rows. FaberLoom Spaces no longer appear as a separate folder tree in the column; a Space is reached through the Workspace that mirrors it, which is how the product already names the pair.

## Testing

`packages/client/ui-faberloom/tests` passes (277 tests). `tsc -p packages/client/ui-faberloom/tsconfig.json` is clean. The deleted tree spec covered only the removed component; the browser's own suite in `packages/client/ui-workspace/tests` covers the restored rows and menus.
