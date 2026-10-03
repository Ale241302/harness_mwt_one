# Agent Note: Automatic and semantic Space context

Status: proposed

English | [中文](2026-10-03-automatic-semantic-space-context.zh.md)

## Problem

The cross-space tools resolve a Space by lexical lookup and consult its agent on request, but three automatic behaviors remain deferred: no semantic index, no automatic injection of the active Space, and no memory distillation. The [spaces service](../../../../packages/faberloom/spaces/src/index.ts) ranks with folded lexical terms, which miss synonyms and cross-language phrasing, so the model must still name or find a Space before its context applies. A consultation runs in the parent's workspace because `resolveWorkdir` returns an opaque reference, not a path. A closed case leaves no teaching behind unless a person records one.

## Proposal

### Slice status

- Slice 6.1 is shipped: `ctx.spaceIndex` is a seam with the lexical ranker as the default and `find` delegating to a mounted provider.
- Slices 6.2 through 6.5 are planned: active-Space injection, real Space workdir, memory distillation, and the ECC / knowledge-hub integration.

### The `ctx.spaceIndex` seam (6.1, shipped)

[spaces types](../../../../packages/faberloom/spaces/src/types.ts) exports `SpaceIndex` with one `rank(entries, query, limit)` method and the `SpaceIndexEntry` candidates it reads. `find` builds the actor's readable, non-archived entries and calls `ctx.get('spaceIndex')`; when no provider is mounted it calls the built-in lexical ranker, so ranking never regresses. A provider package replaces only ranking and never touches storage or access control.

### Active Space and automatic injection (6.2)

Add `FaberLoomSpaces.spaceForWorkspace(actor, workspaceId)` resolving the Space that mirrors a Workspace, and a dynamic prompt section carrying that Space's `effectiveContext`, memory, and directives. The section is registered per session from the session's workspace and is opt-in, because it changes node 0 of every request for the session and the route must tolerate KV-cache invalidation when the active Space changes.

### Real Space workdir (6.3)

Resolve `space.workspaceId` to the registered Workspace path through `ctx.workspaceRegistry`, and pass it to the delegated child's creation options so a consultation runs in the Space's real directory. The sandbox policy and containment checks still own that boundary.

### Memory distillation (6.4)

When a board item is approved or an execution completes, distill one candidate teaching from the case conversation using `ctx.sessionQuery` and the session-reference context, with `source` naming the case. The teaching stays a candidate until a person confirms it, so automatic learning never silently changes behavior.

### ECC and knowledge-hub integration (6.5)

A `space-index` provider package owns embeddings and, when the deployment wires it, the MWT knowledge hub as the backend. The hub owns the index data, retention, and residency; the provider owns only the query mapping, and `find` remains the single consumer. ECC supplies the reusable skills and gates for the package, not runtime behavior.

## Alternatives considered

**Embeddings inside the spaces service.** It couples durable records to a model provider and a network dependency; the seam keeps ranking replaceable and the service testable without a provider.

**Always-on active-Space injection.** It changes the request prefix on every request even when the task needs no Space context; an opt-in section scoped to the session workspace keeps the change deliberate.

**Reuse the opaque workdir reference.** `resolveWorkdir` is deliberately path-free; a real path requires the workspace registry and its confinement, so it is a separate slice.

**Distill teachings directly to active.** An unconfirmed inference is a candidate; promoting it without a person would let a wrong generalization change later behavior.

## Acceptance criteria

- Slice 6.1 delegates to a mounted `ctx.spaceIndex` and falls back to lexical ranking, with unit tests covering both.
- Slice 6.2 resolves the workspace mirror and carries the active Space in a session-scoped prompt section, pinned by a keyless snapshot before and after activation.
- Slice 6.3 runs a consultation child in the Space's registered workspace path, proven by a path assertion.
- Slice 6.4 records exactly one candidate teaching with the case as source on an approved case, and no active teaching.
- Slice 6.5 documents the provider package, the hub integration, and the retention and residency ownership.

## Risks

A semantic index adds embedding cost, latency, and nondeterminism; the seam keeps the lexical ranker as the default and the fallback. Automatic injection and distillation change model-visible input, so each needs a snapshot and an opt-in. The knowledge hub introduces data residency and retention obligations that the deployment, not the harness, must own.
