# Agent Note: space memory outlives its origin

Status: implemented

English | [中文](2026-09-27-memory-outlives-its-origin.zh.md)

## Problem

The Memory panel listed space-memory rows with the raw space id, rendered each entry's full email or document body inside the row (rows hundreds of lines tall), and offered no way to remove an entry. Deleting a Space left those ids dangling, so the table showed unreadable uuids for entries whose origin no longer existed.

## Decision

Space memory is knowledge, not a child row: it survives the deletion of the Space, Workspace, or conversation section it came from, and it is removed only by an explicit action.

- `FaberLoomSpaces.remove` deletes the space record and its files, never its memory rows; `forgetMemory(actor, id)` is the only deletion path and refuses another owner's entry.
- `faberloomView.deleteSpaceMemory(id)` forgets one entry and returns the refreshed list.
- The panel resolves every recorded space id to its title and renders `(deleted space)` when the space no longer exists, so the origin reads as history instead of a uuid.
- The table is full width with four columns — a one-line text snippet, a type chip (Correo / Documento / Nota), the space name(s), and the date. Clicking a row opens a modal with the full text, its space, its date, and **Delete memory**; the deletion note states that removing the memory does not change the source email, document, or space.

The Teachings registry stays: it is the versioned, revocable store of corrections and instructions that the email voice profile reads, so it is a different fact from the agent-memory rows beside it.

## Alternatives considered

**Cascade-delete memory with the Space.** Destroys knowledge the owner may want after the Space is gone; a recorded origin is history, not a foreign key.

**Keep the raw space id.** Unreadable, and it hides that the space was deleted at all.

**Keep the side inspector and truncate in place.** The inspector halved the table width and still showed the full body; a modal frees the width and carries the full text with the delete action.

## Consequences

- Memory rows may reference deleted spaces indefinitely; the panel labels them, and nothing else resolves them as live spaces.
- Deleting a Space no longer risks losing its remembered context, but a user who wants it gone must delete each entry (or all of them) from the Memory panel.

## Testing

`packages/faberloom/view/tests/email-actions.spec.ts` covers `deleteSpaceMemory` forgetting the entry and returning the refreshed list. `packages/client/ui-faberloom/tests/registration.client.spec.tsx` covers the space-name resolution, the deleted-space label, the snippet row, and deleting from the modal.
