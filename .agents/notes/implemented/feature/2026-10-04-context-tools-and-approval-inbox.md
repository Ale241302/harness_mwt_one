# Agent Note: Context tools, Work Flow proposals, and the approval inbox

Status: implemented

English | [中文](2026-10-04-context-tools-and-approval-inbox.zh.md)

## Problem

FaberLoom shipped a Context panel and a shared-Session catalog, but four gaps remained. The model could not touch the Workspace/Space context from a conversation, so "remember this rule" needed the panel. Work Flows were only built when the user asked, with no path for the model to notice an automatable flow on its own. A member's Work Flow edit and a member's Space-context contribution had no single owner-facing place to accept or reject, and a member's Work Flow edit applied to the live graph directly, with no pending revision to diff. Context sharing stayed on one host because no transport carried it to the console the way share grants already travel.

## Decision

`Config.contextTools` opts in the `faberloom_context_*` tools (`list`, `create`, `update`, `versions`, `restore`, `approve`, `reject`, `remove`) over `ctx.faberloomContext`, plus a `faberloom:context` prompt directive that tells the model to record facts and rules unprompted and to index or keep a pending entry when it owns the Space.

`faberloom_workflows_propose` builds a draft Work Flow from a name, an intent, and an ordered step list: a `trigger.*` step (or `trigger.manual`) becomes the trigger, the rest chain with directed edges, and the flow is validated but never activated. The `faberloom:workflows` directive now tells the model to propose on its own when a conversation exposes a repeatable flow and to wait for the user's confirmation.

The workflows domain gains a `pending` table with one staged revision per flow; the domain version stays 1 because the store reads a missing table as empty, while raising the version rejects every existing store at open. A non-owner edit — `update`, `addNode`, `updateNode`, `removeNode`, `connect`, `disconnect`, `setTrigger`, `setConcurrency`, or `restore` — stages the proposed name, scope, and definition (a later proposal replaces an earlier one) and leaves the live flow untouched. `pendingChanges(actor)` lists the owner's staged revisions with each base and proposed definition, and `acceptPending`/`rejectPending` apply or drop one. Owner edits still apply directly.

The context domain gains `origin` and `consoleId`, both optional-with-default so the domain version stays 1. A member's Space entry is published to `${consoleBase}/harness/context`; approving or rejecting republishes the status; removing deletes the mirror; `sync(readerId)` imports the console's rows as `pending` entries owned by the reader and prunes the rows the console no longer carries.

The view exposes `syncContext`, `workflowPendingChanges`, `acceptWorkflowChange`, and `rejectWorkflowChange`. The Espacios panel adds a `Sesiones compartidas` field, and a new **Aprobaciones** panel lists pending context and staged flow changes with an accept/reject action and a node/edge diff of each proposal against its base.

## Alternatives considered

**Enforce automatic proposal detection in code.** Rejected: deciding that a conversation is automatable is the model's judgment, not a host rule; the tool creates a safe draft and the directive makes the proposal explicit and confirmable instead.

**Apply a member's edit, then offer "undo".** Rejected: the request was a pending revision the owner diffs and accepts or rejects; staging at the mutation is the only way to show the proposed graph beside the live one without having applied it.

**Import shared context into the local entries as the owner's own.** Rejected: an imported row is a member's proposal, so it lands `pending` and only `shared` after the owner indexes it, matching the same-host approval semantics.

**A separate opt-in for the Work Flow proposal tool.** Rejected: it is part of the existing `workflowTools` graph suite and shares its schema and directive.

## Consequences

The Context and Work Flow tools stay opt-in, so a deployment that wants them sets `contextTools` and `workflowTools`; the directive text is pinned with the tools. Staging is one revision per flow, so a second member edit replaces the first — the owner always reviews the latest proposal, never a queue. The approval inbox is the single owner-facing place for both context and flow decisions. Cross-host context needs the `${consoleBase}/harness/context` endpoints, exactly like share grants and shared Sessions; without them a member's context stays local and `sync` is a no-op. The two domains gained a durable field and a table without changing their version — the storage layer never migrates a version change, so an additive table or optional field keeps version 1 and existing stores keep opening — and the persistence catalog records the new tables and fields.

Tests cover the Context tools (list, create, update, versions, restore, approve, reject, remove, the not-mounted failure, and the empty list), the proposal tool (a scoped step list and a bare manual draft that reports invalid), the pending Work Flow lifecycle (stage on update, add, restore, and concurrency; accept; reject; the owner-only and missing-stage failures), the context console transport (publish, status republish on approve, retract on removal, import with defaults, prune, the environment fallback, and the loud failure), and the view's pending mapping plus `syncContext`.
