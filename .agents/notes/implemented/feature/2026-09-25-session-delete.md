# Agent Note: permanently deleting sessions

Status: implemented

English | [中文](2026-09-25-session-delete.zh.md)

## Problem

A Session could be archived but never deleted. Storage kept every generation forever, and the sidebar had no way to remove the conversations users no longer wanted — in particular the "Ungrouped" bucket could only be hidden a row at a time, and nothing could reap the sessions left behind by deleted Spaces.

## Decision

Session persistence gains a permanent `delete`, and the Session Controller exposes it as one destructive Host command with an explicit lifecycle gate.

- `packages/session/session-persistence` adds `SessionPersistence.delete(id, options)` returning `boolean`. The base implementation refuses with a named error, so the backends that do not implement it (and the test doubles that extend the service) stay honest instead of silently pretending to delete.
- `packages/session/session-persistence-jsonl` overrides it: `findLog(id)` locates the stored directory, the whole directory is removed, and the cold-log memo entry is dropped. Deletion removes artifacts; it never rewrites or snapshots them.
- `SessionCommandController.delete({ sessionId })` refuses any Session that is live in this process (`ctx.sessions.get(id)`) with `session/busy`, then removes the Session and every Session forked from it. Children are ordered before their parent through `header.parentSession`, so a partial failure never leaves a child pointing at a missing parent.
- `SessionCommandController.deleteOrphans()` deletes every stored Session whose recorded `cwd` resolves to no registered Workspace. Live Sessions are skipped rather than refused, and a `cwd` that no longer exists on disk counts as unowned.
- `@Remote('delete')` and `@Remote('deleteOrphans')` carry both commands; the generated Client surface follows from the Typert build.
- `WorkspaceRegistry.forgetSession(id)` drops the deleted id from the in-memory header and path indexes so the board stops listing it without waiting for a re-index. The durable archive set is left alone: a deleted id can never resolve again.

The Client data layer mirrors the Host: `ISession.delete()` is a 1:1 verb, `ISessions.deleteOrphans()` re-projects the list after the Host answers, and `SessionManager` records a `remove` list mutation per returned id. The sidebar exposes Delete in the session row's `…` menu behind the browser-owned confirmation dialog, and Delete all Ungrouped as a header action on the ungrouped bucket.

## Alternatives considered

**Abort a running turn and delete anyway.** Deleting storage under a live writer races replay and tool output; refusing keeps the destructive path synchronous and honest.

**Leave forked children behind.** A child whose parent row no longer resolves reads as a lost orphan in the same ungrouped bucket the user is clearing, so the cascade is the only outcome that leaves no residue.

**Delete archived sessions from the archive list.** Archive is deliberately recoverable; permanent deletion is a separate, confirmed gesture on the visible row and on the ungrouped bucket.

## Consequences

- Deleting a Session is irreversible; the confirmation dialog and the `Delete all Ungrouped` dialog both state so.
- `session/busy` is a new Remote error code on the Session Controller.
- A Session open in any surface cannot be deleted until it is closed; the Host reports which id is busy.

## Testing

`packages/api/session-controller/tests/commands-delete.host.spec.ts` covers the children-first cascade, the live refusal that removes nothing, orphan selection that skips both live and workspace-owned sessions, and the missing-persistence refusal. The sidebar delete menu, its confirmation gate, and the ungrouped header action are covered by `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx`. `packages/session/session-persistence-jsonl` keeps its generation suite green over the new override.
