# Agent Note: Private Memory, Context, Work Flows, and Routines

Status: implemented

English | [中文](2026-10-11-private-faberloom-records.zh.md)

## Problem

Sharing a Space or Work Flow grants another identity a per-action permission set (`view-memory`, `edit-workflows`, `delete-routines`, …) and publishes the owner's Memory, Context, Work Flows, and Routines through the shared-content catalog. Nothing let the owner keep one record out of that set: every publishable item travelled, so a member — and the member's agent, acting through `ctx.faberloom*` and the model tools — read and edited it whenever the grant carried the module permission. Context alone carried a `local`/`pending`/`shared` visibility, but `publishSpaceContent` ignored it and published a `local` entry anyway.

## Decision

Memory, Work Flows, and Routines gain a durable `visibility: 'shared' | 'private'`, defaulted to `shared` so the domain version stays 1 and records written before the field keep loading. Context keeps its `local | pending | shared` vocabulary, where `local` is the private state and is now **author-only**: neither the Space owner nor another member reads it, `visible` admits only its author, and `context.sync` never stores a `local` console row. Only the owner flips a record's visibility: `ctx.faberloomSpaces.setMemoryVisibility`, `ctx.faberloomWorkflows.setVisibility`, `ctx.faberloomRoutines.setRoutineVisibility`, and Context's existing `approve`/`reject`; the view Remote layer exposes them as `setMemoryVisibility`, `setWorkflowVisibility`, and `setRoutineVisibility`. The owner shares a record by granting a Space or Work Flow to the email in the grant and can always keep it private instead.

A private record is enforced at the operation that reads or publishes it, not at a caller:

- `publishSpaceContent` skips a `private` Memory, Work Flow, or Routine and a non-`shared` Context entry; `FaberLoomShares.publishContent` also drops any item whose payload carries `visibility: 'private'`, so the record never reaches the MWT.ONE console or another identity's process.
- `materializeSharedContent` ignores a console row that carries `visibility: 'private'`, so a copy is never materialized even if a console returned one.
- `ctx.faberloomSpaces.listMemory` hides another owner's `private` entry from a member of a readable Space, and `ctx.faberloomWorkflows.list` plus its `requireAccess` deny a `private` flow to a non-owner even while an active grant carries `view` or `edit-graph`.
- `ctx.faberloomContext.visible` admits a `local` entry only to its author, so the Space owner still decides a `pending` contribution but cannot read it once it is `local`; `context.sync` skips a `local` console row rather than storing an unreadable copy.

Turning a Work Flow private also revokes its outgoing direct Work Flow grants inside `ctx.faberloomWorkflows.setVisibility` itself — the denial sits in the service, not the view — because a grantee's imported copy carries its own visibility and must stop resolving; a visibility change republishes the owner's Space content at once. The Space's members still lose a materialized copy on the next sync, because the console replaces the author's set. The Espacios Memory/Workflows/Routines panels expose the toggle and the Context panel's approve/reject pair is its private/shared control.

A Work Flow and a Routine also name the Space they belong to. `publishSpaceContent` publishes each Work Flow into the Space its `scope` names and each Routine into the `spaceId` it carries, so a personal Work Flow (`scope: personal`) or a personal Routine (`spaceId: null`) never travels. `routineRecord` gains a defaulted `spaceId`; `createRoutine`/`updateRoutine` carry it, `routineDetail` and the routine rows project it, and `createRoutine`, `saveRoutine`, `routineFromEmail`, `createRoutineFromWork`, and the `faberloom_routines_create`/`faberloom_routines_update` tools accept it. The Routines panel edits it through a Space select that offers no space for the personal scope.

## Alternatives considered

**A bare boolean `private` field.** Rejected: the value vocabulary matches Context's existing `visibility` and leaves room for a later `pending`.

**Filtering at the tool layer.** Rejected: a tool facade is bypassable by another caller; the denial belongs in the service method and in the publish/materialize operations (AGENTS.md, "Enforce a decision in the operation that makes it").

**A new domain version.** Rejected: a defaulted member keeps the single-layout store loading under version 1, which the storage layer never migrates.

**Deriving privacy only from the absence of a grant.** Rejected: the grant set is the wrong owner of the fact; the record itself must carry who may see it, so revoking or re-granting a permission never silently republishes a record the owner kept back.

## Consequences

The three new fields are additive and defaulted; every existing durable record loads as `shared`, unchanged. A `local` Context entry now stops being published, which fixes a latent leak rather than changing an intended behavior. A private record is invisible to a member's agent, so it cannot be read, edited, or executed through a chat turn, whatever module permissions the Space grant carries. The owner's own agent still reads it normally. Tests cover the owner-only toggle, the member-hidden read, the publish drop in `FaberLoomShares`, the console-grant revocation on a Work Flow, the `local`-only Context read, and the panel toggles.

## Deferred

- **Teachings and the external memory core.** `ctx.faberloomMemory` (learning) and the agent-memory core behind `memoryCoreUrl` do not travel through the shared-content catalog, so they stay owner-scoped by construction and this flag does not apply to them. Giving teachings an explicit flag stays deferred until they are shareable at all.
- **Residual imported copy.** After a grant is revoked or a flow turns private, the member's imported record stays in its storage but every read path — `list`, `requireAccess`, `materializeSharedContent` — denies it.
- **Immediate republish needs the console.** A visibility change republishes at once only when `CONSOLA_API_BASE` and `CONSOLA_TOKEN` are set; otherwise the periodic `overview` pass publishes it within about ten seconds.
