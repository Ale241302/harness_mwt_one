# 原生产品模块

[English](faberloom.md) | 中文

原生产品模块为本 DeepSeek Harness 构建扩展主题空间、带模型策略的代理目录、声明式例程、持久化执行、记忆、选择性自主与知识备份。每个模块都是 [`packages/faberloom`](../../packages/faberloom/README.zh.md) 下的主机 Cordis 服务；工具、设置与持久化记录在后续切片加入。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxfaberloomaccess--faberloomaccess"></a>

### `ctx.faberloomAccess` — `FaberLoomAccess`

The product access service: action-scoped, revocable autonomy grants.

```ts cordis-catalog
/**
 * Issue one grant.
 * @param ownerId - the identity granting autonomy.
 * @param input - action, optional agent/context scopes, note, and expiry.
 * @returns the created grant.
 */
async grant(ownerId: string, input: GrantInput): Promise<FaberLoomGrant>

/**
 * List one owner's grants.
 * @param ownerId - the owning identity.
 * @param options - `activeOnly` skips revoked grants.
 * @returns the grants.
 */
async listGrants(ownerId: string, options: { activeOnly?: boolean } = {}): Promise<FaberLoomGrant[]>

/**
 * Revoke one grant; the next check denies it.
 * @param ownerId - the acting identity.
 * @param id - grant id.
 * @returns the revoked grant.
 */
async revokeGrant(ownerId: string, id: string): Promise<FaberLoomGrant>

/**
 * Check whether an action is authorized before running it.
 * @param request - owner, action, optional agent/context, and instant.
 * @returns the decision and the grant that decided it.
 */
async check(request: GrantCheck): Promise<GrantDecision>
```

Source: [`packages/faberloom/access/src/index.ts`](../../packages/faberloom/access/src/index.ts)

<a id="ctxfaberloomagents--faberloomagents"></a>

### `ctx.faberloomAgents` — `FaberLoomAgents`

The product agents service: model pool, agent catalog, model policy resolver and recommender, selection records, contextual evidence, and delegation.

```ts cordis-catalog
/**
 * Register one accessible model in the pool.
 * @param input - provider, model, capabilities, limits, and rates.
 * @returns the registered model.
 */
async registerModel(input: ModelInput): Promise<FaberLoomModel>

/**
 * List the accessible models.
 * @returns the pool entries.
 */
async listModels(): Promise<FaberLoomModel[]>

/**
 * Read one model.
 * @param id - pool id.
 * @returns the model, or undefined.
 */
async getModel(id: FaberLoomModelId): Promise<FaberLoomModel | undefined>

/**
 * Set a model's availability after a checked probe.
 * @param id - pool id.
 * @param available - the new availability.
 * @returns the updated model.
 */
async setAvailability(id: FaberLoomModelId, available: boolean): Promise<FaberLoomModel>

/**
 * Remove one model from the pool.
 * @param id - pool id.
 * @returns true when it existed.
 */
async removeModel(id: FaberLoomModelId): Promise<boolean>

/**
 * Reconcile pool availability with the live harness routes from `ctx.llm`.
 * @returns how many entries were checked and how many are now available.
 */
async syncPool(): Promise<{ checked: number; available: number }>

/**
 * Register one executable tool handler in this process.
 * @param name - tool name referenced by an agent's `tools` list.
 * @param handler - sync or async handler over the call arguments.
 * @returns the disposer removing the handler.
 */
registerExecutableTool(name: string, handler: (args: unknown) => unknown | Promise<unknown>): () => void

/**
 * List the executable tools registered in this process.
 * @returns the tool names.
 */
listExecutableTools(): string[]

/**
 * Execute one registered tool for an agent, enforcing the agent's tool allowlist.
 * @param agentId - the agent that acts.
 * @param toolName - the tool to run.
 * @param args - handler arguments.
 * @returns the tool name and its result.
 */
async executeTool(agentId: FaberLoomAgentId, toolName: string, args: unknown): Promise<{ toolName: string; result: unknown }>

/**
 * Run a one-shot temporary subagent: it shares the parent budget, may use only
 * tools the parent already allows, executes one tool, and is never added to
 * the catalog.
 * @param parentAgentId - the parent agent.
 * @param request - name, responsibility, model, task, and optional tool call.
 * @returns the run outcome and the remaining parent budget.
 */
async runTemporarySubagent(parentAgentId: FaberLoomAgentId, request: RunTemporarySubagentRequest): Promise<TemporarySubagentResult>

/**
 * Create one agent through any of the three routes.
 * @param input - name, responsibility, route, and initial policy.
 * @returns the created agent.
 */
async createAgent(input: AgentInput): Promise<FaberLoomAgent>

/**
 * List the catalog.
 * @returns agents oldest first.
 */
async listAgents(): Promise<FaberLoomAgent[]>

/**
 * Read one agent.
 * @param id - agent id.
 * @returns the agent.
 */
async getAgent(id: FaberLoomAgentId): Promise<FaberLoomAgent>

/**
 * Apply a patch to one agent, bumping its version.
 * @param id - agent id.
 * @param patch - fields to change.
 * @returns the updated agent.
 */
async updateAgent(id: FaberLoomAgentId, patch: AgentPatch): Promise<FaberLoomAgent>

/**
 * Duplicate one agent: copies configuration and explicitly selected lessons,
 * never the source's evidence (confidence is not transferred).
 * @param id - source agent id.
 * @param input - name, optional space, and selected lessons for the copy.
 * @returns the created duplicate.
 */
async duplicateAgent(id: FaberLoomAgentId, input: DuplicateInput): Promise<FaberLoomAgent>

/**
 * Deactivate one agent; the record stays in the catalog.
 * @param id - agent id.
 * @returns the deactivated agent.
 */
async deactivateAgent(id: FaberLoomAgentId): Promise<FaberLoomAgent>

/**
 * Remove one agent from the catalog.
 * @param id - agent id.
 * @returns true when it existed.
 */
async removeAgent(id: FaberLoomAgentId): Promise<boolean>

/**
 * Resolve the effective model for one task attempt under the agent policy and
 * shared budget. Fails closed: exclusive providers never substitute, unknown
 * cost under a budget never assumes zero.
 * @param agentId - the agent to resolve for.
 * @param request - task, provider state, met condition, and spent budget.
 * @returns the selection or the reason to stop.
 */
async resolveModel(agentId: FaberLoomAgentId, request: ResolveRequest): Promise<ResolveResult>

/**
 * Recommend models for a task by cost per useful result over accessible,
 * capable candidates, exposing uncertainty instead of guessing.
 * @param request - required capabilities, context floor, and task label.
 * @returns the recommended model, ranked alternatives, and uncertainty.
 */
async recommendModel(request: RecommendRequest): Promise<RecommendResult>

/**
 * Record one model selection for an execution step.
 * @param entry - the selection facts (id and instant are assigned).
 * @returns the stored selection.
 */
async recordSelection(entry: SelectionInput): Promise<Selection>

/**
 * List recorded selections.
 * @param filter - optional agent and task filters.
 * @returns selections oldest first.
 */
async listSelections(filter: { agentId?: FaberLoomAgentId; task?: string } = {}): Promise<Selection[]>

/**
 * Record one human outcome for an agent/model/task.
 * @param entry - the outcome facts (id and instant are assigned).
 * @returns the stored outcome.
 */
async recordOutcome(entry: OutcomeInput): Promise<Outcome>

/**
 * Aggregate contextual performance for a filter.
 * @param filter - optional agent, task, and model filters.
 * @returns uses, approvals, corrections, correction rate, and cost per useful result.
 */
async evidence(filter: { agentId?: FaberLoomAgentId; task?: string; modelId?: FaberLoomModelId } = {}): Promise<EvidenceSummary>

/**
 * Delegate one task to a named subagent, resolving its policy inside the
 * parent's shared budget and recording the selection.
 * @param parentAgentId - the parent agent.
 * @param request - subagent name, task, spent budget, and met condition.
 * @returns the subagent result and the remaining parent budget.
 */
async delegate(parentAgentId: FaberLoomAgentId, request: DelegateRequest): Promise<DelegateResult>
```

Source: [`packages/faberloom/agents/src/index.ts`](../../packages/faberloom/agents/src/index.ts)

<a id="ctxfaberloombackup--faberloombackup"></a>

### `ctx.faberloomBackup` — `FaberLoomBackup`

The product backup service: capture, list, verify, restore, and delete integrity-checked snapshots of the FaberLoom domains.

```ts cordis-catalog
/**
 * Capture the currently open FaberLoom domains into one durable snapshot and
 * return its manifest. Domains that are not mounted in this process are
 * omitted from the manifest rather than reported as empty.
 * @param ownerId - the owning identity the snapshot belongs to.
 * @param options - optional note and domain restriction.
 * @returns the manifest of the captured snapshot.
 */
async createBackup(ownerId: string, options: CreateBackupOptions = {}): Promise<FaberLoomBackupManifest>

/**
 * List one owner's backup manifests, newest first.
 * @param ownerId - the owning identity.
 * @returns the manifests, newest first.
 */
async listBackups(ownerId: string): Promise<FaberLoomBackupManifest[]>

/**
 * Read one backup manifest.
 * @param ownerId - the owning identity.
 * @param id - backup id.
 * @returns the manifest.
 */
async getBackup(ownerId: string, id: string): Promise<FaberLoomBackupManifest>

/**
 * Recompute the stored payload's digests and compare them with the manifest.
 * @param ownerId - the owning identity.
 * @param id - backup id.
 * @returns the per-table verdicts and the overall verdict.
 */
async verifyBackup(ownerId: string, id: string): Promise<FaberLoomBackupVerifyResult>

/**
 * Restore one backup into the domains open in this process. Every record is
 * written with `put` (upsert); domains the process does not have open are
 * reported and skipped. A backup whose payload fails its integrity check is
 * refused before any write.
 * @param ownerId - the owning identity.
 * @param id - backup id.
 * @param options - `dryRun` counts the writes without performing them.
 * @returns the tables written or counted and the domains skipped.
 */
async restoreBackup(ownerId: string, id: string, options: RestoreBackupOptions = {}): Promise<FaberLoomRestoreResult>

/**
 * List the migration registry and whether this owner already applied each
 * entry.
 * @param ownerId - the owning identity.
 * @param registry - the migrations to report; defaults to the product registry.
 * @returns one info row per migration, in registry order.
 */
async listMigrations( ownerId: string, registry: readonly FaberLoomDataMigration[] = FABERLOOM_DATA_MIGRATIONS, ): Promise<FaberLoomMigrationInfo[]>

/**
 * Apply every registry migration this owner has not applied yet. Each rewrite
 * runs through the same domain handles the services use, and the applied id is
 * recorded only after a successful rewrite, so an interrupted pass re-runs
 * safely and a domain that is not open is reported rather than skipped.
 * @param ownerId - the owning identity.
 * @param registry - the migrations to apply; defaults to the product registry.
 * @returns the ids applied in this pass and the domains that were not open.
 */
async runMigrations( ownerId: string, registry: readonly FaberLoomDataMigration[] = FABERLOOM_DATA_MIGRATIONS, ): Promise<FaberLoomMigrationReport>

/**
 * Delete one backup record.
 * @param ownerId - the owning identity.
 * @param id - backup id.
 * @returns nothing.
 */
async deleteBackup(ownerId: string, id: string): Promise<void>
```

Source: [`packages/faberloom/backup/src/index.ts`](../../packages/faberloom/backup/src/index.ts)

<a id="ctxfaberloomboard--faberloomboard"></a>

### `ctx.faberloomBoard` — `FaberLoomBoard`

The product board service: versioned items, evidence-gated submits, version-bound approvals, revalidation, and authorization-gated effects.

```ts cordis-catalog
/**
 * Create one prepared item awaiting review; evidence is mandatory.
 * @param ownerId - the owning identity.
 * @param input - title, summary, evidence, optional space, document, execution.
 * @returns the created item.
 */
async create(ownerId: string, input: BoardCreateInput): Promise<FaberLoomBoardItem>

/**
 * Submit a correction as the next revision, awaiting a fresh review.
 * @param ownerId - the acting identity.
 * @param id - item id.
 * @param input - summary, evidence, and optional document reference.
 * @returns the updated item.
 */
async submitRevision(ownerId: string, id: FaberLoomBoardItemId, input: BoardSubmitInput): Promise<FaberLoomBoardItem>

/**
 * Record that the item waits for data.
 * @param ownerId - the acting identity.
 * @param id - item id.
 * @returns the updated item.
 */
async requestData(ownerId: string, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem>

/**
 * Mark the item failed.
 * @param ownerId - the acting identity.
 * @param id - item id.
 * @returns the updated item.
 */
async fail(ownerId: string, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem>

/**
 * Reopen the item for another attempt.
 * @param ownerId - the acting identity.
 * @param id - item id.
 * @returns the updated item.
 */
async reopen(ownerId: string, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem>

/**
 * Complete an approved item.
 * @param ownerId - the acting identity.
 * @param id - item id.
 * @returns the updated item.
 */
async complete(ownerId: string, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem>

/**
 * Approve or reject the exact revision. A stale item refuses; a revision that
 * is not current refuses with `STALE_REVISION`.
 * @param ownerId - the acting identity.
 * @param id - item id.
 * @param input - decision, exact revision, and optional note.
 * @returns the updated item.
 */
async review(ownerId: string, id: FaberLoomBoardItemId, input: BoardReviewInput): Promise<FaberLoomBoardItem>

/**
 * Invalidate a current approval: the item must be revalidated before approval
 * or effects.
 * @param ownerId - the acting identity.
 * @param id - item id.
 * @param reason - why the item went stale.
 * @returns the updated item.
 */
async markStale(ownerId: string, id: FaberLoomBoardItemId, reason: string): Promise<FaberLoomBoardItem>

/**
 * Clear staleness after checking the changed condition.
 * @param ownerId - the acting identity.
 * @param id - item id.
 * @param changed - whether the underlying condition actually changed.
 * @returns the updated item.
 */
async revalidate(ownerId: string, id: FaberLoomBoardItemId, changed: boolean): Promise<FaberLoomBoardItem>

/**
 * Record an effect. Approval never sends: an explicit non-empty authorization
 * is required, and a stale or unapproved item refuses.
 * @param ownerId - the acting identity.
 * @param id - item id.
 * @param input - external reference, authorization, and optional detail.
 * @returns the updated item.
 */
async recordEffect(ownerId: string, id: FaberLoomBoardItemId, input: BoardEffectInput): Promise<FaberLoomBoardItem>

/**
 * Read one item.
 * @param id - item id.
 * @returns the item.
 */
async get(id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem>

/**
 * List items, optionally filtered by owner and status.
 * @param filter - optional owner and status filters.
 * @returns items oldest first.
 */
async list(filter: { ownerId?: string; status?: BoardStatus } = {}): Promise<FaberLoomBoardItem[]>
```

Source: [`packages/faberloom/board/src/index.ts`](../../packages/faberloom/board/src/index.ts)

<a id="ctxfaberloomconnections--faberloomconnections"></a>

### `ctx.faberloomConnections` — `FaberLoomConnections`

The product connections service: per-user integrations owned by FaberLoom.

```ts cordis-catalog
/**
 * List one owner's connections.
 * @param ownerId - the owning identity.
 * @returns the connections, oldest first.
 */
async list(ownerId: string): Promise<FaberLoomConnection[]>

/**
 * Create or replace one connection. An omitted secret keeps the stored one.
 * @param ownerId - the owning identity.
 * @param input - the configuration to store.
 * @returns the stored connection.
 */
async save(ownerId: string, input: ConnectionInput): Promise<FaberLoomConnection>

/**
 * Remove one connection.
 * @param ownerId - the owning identity.
 * @param id - connection id.
 * @returns true when it existed.
 */
async remove(ownerId: string, id: string): Promise<boolean>

/**
 * Check one connection for real: an IMAP login, or a writable backup destination.
 * @param ownerId - the owning identity.
 * @param id - connection id.
 * @returns the probe outcome.
 */
async probe(ownerId: string, id: string): Promise<ConnectionProbe>

/**
 * Read one of the owner's mailbox credentials.
 *
 * This is the only accessor that returns a stored secret, and it exists for
 * the inbound receiver, which has to log in to the owner's mailbox. The
 * browser never sees it: the panel reads {@link list}, which omits the secret.
 * @param ownerId - the owning identity.
 * @param id - a specific connection, or undefined for the first IMAP one.
 * @returns the credentials, or undefined when the owner has no usable mailbox.
 */
async imap(ownerId: string, id?: string): Promise<ImapCredentials | undefined>
```

Source: [`packages/faberloom/connections/src/index.ts`](../../packages/faberloom/connections/src/index.ts)

<a id="ctxfaberloomdefaults--faberloomdefaults"></a>

### `ctx.faberloomDefaults` — `FaberLoomDefaults`

FaberLoom's own default agents and routines for one owner.

```ts cordis-catalog
/**
 * Seed the catalogue once for this owner.
 *
 * A pass is a no-op when the identity is read-only, when it has no owner, or
 * when the marker exists. Items are matched by name, so a retry after a
 * partial pass never duplicates what already landed.
 * @returns what the pass created.
 */
async seed(): Promise<SeedReport>
```

Source: [`packages/faberloom/defaults/src/index.ts`](../../packages/faberloom/defaults/src/index.ts)

<a id="ctxfaberloomexecutions--faberloomexecutions"></a>

### `ctx.faberloomExecutions` — `FaberLoomExecutions`

The persistent driver over the routines engine.

```ts cordis-catalog
/**
 * Run one pass. Acquires the engine's dispatcher lock first, so an overlapping
 * pass — a timer tick during a manual call, or the same owner served twice —
 * reports `another pass is running` instead of starting work twice.
 * @param now - the instant this pass considers current.
 * @returns what the pass did.
 */
async runOnce(now: Date = new Date()): Promise<DispatchReport>
```

Source: [`packages/faberloom/execution/src/index.ts`](../../packages/faberloom/execution/src/index.ts)

<a id="ctxfaberloomhandlers--faberloomhandlers"></a>

### `ctx.faberloomHandlers` — `FaberLoomHandlers`

Step handler registry owned by the FaberLoom product layer.

Source: [`packages/faberloom/handlers/src/index.ts`](../../packages/faberloom/handlers/src/index.ts)

<a id="ctxfaberloominbound--faberloominbound"></a>

### `ctx.faberloomInbound` — `FaberLoomInbound`

The owner's mailbox as a source of routine events.

```ts cordis-catalog
/**
 * Poll the owner's mailbox once.
 * @param now - the instant this pass considers current.
 * @returns what the pass read and started.
 */
async runOnce(now: Date = new Date()): Promise<InboundReport>
```

Source: [`packages/faberloom/inbound/src/index.ts`](../../packages/faberloom/inbound/src/index.ts)

<a id="ctxfaberloommcpserver--faberloommcpserver"></a>

### `ctx.faberloomMcpServer` — `FaberLoomMcpServer`

FaberLoom's server face for other agents.

```ts cordis-catalog
/**
 * Mint one bearer token for a client the owner names.
 * @param label - who the token is for.
 * @param scopes - tool names the client may call, or null for the full surface.
 * @returns the token, which is only shown here.
 */
async mintToken(label: string, scopes: readonly string[] | null = null): Promise<FaberLoomMcpToken>

/**
 * List the tokens this owner minted, revoked ones included.
 * @returns the token rows.
 */
async listTokens(): Promise<readonly FaberLoomMcpToken[]>

/**
 * Revoke one token so its client stops working.
 * @param token - the token to revoke.
 * @returns whether a live token was revoked.
 */
async revokeToken(token: string): Promise<boolean>
```

Source: [`packages/faberloom/mcp-server/src/index.ts`](../../packages/faberloom/mcp-server/src/index.ts)

<a id="ctxfaberloommemory--faberloommemory"></a>

### `ctx.faberloomMemory` — `FaberLoomMemory`

The product memory service: versioned teachings, contextual performance, late errors, and portable knowledge.

```ts cordis-catalog
/**
 * Record one teaching. An explicit instruction (`active: true`) is remembered
 * active; an inferred one stays a candidate.
 * @param ownerId - the owning identity.
 * @param input - scope, text, source, and scoping.
 * @returns the created teaching.
 */
async createTeaching(ownerId: string, input: TeachingInput): Promise<FaberLoomTeaching>

/**
 * Edit one teaching, producing a new version and preserving the previous as
 * superseded history.
 * @param ownerId - the acting identity.
 * @param id - teaching id.
 * @param input - new text, reason, and author.
 * @returns the updated teaching.
 */
async editTeaching(ownerId: string, id: FaberLoomTeachingId, input: TeachingEditInput): Promise<FaberLoomTeaching>

/**
 * Revoke one teaching: it disappears from new decisions and its history stays.
 * @param ownerId - the acting identity.
 * @param id - teaching id.
 * @returns the revoked teaching.
 */
async revokeTeaching(ownerId: string, id: FaberLoomTeachingId): Promise<FaberLoomTeaching>

/**
 * Read one teaching.
 * @param id - teaching id.
 * @returns the teaching.
 */
async getTeaching(id: FaberLoomTeachingId): Promise<FaberLoomTeaching>

/**
 * List teachings including history, optionally filtered.
 * @param ownerId - the owning identity.
 * @param filter - optional scope filters.
 * @returns the teachings, oldest first.
 */
async listTeachings(ownerId: string, filter: Pick<TeachingFilter, 'scope' | 'spaceId' | 'agentId' | 'skill' | 'task'> = {}): Promise<FaberLoomTeaching[]>

/**
 * List every stored version of one teaching.
 * @param ownerId - the owning identity.
 * @param id - teaching id.
 * @returns superseded versions plus the current one.
 */
async listVersions(ownerId: string, id: FaberLoomTeachingId): Promise<FaberLoomTeaching[]>

/**
 * Recover the active teachings that apply to a context, and record the use
 * when a case reference is supplied.
 * @param ownerId - the owning identity.
 * @param filter - scope filters and optional case reference.
 * @returns the recovered teachings, current version only.
 */
async retrieve(ownerId: string, filter: TeachingFilter = {}): Promise<FaberLoomTeaching[]>

/**
 * Record one contextual outcome.
 * @param ownerId - the owning identity.
 * @param input - task, outcome, and cause.
 * @returns nothing.
 */
async recordPerformance(ownerId: string, input: PerformanceInput): Promise<void>

/**
 * Aggregate contextual performance. Correction causes are separated so a
 * requirement change is never counted as an agent failure.
 * @param ownerId - the owning identity.
 * @param filter - optional agent, task, and space filters.
 * @returns the summary.
 */
async performance(ownerId: string, filter: { agentId?: string; task?: string; spaceId?: string } = {}): Promise<PerformanceSummary>

/**
 * Record a late error. When it targets a teaching, the teaching gets a new
 * version carrying the correction; the original history stays.
 * @param ownerId - the owning identity.
 * @param input - case reference, detail, optional teaching, author.
 * @returns the updated teaching when one was corrected.
 */
async recordLateError(ownerId: string, input: LateErrorInput): Promise<FaberLoomTeaching | undefined>

/**
 * Export a portable knowledge snapshot; credentials are never included.
 * @param ownerId - the owning identity.
 * @returns the snapshot of teachings, performance, and late errors.
 */
async exportKnowledge(ownerId: string): Promise<KnowledgeSnapshot>

/**
 * Restore a knowledge snapshot for one owner, keeping versions and statuses.
 * @param ownerId - the destination identity.
 * @param snapshot - the snapshot to import.
 * @returns how many records were restored.
 */
async importKnowledge( ownerId: string, snapshot: KnowledgeSnapshot, ): Promise<{ teachings: number; performance: number; lateErrors: number }>
```

Source: [`packages/faberloom/learning/src/index.ts`](../../packages/faberloom/learning/src/index.ts)

<a id="ctxfaberloomroutines--faberloomroutines"></a>

### `ctx.faberloomRoutines` — `FaberLoomRoutines`

The product routines service: versioned definitions, validated activation, persistent executions, dispatcher, effects ledger, sources, and migration.

```ts cordis-catalog
/**
 * Register one step handler.
 * @param name - handler name referenced by steps.
 * @param handler - the sync or async handler.
 * @returns the disposer removing the handler.
 */
registerHandler(name: string, handler: StepHandler): () => void

/**
 * List registered handler names.
 * @returns the names.
 */
listHandlers(): string[]

/**
 * Create one routine as version 1 in draft.
 * @param ownerId - the owning identity.
 * @param input - name and definition.
 * @returns the created routine.
 */
async createRoutine(ownerId: string, input: RoutineInput): Promise<FaberLoomRoutine>

/**
 * Read one routine.
 * @param id - routine id.
 * @returns the routine.
 */
async getRoutine(id: FaberLoomRoutineId): Promise<FaberLoomRoutine>

/**
 * List one owner's routines, oldest first.
 * @param ownerId - the owning identity.
 * @returns the routines.
 */
async listRoutines(ownerId: string): Promise<FaberLoomRoutine[]>

/**
 * Edit a routine, producing a new version. Executions keep their starting version.
 * @param ownerId - the acting identity.
 * @param id - routine id.
 * @param input - the new name and definition.
 * @returns the updated routine.
 */
async updateRoutine(ownerId: string, id: FaberLoomRoutineId, input: RoutineInput): Promise<FaberLoomRoutine>

/**
 * Remove one routine and the versions stored for it.
 *
 * Executions and the effect ledger are the run's history and stay: only the
 * definition leaves, so a case that already ran keeps its record.
 * @param ownerId - the acting identity.
 * @param id - routine id.
 * @returns whether a routine was removed.
 */
async removeRoutine(ownerId: string, id: FaberLoomRoutineId): Promise<boolean>

/**
 * Move every execution whose wait passed its deadline to review.
 *
 * A wait that nobody answers is not a success and not a crash: the case needs
 * a person, so the waiting step is marked failed with `WAIT_TIMEOUT` and the
 * execution keeps its history for the panel. The dispatcher calls this on each
 * pass; calling it by hand is safe, because an execution already past its
 * deadline is the only thing it touches.
 * @param now - the instant this pass considers current.
 * @returns the execution ids it moved.
 */
async expireWaits(now: Date = new Date()): Promise<FaberLoomExecutionId[]>

/**
 * Read one stored routine version.
 * @param id - routine id.
 * @param version - version number.
 * @returns the definition.
 */
async getRoutineVersion(id: FaberLoomRoutineId, version: number): Promise<RoutineDefinition>

/**
 * Count executions that started with a given routine version.
 * @param id - routine id.
 * @param version - routine version.
 * @returns the execution count.
 */
async countExecutionsAtVersion(id: FaberLoomRoutineId, version: number): Promise<number>

/**
 * Validate and activate a routine. Missing handlers, missing dependencies, or
 * cycles refuse activation with the exact problems.
 * @param ownerId - the acting identity.
 * @param id - routine id.
 * @returns the activated routine.
 */
async activateRoutine(ownerId: string, id: FaberLoomRoutineId): Promise<FaberLoomRoutine>

/**
 * Pause a routine; running executions keep going.
 * @param ownerId - the acting identity.
 * @param id - routine id.
 * @returns the paused routine.
 */
async pauseRoutine(ownerId: string, id: FaberLoomRoutineId): Promise<FaberLoomRoutine>

/**
 * Start one execution, deduping by idempotency key: a repeated key appends the
 * new channel's evidence to the same case instead of starting another.
 * @param request - routine, idempotency key, channel, input, and event.
 * @returns the execution and whether it was deduped.
 */
async startExecution(request: StartExecutionRequest): Promise<StartExecutionResult>

/**
 * Deliver events to waiting executions.
 * @param request - events and the current instant.
 * @returns the resumed execution ids.
 */
async tick(request: TickRequest): Promise<TickResult>

/**
 * Read one execution.
 * @param id - execution id.
 * @returns the execution.
 */
async getExecution(id: FaberLoomExecutionId): Promise<Execution>

/**
 * List executions, optionally filtered by routine and status.
 * @param filter - optional routine and status filters.
 * @returns executions oldest first.
 */
async listExecutions(filter: { routineId?: FaberLoomRoutineId; status?: ExecutionStatus } = {}): Promise<Execution[]>

/**
 * Reconcile an execution whose effect stayed pending after a write.
 * @param id - execution id.
 * @returns the reconciled execution.
 */
async reconcile(id: FaberLoomExecutionId): Promise<Execution>

/**
 * Mark one pending effect as cancelled, so an obsolete draft is not applied.
 * @param id - execution id.
 * @param stepId - the step owning the effect.
 * @returns true when the effect existed and was pending.
 */
async cancelEffect(id: FaberLoomExecutionId, stepId: string): Promise<boolean>

/**
 * Plan a migration from the execution's version to a target version.
 * @param id - execution id.
 * @param toVersion - target routine version.
 * @returns the preserved and added steps.
 */
async previewMigration(id: FaberLoomExecutionId, toVersion: number): Promise<MigrationPlan>

/**
 * Migrate one execution to a target version, preserving completed steps and
 * running the added ones.
 * @param id - execution id.
 * @param toVersion - target routine version.
 * @returns the migrated execution.
 */
async migrate(id: FaberLoomExecutionId, toVersion: number): Promise<Execution>

/**
 * Register one per-user event source.
 * @param ownerId - the owning identity.
 * @param kind - source kind.
 * @param label - display label.
 * @returns the source with its token.
 */
async registerSource(ownerId: string, kind: 'email' | 'webhook', label: string): Promise<EventSource>

/**
 * List one owner's event sources.
 * @param ownerId - the owning identity.
 * @returns the sources.
 */
async listSources(ownerId: string): Promise<EventSource[]>

/**
 * Remove one event source.
 * @param ownerId - the acting identity.
 * @param id - source id.
 * @returns true when it existed.
 */
async removeSource(ownerId: string, id: string): Promise<boolean>

/**
 * Ingest one event for its owner: every matching active routine starts or
 * dedupes to its case.
 * @param ownerId - the owning identity the event belongs to.
 * @param event - the event.
 * @returns the executions started or deduped.
 */
async ingest(ownerId: string, event: IngestEvent): Promise<StartExecutionResult[]>

/**
 * Ingest one event through a source token.
 * @param token - the source token.
 * @param event - the event.
 * @returns the executions started or deduped.
 * @throws when the token matches no source.
 */
async ingestForToken(token: string, event: IngestEvent): Promise<StartExecutionResult[]>

/**
 * Acquire the dispatcher lock for this process.
 * @returns true when the caller now holds it.
 */
acquireLock(): boolean

/** Release the dispatcher lock. */
releaseLock(): void
```

Source: [`packages/faberloom/routines/src/index.ts`](../../packages/faberloom/routines/src/index.ts)

<a id="ctxfaberloomspaces--faberloomspaces"></a>

### `ctx.faberloomSpaces` — `FaberLoomSpaces`

The product spaces service. It owns the durable space records, the effective context resolution, the personal scope, the opaque work-directory references, and console-role access control; every operation carries the authenticated actor.

```ts cordis-catalog
/**
 * Create one space scoped to the actor's company, under an optional parent
 * the actor controls.
 * @param actor - the acting identity.
 * @param input - title and optional parent.
 * @returns the created space.
 */
async create(actor: SpaceActor, input: CreateSpaceInput): Promise<FaberLoomSpace>

/**
 * List the spaces the actor may read, oldest first.
 * @param actor - the acting identity.
 * @returns the readable spaces.
 */
async list(actor: SpaceActor): Promise<FaberLoomSpace[]>

/**
 * Read one space the actor may see.
 * @param actor - the acting identity.
 * @param id - space id.
 * @returns the space.
 * @throws when the space is absent or not readable.
 */
async get(actor: SpaceActor, id: FaberLoomSpaceId): Promise<FaberLoomSpace>

/**
 * Apply a mutable patch to one space the actor may manage.
 * @param actor - the acting identity.
 * @param id - space id.
 * @param patch - fields to change.
 * @returns the updated space.
 */
async update(actor: SpaceActor, id: FaberLoomSpaceId, patch: UpdateSpaceInput): Promise<FaberLoomSpace>

/**
 * Archive one space the actor may manage; the record is kept, out of the active list.
 * @param actor - the acting identity.
 * @param id - space id.
 * @returns the archived space.
 */
async archive(actor: SpaceActor, id: FaberLoomSpaceId): Promise<FaberLoomSpace>

/**
 * The isolated personal scope of one identity, used when no space is assigned.
 * @param ownerId - the owning identity.
 * @returns the personal scope descriptor (never a shared space).
 */
personalScope(ownerId: string): PersonalScope

/**
 * Resolve an opaque working-directory reference for one space; never a path.
 * @param actor - the acting identity.
 * @param id - space id.
 * @returns the opaque reference.
 */
async resolveWorkdir(actor: SpaceActor, id: FaberLoomSpaceId): Promise<WorkdirReference>

/**
 * Preview audience and material before linking private work to one space.
 * @param actor - the acting identity.
 * @param id - space id.
 * @returns identities that would gain visibility and the context keys shared.
 */
async previewLink(actor: SpaceActor, id: FaberLoomSpaceId): Promise<LinkPreview>

/**
 * Resolve the effective context of one space: the space's own context plus,
 * when it inherits, its ancestors' context, minus explicit exclusions, with
 * unresolved key conflicts surfaced instead of silently prioritized.
 * @param actor - the acting identity.
 * @param id - space id.
 * @returns resolved values, conflicts, contributing sources, and exclusions.
 */
async effectiveContext(actor: SpaceActor, id: FaberLoomSpaceId): Promise<EffectiveContext>

/**
 * Attach one file to a space the actor may manage. Bytes are stored inline
 * for this slice, capped at {@link MAX_FILE_BYTES}.
 * @param actor - the acting identity.
 * @param spaceId - the target space.
 * @param input - file name, media type, and base64 bytes.
 * @returns the stored file metadata.
 */
async attachFile(actor: SpaceActor, spaceId: FaberLoomSpaceId, input: SpaceFileInput): Promise<SpaceFile>

/**
 * List the files attached to one space the actor may read.
 * @param actor - the acting identity.
 * @param spaceId - the target space.
 * @returns file metadata, oldest first.
 */
async listFiles(actor: SpaceActor, spaceId: FaberLoomSpaceId): Promise<SpaceFile[]>

/**
 * Read one attached file, bytes included, when the actor may read its space.
 * @param actor - the acting identity.
 * @param fileId - the file id.
 * @returns the file with its base64 bytes.
 */
async readFile(actor: SpaceActor, fileId: string): Promise<SpaceFileContent>
```

Source: [`packages/faberloom/spaces/src/index.ts`](../../packages/faberloom/spaces/src/index.ts)

<a id="ctxfaberloomview--faberloomviewservice"></a>

### `ctx.faberloomView` — `FaberLoomViewService`

Workspace view (`ctx.faberloomView`) over the mounted product services and the agent-memory core. Reads and writes both return the fresh overview so the panels refresh from one value instead of recomputing.

```ts cordis-catalog
/**
 * Read the signed-in owner's workspace rows for the global panels.
 * @returns spaces, agents, board items, routines, and memory rows as plain JSON.
 */
@Remote('overview') async overview(): Promise<FaberLoomOverview>

/**
 * Create a root space for the owner.
 * @param title - display title.
 * @returns the refreshed overview.
 */
@Remote('createSpace') async createSpace(title: string): Promise<FaberLoomOverview>

/**
 * Rename one of the owner's spaces.
 * @param id - space id.
 * @param title - new display title.
 * @returns the refreshed overview.
 */
@Remote('renameSpace') async renameSpace(id: string, title: string): Promise<FaberLoomOverview>

/**
 * Create an agent in the catalog.
 * @param name - display name.
 * @param responsibility - the agent's responsibility statement.
 * @returns the refreshed overview.
 */
@Remote('createAgent') async createAgent(name: string, responsibility: string): Promise<FaberLoomOverview>

/**
 * Rename one catalog agent.
 * @param id - agent id.
 * @param name - new display name.
 * @returns the refreshed overview.
 */
@Remote('renameAgent') async renameAgent(id: string, name: string): Promise<FaberLoomOverview>

/**
 * Deactivate one catalog agent.
 * @param id - agent id.
 * @returns the refreshed overview.
 */
@Remote('deleteAgent') async deleteAgent(id: string): Promise<FaberLoomOverview>

/**
 * Read one agent with its full editable configuration.
 * @param id - agent id.
 * @returns the agent detail, or undefined when it no longer exists.
 */
@Remote('agentDetail') async agentDetail(id: string): Promise<FaberLoomAgentDetail | undefined>

/**
 * Save an agent's editable configuration.
 * @param id - agent id.
 * @param input - name, responsibility, skills, and the optional model policy.
 * @returns the refreshed overview.
 */
@Remote('saveAgent') async saveAgent(id: string, input: AgentSaveInput): Promise<FaberLoomOverview>

/**
 * Remove one agent from the catalog permanently.
 * @param id - agent id.
 * @returns the refreshed overview.
 */
@Remote('purgeAgent') async purgeAgent(id: string): Promise<FaberLoomOverview>

/**
 * List the skills available to this owner: the role catalog plus the owner's
 * own uploaded skills, each marked with the agents that already use it.
 * @returns the skill rows.
 */
@Remote('skills') async skills(): Promise<readonly FaberLoomSkillRow[]>

/**
 * Add or replace one skill from Markdown content the user uploaded.
 * @param name - skill name (its directory).
 * @param markdown - full SKILL.md content.
 * @returns the refreshed skill list.
 */
@Remote('saveSkill') async saveSkill(name: string, markdown: string): Promise<readonly FaberLoomSkillRow[]>

/**
 * Remove one owner-uploaded skill. Role-catalog skills cannot be removed.
 * @param name - skill name.
 * @returns the refreshed skill list.
 */
@Remote('removeSkill') async removeSkill(name: string): Promise<readonly FaberLoomSkillRow[]>

/**
 * List the owner's own connections (IMAP mailbox, knowledge backup).
 * @returns the stored connections, without the secrets.
 */
@Remote('connections') async connections(): Promise<readonly FaberLoomConnection[]>

/**
 * Create or replace one of the owner's connections.
 * @param input - the configuration to store; an omitted secret keeps the stored one.
 * @returns the refreshed connection list.
 */
@Remote('saveConnection') async saveConnection(input: ConnectionInput): Promise<readonly FaberLoomConnection[]>

/**
 * Remove one of the owner's connections.
 * @param id - connection id.
 * @returns the refreshed connection list.
 */
@Remote('removeConnection') async removeConnection(id: string): Promise<readonly FaberLoomConnection[]>

/**
 * Check one of the owner's connections for real (IMAP login or writable destination).
 * @param id - connection id.
 * @returns the probe outcome.
 */
@Remote('probeConnection') async probeConnection(id: string): Promise<ConnectionProbe>

/**
 * List the owner's knowledge backups, newest first.
 * @returns one row per captured snapshot.
 */
@Remote('backups') async backups(): Promise<readonly FaberLoomBackupRow[]>

/**
 * Capture a new knowledge backup and return the refreshed list.
 * @param note - optional operator note stored with the snapshot.
 * @returns the refreshed backup list.
 */
@Remote('createBackup') async createBackup(note?: string): Promise<readonly FaberLoomBackupRow[]>

/**
 * Verify one backup's integrity.
 * @param id - backup id.
 * @returns the verdict the panel shows.
 */
@Remote('verifyBackup') async verifyBackup(id: string): Promise<FaberLoomBackupVerify>

/**
 * Restore one backup into the open domains; a dry run counts without writing.
 * @param id - backup id.
 * @param dryRun - true to preview, false to write.
 * @returns the restore result the panel shows.
 */
@Remote('restoreBackup') async restoreBackup(id: string, dryRun: boolean): Promise<FaberLoomBackupRestore>

/**
 * Delete one backup record.
 * @param id - backup id.
 * @returns the refreshed backup list.
 */
@Remote('deleteBackup') async deleteBackup(id: string): Promise<readonly FaberLoomBackupRow[]>

/**
 * Build an editable proposal from a fresh request (pantallas §2). It keeps the
 * origin text, suggests catalog agents, and never creates anything by itself.
 * @param text - what the user wants to resolve.
 * @returns the proposal the panel renders.
 */
@Remote('proposeWork') async proposeWork(text: string): Promise<FaberLoomWorkProposal>

/**
 * Create a board item from a proposal, preserving the conversation as evidence.
 * @param text - the request that originated the task.
 * @param spaceId - space the work belongs to, or null for the personal scope.
 * @returns the refreshed overview.
 */
@Remote('createTaskFromWork') async createTaskFromWork(text: string, spaceId: string | null): Promise<FaberLoomOverview>

/**
 * Create a specialist from a proposal, preserving the conversation as its
 * origin and never copying another client's context (plan §6.5, F33–F35).
 * @param text - the responsibility the conversation described.
 * @param name - display name for the specialist.
 * @param spaceId - space it belongs to, or null for the personal scope.
 * @returns the refreshed overview.
 */
@Remote('createAgentFromWork') async createAgentFromWork(text: string, name: string, spaceId: string | null): Promise<FaberLoomOverview>

/**
 * Create a routine draft from a proposal; it starts inactive until activated.
 * @param text - the procedure the conversation described.
 * @param name - display name for the routine.
 * @returns the refreshed overview.
 */
@Remote('createRoutineFromWork') async createRoutineFromWork(text: string, name: string): Promise<FaberLoomOverview>

/**
 * Preview the audience and material that would change before linking work to a
 * space (F41); the user confirms before anything becomes visible.
 * @param spaceId - the candidate space.
 * @returns the preview the panel shows.
 */
@Remote('linkPreview') async linkPreview(spaceId: string): Promise<FaberLoomLinkPreview>

/**
 * Read one space with its editable configuration.
 * @param id - space id.
 * @returns the space detail, or undefined when it is gone.
 */
@Remote('spaceDetail') async spaceDetail(id: string): Promise<FaberLoomSpaceDetail | undefined>

/**
 * Save one space's editable configuration.
 * @param id - space id.
 * @param input - title, inheritance, and members.
 * @returns the refreshed overview.
 */
@Remote('saveSpace') async saveSpace(id: string, input: SpaceSaveInput): Promise<FaberLoomOverview>

/**
 * List the model pool the panels assign from.
 * @returns one row per registered model.
 */
@Remote('models') async models(): Promise<readonly FaberLoomModelRow[]>

/**
 * Ask the recommender which model suits one agent's work.
 * @param agentId - the agent the recommendation is for.
 * @param task - optional task label used to weight evidence.
 * @returns the recommendation, or undefined when the agent is gone.
 */
@Remote('recommendModel') async recommendModel(agentId: string, task?: string): Promise<FaberLoomModelRecommendation | undefined>

/**
 * List the owner's versioned teachings, optionally filtered.
 * @param spaceId - filter by owning space id.
 * @param agentId - filter by owning agent id.
 * @param task - filter by task label.
 * @returns one row per teaching.
 */
@Remote('teachings') async teachings(spaceId?: string, agentId?: string, task?: string): Promise<readonly FaberLoomTeachingRow[]>

/**
 * Record one teaching: a correction from a case, or a direct instruction.
 * @param input - scope, text, source, and the optional scoping.
 * @returns the refreshed teaching list.
 */
@Remote('saveTeaching') async saveTeaching(input: TeachingSaveInput): Promise<readonly FaberLoomTeachingRow[]>

/**
 * Edit one teaching, producing a new version and keeping the previous one.
 * @param id - teaching id.
 * @param text - the new text.
 * @param reason - why it changed.
 * @returns the refreshed teaching list.
 */
@Remote('editTeaching') async editTeaching(id: string, text: string, reason: string): Promise<readonly FaberLoomTeachingRow[]>

/**
 * Revoke one teaching so no later decision recovers it.
 * @param id - teaching id.
 * @returns the refreshed teaching list.
 */
@Remote('revokeTeaching') async revokeTeaching(id: string): Promise<readonly FaberLoomTeachingRow[]>

/**
 * List the MCP client tokens this owner minted.
 * @returns the token rows, revoked ones included.
 */
@Remote('mcpTokens') async mcpTokens(): Promise<readonly FaberLoomMcpTokenRow[]>

/**
 * Mint one MCP client token for an external agent.
 * @param input - who the token is for and the tools it may use.
 * @returns the refreshed token list.
 */
@Remote('mintMcpToken') async mintMcpToken(input: McpTokenInput): Promise<readonly FaberLoomMcpTokenRow[]>

/**
 * Revoke one MCP client token.
 * @param token - the token to revoke.
 * @returns the refreshed token list.
 */
@Remote('revokeMcpToken') async revokeMcpToken(token: string): Promise<readonly FaberLoomMcpTokenRow[]>

/**
 * Read the owner's contextual performance evidence.
 * @param agentId - optional agent filter.
 * @param task - optional task filter.
 * @returns the evidence summary, with an absent sample reported as null.
 */
@Remote('performance') async performance(agentId?: string, task?: string): Promise<FaberLoomPerformanceRow>

/**
 * List the owner's autonomy grants, revoked ones included.
 * @returns the grant rows.
 */
@Remote('grants') async grants(): Promise<readonly FaberLoomGrantRow[]>

/**
 * Grant one action, scoped to an agent and context the caller states.
 * @param input - the action and its optional scope.
 * @returns the refreshed grant list.
 */
@Remote('grant') async grant(input: GrantSaveInput): Promise<readonly FaberLoomGrantRow[]>

/**
 * Revoke one grant, stopping the next effect that depended on it.
 * @param id - grant id.
 * @returns the refreshed grant list.
 */
@Remote('revokeGrant') async revokeGrant(id: string): Promise<readonly FaberLoomGrantRow[]>

/**
 * Read one routine with its full editable definition.
 * @param id - routine id.
 * @returns the routine detail, or undefined when it is gone.
 */
@Remote('routineDetail') async routineDetail(id: string): Promise<FaberLoomRoutineDetail | undefined>

/**
 * Save one routine's editable definition as a new version.
 * @param id - routine id.
 * @param input - the fields to replace; absent fields keep the current value.
 * @returns the refreshed overview.
 */
@Remote('saveRoutine') async saveRoutine(id: string, input: RoutineSaveInput): Promise<FaberLoomOverview>

/**
 * Remove one routine definition. Its executions stay as the run's history.
 * @param id - routine id.
 * @returns the refreshed overview.
 */
@Remote('removeRoutine') async removeRoutine(id: string): Promise<FaberLoomOverview>

/**
 * List the owner's executions, optionally only one routine's.
 * @param routineId - routine id, or undefined for every routine.
 * @returns execution rows oldest first.
 */
@Remote('executions') async executions(routineId?: string): Promise<readonly FaberLoomExecutionRow[]>

/**
 * Start a manual run of one active routine.
 * @param routineId - routine to run.
 * @returns the refreshed executions of that routine.
 */
@Remote('startRoutine') async startRoutine(routineId: string): Promise<readonly FaberLoomExecutionRow[]>

/**
 * Advance every runnable step of the owner's executions.
 * @param routineId - routine whose panel is asking; the tick itself is global to the owner.
 * @returns the refreshed executions of that routine.
 */
@Remote('tickRoutine') async tickRoutine(routineId: string): Promise<readonly FaberLoomExecutionRow[]>

/**
 * Reconcile one execution whose effect stayed pending after a write.
 * @param id - execution id.
 * @returns the refreshed executions of its routine.
 */
@Remote('reconcileExecution') async reconcileExecution(id: string): Promise<readonly FaberLoomExecutionRow[]>

/**
 * Cancel the recorded effect of one step so the run can be retried.
 * @param id - execution id.
 * @param stepId - step whose effect to cancel.
 * @returns the refreshed executions of its routine.
 */
@Remote('cancelExecutionEffect') async cancelExecutionEffect(id: string, stepId: string): Promise<readonly FaberLoomExecutionRow[]>

/**
 * Read one board item with its review state.
 * @param id - board item id.
 * @returns the board detail, or undefined when it is gone.
 */
@Remote('boardDetail') async boardDetail(id: string): Promise<FaberLoomBoardDetail | undefined>

/**
 * Replace one catalog agent's responsibility.
 * @param id - agent id.
 * @param responsibility - the new responsibility statement.
 * @returns the refreshed overview.
 */
@Remote('setAgentResponsibility') async setAgentResponsibility(id: string, responsibility: string): Promise<FaberLoomOverview>

/**
 * Create one board item awaiting review.
 * @param title - display title; it also carries the prepared result summary.
 * @returns the refreshed overview.
 */
@Remote('createBoardItem') async createBoardItem(title: string): Promise<FaberLoomOverview>

/**
 * Approve or reject the current revision of one board item.
 * @param id - board item id.
 * @param approve - true approves, false rejects.
 * @returns the refreshed overview.
 */
@Remote('reviewBoardItem') async reviewBoardItem(id: string, approve: boolean): Promise<FaberLoomOverview>

/**
 * Reopen one reviewed board item so it can be corrected.
 * @param id - board item id.
 * @returns the refreshed overview.
 */
@Remote('reopenBoardItem') async reopenBoardItem(id: string): Promise<FaberLoomOverview>

/**
 * Create one draft routine the owner can then activate.
 * @param name - display name.
 * @param intent - the procedure the routine performs.
 * @returns the refreshed overview.
 */
@Remote('createRoutine') async createRoutine(name: string, intent: string): Promise<FaberLoomOverview>

/**
 * Activate or pause one routine.
 * @param id - routine id.
 * @param active - true activates, false pauses.
 * @returns the refreshed overview.
 */
@Remote('setRoutineActive') async setRoutineActive(id: string, active: boolean): Promise<FaberLoomOverview>

/**
 * Record one owner statement on the agent-memory server. The server distils
 * L0 into L1 asynchronously, so the new row may appear after the next read.
 * @param text - the statement to remember.
 * @returns the refreshed overview.
 */
@Remote('remember') async remember(text: string): Promise<FaberLoomOverview>
```

Source: [`packages/faberloom/view/src/index.ts`](../../packages/faberloom/view/src/index.ts)
<!-- END GENERATED cordis-surface -->
