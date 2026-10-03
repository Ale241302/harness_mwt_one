# Agent Note: Work Flow module — graph automation over Spaces

Status: proposed

English | [中文](2026-10-03-workflow-module.zh.md)

## Problem

FaberLoom already has the primitives for autonomous work — durable Spaces, a catalog of agents, persistent [routines](../../../../packages/faberloom/routines/src/types.ts) with a dispatcher, an IMAP [inbound](../../../../packages/faberloom/inbound/src/index.ts) poller, per-user IMAP/SMTP connections, a board, and memory — but no surface where a person composes them into one automation, sees it as a graph, edits it from chat, shares it, and lets it run while they are offline. Today a "workflow" means either a harness code script or a routine whose steps are hand-written; neither is a directed graph bound to a Space, so the spam-classification case (read mail, classify, delete spam, remember the pattern) cannot be assembled, inspected, or delegated at the product level.

## Proposal

Add a native product module, `ctx.faberloomWorkflows`, whose source of truth is a versioned directed graph of nodes and edges scoped to a Space or the personal scope. The graph compiles to a Routine and runs on the existing dispatcher, so nothing depends on a browser session; the module adds a graphical editor, chat tools, permissions, and sharing, and reuses every existing module instead of replacing it.

### Graph model

A workflow owns `nodes`, `edges`, a `definition`, a `scope`, a lifecycle `status` (`draft`/`active`/`paused`), and a monotonic `version`. Nodes carry a discriminated `kind` and a `kind`-specific `config`; edges carry an optional `condition`. Validation rejects cycles, unreachable nodes, unknown kinds, malformed `config`, and edges to missing nodes. The graph is the source of truth; a compiled `routineId` is a derived artifact.

### Compilation to a Routine

`compileWorkFlow(workflow)` maps each node to a routine step, each edge to `dependsOn`, and each trigger node to a `RoutineTrigger`, producing a `RoutineDefinitionInput` the [routines service](../../../../packages/faberloom/routines/src/index.ts) accepts. `active` activates the compiled routine; editing recompiles and versions it, and in-flight executions migrate through the engine's `previewMigration`/`migrate`. New step handlers live in [handlers](../../../../packages/faberloom/handlers/src/index.ts): `condition`, `imap`, `smtp`, `mcp`, `agent`, `delay`, `subroutine`, `transform`, `notify`, and `deadletter`.

### Node catalog

| Family | `kind` | Config |
|---|---|---|
| Trigger | `trigger.manual` | none |
| Trigger | `trigger.schedule` | recurrence or cron, timezone, windows |
| Trigger | `trigger.email` | connection, mailbox, match, unseenOnly |
| Trigger | `trigger.event` | event source, match |
| Trigger | `trigger.board` | item, status |
| Action | `agent` | agentId, instruction, useSpaceContext, skills |
| Action | `skill` | skill name, arguments |
| Action | `mcp.call` | server, tool, arguments, allow |
| Action | `imap.action` | connection, op, query, folder |
| Action | `smtp.send` | connection, to, subject, template |
| Action | `memory.remember` | space, text |
| Action | `memory.teach` | scope, text, source, active |
| Action | `board.create` | title, summary, evidence |
| Action | `space.reference` | space id |
| Action | `routine.invoke` | routine id |

### Permissions and sharing

A `ShareGrant` names a resource (`space` or `workflow`), a `granteeEmail`, a set of `SharePermission` values (`view`, `run`, `edit-graph`, `add-nodes`, `remove-nodes`, `edit-agents`, `manage-triggers`, `manage-connections`, `approve-effects`, `share`, `manage-members`), and a lifecycle `status`. Enforcement extends the Spaces `canRead`/`canManage` checks so a permission, not a single member flag, decides each action. A share notifies the grantee through the sharer's SMTP connection, and cross-user sharing publishes the grant and a portable graph snapshot to the MWT.ONE console, the same path agents and skills already use, because each user runs an isolated process with its own home.

### Offline runtime and liveness

The dispatcher and the inbound poller already run without a person; a workflow inherits that. Each execution records per-node state, retries a failed node up to a bound, and moves to review with a dead-letter item when retries are exhausted. Liveness surfaces the last run, failures, and the next due slot, and alerts the owner by email.

### Editing surfaces

The model edits a graph through opt-in tools (`workflowTools`, default off), the browser edits it on an interactive canvas, and `exportWorkflow` produces a portable JSON plus a read-only Archify HTML/SVG diagram. A Space topology view lists the Space's agents, MCP servers, IMAP/SMTP connections, and workspaces to feed the palette.

### Repository responsibilities

The runtime lives in this repository; mwt-one-harness mounts the module in the `faberloom` profile and owns deployment and the release manifest; mwt-knowledge-hub stores the templates, the enterprise schema, and the retention policy; ECC supplies the engineering skills and schemas, never runtime code.

## Type contracts

```text
WorkFlowNode   = { id, kind, title, config, agentId?, position: { x, y } }
WorkFlowEdge   = { id, from, to, condition? }
WorkFlowDef    = { intent, nodes[], edges[], permissions[], failurePolicy }
WorkFlow       = { id, ownerId, scope, name, status, version, definition, routineId?, createdAt, updatedAt }
WorkFlowScope  = { kind: 'personal' } | { kind: 'space', spaceId }
ShareGrant     = { id, resource, granteeEmail, permissions[], status, createdAt, acceptedAt? }
ShareResource  = { kind: 'space' | 'workflow', id }
SharePermission = 'view' | 'run' | 'edit-graph' | 'add-nodes' | 'remove-nodes' | 'edit-agents' | 'manage-triggers' | 'manage-connections' | 'approve-effects' | 'share' | 'manage-members'
```

## Draft subsystem surface

The generated subsystem page gains this service section when the package lands in Phase 1.

```text
ctx.faberloomWorkflows — FaberLoomWorkflows
async create(actor, input): Promise<WorkFlow>
async list(actor, scope?): Promise<WorkFlow[]>
async get(actor, id): Promise<WorkFlow>
async update(actor, id, patch): Promise<WorkFlow>
async setStatus(actor, id, status): Promise<WorkFlow>
async validate(actor, id): Promise<WorkFlowValidation>
async compile(actor, id): Promise<RoutineDefinitionInput>
async remove(actor, id): Promise<boolean>
async share(actor, id, granteeEmail, permissions): Promise<ShareGrant>
async revokeShare(actor, grantId): Promise<ShareGrant>
```

## Alternatives considered

**A dedicated graph executor.** It would give exact control over loops, fan-out, and joins, but it duplicates the dispatcher, waits, effect ledger, idempotency, and migration the routines engine already ships and keeps tested; the proposal compiles to a Routine first and defers an executor until a flow the engine cannot express is real.

**Reuse the harness workflow tool.** The harness workflow runs a JavaScript orchestration of subagents inside one turn; it is not a durable product graph bound to a Space, has no graphical surface, and stops when the turn ends, so it cannot run while the user is offline.

**Model the automation directly as a Routine with no graph.** Routines already express steps and triggers, but a routine is a linear list with dependencies and cannot be drawn, dragged, or inspected as a graph, which is the requested editing experience.

**Keep the graph and skip compilation.** Storing only the graph would leave execution, retries, waits, migrations, and the offline dispatcher to a second engine; compiling keeps one runtime and one execution history.

**Share through local Space members only.** Members grant read to identities in the same process, but each user is an isolated process with its own home, so cross-user sharing needs the console; local members alone cannot notify or revoke another user.

## Acceptance criteria

- The graph model validates cycles, unreachable nodes, unknown kinds, and malformed config, and rejects an invalid graph before compilation.
- An anti-spam graph compiles deterministically to a Routine and runs through the dispatcher without an open session, exactly once per trigger slot or message.
- A node of each catalog kind has a handler and a unit test; an end-to-end case reads mail, classifies spam, deletes it, and records a memory entry against a fake IMAP/SMTP server.
- Chat tools create, edit, and activate the anti-spam graph, pinned by a keyless snapshot; the canvas adds, connects, edits, and removes nodes and changes the agent.
- Permissions decide each action, a share notifies the grantee's email, and revoking the grant removes access.
- The catalog, tool catalog, subsystem pages, i18n pairs, snapshots, lint, duplication, and typecheck gates pass, and the module is mounted in the `faberloom` profile.

## Risks

A compiled graph inherits the routines engine's limits: control flow is a dependency graph with waits, so rich loops and joins may force the deferred executor. Real effects (delete, send, MCP calls) touch a user's mailbox and accounts, so every effect node needs an explicit permission, idempotency, and a dry-run, and the effect ledger must survive a crash. Cross-user sharing depends on the MWT.ONE console contract and introduces retention and residency obligations the deployment, not the harness, must own. The knowledge hub and the enterprise schema assume one tenant per console company, so a shared graph must never leak across tenants. Finally, adding tools to the request changes its schema and invalidates KV reuse, so the editing tools are opt-in and the editor itself never touches a prompt.

## Implementation status

- Fase 0 — design and contracts (this note, `packages/faberloom/workflows/README.md`, and the knowledge-hub specs `SPEC_WORKFLOW_ANTI_SPAM_v1` and `SPEC_WORKFLOW_GLOSARIO_v1`): done.
- Fase 1 — model and storage: done. `@deepseek-ai/dsh-faberloom-workflows` ships the branded types, the discriminated node catalog, the `faberloom_workflows` domain, owner-scoped CRUD with version bumping, DAG validation, and `compileWorkFlow`; the anti-spam graph validates and compiles deterministically, with per-file 100% coverage. `SPEC_WORKFLOW_MODEL_v1` records the model.
- Fase 2 — persistent execution: done. The compiled routine carries each node's `config`; activating a flow creates and activates the routine through `ctx.faberloomRoutines`, editing an active flow versions it and migrates its waiting executions, and the `faberloom-handlers` package registers the config-driven handlers (`condition`, `transform`, `delay`, `imap`, `smtp`, `memory.remember`, `memory.teach`, `board.create`, `reference`, `subroutine`, `notify`, `deadletter`) plus the agent Space context. A keyless end-to-end spec drives the anti-spam graph against fake IMAP and SMTP servers with no user connected and across a restart without duplicating a run. The `faberloom` bundle mounts the workflows row, and the gateway keeps the dispatcher and inbound poller enabled per user.
- Fase 3 — rich connectivity: done. `mcp.call` calls one MCP tool through `ctx.tools` after an `mcp:<server>:<tool>` allowlist check; an agent step resolves the Space's effective context and memory, the responsible agent and its skills, and an invoked skill's body, runs its hidden Session in the Space's mirrored workspace path, and uses the catalog agent's provider and model; `ctx.faberloomView.spaceMap()` returns the Spaces, agents, MCP access, mail connections, and Workspaces the palette and canvas read. The routines engine also gates a branch step on its condition result and resumes a `@delay:` wait on the engine clock. Chat tools, the editor, scheduling, sharing, liveness, and templates remain Fases 4–9.
