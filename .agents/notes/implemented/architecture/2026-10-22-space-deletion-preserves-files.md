# Agent Note: Deleting a Space never deletes its folder

Status: implemented

English | [中文](2026-10-22-space-deletion-preserves-files.zh.md)

## Problem

`deleteSpace` removed the Space's Workspace registration and its Space record, then deleted the folder when it lived under the harness home. Spaces created by the product, including sub-Spaces created from the new row-menu action, live under that home. Deleting one therefore deleted the folder and every file the operator had created in it. The operator's files are not product metadata and must survive a product deletion.

The Workspace registration delete path already retained its directory, so this change is scoped to the Space hierarchy and its mirrored Workspace cleanup.

## Decision

**Deleting a Space removes product state only.** `deleteSpace` still archives the Sessions under the Space, removes the Space's Workspace registration, removes the Space record, and detaches an orphaned agent. It no longer calls the filesystem removal. The folder remains at its absolute path with its files and child folders intact.

**Deleting a Workspace remains a registration-only operation.** Its confirmation already says the folder and session records are preserved; sessions appear under “Sin grupo”. The `workspace/removed` listener removes the mirrored Space record without touching the path.

**Individual file deletion stays separate.** The Files panel's explicit `deleteSpaceEntries` operation continues to delete the selected files, because that is the operator's direct action on those paths. Deleting the container (Workspace or Space) is not an instruction to delete its contents.

After deletion, the operator can re-add the kept folder with “Añadir Workspace” or “Desde carpeta…”, and the retained files are available again. A sub-Space folder remains physically inside its former parent folder; deleting the parent is rejected while child Spaces still exist, so the hierarchy cannot be deleted around a surviving child.

## Alternatives considered

**Delete only folders the product created.** The folder name is product-created, but its contents are not; the distinction is invisible to the operator and still destroys their documents. Creation origin is not consent to delete later contents.

**Move the folder to a trash location instead of deleting it.** A product-level trash adds a second lifecycle, ownership rules, and a restore UI for an operation that can simply leave the folder in place. The operator already knows the path and can move or remove it outside the product.

**Ask on every delete whether to keep the folder.** The safe behavior is unconditional. A confirmation option would still make accidental data loss one click away, and the product has no reliable way to distinguish a folder the operator wants removed from one they only want removed from the Workspace list.

## Consequences

A deleted Space disappears from the sidebar, the Spaces panel, and its Workspace area, but its folder, files, and child folders remain on disk. The product may still create a fresh Space from that folder later; it does not overwrite the existing contents.

The product attachment records associated with the deleted Space are removed with the Space record; those records are metadata about uploaded files, not the physical files themselves. Files written into the folder by the operator or by an agent remain.

## Testing

`packages/faberloom/view/tests/workspace-board.spec.ts` now asserts that a generated Space, a Space without a mounted registry, and an adopted Space all keep their folders after `deleteSpace`. The same suite continues to assert the Workspace registration is removed and the Space record is deleted.
