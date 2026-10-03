# Agent Note: Cross-Space context resolution and space-agent consultation

Status: proposed

English | [中文](2026-10-03-cross-space-context-and-agent-consultation.zh.md)

## Problem

A product Space carries durable context, Space-scoped memory, commercial-source directives, attached files, and a responsible catalog agent, and its conversation area is a harness Workspace, so a Space and its Workspace name the same work area. The [spaces service](../../../../packages/faberloom/spaces/src/index.ts) resolves a Space's context only through `effectiveContext` for an id the caller already holds, and that resolution walks the ancestor chain alone. The model therefore cannot resolve an arbitrary Space named in a request, cannot consult the agent responsible for another Space, and cannot infer the Space when the request never names one. Cross-Space work, such as producing a report in a client's Space with the formats that live in a formats Space, depends on the user pasting the context by hand.

## Proposal

Add cross-Space resolution and Space-agent consultation to the native product modules, and fix the context-versus-memory save policy. The model-facing entry points register through the [product tools](../../../../packages/faberloom/tool-faberloom/src/index.ts), and every read keeps the existing access checks.

### Decisions

- A Space is the product container and a Workspace is the harness container; `FaberLoomSpace.workspaceId` links them and the Space's conversation area is the Workspace, so context is never duplicated between the two.
- Version 1 resolves Space context only through explicit model tools; automatic injection into the request prefix is deferred.
- Every cross-Space read enforces the existing `canRead` check, company scope, and role, so no read crosses a tenant.
- Consulting another Space's agent is parent-initiated delegation through `ctx.subagents.start`, never a cross-tree agent message.
- The session log is the conversation and is never copied into context; `Space.context` holds stable shared configuration, `FaberLoomSpaceMemory` holds case-derived learning with a `source`, and `ctx.faberloomMemory` teachings hold destilled rules that stay candidates until the user confirms an explicit instruction.
- `find` ranks by deterministic lexical matching in version 1; embeddings or an external index are deferred.

### 1. Space resolution and context reference

`FaberLoomSpaces.find(actor, query, limit?)` returns `SpaceMatch[]` ranked over the Space title, its context keys and values, and its memory text, restricted to Spaces the actor may read. `FaberLoomSpaces.reference(actor, id)` returns a `SpaceReference` that composes `effectiveContext`, `effectiveMemory`, attached-file metadata without bytes, the responsible `agentId`, and `workspaceId`. Both methods enforce `canRead`.

### 2. Model tools

Register `faberloom_spaces_find` and `faberloom_spaces_reference`, and add a system-prompt directive that tells the model to resolve a referenced Space with `find` before `reference` and never to invent context.

### 3. Space-agent consultation

Register `faberloom_spaces_ask({ spaceId, question, agentId?, continuable? })`. It resolves the Space reference, resolves the responsible catalog agent through `ctx.faberloomAgents.getAgent`, composes a prompt from the agent responsibility, the Space directives, and the reference, and delegates through the [subagent seam](../../../../docs/subsystems/subagent.md) with `ctx.subagents.start(config.askProvider, { prompt, parent: exec.agent, signal })`. It returns the child output and session id and disposes the run. A Space without a responsible agent fails loud.

### 4. Context and memory tools

Register `faberloom_spaces_remember`, `faberloom_spaces_memory_list`, and `faberloom_spaces_forget` over the existing Space memory methods, and `faberloom_memory_teach`, `faberloom_memory_teachings`, and `faberloom_memory_revoke` over the [memory service](../../../../packages/faberloom/learning/src/index.ts). The external agent-memory server keeps owning automatic episodic distillation; these tools own only the explicit, versioned layer.

### 5. Delivery phases

Phase 0 records this note. Phase 1 adds `find` and `reference` with unit tests. Phase 2 adds the two resolution tools, the prompt directive, the regenerated tool catalog, and a keyless recorded-session snapshot. Phase 3 adds implicit resolution. Phase 4 adds `faberloom_spaces_ask`. Phase 5 adds the memory and teaching tools. Phase 6 defers semantic retrieval, automatic injection of the active Space, real Space workdir resolution, and memory distillation.

## Type contracts

| Record | Field | Meaning |
|---|---|---|
| `SpaceMatch` | `id` | Space id. |
| `SpaceMatch` | `title` | Display title. |
| `SpaceMatch` | `score` | Lexical match score. |
| `SpaceMatch` | `reasons` | Matched fields. |
| `SpaceReference` | `space` | The resolved Space record. |
| `SpaceReference` | `context` | The `effectiveContext` result. |
| `SpaceReference` | `memory` | The `effectiveMemory` entries. |
| `SpaceReference` | `files` | Attached-file metadata without bytes. |
| `SpaceReference` | `agentId` | The responsible catalog agent. |
| `SpaceReference` | `workspaceId` | The mirrored harness Workspace. |

## Alternatives considered

**Reuse `sessionReference` for Space context.** It recalls a session transcript from a concrete source session; a Space has no single session, and its configuration and memory are not transcript bytes, so the recall form does not carry the requested data.

**Send an agent-to-agent message with `sendMessage`.** That seam authorizes only adjacent live Agents and never crosses a Space boundary; the asking agent is not the referenced Space's parent, so the message would be rejected.

**Rank with embeddings or an external index in version 1.** It adds a provider, a network dependency, and nondeterminism before the lexical baseline and its tests exist; it is deferred to Phase 6.

**Inject the active Space context automatically in version 1.** It changes the request prefix on every request, cannot distinguish an explicit user reference, and would precede the lookup tools that make the reference auditable.

## Acceptance criteria

- `FaberLoomSpaces.find` and `FaberLoomSpaces.reference` pass unit tests for ranking, inheritance, exclusions, conflicts, memory inheritance, file metadata without bytes, and read denial, and no result crosses a tenant.
- `faberloom_spaces_find` and `faberloom_spaces_reference` register, the generated tool catalog reflects them, the prompt directive is present, and a keyless recorded-session snapshot pins the model-visible text.
- `faberloom_spaces_ask` delegates with `exec.agent` as the parent, returns the child output and session id, disposes the run, and fails loud when the Space has no responsible agent.
- The Space memory and teaching tools enforce their scope and ownership, and the external memory server remains the only automatic episodic layer.
- Phases 0 through 5 merge with green format, pairing, unit, coverage, typecheck, and catalog gates; Phase 6 stays recorded as deferred.
- The context-versus-memory policy is stated in the Space and memory READMEs and is not contradicted by the shipped behavior.

## Risks

Lexical matching misses synonyms and cross-language phrasing; its uncertainty must surface as ranked candidates rather than a silent wrong Space, and semantic retrieval is deferred. A consultation runs a child model turn on the deployment's shared budget, so depth limits and provider availability can refuse it, and that refusal must surface instead of an empty answer. The prompt directive is model-visible text pinned by a snapshot, so wording changes require a snapshot update. Every registered tool adds permanent schema tokens to each request, so the memory and teaching tools stay opt-in until the user enables them.

The [Space-Workspace link](../../implemented/feature/2026-09-22-spaces-workspace-link-and-bench.md) and [memory outliving its origin](../../implemented/feature/2026-09-27-memory-outlives-its-origin.md) decisions remain independent authorities for those mechanisms; this proposal supersedes neither and archives no active note.
