# Native product modules

English | [中文](faberloom.zh.md)

The native product modules extend this DeepSeek Harness build with thematic spaces, agent catalogs with model policy, declarative routines, persistent execution, memory, elective autonomy, and knowledge backup. Each module is a host-side Cordis service under [`packages/faberloom`](../../packages/faberloom/README.md); tools, settings, and durable records arrive on later slices.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
registerExecutableTool(name: string, handler: (args: unknown) => unknown): () => void

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
 * Aggregate the user's recorded spend, grouped by effective model, agent, and
 * task. A selection recorded without a cost makes the summary partial rather
 * than contributing zero; the currency is reported only when the models behind
 * the selections agree on one.
 * @param filter - optional agent, task, and inclusive lower time bound.
 * @returns totals, shared currency, and the three groupings.
 */
async costs(filter: { agentId?: FaberLoomAgentId; task?: string; since?: string } = {}): Promise<CostSummary>

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
 * Permanently remove one item from the work table, regardless of status.
 * @param ownerId - the acting identity.
 * @param id - item id.
 * @returns whether the item existed and was removed.
 */
async remove(ownerId: string, id: FaberLoomBoardItemId): Promise<boolean>

/**
 * Link the item to the routine that will run it, or unlink it with `null`.
 * @param ownerId - the acting identity.
 * @param id - item id.
 * @param routineId - routine id to attach, or null to detach.
 * @returns the updated item.
 */
async setRoutine(ownerId: string, id: FaberLoomBoardItemId, routineId: string | null): Promise<FaberLoomBoardItem>

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
 * Read the auto-send policy for one owner (and space, when scoped).
 * @param ownerId - the owning identity.
 * @param spaceId - the space, or null for the owner-wide policy.
 * @returns the policy, defaulting to disabled with a threshold of three.
 */
async emailPolicy(ownerId: string, spaceId: string | null = null): Promise<EmailAutoPolicy>

/**
 * Save the auto-send policy, preserving the accumulated clean-send count.
 * @param ownerId - the owning identity.
 * @param input - the policy fields.
 * @returns the stored policy.
 */
async saveEmailPolicy(ownerId: string, input: EmailAutoPolicyInput): Promise<EmailAutoPolicy>

/**
 * List one owner's email drafts, newest first.
 * @param ownerId - the owning identity.
 * @returns the drafts.
 */
async listDrafts(ownerId: string): Promise<FaberLoomEmailDraft[]>

/**
 * Create or replace one email draft.
 * @param ownerId - the owning identity.
 * @param input - the draft fields.
 * @returns the stored draft.
 */
async saveDraft(ownerId: string, input: EmailDraftInput): Promise<FaberLoomEmailDraft>

/**
 * Remove one draft the owner may discard.
 * @param ownerId - the owning identity.
 * @param id - the draft id.
 * @returns true when a record was removed.
 */
async removeDraft(ownerId: string, id: string): Promise<boolean>

/**
 * Send one draft through the owner's SMTP connection and mark it sent.
 * @param ownerId - the owning identity.
 * @param id - the draft id.
 * @returns the sent draft.
 * @throws when the draft is absent, already settled, or the send fails.
 */
async sendDraft(ownerId: string, id: string): Promise<FaberLoomEmailDraft>

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
 * Check one connection for real: an IMAP or SMTP login, or a writable backup destination.
 * @param ownerId - the owning identity.
 * @param id - connection id.
 * @returns the probe outcome.
 */
async probe(ownerId: string, id: string): Promise<ConnectionProbe>

/**
 * Read one of the owner's outgoing-server credentials.
 *
 * Like {@link imap}, this accessor returns a stored secret and exists for
 * host-side consumers that send mail as the owner; the browser never sees it.
 * @param ownerId - the owning identity.
 * @param id - a specific connection, or undefined for the primary SMTP row
 *   (the owner's flagged one, otherwise the first complete row).
 * @returns the credentials, or undefined when the owner has no usable server.
 */
async smtp(ownerId: string, id?: string): Promise<SmtpCredentials | undefined>

/**
 * Deliver one message through the owner's outgoing server.
 * @param ownerId - the owning identity.
 * @param mail - the message to send.
 * @param connectionId - a specific SMTP connection, or undefined for the
 *   primary (or first complete) one.
 * @returns the generated `Message-ID` and the accepted recipients.
 */
async sendMail(ownerId: string, mail: OutgoingMail, connectionId?: string): Promise<SentMail>

/**
 * Read one of the owner's mailbox credentials.
 *
 * This is the only accessor that returns a stored secret, and it exists for
 * the inbound receiver, which has to log in to the owner's mailbox. The
 * browser never sees it: the panel reads {@link list}, which omits the secret.
 * @param ownerId - the owning identity.
 * @param id - a specific connection, or undefined for the primary mailbox
 *   (the owner's flagged one, otherwise the first complete row).
 * @returns the credentials, or undefined when the owner has no usable mailbox.
 */
async imap(ownerId: string, id?: string): Promise<ImapCredentials | undefined>
```

Source: [`packages/faberloom/connections/src/index.ts`](../../packages/faberloom/connections/src/index.ts)

<a id="ctxfaberloomcontext--faberloomcontext"></a>

### `ctx.faberloomContext` — `FaberLoomContext`

The Workspace/Space Context service: versioned entries with an owner approval gate and console transport.

```ts cordis-catalog
/**
 * Create one context entry.
 * @param actor - the acting identity.
 * @param input - title, body, and optional Space.
 * @returns the created entry.
 */
async create(actor: FaberLoomContextActor, input: FaberLoomContextInput): Promise<FaberLoomContextEntry>

/**
 * List every context entry the actor may see, newest first.
 * @param actor - the acting identity.
 * @returns the visible entries.
 */
async list(actor: FaberLoomContextActor): Promise<readonly FaberLoomContextEntry[]>

/**
 * Read one entry.
 * @param actor - the acting identity.
 * @param id - entry id.
 * @returns the entry.
 */
async get(actor: FaberLoomContextActor, id: string): Promise<FaberLoomContextEntry>

/**
 * Edit one entry, appending a version. A member's edit returns the entry to
 * `pending` until the owner approves it again.
 * @param actor - the acting identity.
 * @param id - entry id.
 * @param edit - the new title and/or body.
 * @returns the updated entry.
 */
async update(actor: FaberLoomContextActor, id: string, edit: FaberLoomContextEdit): Promise<FaberLoomContextEntry>

/**
 * List one entry's version history, newest first.
 * @param actor - the acting identity.
 * @param id - entry id.
 * @returns the versions.
 */
async versions(actor: FaberLoomContextActor, id: string): Promise<readonly FaberLoomContextVersion[]>

/**
 * Restore one entry to an earlier version, appending a fresh version.
 * @param actor - the acting identity.
 * @param id - entry id.
 * @param version - version to restore.
 * @returns the restored entry.
 */
async restore(actor: FaberLoomContextActor, id: string, version: number): Promise<FaberLoomContextEntry>

/**
 * Index one entry into the Space's shared context (owner only).
 * @param actor - the acting identity.
 * @param id - entry id.
 * @returns the approved entry.
 */
async approve(actor: FaberLoomContextActor, id: string): Promise<FaberLoomContextEntry>

/**
 * Keep one entry private to its author, out of the shared context (owner only).
 * @param actor - the acting identity.
 * @param id - entry id.
 * @returns the entry.
 */
async reject(actor: FaberLoomContextActor, id: string): Promise<FaberLoomContextEntry>

/**
 * Remove one entry and its history (author or owner).
 * @param actor - the acting identity.
 * @param id - entry id.
 * @returns true when removed.
 */
async remove(actor: FaberLoomContextActor, id: string): Promise<boolean>

/**
 * Import the console's shared context for one owner and prune the imported
 * rows the console no longer carries. Each imported row lands `pending` so the
 * owner decides whether to index it. A no-op when the console is not wired.
 * @param readerId - the Space owner importing its members' context.
 */
async sync(readerId: string): Promise<void>
```

Source: [`packages/faberloom/context/src/index.ts`](../../packages/faberloom/context/src/index.ts)

<a id="ctxfaberloomdefaults--faberloomdefaults"></a>

### `ctx.faberloomDefaults` — `FaberLoomDefaults`

FaberLoom's own default agents and routines for one owner.

```ts cordis-catalog
/**
 * Seed the catalogue once for this owner.
 *
 * A pass seeds the deployment's shared agents for every identity, and the
 * owner's plan agents once (no-op while the marker exists). A read-only
 * identity still receives the shared agents but no plan agents or routines.
 * Items are matched by name, so a retry after a partial pass never duplicates
 * what already landed.
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

/**
 * The dispatcher's liveness: one row per routine plus aggregate counters.
 * @returns the health snapshot.
 */
async health(): Promise<FaberLoomHealth>
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

/**
 * List the owner's mailbox envelopes, newest first, without mutating the
 * mailbox. Read-only: never marks, moves, or deletes mail.
 * @param ownerId - the owning identity.
 * @param limit - most envelopes to return.
 * @returns the envelopes, or an empty list when no mailbox is configured.
 */
async listInbox(ownerId: string, limit?: number): Promise<ImapMessage[]>

/**
 * Read one mailbox message's body, read-only.
 * @param ownerId - the owning identity.
 * @param uid - the message UID.
 * @returns the decoded body, or null when no mailbox is configured or the message has no body.
 */
async readEmail(ownerId: string, uid: number): Promise<ImapMessageContent>

/**
 * Mark one message as read (`\Seen`). Unlike the poller this writes to the
 * mailbox, so it runs only for an explicit user gesture.
 * @param ownerId - the owning identity.
 * @param uid - the message UID.
 * @returns true when the mailbox accepted the flag update, false without a mailbox.
 */
async markSeen(ownerId: string, uid: number): Promise<boolean>

/**
 * Move one message to the Trash mailbox, trying the configured name and then
 * the built-in candidates. Writes to the mailbox on an explicit gesture only.
 * @param ownerId - the owning identity.
 * @param uid - the message UID.
 * @returns the mailbox the message moved to.
 * @throws when every candidate mailbox rejects the move.
 */
async moveToTrash(ownerId: string, uid: number): Promise<string>

/**
 * Search the owner's mailbox envelopes from the chat, newest first.
 *
 * Read-only like the poller: it neither advances the receiver's cursor nor
 * touches the mailbox flags, so searching never hides mail from the triggers.
 * @param ownerId - the owning identity.
 * @param query - text to look for; empty returns the newest envelopes.
 * @param limit - most envelopes returned.
 * @param connectionId - a specific IMAP connection, or undefined for the
 *   primary mailbox.
 * @returns the matching envelopes.
 */
async searchMailbox(ownerId: string, query: string, limit: number = 10, connectionId?: string): Promise<readonly ImapMessage[]>
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
 * Register a listener the engine calls when an execution reaches review
 * (a failed step, a missing handler, or an expired wait), so a deployment can
 * dead-letter it and alert the owner.
 * @param listener - the callback.
 * @returns the disposer removing the listener.
 */
registerReviewListener(listener: (review: ExecutionReview) => void): () => void

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

<a id="ctxfaberloomsessionshares--faberloomsessionshares"></a>

### `ctx.faberloomSessionShares` — `FaberLoomSessionShares`

The shared Session catalog: durable, per-Space, and console-synced.

```ts cordis-catalog
/**
 * Capture one local Session into its Space: store its portable log and publish
 * it to the console when one is configured.
 * @param actor - the acting identity, which must own the Session.
 * @param input - Space, Session identity, title, and canonical log text.
 * @returns the captured row.
 */
async capture(actor: FaberLoomSessionActor, input: FaberLoomSharedSessionCapture): Promise<FaberLoomSharedSession>

/**
 * List one Space's shared Sessions, newest first. The actor must be able to
 * view the Space.
 * @param actor - the acting identity.
 * @param spaceId - the Space being listed.
 * @returns the rows, without content.
 */
async list(actor: FaberLoomSessionActor, spaceId: string): Promise<readonly FaberLoomSharedSession[]>

/**
 * Read one shared Session's content.
 * @param actor - the acting identity.
 * @param spaceId - the Space the Session is shared in.
 * @param ownerId - the member whose host holds the Session.
 * @param sessionId - the Session id.
 * @returns the row with its content.
 */
async content(actor: FaberLoomSessionActor, spaceId: string, ownerId: string, sessionId: string): Promise<FaberLoomSharedSessionContent>

/**
 * Remove one captured Session the actor owns, or any Session when the actor
 * owns the Space.
 * @param actor - the acting identity.
 * @param spaceId - the Space the Session is shared in.
 * @param ownerId - the member whose host holds the Session.
 * @param sessionId - the Session id.
 * @returns true when a row was removed.
 */
async remove(actor: FaberLoomSessionActor, spaceId: string, ownerId: string, sessionId: string): Promise<boolean>

/**
 * Import the console's shared Sessions for one member and prune the local
 * copies the console no longer carries, so a revoked share stops showing.
 * A no-op when the console is not configured.
 * @param readerId - the identity whose incoming Sessions are imported.
 */
async sync(readerId: string): Promise<void>
```

Source: [`packages/faberloom/session-shares/src/index.ts`](../../packages/faberloom/session-shares/src/index.ts)

<a id="ctxfaberloomshares--faberloomshares"></a>

### `ctx.faberloomShares` — `FaberLoomShares`

The product sharing service: durable per-action grants with console transport and email acceptance.

```ts cordis-catalog
/**
 * Create one share grant, notify the grantee by email, and publish it to the
 * console when one is configured. The grant starts `pending`; only an
 * accepted (`active`) grant authorizes an action.
 * @param ownerId - the identity granting access.
 * @param input - resource, resource name, grantee email, and permissions.
 * @returns the created grant.
 * @throws when the grantee email is empty.
 */
async create(ownerId: string, input: FaberLoomShareInput): Promise<FaberLoomShareGrant>

/**
 * Accept one pending grant addressed to the grantee; a pending grant becomes
 * active and its permissions start authorizing actions.
 * @param granteeEmail - the identity accepting.
 * @param id - grant id.
 * @returns the accepted grant.
 * @throws when the grant is missing or not addressed to the grantee.
 */
async accept(granteeEmail: string, id: string): Promise<FaberLoomShareGrant>

/**
 * Revoke one grant the actor issued; the next permission check denies it and
 * the console mirror is removed.
 * @param ownerId - the identity that granted access.
 * @param id - grant id.
 * @returns the revoked grant.
 * @throws when the grant is missing or the actor did not issue it.
 */
async revoke(ownerId: string, id: string): Promise<FaberLoomShareGrant>

/**
 * List the grants the actor issued and the ones addressed to it.
 * @param actorId - the acting identity (owner or grantee email).
 * @returns the outgoing and incoming grants, oldest first.
 */
async list(actorId: string): Promise<FaberLoomShareList>

/**
 * The portable snapshot attached to one grant the actor holds, so a consumer
 * can materialize the shared resource without a second console read.
 * @param granteeEmail - the identity that holds the grant.
 * @param grantId - grant id (the id `list` returned for the incoming grant).
 * @returns the resource snapshot, or null when the actor holds no such grant.
 */
async snapshotFor(granteeEmail: string, grantId: string): Promise<Record<string, unknown> | null>

/**
 * Replace the portable snapshot the console holds for one of the actor's
 * Space/Work Flow grants, so a grantee's next sync reads the current content.
 * The grant lifecycle and permissions are untouched. A no-op when the console
 * is not configured, so a local-only deployment keeps working.
 * @param input - resource, display name, and the current snapshot.
 */
async republish(input: FaberLoomShareRepublishInput): Promise<void>

/**
 * List the permissions one grantee holds on one resource, unioned over every
 * active grant.
 * @param granteeEmail - the identity acting.
 * @param resource - the resource being touched.
 * @returns the active permissions, in display order.
 */
async permissionsFor(granteeEmail: string, resource: FaberLoomShareResource): Promise<readonly FaberLoomSharePermission[]>

/**
 * Whether one grantee may perform one action on one resource. The owner is
 * always allowed; a grantee needs an active grant carrying the permission.
 * @param actorId - the acting identity.
 * @param ownerId - the resource owner.
 * @param resource - the resource being touched.
 * @param permission - the action being authorized.
 * @returns true when the action is authorized.
 */
async can(actorId: string, ownerId: string, resource: FaberLoomShareResource, permission: FaberLoomSharePermission): Promise<boolean>

/**
 * Import the grants the console holds for one grantee and prune the local
 * copies the console no longer carries, so a revoked share stops authorizing
 * here. A no-op when the console is not configured.
 * @param granteeEmail - the identity whose incoming grants are imported.
 */
async sync(granteeEmail: string): Promise<void>

/**
 * Publish one Space's own Memory/Context/Work Flow/Routine items to the
 * console as this member's full set, so the other members read them, and keep
 * the durable owner rows current. The console write replaces the author's set
 * for the Space, so an item dropped here stops reaching the other members.
 * @param actorId - the publishing identity.
 * @param spaceId - the Space the items belong to.
 * @param items - the member's current items for the Space.
 */
async publishContent(actorId: string, spaceId: string, items: readonly FaberLoomSharedContentInput[]): Promise<void>

/**
 * List the shared-content items one Space carries for one member: the
 * member's own items and the ones imported for it from the console.
 * @param actorId - the member reading.
 * @param spaceId - the Space being read.
 * @returns the rows.
 */
async listContent(actorId: string, spaceId: string): Promise<readonly FaberLoomSharedContentRow[]>

/**
 * The logical keys other members published in one Space and this member
 * imported. A member excludes them when publishing, so an imported copy is
 * never echoed back as its own.
 * @param actorId - the member reading.
 * @param spaceId - the Space being read.
 * @returns the imported `kind\itemKey` keys.
 */
async importedContentKeys(actorId: string, spaceId: string): Promise<ReadonlySet<string>>

/**
 * The ids of the local copies this member materialized for the items other
 * members shared, across every Space. A panel marks those rows read-only, so
 * a member cannot delete content the author still owns.
 * @param actorId - the member reading.
 * @returns the imported local copy ids.
 */
async importedLocalIds(actorId: string): Promise<ReadonlySet<string>>

/**
 * Record the id of the local copy a member materialized for one imported
 * console row, so a later sync removes the copy when its author withdraws the
 * item. A missing row is ignored.
 * @param readerId - the member that materialized the copy.
 * @param consoleId - the console-side row id.
 * @param localId - the id of the local copy.
 */
async noteContentLocal(readerId: string, consoleId: string, localId: string): Promise<void>

/**
 * Import the console's shared-content rows for one member and prune the local
 * rows the console no longer carries, so a withdrawn item stops showing. A
 * no-op when the console is not configured. The reader reads back the removed
 * rows (with their `localId`) before this runs, so it can delete the
 * materialized copies.
 * @param readerId - the identity whose incoming items are imported.
 */
async syncContent(readerId: string): Promise<void>
```

Source: [`packages/faberloom/shares/src/index.ts`](../../packages/faberloom/shares/src/index.ts)

<a id="ctxfaberloomspaces--faberloomspaces"></a>

### `ctx.faberloomSpaces` — `FaberLoomSpaces`

The product spaces service. It owns the durable space records, the effective context resolution, the personal scope, the opaque work-directory references, and console-role access control; every operation carries the authenticated actor.

```ts cordis-catalog
/**
 * Create one space owned by the actor, scoped to its company, under an
 * optional parent the actor controls. Every identity may create its own
 * space, including a console read-only role.
 * @param actor - the acting identity.
 * @param input - title and optional parent.
 * @returns the created space.
 */
async create(actor: SpaceActor, input: CreateSpaceInput): Promise<FaberLoomSpace>

/**
 * Materialize a Space another identity shared, under the remote id so the
 * imported record resolves the same `view`/`manage-members` grants. Idempotent:
 * an existing record is returned untouched, so a repeated sync never clobbers
 * the member's own state. The record is owned by the publisher, so the member
 * can never manage or delete it, and it is never a sub-space of a local parent.
 * @param input - remote id, publisher email, title, and the shared context.
 * @returns the imported (or already present) space.
 */
async importShared(input: ImportSharedSpaceInput): Promise<FaberLoomSpace>

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
 * Remove one space the actor may manage, together with every file attached to
 * it. Deletion is permanent: the caller removes the space's conversation area.
 * @param actor - the acting identity.
 * @param id - space id.
 * @returns `true` when the stored record was deleted.
 * @throws when the space is absent or not manageable.
 */
async remove(actor: SpaceActor, id: FaberLoomSpaceId): Promise<boolean>

/**
 * Attach one memory entry to one or more spaces the actor may read. A
 * sub-space with inheritance on later reads its ancestors' entries too.
 * @param actor - the acting identity.
 * @param text - the remembered text.
 * @param spaceIds - the spaces the entry is attached to.
 * @param sessionId - the Session that captured the entry, when it came from one.
 * @returns the created entry.
 */
async remember( actor: SpaceActor, text: string, spaceIds: readonly FaberLoomSpaceId[], sessionId?: string, ): Promise<FaberLoomSpaceMemory>

/**
 * Delete every memory entry the actor captured from one Session, so deleting
 * a Session also removes the facts it left behind and the shared-content
 * catalog can propagate the removal to every member.
 * @param actor - the acting identity.
 * @param sessionId - the Session whose captured entries are removed.
 * @returns the removed entry count.
 */
async forgetMemoryBySession(actor: SpaceActor, sessionId: string): Promise<number>

/**
 * Delete one memory entry the actor owns. Deleting a space deliberately does
 * not go through here: removing a space keeps its memory, which retains the
 * space id as the recorded origin of a space that no longer exists.
 * @param actor - the acting identity.
 * @param id - memory entry id.
 * @returns whether the entry existed and was removed.
 * @throws when the entry belongs to another owner.
 */
async forgetMemory(actor: SpaceActor, id: string): Promise<boolean>

/**
 * List the actor's memory entries, optionally only those attached to one space.
 * @param actor - the acting identity.
 * @param spaceId - when set, only entries attached to this space.
 * @returns entries oldest first.
 */
async listMemory(actor: SpaceActor, spaceId?: FaberLoomSpaceId): Promise<FaberLoomSpaceMemory[]>

/**
 * Resolve the memory one space sees: its own entries plus, while inheritance
 * is on, each ancestor's entries.
 * @param actor - the acting identity.
 * @param spaceId - the space to resolve for.
 * @returns entries from the inheriting chain, oldest first.
 * @throws when the space is absent or not readable.
 */
async effectiveMemory(actor: SpaceActor, spaceId: FaberLoomSpaceId): Promise<FaberLoomSpaceMemory[]>

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
 * Rank the actor's readable spaces for a query. It ranks through
 * `ctx.spaceIndex` when a provider is mounted, otherwise through the built-in
 * lexical ranker. An empty query returns the actor's readable, non-archived
 * spaces most recently created first; archived spaces are always excluded.
 * @param actor - the acting identity.
 * @param query - free-text query; an empty query lists the recent spaces.
 * @param limit - most results to return.
 * @returns matched spaces, best score first, then most recent first.
 */
async find(actor: SpaceActor, query: string, limit: number = 10): Promise<SpaceMatch[]>

/**
 * Resolve one referenced Space into its effective context and memory, its
 * attached-file metadata, and its responsible agent and mirrored workspace.
 * @param actor - the acting identity.
 * @param id - space id.
 * @returns the resolved reference.
 * @throws when the space is absent or not readable.
 */
async reference(actor: SpaceActor, id: FaberLoomSpaceId): Promise<SpaceReference>

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
 * Read the Space connectivity map the palette and canvas consume: every
 * Space with its agent and mirrored workspace, every agent with its skills
 * and MCP access, the owner's mail connections, and the registered
 * Workspaces. Connections and Workspaces are optional, so a deployment that
 * mounts neither still gets the map.
 * @returns the connectivity map as plain JSON.
 */
@Remote('spaceMap') async spaceMap(): Promise<FaberLoomSpaceMap>

/**
 * List the owner's work flows.
 * @returns one row per flow.
 */
@Remote('workflowOverview') async workflowOverview(): Promise<readonly FaberLoomWorkflowRow[]>

/**
 * Read one work flow with its graph and validation verdict.
 * @param id - work flow id.
 * @returns the flow detail.
 */
@Remote('workflowDetail') async workflowDetail(id: string): Promise<FaberLoomWorkflowDetail>

/**
 * Create an empty work flow and return the refreshed list.
 * @param name - display name.
 * @returns the refreshed rows.
 */
@Remote('createWorkflow') async createWorkflow(name: string): Promise<readonly FaberLoomWorkflowRow[]>

/**
 * Rename one work flow and return the refreshed list.
 * @param id - work flow id.
 * @param name - new display name.
 * @returns the refreshed rows.
 */
@Remote('saveWorkflow') async saveWorkflow(id: string, name: string): Promise<readonly FaberLoomWorkflowRow[]>

/**
 * Append one node to a work flow.
 * @param id - work flow id.
 * @param kind - node kind.
 * @param title - node title.
 * @param configJson - node config as a JSON object string; empty for none.
 * @param nodeId - optional stable node id.
 * @returns the refreshed flow detail.
 */
@Remote('addNode') async addNode(id: string, kind: string, title: string, configJson: string, nodeId?: string): Promise<FaberLoomWorkflowDetail>

/**
 * Change one node's title, kind, or config.
 * @param id - work flow id.
 * @param nodeId - the node to change.
 * @param title - new title, or empty to keep it.
 * @param kind - new kind, or empty to keep it.
 * @param configJson - config JSON merged over the node, or empty to keep it.
 * @returns the refreshed flow detail.
 */
@Remote('updateNode') async updateNode(id: string, nodeId: string, title: string, kind: string, configJson: string): Promise<FaberLoomWorkflowDetail>

/**
 * Remove one node and its incident edges.
 * @param id - work flow id.
 * @param nodeId - the node to remove.
 * @returns the refreshed flow detail.
 */
@Remote('removeNode') async removeNode(id: string, nodeId: string): Promise<FaberLoomWorkflowDetail>

/**
 * Connect two nodes.
 * @param id - work flow id.
 * @param from - source node id.
 * @param to - target node id.
 * @param condition - optional branch condition.
 * @returns the refreshed flow detail.
 */
@Remote('connect') async connect(id: string, from: string, to: string, condition?: string): Promise<FaberLoomWorkflowDetail>

/**
 * Remove one edge.
 * @param id - work flow id.
 * @param edgeId - the edge to remove.
 * @returns the refreshed flow detail.
 */
@Remote('disconnect') async disconnect(id: string, edgeId: string): Promise<FaberLoomWorkflowDetail>

/**
 * Change one work flow's lifecycle.
 * @param id - work flow id.
 * @param status - `active`, `paused`, or `draft`.
 * @returns the refreshed flow detail.
 */
@Remote('setWorkflowStatus') async setWorkflowStatus(id: string, status: string): Promise<FaberLoomWorkflowDetail>

/**
 * Set or clear one work flow's concurrency cap.
 * @param id - work flow id.
 * @param maxConcurrency - the cap, or null to clear it.
 * @returns the refreshed flow detail.
 */
@Remote('setWorkflowConcurrency') async setWorkflowConcurrency(id: string, maxConcurrency: number | null): Promise<FaberLoomWorkflowDetail>

/**
 * List one work flow's executions.
 * @param id - work flow id.
 * @returns the run history rows.
 */
@Remote('workflowRuns') async workflowRuns(id: string): Promise<readonly FaberLoomWorkflowRunRow[]>

/**
 * List every routine ↔ work flow link the owner holds, in both directions:
 * a routine step with handler `workflow` invoking a flow, and the compiled
 * routine an active flow drives.
 * @returns the links, routines first.
 */
@Remote('routineWorkflowLinks') async routineWorkflowLinks(): Promise<readonly FaberLoomWorkflowLink[]>

/**
 * Mirror every shared Space's Sessions between this host and the console:
 * sync the catalog, publish this identity's own Sessions, and materialize the
 * other members'. Runs from the periodic timer and the read path, so a
 * membership change reaches the sidebar without opening a panel. Guarded
 * against overlapping passes.
 */
async mirrorSharedSpaces(): Promise<void>

/**
 * Share one Space the owner (or an admin) manages with named emails.
 * @param id - space id.
 * @param emails - the grantees.
 * @param permissions - the permission subset each grantee receives.
 * @returns the resource's outgoing grant rows.
 */
@Remote('shareSpace') async shareSpace(id: string, emails: readonly string[], permissions: readonly string[]): Promise<readonly FaberLoomShareGrantRow[]>

/**
 * Share the Space that mirrors one registered Workspace, resolving the Space
 * from the sidebar Workspace the caller addresses.
 * @param workspaceId - the Workspace whose mirrored Space is shared.
 * @param emails - the grantees.
 * @param permissions - the permission subset each grantee receives.
 * @returns the Space's outgoing grant rows.
 */
@Remote('shareSpaceByWorkspace') async shareSpaceByWorkspace( workspaceId: string, emails: readonly string[], permissions: readonly string[], ): Promise<readonly FaberLoomShareGrantRow[]>

/**
 * Share one Work Flow the owner manages — or that the actor holds `share` on —
 * with named emails.
 * @param id - work flow id.
 * @param emails - the grantees.
 * @param permissions - the permission subset each grantee receives.
 * @returns the flow's outgoing grant rows.
 */
@Remote('shareWorkflow') async shareWorkflow(id: string, emails: readonly string[], permissions: readonly string[]): Promise<readonly FaberLoomShareGrantRow[]>

/**
 * List the actor's grants on one resource.
 * @param kind - `space` or `workflow`.
 * @param id - resource id.
 * @returns the outgoing grant rows.
 */
@Remote('resourceShares') async resourceShares(kind: string, id: string): Promise<readonly FaberLoomShareGrantRow[]>

/**
 * Revoke one grant the actor issued.
 * @param grantId - grant id.
 * @returns the actor's refreshed outgoing grant rows.
 */
@Remote('revokeShareGrant') async revokeShareGrant(grantId: string): Promise<readonly FaberLoomShareGrantRow[]>

/**
 * Read the Space connectivity map for the palette and canvas.
 * @returns the connectivity map.
 */
@Remote('spaceTopology') async spaceTopology(): Promise<FaberLoomSpaceMap>

/**
 * Export one work flow as read-only Archify HTML or plain JSON.
 * @param id - work flow id.
 * @param format - `archify` or `json`.
 * @returns the export body.
 */
@Remote('exportWorkflow') async exportWorkflow(id: string, format: string): Promise<FaberLoomWorkflowExport>

/**
 * The built-in Work Flow templates the gallery lists.
 * @returns one row per template.
 */
@Remote('workflowTemplates') workflowTemplates(): Promise<readonly FaberLoomWorkflowTemplateRow[]>

/**
 * Create one work flow from a built-in template and return the refreshed list.
 * @param templateId - template id.
 * @param name - optional display name.
 * @returns the refreshed rows.
 */
@Remote('createWorkflowFromTemplate') async createWorkflowFromTemplate(templateId: string, name?: string): Promise<readonly FaberLoomWorkflowRow[]>

/**
 * Import portable Work Flow JSON as a new work flow and return the refreshed
 * list; the graph is validated before it is stored.
 * @param json - the portable JSON text.
 * @param name - optional display name.
 * @returns the refreshed rows.
 */
@Remote('importWorkflow') async importWorkflow(json: string, name?: string): Promise<readonly FaberLoomWorkflowRow[]>

/**
 * List one work flow's version history, newest first.
 * @param id - work flow id.
 * @returns the versions.
 */
@Remote('workflowVersions') async workflowVersions(id: string): Promise<readonly FaberLoomWorkflowVersionRow[]>

/**
 * Restore one work flow to an earlier version.
 * @param id - work flow id.
 * @param version - version to restore.
 * @returns the refreshed detail.
 */
@Remote('restoreWorkflow') async restoreWorkflow(id: string, version: number): Promise<FaberLoomWorkflowDetail>

/**
 * List the staged work flow revisions awaiting this owner's decision, with
 * each proposal's base and proposed graph for the diff.
 * @returns the staged revisions.
 */
@Remote('workflowPendingChanges') async workflowPendingChanges(): Promise<readonly FaberLoomWorkflowPendingRow[]>

/**
 * Accept one staged work flow revision and return the refreshed inbox.
 * @param id - work flow id.
 * @returns the staged revisions.
 */
@Remote('acceptWorkflowChange') async acceptWorkflowChange(id: string): Promise<readonly FaberLoomWorkflowPendingRow[]>

/**
 * Reject one staged work flow revision and return the refreshed inbox.
 * @param id - work flow id.
 * @returns the staged revisions.
 */
@Remote('rejectWorkflowChange') async rejectWorkflowChange(id: string): Promise<readonly FaberLoomWorkflowPendingRow[]>

/**
 * List the context entries the actor may see, newest first.
 * @returns the visible context rows.
 */
@Remote('contextEntries') async contextEntries(): Promise<readonly FaberLoomContextRow[]>

/**
 * Create one context entry, optionally attached to a Space.
 * @param title - display title.
 * @param body - context body.
 * @param spaceId - optional Space to attach it to.
 * @returns the refreshed rows.
 */
@Remote('createContext') async createContext(title: string, body: string, spaceId?: string): Promise<readonly FaberLoomContextRow[]>

/**
 * Edit one context entry, appending a version.
 * @param id - entry id.
 * @param title - new title.
 * @param body - new body.
 * @returns the refreshed rows.
 */
@Remote('updateContext') async updateContext(id: string, title: string, body: string): Promise<readonly FaberLoomContextRow[]>

/**
 * List one context entry's version history.
 * @param id - entry id.
 * @returns the versions.
 */
@Remote('contextVersions') async contextVersions(id: string): Promise<readonly FaberLoomContextVersionRow[]>

/**
 * Restore one context entry to an earlier version.
 * @param id - entry id.
 * @param version - version to restore.
 * @returns the refreshed rows.
 */
@Remote('restoreContext') async restoreContext(id: string, version: number): Promise<readonly FaberLoomContextRow[]>

/**
 * Index one context entry into its Space's shared context.
 * @param id - entry id.
 * @returns the refreshed rows.
 */
@Remote('approveContext') async approveContext(id: string): Promise<readonly FaberLoomContextRow[]>

/**
 * Keep one context entry private to its author.
 * @param id - entry id.
 * @returns the refreshed rows.
 */
@Remote('rejectContext') async rejectContext(id: string): Promise<readonly FaberLoomContextRow[]>

/**
 * Remove one context entry and its history.
 * @param id - entry id.
 * @returns the refreshed rows.
 */
@Remote('removeContext') async removeContext(id: string): Promise<readonly FaberLoomContextRow[]>

/**
 * Import the console's shared context for this owner and return the refreshed
 * entries, so a member's Space contribution shows up for approval.
 * @returns the visible context rows.
 */
@Remote('syncContext') async syncContext(): Promise<readonly FaberLoomContextRow[]>

/**
 * Capture the panel's local Sessions into one Space and return the refreshed
 * shared catalog.
 * @param spaceId - the Space to share the Sessions in.
 * @param sessions - the local Sessions the panel offers.
 * @returns the Space's shared Session rows.
 */
@Remote('captureSpaceSessions') async captureSpaceSessions( spaceId: string, sessions: readonly FaberLoomSharedSessionRef[], ): Promise<readonly FaberLoomSharedSessionRow[]>

/**
 * Sync the console's shared Sessions and list one Space's catalog.
 * @param spaceId - the Space to list.
 * @returns the Space's shared Session rows.
 */
@Remote('spaceSessions') async spaceSessions(spaceId: string): Promise<readonly FaberLoomSharedSessionRow[]>

/**
 * Read one shared Session's portable content.
 * @param spaceId - the Space the Session is shared in.
 * @param ownerId - the member whose host holds the Session.
 * @param sessionId - the Session id.
 * @returns the row with its content.
 */
@Remote('spaceSessionContent') async spaceSessionContent(spaceId: string, ownerId: string, sessionId: string): Promise<FaberLoomSharedSessionContentRow>

/**
 * Remove one shared Session (its author or the Space owner) and return the
 * refreshed catalog.
 * @param spaceId - the Space the Session is shared in.
 * @param ownerId - the member whose host holds the Session.
 * @param sessionId - the Session id.
 * @returns the Space's shared Session rows.
 */
@Remote('removeSpaceSession') async removeSpaceSession(spaceId: string, ownerId: string, sessionId: string): Promise<readonly FaberLoomSharedSessionRow[]>

/**
 * Create a space (root or sub-space) for the owner with an optional
 * responsible agent, and register its conversation area as a Workspace so
 * the sidebar and the Espacios panel show the same thing.
 * @param title - display title.
 * @param agentId - catalog agent put in charge; the same agent may lead a parent and a sub-space.
 * @param parentId - parent space id, when this is a sub-space.
 * @param inheritContext - whether the space inherits its parent's context; defaults to true.
 * @returns the refreshed overview.
 */
@Remote('createSpace') async createSpace(title: string, agentId?: string, parentId?: string, inheritContext?: boolean): Promise<FaberLoomOverview>

/**
 * Remove a space permanently: drop its Workspace registration, delete its
 * conversation directory, and delete the space record with its attached
 * files.
 * @param id - space id.
 * @returns the refreshed overview.
 */
@Remote('deleteSpace') async deleteSpace(id: string): Promise<FaberLoomOverview>

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
 * @param provider - model provider id, when set.
 * @param model - provider model id, when set.
 * @param apiKey - provider API key, when set.
 * @param webAccess - whether the agent may browse the open web.
 * @param mwtMcp - whether the agent may query the MWT.ONE MCP.
 * @param sicopMcp - whether the agent may query the SICOP MCP.
 * @param mailConnectionIds - mail connection ids the agent may use.
 * @param subagentIds - agent ids this agent may communicate with.
 * @returns the refreshed overview.
 */
@Remote('createAgent') async createAgent( name: string, responsibility: string, provider?: string, model?: string, apiKey?: string, webAccess?: boolean, mwtMcp?: boolean, sicopMcp?: boolean, mailConnectionIds?: readonly string[], subagentIds?: readonly string[], ): Promise<FaberLoomOverview>

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
 * List what the owner publishes and what others share with them.
 * @returns the share rows; unconfigured and empty when the console is not wired.
 */
@Remote('shares') async shares(): Promise<FaberLoomShares>

/**
 * Share one agent the actor manages, with named emails or with the whole
 * company. The provider API key never travels: it belongs to the owner's
 * account and is not portable.
 * @param id - agent id.
 * @param emails - exact emails to share with.
 * @param allUsers - also offer it to every user of the owner's company.
 * @returns the refreshed share rows.
 */
@Remote('shareAgent') async shareAgent(id: string, emails: readonly string[], allUsers: boolean): Promise<FaberLoomShares>

/**
 * Share one skill the owner uploaded, with named emails or with the whole
 * company. A skill someone shared with the owner is not re-shareable.
 * @param name - skill name (its directory).
 * @param emails - exact emails to share with.
 * @param allUsers - also offer it to every user of the owner's company.
 * @returns the refreshed share rows.
 */
@Remote('shareSkill') async shareSkill(name: string, emails: readonly string[], allUsers: boolean): Promise<FaberLoomShares>

/**
 * Stop sharing one resource the owner published.
 * @param shareId - console-side share id.
 * @returns the refreshed share rows.
 */
@Remote('unshareShare') async unshareShare(shareId: string): Promise<FaberLoomShares>

/**
 * Pull the resources others shared with the owner and return the refreshed
 * overview.
 * @returns the refreshed overview.
 */
@Remote('syncShared') async syncShared(): Promise<FaberLoomOverview>

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
 * List the owner's mailbox envelopes, newest first. Read-only.
 * @returns one row per envelope, or an empty list without a mailbox.
 */
@Remote('emailInbox') async emailInbox(): Promise<readonly FaberLoomInboxRow[]>

/**
 * Read one mailbox message's body, read-only.
 * @param uid - the message UID.
 * @returns the decoded body, or null.
 */
@Remote('emailRead') async emailRead(uid: string): Promise<FaberLoomEmailContent>

/**
 * Mark one mailbox message as read.
 * @param uid - the message UID.
 * @returns true when the mailbox accepted the flag update.
 */
@Remote('emailMarkSeen') async emailMarkSeen(uid: string): Promise<boolean>

/**
 * Move one mailbox message to Trash, then remember the deletion so the live
 * agent learns which mail the owner discards. A capture failure never fails
 * the move.
 * @param uid - the message UID.
 * @param sender - sender line, for the learned pattern.
 * @param subject - subject line, for the learned pattern.
 * @returns the mailbox the message moved to.
 */
@Remote('emailTrash') async emailTrash(uid: string, sender?: string, subject?: string): Promise<{ movedTo: string }>

/**
 * Read one attachment's bytes for download.
 * @param uid - the message UID.
 * @param index - the attachment index in the message.
 * @returns the attachment bytes as base64, or undefined.
 */
@Remote('emailAttachment') async emailAttachment(uid: string, index: number): Promise<FaberLoomEmailAttachmentContent | undefined>

/**
 * Turn one email into a Space: reuse the space with the same title when it
 * already exists, otherwise create it with its agent and Workspace, store the
 * email as the space's memory, and attach every file it carried.
 * @param uid - the message UID.
 * @param name - the space title (usually the subject).
 * @param agentId - the agent put in charge, when chosen and the space is new.
 * @param from - the sender line the browser already holds, for the seeded context.
 * @returns the space, its Workspace id, and the email as a first-message seed.
 */
@Remote('spaceFromEmail') async spaceFromEmail(uid: string, name: string, agentId?: string, from?: string): Promise<FaberLoomSpaceFromEmail>

/**
 * List the owner's email drafts, newest first.
 * @returns one row per draft.
 */
@Remote('emailDrafts') async emailDrafts(): Promise<readonly FaberLoomEmailDraftRow[]>

/**
 * Create or replace one email draft.
 * @param input - the draft fields.
 * @returns the stored draft.
 */
@Remote('saveEmailDraft') async saveEmailDraft(input: EmailDraftSaveInput): Promise<FaberLoomEmailDraftRow>

/**
 * Discard one email draft.
 * @param id - the draft id.
 * @returns true when a draft was removed.
 */
@Remote('deleteEmailDraft') async deleteEmailDraft(id: string): Promise<boolean>

/**
 * Send one email draft through the owner's SMTP connection. The sent text is
 * remembered as an email teaching so the owner's voice profile grows from the
 * messages they actually approved; a capture failure never fails the send.
 * @param id - the draft id.
 * @returns the sent draft.
 */
@Remote('sendEmailDraft') async sendEmailDraft(id: string): Promise<FaberLoomEmailDraftRow>

/**
 * Read the owner's email voice profile: the teachings captured from sent mail,
 * optionally resolved for one space.
 * @param spaceId - restrict to one space's teachings.
 * @returns the email teachings, oldest first.
 */
@Remote('emailVoice') async emailVoice(spaceId?: string): Promise<readonly FaberLoomTeachingRow[]>

/**
 * Draft one email with the model, in the owner's voice, and enqueue it as a
 * draft. Never sends. Uses the first mounted provider/model route.
 * @param input - recipients, subject, instruction, and optional email being answered.
 * @returns the stored draft.
 */
@Remote('emailDraftWithAi') async emailDraftWithAi(input: EmailDraftAiInput): Promise<FaberLoomEmailDraftRow>

/**
 * Answer one message in the routine-designer chat, grounded in the email and
 * the owner's space memory. Never creates anything.
 * @param uid - the message UID used as context.
 * @param messages - the chat so far.
 * @param subject - the subject, when the caller already has it.
 * @param from - the sender, when the caller already has it.
 * @returns the assistant reply.
 */
@Remote('routineChat') async routineChat(uid: string, messages: readonly FaberLoomRoutineChatMessage[], subject?: string, from?: string): Promise<string>

/**
 * Turn a described workflow into a real routine: the model returns a JSON
 * definition, which is validated and stored as a draft routine.
 * @param uid - the message UID used as context.
 * @param name - the routine name.
 * @param instruction - the workflow description.
 * @param subject - the subject, when the caller already has it.
 * @param from - the sender, when the caller already has it.
 * @returns the created routine.
 */
@Remote('routineFromEmail') async routineFromEmail( uid: string, name: string, instruction: string, subject?: string, from?: string, ): Promise<FaberLoomRoutineCreated>

/**
 * Learn the expediente facts from one email and store them as Space memory,
 * so a routine can later create or update the record without intervention.
 * @param uid - the message UID.
 * @returns the extracted facts.
 */
@Remote('learnFromEmail') async learnFromEmail(uid: string): Promise<FaberLoomEmailFacts>

/**
 * Read the owner's auto-send policy.
 * @param spaceId - the space, or absent for the owner-wide policy.
 * @returns the policy.
 */
@Remote('emailPolicy') async emailPolicy(spaceId?: string): Promise<FaberLoomEmailPolicy>

/**
 * Save the owner's auto-send policy.
 * @param input - the policy fields.
 * @returns the stored policy.
 */
@Remote('saveEmailPolicy') async saveEmailPolicy(input: EmailPolicySaveInput): Promise<FaberLoomEmailPolicy>

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
 * Read a space's conversation area: the workspace registered for its
 * workdir, if any, with its live session count. Read-only: it never creates
 * the directory nor registers the workspace.
 * @param id - space id.
 * @returns the workspace projection.
 */
@Remote('spaceWorkspace') async spaceWorkspace(id: string): Promise<FaberLoomSpaceWorkspace>

/**
 * Open a space's conversation area: create the workdir when needed, register
 * it as a workspace titled after the space, and return its id so the browser
 * can start a session in it.
 * @param id - space id.
 * @returns the registered workspace projection.
 */
@Remote('openSpaceWorkspace') async openSpaceWorkspace(id: string): Promise<FaberLoomSpaceWorkspace>

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
 * List the model providers and models the harness currently mounts, read live
 * from `ctx.llm`, so the panels offer exactly what this deployment can run and
 * new models appear as soon as the provider exposes them.
 * @returns one entry per mounted provider with its current model ids.
 */
@Remote('modelCatalog') async modelCatalog(): Promise<FaberLoomModelCatalog>

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
 * Report the owner's MWT.ONE access: identity, active company, and the
 * external MCP servers the harness is connected to as a client, with the
 * tool names each one published (grouped from the `mcp__<server>__<tool>`
 * registrations). An empty server list means the deployment mounted no MCP
 * client for this identity.
 * @returns the status the Connections panel renders.
 */
@Remote('mwtStatus') mwtStatus(): FaberLoomMwtStatus

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
 * Read the owner's recorded spend, grouped by effective model, agent, and task.
 * @param agentId - optional agent filter.
 * @param task - optional task filter.
 * @returns the spend summary the cost panel renders.
 */
@Remote('costs') async costs(agentId?: string, task?: string): Promise<FaberLoomCostSummary>

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
 * The dispatcher's liveness — last run, failures, review backlog, retries, and
 * the sooner wait deadline — per routine and in aggregate.
 * @returns the health snapshot.
 */
@Remote('executionHealth') async executionHealth(): Promise<FaberLoomHealth>

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
 * Link one board item to the routine that runs it, or unlink it.
 * @param id - board item id.
 * @param routineId - routine id to attach, or null to detach.
 * @returns the refreshed overview.
 */
@Remote('setBoardRoutine') async setBoardRoutine(id: string, routineId: string | null): Promise<FaberLoomOverview>

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
 * @param note - optional review note.
 * @returns the refreshed overview.
 */
@Remote('reviewBoardItem') async reviewBoardItem(id: string, approve: boolean, note?: string): Promise<FaberLoomOverview>

/**
 * Reopen one reviewed board item so it can be corrected.
 * @param id - board item id.
 * @returns the refreshed overview.
 */
@Remote('reopenBoardItem') async reopenBoardItem(id: string): Promise<FaberLoomOverview>

/**
 * Submit a prepared result as a new revision awaiting review.
 * @param id - board item id.
 * @param input - summary and evidence of the prepared result.
 * @returns the refreshed overview.
 */
@Remote('submitBoardRevision') async submitBoardRevision(id: string, input: BoardRevisionInput): Promise<FaberLoomOverview>

/**
 * Move a board item into an exception state: request_data, fail, or complete.
 * @param id - board item id.
 * @param action - the exception action.
 * @returns the refreshed overview.
 */
@Remote('boardException') async boardException(id: string, action: 'request_data' | 'fail' | 'complete'): Promise<FaberLoomOverview>

/**
 * Permanently remove one board item from the work table.
 * @param id - board item id.
 * @returns the refreshed overview.
 */
@Remote('deleteBoardItem') async deleteBoardItem(id: string): Promise<FaberLoomOverview>

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
 * Remember one statement, attached to a space or to no space. The entry is
 * durable and space-scoped, so a sub-space with inheritance sees it.
 * @param text - the statement to remember.
 * @param spaceId - the space to attach it to, when one is chosen.
 * @returns the refreshed overview.
 */
@Remote('remember') async remember(text: string, spaceId?: string): Promise<FaberLoomOverview>

/**
 * Read the space-scoped memory, optionally resolved for one space (own plus
 * inherited ancestors' entries).
 * @param spaceId - the space to resolve for; absent lists every entry.
 * @returns memory rows oldest first.
 */
@Remote('spaceMemory') async spaceMemory(spaceId?: string): Promise<readonly FaberLoomSpaceMemoryRow[]>

/**
 * Delete one space-memory entry the owner controls and return the refreshed
 * list. Deleting a space never deletes its memory; this is the only path that
 * removes an entry, and it is explicit.
 * @param id - memory entry id.
 * @returns the remaining memory rows, oldest first.
 */
@Remote('deleteSpaceMemory') async deleteSpaceMemory(id: string): Promise<readonly FaberLoomSpaceMemoryRow[]>
```

Source: [`packages/faberloom/view/src/index.ts`](../../packages/faberloom/view/src/index.ts)

<a id="ctxfaberloomworkflows--faberloomworkflows"></a>

### `ctx.faberloomWorkflows` — `FaberLoomWorkflows`

The work flows service. It owns the durable versioned graph records, the graph validation, and the compilation to a routine; every operation carries the authenticated actor.

```ts cordis-catalog
/**
 * Create one work flow owned by the actor. The definition is stored as given;
 * validation is explicit and activation requires a valid graph.
 * @param actor - the acting identity.
 * @param input - name, optional scope, and the initial definition.
 * @returns the created work flow.
 */
async create(actor: WorkFlowActor, input: CreateWorkFlowInput): Promise<WorkFlow>

/**
 * Materialize a Work Flow another identity shared, under the remote id so the
 * imported record resolves the same grants. Idempotent: an existing record is
 * returned untouched, so a repeated sync never clobbers the member's state.
 * The record is owned by the publisher and stays `draft`; no routine is
 * created here, so a shared flow is readable and editable per grant but does
 * not start executing on the member's host.
 * @param input - remote id, publisher email, name, scope, and shared definition.
 * @returns the imported (or already present) work flow.
 */
async importShared(input: ImportSharedWorkFlowInput): Promise<WorkFlow>

/**
 * List the actor's work flows, optionally only one scope, oldest first.
 * @param actor - the acting identity.
 * @param scope - when set, only flows in this scope.
 * @returns the actor's work flows.
 */
async list(actor: WorkFlowActor, scope?: WorkFlowScope): Promise<WorkFlow[]>

/**
 * Read one work flow the actor owns.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @returns the work flow.
 * @throws when the flow is absent or owned by another identity.
 */
async get(actor: WorkFlowActor, id: WorkFlowId): Promise<WorkFlow>

/**
 * Apply a mutable patch to one work flow the actor owns, bumping the version.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @param patch - fields to change.
 * @returns the updated work flow.
 */
async update(actor: WorkFlowActor, id: WorkFlowId, patch: UpdateWorkFlowInput): Promise<WorkFlow>

/**
 * List one work flow's version history, newest first.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @returns the versions.
 */
async versions(actor: WorkFlowActor, id: WorkFlowId): Promise<readonly WorkFlowVersionRecord[]>

/**
 * Restore one work flow to an earlier version, bumping the version and
 * reconciling an active flow's compiled routine.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @param version - the version to restore.
 * @returns the restored work flow.
 */
async restore(actor: WorkFlowActor, id: WorkFlowId, version: number): Promise<WorkFlow>

/**
 * List the staged revisions on the work flows the actor owns, newest first,
 * each with its base and proposed graph for the approval diff.
 * @param actor - the acting identity.
 * @returns the staged revisions.
 */
async pendingChanges(actor: WorkFlowActor): Promise<readonly WorkFlowPendingChange[]>

/**
 * Accept one staged revision: apply it to the live flow, bump the version,
 * reconcile an active flow's routine, and clear the stage. Owner only.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @returns the updated work flow.
 */
async acceptPending(actor: WorkFlowActor, id: WorkFlowId): Promise<WorkFlow>

/**
 * Reject one staged revision: drop it, leaving the live flow unchanged.
 * Owner only.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @returns the unchanged work flow.
 */
async rejectPending(actor: WorkFlowActor, id: WorkFlowId): Promise<WorkFlow>

/**
 * Append one node to a work flow the actor owns.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @param input - node title, kind, optional config, and optional id.
 * @returns the updated work flow.
 * @throws when the node id repeats an existing node.
 */
async addNode( actor: WorkFlowActor, id: WorkFlowId, input: { id?: string | undefined; title: string; kind: WorkFlowNodeKind; config?: Record<string, unknown> | undefined }, ): Promise<WorkFlow>

/**
 * Change one node's title, kind, or config values (merged into its config).
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @param nodeId - the node to change.
 * @param patch - fields to change; `config` merges over the node's config.
 * @returns the updated work flow.
 * @throws when the node does not exist.
 */
async updateNode( actor: WorkFlowActor, id: WorkFlowId, nodeId: WorkFlowNodeId, patch: { title?: string | undefined; kind?: WorkFlowNodeKind | undefined; config?: Record<string, unknown> | undefined }, ): Promise<WorkFlow>

/**
 * Remove one node and every edge incident to it.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @param nodeId - the node to remove.
 * @returns the updated work flow.
 * @throws when the node does not exist.
 */
async removeNode(actor: WorkFlowActor, id: WorkFlowId, nodeId: WorkFlowNodeId): Promise<WorkFlow>

/**
 * Add a directed edge between two existing nodes.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @param input - source, target, and optional branch condition.
 * @returns the updated work flow.
 * @throws when a referenced node does not exist.
 */
async connect( actor: WorkFlowActor, id: WorkFlowId, input: { from: WorkFlowNodeId; to: WorkFlowNodeId; condition?: string | undefined }, ): Promise<WorkFlow>

/**
 * Remove one edge.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @param edgeId - the edge to remove.
 * @returns the updated work flow.
 * @throws when the edge does not exist.
 */
async disconnect(actor: WorkFlowActor, id: WorkFlowId, edgeId: WorkFlowEdgeId): Promise<WorkFlow>

/**
 * Replace the flow's trigger with one new trigger node of the given kind,
 * dropping edges that referenced the removed triggers.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @param input - trigger kind and optional config.
 * @returns the updated work flow.
 * @throws when the kind is not a trigger kind.
 */
async setTrigger( actor: WorkFlowActor, id: WorkFlowId, input: { kind: WorkFlowNodeKind; config?: Record<string, unknown> | undefined }, ): Promise<WorkFlow>

/**
 * Change one work flow's lifecycle. Activating validates the graph and
 * resolves the compiled routine id; an invalid graph is refused.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @param status - the new status.
 * @returns the updated work flow.
 * @throws when the graph is invalid and the target status is `active`.
 */
async setStatus(actor: WorkFlowActor, id: WorkFlowId, status: WorkFlowStatus): Promise<WorkFlow>

/**
 * Set or clear one work flow's concurrency cap, recompiling an active flow so
 * the dispatcher sees the new limit.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @param maxConcurrency - the cap, or null to clear it.
 * @returns the updated work flow.
 */
async setConcurrency(actor: WorkFlowActor, id: WorkFlowId, maxConcurrency: number | null): Promise<WorkFlow>

/**
 * Validate one work flow's graph without mutating it.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @returns the verdict.
 */
async validate(actor: WorkFlowActor, id: WorkFlowId): Promise<WorkFlowValidation>

/**
 * Compile one work flow to a routine definition without mutating it.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @returns the routine definition input.
 */
async compile(actor: WorkFlowActor, id: WorkFlowId): Promise<RoutineDefinitionInput>

/**
 * The built-in templates a user can start from.
 * @returns the template catalog, in gallery order.
 */
templates(): readonly WorkFlowTemplate[]

/**
 * Create one owned work flow from a built-in template.
 * @param actor - the acting identity.
 * @param templateId - the template id.
 * @param name - optional display name; the template's name is used otherwise.
 * @returns the created work flow.
 * @throws when the template id is unknown.
 */
async createFromTemplate(actor: WorkFlowActor, templateId: string, name?: string): Promise<WorkFlow>

/**
 * Export one work flow as portable JSON the gallery, the knowledge hub, and
 * another deployment can import.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @returns the JSON text.
 */
async exportFlow(actor: WorkFlowActor, id: WorkFlowId): Promise<string>

/**
 * Import portable Work Flow JSON as a new owned work flow; the graph is
 * validated before it is stored.
 * @param actor - the acting identity.
 * @param json - the JSON text.
 * @param name - optional display name overriding the export's.
 * @returns the created work flow.
 * @throws when the JSON is malformed, mislabelled, or its graph is invalid.
 */
async importFlow(actor: WorkFlowActor, json: string, name?: string): Promise<WorkFlow>

/**
 * Remove one work flow the actor owns.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @returns whether the stored record was deleted.
 */
async remove(actor: WorkFlowActor, id: WorkFlowId): Promise<boolean>

/**
 * Start one manual execution of an active work flow.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @returns the started execution id and whether the engine deduped it.
 * @throws when the flow has no activated routine.
 */
async runNow(actor: WorkFlowActor, id: WorkFlowId): Promise<{ executionId: string; deduped: boolean }>

/**
 * Start one run of an active work flow on behalf of a collaborator — a
 * routine step that invokes this flow — deduping by the caller's key.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @param request - the caller's idempotency key.
 * @returns the started execution id and whether the engine deduped it.
 * @throws when the flow has no activated routine.
 */
async invoke( actor: WorkFlowActor, id: WorkFlowId, request: { idempotencyKey: string }, ): Promise<{ executionId: string; deduped: boolean }>

/**
 * List one work flow's executions, oldest first.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @returns the executions, or an empty list when the flow has no routine.
 */
async runs(actor: WorkFlowActor, id: WorkFlowId): Promise<readonly Execution[]>
```

Source: [`packages/faberloom/workflows/src/index.ts`](../../packages/faberloom/workflows/src/index.ts)

<a id="ctxspaceindex--spaceindex"></a>

### `ctx.spaceIndex` — `SpaceIndex`

Pluggable ranker over the spaces an actor may read. The built-in lexical ranker is the default provider; an embeddings or knowledge-hub provider may replace it without changing the spaces service.

```ts cordis-catalog
/**
 * Rank one query over the actor's readable entries.
 * @param entries - readable, non-archived candidate entries.
 * @param query - free-text query; an empty query lists recent spaces.
 * @param limit - most matches to return.
 * @returns matches, best score first, then most recent first.
 */
rank(entries: readonly SpaceIndexEntry[], query: string, limit: number): Promise<SpaceMatch[]>
```

Source: [`packages/faberloom/spaces/src/types.ts`](../../packages/faberloom/spaces/src/types.ts)
<!-- END GENERATED cordis-surface -->
