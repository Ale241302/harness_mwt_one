# 原生产品模块

[English](faberloom.md) | 中文

原生产品模块为本 DeepSeek Harness 构建扩展主题空间、带模型策略的代理目录、声明式例程、持久化执行、记忆、选择性自主与知识备份。每个模块都是 [`packages/faberloom`](../../packages/faberloom/README.zh.md) 下的主机 Cordis 服务；工具、设置与持久化记录在后续切片加入。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxfaberloomaccess--faberloomaccess"></a>

### `ctx.faberloomAccess` — `FaberLoomAccess`

The product access service: action-scoped, revocable autonomy grants plus the tenant signatures protected action types require before approval.

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

/**
 * Issue one CEO signature for the acting identity's tenant.
 *
 * Only a configured `signingAuthorities` identity may sign; with none
 * configured, issuance refuses (`SIGNATURE_AUTHORITY_UNCONFIGURED`) instead of
 * letting any actor sign. The signature is repeatable: it authorizes every
 * approval of a covered action type until it expires or is revoked, and issuing
 * it does not mark it used.
 * @param actor - the authenticated signer, which also supplies the tenant.
 * @param input - covered action types or a wildcard, and an optional expiry.
 * @param options - instant the signature is dated; defaults to now.
 * @returns the stored signature.
 */
async issueSignature( actor: SignatureActor, input: SignatureInput, options: SignatureCheckOptions = {}, ): Promise<FaberLoomSignature>

/**
 * Revoke one signature of the acting identity's tenant. The next check refuses
 * from this instant and the record keeps the revoking identity and instant. The
 * signer may always revoke their own signature; `revocationAuthorities` adds
 * others. Revoking an already-revoked signature returns it unchanged and keeps
 * the first revocation.
 * @param actor - the acting identity.
 * @param id - signature id.
 * @param options - instant of revocation; defaults to now.
 * @returns the revoked signature.
 */
async revokeSignature( actor: SignatureActor, id: FaberLoomSignatureId, options: SignatureCheckOptions = {}, ): Promise<FaberLoomSignature>

/**
 * Require an active CEO signature before approving a protected action type.
 *
 * Refuses, never warns: a protected action type with no active signature throws
 * `SIGNATURE_REQUIRED`, a revoked one `SIGNATURE_REVOKED`, an expired one
 * `SIGNATURE_EXPIRED` — all as {@link FaberLoomAccessRefusal}, the family the
 * other access refusals use. Signatures of another tenant are never consulted.
 * The accepted signature stays valid for further approvals (§7.4 states no
 * single use); callers must not consume or mutate it.
 * @param actor - the approving identity; its `companyId` is the tenant.
 * @param actionType - the action type the approval would run.
 * @param options - instant the check evaluates; defaults to now.
 * @returns the accepted signature, or `null` when the action type is unprotected.
 */
async requireSignature( actor: SignatureActor, actionType: string, options: SignatureCheckOptions = {}, ): Promise<FaberLoomSignature | null>

/**
 * Report whether the acting identity's tenant holds a signature for one action
 * type, so a panel or tool can show the state before approval. The signer
 * identity appears only to the signer or to `signerIdentityAudience`; another
 * tenant's signature is never visible.
 * @param actor - the reading identity; its `companyId` is the tenant.
 * @param actionType - the action type to report.
 * @param options - instant the state evaluates; defaults to now.
 * @returns the signature state for this reader.
 */
async signatureStatus( actor: SignatureActor, actionType: string, options: SignatureCheckOptions = {}, ): Promise<SignatureStatus>
```

Source: [`packages/faberloom/access/src/index.ts`](../../packages/faberloom/access/src/index.ts)

<a id="ctxfaberloomagentplane--faberloomagentplane"></a>

### `ctx.faberloomAgentPlane` — `FaberLoomAgentPlane`

The agent capability plane service: resolves one agent's enforced tool mask and its delegation allowlist.

```ts cordis-catalog
/**
 * Resolve one catalog agent's enforced plane. A source the agent may not use
 * denies exactly the registered tool names that source publishes; a source
 * the agent may use, or a source with no registered names, contributes no
 * mask. The mask is omitted entirely when nothing is denied, so a caller
 * never passes an empty-restriction no-op.
 * @param agent - the catalog agent whose capabilities are enforced.
 * @param sources - the registered tool names grouped by source.
 * @returns the agent's persona, tool mask, model route, key reference, and skills.
 */
resolve(agent: FaberLoomAgent, sources: AgentToolSources): AgentPlane

/**
 * Whether one agent may consult another. An empty allowlist means the agent
 * is unrestricted; a non-empty allowlist authorizes only its listed agent
 * ids.
 * @param agent - the consulting agent.
 * @param targetAgentId - the catalog agent id the agent wants to consult.
 * @returns `true` when the consultation is authorized.
 */
allowsSubagent(agent: FaberLoomAgent, targetAgentId: string): boolean
```

Source: [`packages/faberloom/agent-plane/src/index.ts`](../../packages/faberloom/agent-plane/src/index.ts)

<a id="ctxfaberloomagentruntime--faberloomagentruntime"></a>

### `ctx.faberloomAgentRuntime` — `FaberLoomAgentRuntime`

The agent runtime service: durable consultations between caller sessions and Space agents.

```ts cordis-catalog
/**
 * Record one consultation, replacing the caller's earlier child for the same
 * Space and preserving its creation instant.
 * @param ownerId - the identity the consultation belongs to.
 * @param input - the Space, caller session, child, and label.
 * @returns the recorded consultation.
 */
async record(ownerId: string, input: AgentConsultationInput): Promise<AgentConsultation>

/**
 * Read the consultation one caller session holds with one Space.
 * @param ownerId - the identity the consultation belongs to.
 * @param spaceId - the consulted Space.
 * @param callerSessionId - the caller session.
 * @returns the consultation, or `undefined`.
 */
async consultation(ownerId: string, spaceId: string, callerSessionId: string): Promise<AgentConsultation | undefined>

/**
 * List every consultation a Space holds for one owner, newest first.
 * @param ownerId - the identity the consultations belong to.
 * @param spaceId - the Space whose consultations are read.
 * @returns the consultations.
 */
async listForSpace(ownerId: string, spaceId: string): Promise<readonly AgentConsultation[]>

/**
 * Remove one consultation.
 * @param ownerId - the identity the consultation belongs to.
 * @param spaceId - the consulted Space.
 * @param callerSessionId - the caller session.
 * @returns true when a consultation was removed.
 */
async remove(ownerId: string, spaceId: string, callerSessionId: string): Promise<boolean>
```

Source: [`packages/faberloom/agent-runtime/src/index.ts`](../../packages/faberloom/agent-runtime/src/index.ts)

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
 * Reconcile the model pool with the models one provider currently serves.
 * Discovery runs through `ctx.faberloomModelCatalog`, which resolves the named
 * credential reference through the credentials seam, per call and like the
 * catalog itself. Every discovered model becomes a pool entry: an unlisted id
 * is created, an already-registered one is refreshed from the provider's
 * fields, and a pool entry of this provider that discovery no longer lists is
 * marked unavailable rather than deleted, so a recorded selection never points
 * at a missing row. A models response carries no rates, so a refreshed entry
 * keeps its recorded rate and a created entry starts with an unknown cost.
 * @param providerId - the provider whose served models to reconcile.
 * @param credentialRef - the credential reference discovery authenticates with.
 * @returns how many entries this call created, refreshed, and marked unavailable.
 * @throws Error when no model catalog is mounted; the catalog's own errors
 * otherwise (unknown provider, unresolvable credential, transport, or rejection).
 */
async reconcileModels(providerId: string, credentialRef: CredentialRef): Promise<ModelReconciliation>

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
 * Apply a patch to one agent, bumping its version. A key the patch omits
 * stays as it was; `null` or an empty string clears it.
 * @param id - agent id.
 * @param patch - fields to change.
 * @returns the updated agent.
 */
async updateAgent(id: FaberLoomAgentId, patch: AgentPatch): Promise<FaberLoomAgent>

/**
 * Duplicate one agent: copies configuration and explicitly selected lessons,
 * never the source's evidence (confidence is not transferred) and never its
 * key — a credential is not readable, so the copy starts without one.
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

Types: [CredentialRef](credentials.zh.md)

Source: [`packages/faberloom/agents/src/index.ts`](../../packages/faberloom/agents/src/index.ts)

<a id="ctxfaberloomautonomy--faberloomautonomy"></a>

### `ctx.faberloomAutonomy` — `FaberLoomAutonomy`

The autonomy service: the level of every unit, the promotion report, the sample of delegated items, and the automatic suspension of §7.3.

```ts cordis-catalog
/**
 * Register one unit at `SHADOW` if it has none, and return it otherwise.
 * Registration is idempotent and records no level change.
 * @param actor - identity supplying the tenant.
 * @param ref - tenant, space, agent, and action type of the unit.
 * @returns the stored unit.
 */
async ensureUnit(actor: AutonomyActor, ref: AutonomyUnitRef): Promise<AutonomyUnit>

/**
 * Read one unit. Another tenant's unit is refused before the store is read.
 * @param actor - reading identity and its tenant.
 * @param ref - unit to read.
 * @returns the unit, or `undefined` when it is not registered.
 */
async getUnit(actor: AutonomyActor, ref: AutonomyUnitRef): Promise<AutonomyUnit | undefined>

/**
 * List the units of the actor's tenant, optionally filtered. Units of other
 * tenants are never read.
 * @param actor - reading identity and its tenant.
 * @param filter - space, agent, action type, and level to keep.
 * @returns the units, ordered by space, agent, and action type.
 */
async listUnits(actor: AutonomyActor, filter: AutonomyUnitFilter = {}): Promise<AutonomyUnit[]>

/**
 * Report the numbers of one unit without changing its level. The report
 * states whether the signed thresholds are met and which values are still
 * unsigned; it never promotes (W-53).
 * @param actor - reading identity and its tenant.
 * @param ref - unit to report.
 * @param options - period to evaluate instead of the configured one.
 * @returns the numbers, the eligibility, and the last suspension.
 */
async report( actor: AutonomyActor, ref: AutonomyUnitRef, options: AutonomyReportOptions = {}, ): Promise<AutonomyUnitReport>

/**
 * Apply the monitoring rule of §7.3 to one unit: while it is `DELEGADO`, a
 * reversal-or-failure rate above the configured threshold returns it to
 * `SUPERVISADO` with an audit entry. The decision needs no human command;
 * the caller that records delegated outcomes calls this after them, because
 * the package owns no scheduler.
 * @param actor - identity supplying the tenant.
 * @param ref - unit to assess.
 * @param options - period to evaluate instead of the configured one.
 * @returns the report after the assessment, with the level it now holds.
 */
async assess( actor: AutonomyActor, ref: AutonomyUnitRef, options: AutonomyReportOptions = {}, ): Promise<AutonomyUnitReport>

/**
 * Promote one unit to `DELEGADO`. The command is explicit and gated: the
 * identity must hold a governance role of the tenant, and the unit must meet
 * the signed thresholds. The promotion records who promoted it, when, and on
 * which numbers. No automatic path exists (W-53, W-64).
 * @param actor - promoting identity and its tenant.
 * @param ref - unit to promote.
 * @returns the promoted unit with its promotion record.
 */
async promote(actor: AutonomyActor, ref: AutonomyUnitRef): Promise<AutonomyUnit>

/**
 * Return one unit to `SUPERVISADO` at a human's request. The audit keeps the
 * cause, and delegating again needs a new promotion.
 * @param actor - identity narrowing the unit.
 * @param ref - unit to supervise.
 * @param cause - why the unit loses its delegation.
 * @returns the supervised unit.
 */
async supervise(actor: AutonomyActor, ref: AutonomyUnitRef, cause: string): Promise<AutonomyUnit>

/**
 * Plan the sample of one period: the configured share of the delegated items,
 * at least the configured minimum, chosen from the earliest delegations that
 * are not in the sample yet. Planning only selects; execution is never
 * blocked (D-13).
 * @param actor - identity supplying the tenant.
 * @param ref - delegated unit.
 * @param period - period the sample covers.
 * @returns the target, the items this call added, and what still waits.
 */
async planSample(actor: AutonomyActor, ref: AutonomyUnitRef, period: AutonomyPeriod): Promise<AutonomySamplePlan>

/**
 * Record the human verdict on one sampled item. A rejection suspends a
 * delegated unit on the spot, with the cause and the numbers in the audit
 * (D-13). A verdict is recorded once.
 * @param actor - reviewing identity; it must hold a governance role.
 * @param ref - unit the item belongs to.
 * @param input - period, item, verdict, and optional note.
 * @returns the reviewed item and the suspension the verdict caused.
 */
async reviewSample( actor: AutonomyActor, ref: AutonomyUnitRef, input: AutonomySampleVerdictInput, ): Promise<AutonomySampleVerdict>

/**
 * List the audit entries of one unit, oldest first.
 * @param actor - reading identity and its tenant.
 * @param ref - unit to read.
 * @returns the audit entries.
 */
async listAudit(actor: AutonomyActor, ref: AutonomyUnitRef): Promise<AutonomyAuditEvent[]>
```

Source: [`packages/faberloom/autonomy/src/index.ts`](../../packages/faberloom/autonomy/src/index.ts)

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

The product board service: WorkLoom states, commands, audit, candidates, and optimistic concurrency over one key-value aggregate per item.

```ts cordis-catalog
/**
 * Register one check implementation for a declared control. The registry is
 * mounted from outside the board (ADR-003): an adapter calls this from
 * `ctx.effect`, exactly like the handlers package mounts its handlers.
 *
 * A pair the board does not declare is refused, so a typo in an artifact type
 * or a check id fails at load instead of silently never running. The class is
 * signed by D-8, and a registration that disagrees is refused.
 * @param artifactType - artifact type the check applies to.
 * @param checkId - declared check id.
 * @param fn - the implementation.
 * @param options - signed class and the source port the check reads.
 * @returns the disposer that removes this registration.
 */
registerCheck(artifactType: string, checkId: string, fn: BoardCheckFn, options: BoardCheckOptions): () => void

/**
 * Which declared controls of one artifact type have an adapter.
 * @param artifactType - artifact type to inspect.
 * @returns the declared controls with their registration state.
 */
checkStatus(artifactType: string): readonly BoardCheckStatusEntry[]

/**
 * Run every declared control of one item without persisting anything. The
 * panel reads this for its verification zone; approval calls the same path
 * immediately before the transition, with no cache (W-50).
 * @param actor - the authenticated reader.
 * @param id - item id.
 * @returns the executed controls and the declared ones with no adapter.
 */
async runChecks(actor: BoardActor, id: FaberLoomBoardItemId): Promise<BoardCheckReport>

/**
 * Create one prepared item awaiting review; evidence is mandatory.
 * @param writer - the owning identity; a bare id is a legacy single-tenant actor.
 * @param input - title, summary, evidence, optional space, document, execution.
 * @returns the created item.
 */
async create(writer: BoardWriter, input: BoardCreateInput): Promise<FaberLoomBoardItem>

/**
 * Create one item from an Action Engine run. `runId`, `idempotencyKey`, and
 * `businessKey` are mandatory; a repeated key returns the existing item.
 * @param writer - the acting identity.
 * @param input - run identity, artifact identity, title, summary, and evidence.
 * @returns the created or deduplicated item.
 */
async submit(writer: BoardWriter, input: BoardSubmitRequest): Promise<FaberLoomBoardItem>

/**
 * Record the human severity and its provenance.
 * @param writer - the acting identity.
 * @param id - item id.
 * @param severity - the chosen severity.
 * @param source - who assigned it.
 * @param confidence - original classifier confidence, when known.
 * @param expectedRowVersion - optimistic token.
 * @returns the updated item.
 */
async setSeverity( writer: BoardWriter, id: FaberLoomBoardItemId, severity: BoardSeverity, source: 'RULE' | 'LLM' | 'HUMAN' = 'HUMAN', confidence: number | null = null, expectedRowVersion?: number, ): Promise<FaberLoomBoardItem>

/**
 * Save inline edits as a new revision and hash.
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - base version, expected row version, and changes.
 * @returns the updated item.
 */
async saveEdits(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardEditsInput): Promise<FaberLoomBoardItem>

/**
 * Approve the exact artifact version. It never sends anything, and the
 * blocking and source-changing controls run again immediately before the
 * transition, with no cache (W-49, W-50).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - expected row, artifact version and hash, and confirmed controls.
 * @returns the approved item.
 */
async approve(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardApproveInput): Promise<FaberLoomBoardItem>

/**
 * Save edits and approve the resulting version in one command. The controls
 * run against the edited content, because that is the version being approved.
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - approval expectations plus the edits.
 * @returns the approved item.
 */
async approveWithEdits( writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardApproveInput & BoardEditsInput, ): Promise<FaberLoomBoardItem>

/**
 * Discard an item with a signed reason.
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - expected row, reason, and optional note.
 * @returns the discarded item.
 */
async discard(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardDiscardInput): Promise<FaberLoomBoardItem>

/**
 * Adopt or keep the pending candidate.
 * @param writer - the acting identity.
 * @param id - item id.
 * @param candidateId - candidate the user saw.
 * @param candidateHash - hash the user saw.
 * @param decision - adopt or keep.
 * @returns the updated item.
 */
async resolveCandidate( writer: BoardWriter, id: FaberLoomBoardItemId, candidateId: string, candidateHash: string, decision: 'adopt' | 'keep', ): Promise<FaberLoomBoardItem>

/**
 * Assign a space (and its root workspace) to an item. A collision with
 * another live item on the same business key resolves by the §2.3 rule: a
 * substitutable item closes, a non-substitutable one receives the artifact as
 * a candidate and stays open. The drafts of the item that closes move to the
 * live one, marked with their base version and origin (W-98).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param workspaceId - target space/workspace id.
 * @returns the live item and the drafts the collision moved to it.
 */
async assignWorkspace( writer: BoardWriter, id: FaberLoomBoardItemId, workspaceId: string, ): Promise<BoardAssignment>

/**
 * Drafts a collision moved to one item from the item it closed (§2.3, W-98).
 * Iteration drafts are listed for every reader of the item; edit drafts only
 * for the caller's own seat, because another user's edits are not theirs to
 * read. Each entry carries the version the draft was written on.
 * @param actor - the authenticated reader.
 * @param id - item id.
 * @returns the transferred draft references, empty when none moved here.
 */
async transferredDrafts(actor: BoardActor, id: FaberLoomBoardItemId): Promise<readonly BoardTransferredDraft[]>

/**
 * Read the caller's inline-edit draft for one item.
 * @param actor - the authenticated editor.
 * @param id - item id.
 * @returns the draft, or undefined.
 */
async getEditDraft(actor: BoardActor, id: FaberLoomBoardItemId): Promise<BoardEditDraft | undefined>

/**
 * Save one draft write, conditional on its revision and writer tab.
 * @param actor - the authenticated editor.
 * @param id - item id.
 * @param input - base version, revision, tab, and changes.
 * @returns the stored draft.
 */
async saveEditDraft( actor: BoardActor, id: FaberLoomBoardItemId, input: { baseVersion: number; revision: number; writerSession: string; changes: Record<string, string> }, ): Promise<BoardEditDraft>

/**
 * Take the writer seat for one item. A second tab becomes read-only until
 * this call succeeds.
 * @param actor - the authenticated editor.
 * @param id - item id.
 * @param writerSession - the requesting tab.
 * @returns the draft with this tab as writer.
 */
async takeEditDraft(actor: BoardActor, id: FaberLoomBoardItemId, writerSession: string): Promise<BoardEditDraft>

/**
 * Drop the caller's draft.
 * @param actor - the authenticated editor.
 * @param id - item id.
 */
async discardEditDraft(actor: BoardActor, id: FaberLoomBoardItemId): Promise<void>

/**
 * The validated iteration policy this deployment runs with (D-09, D-10). The
 * panel reads the renewal cadence and the round limit from here instead of
 * carrying its own copy.
 * @returns a copy of the resolved policy.
 */
iterationPolicy(): IterationPolicy

/**
 * Iteration status of one item: attempt phase, lock, rounds, and the retained
 * draft. An expired attempt already reports as paused, which is how the panel
 * offers the draft for recovery (W-44).
 * @param actor - the authenticated reader.
 * @param id - item id.
 * @returns the attempt projection.
 */
async iterationStatus(actor: BoardActor, id: FaberLoomBoardItemId): Promise<BoardIterationStatus>

/**
 * Start an iteration attempt over the current artifact version (§9.7.1). The
 * attempt needs a space (W-31), mints a new `iterationId`, bumps the lock
 * generation, records the base version and the deadline, and leaves the
 * artifact version untouched (W-11).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - artifact version the caller saw and the tab session.
 * @returns the item and the new attempt.
 */
async iterate(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardIterateInput): Promise<BoardIterationResult>

/**
 * Save the caller's edits as a new version and start the iteration over it.
 * The edits, the version, and the attempt commit in one transform, so a
 * conflict creates no version, applies no transition, and keeps the caller's
 * edits outside the item (W-69).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - expected row and base version, the changes, and the tab session.
 * @returns the item and the new attempt.
 */
async iterateWithEdits( writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardIterateWithEditsInput, ): Promise<BoardIterationResult>

/**
 * Store one write of the attempt's work as its working draft. A write that no
 * longer matches the live attempt stores the draft of that dead attempt and
 * leaves the item untouched, which is how a late agent answer is kept without
 * reaching the item (W-57). A write from another tab session is refused with
 * `LOCK_HELD` before anything is stored.
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - attempt, session, base version, and the fields the caller wrote.
 * @returns the stored draft and whether the item links it.
 */
async saveIterationDraft( writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardIterationDraftInput, ): Promise<BoardIterationDraftOutcome>

/**
 * Read one attempt's draft, or the draft the item offers.
 * @param actor - the authenticated reader.
 * @param id - item id.
 * @param iterationId - attempt to read; omitted reads the draft the item offers.
 * @returns the draft, or undefined when none is stored or retained.
 */
async getIterationDraft( actor: BoardActor, id: FaberLoomBoardItemId, iterationId?: string, ): Promise<BoardIterationDraft | undefined>

/**
 * Extend the lock of the live attempt. A stale attempt id, a stale generation,
 * an expired deadline, or another tab session is refused without effects
 * (W-43).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - attempt id, generation, and tab session.
 * @returns the item and the renewed attempt.
 */
async renewIteration( writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardIterationLockInput, ): Promise<BoardIterationResult>

/**
 * Save and exit, carry to SpaceLoom, return without resolving, or record the
 * expiry: the attempt releases its lock and the item returns to the pending
 * column with its draft and any pending candidate untouched (W-67, W-97).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - attempt, generation, session, and the exit the user chose.
 * @returns the item and the released attempt.
 */
async pauseIteration( writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardPauseIterationInput, ): Promise<BoardIterationResult>

/**
 * Discard the attempt's work and release the lock. It requires no pending
 * candidate, or the adopt/keep choice that resolves it in the same commit; it
 * deletes the draft and never changes the version except through adoption
 * (W-41).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - attempt, generation, session, and the optional candidate choice.
 * @returns the item and the released attempt.
 */
async cancelIteration( writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardCancelIterationInput, ): Promise<BoardIterationResult>

/**
 * Take a new attempt over the draft the item offers: the linked one, or the
 * retained draft of a dead attempt the item never linked, which is otherwise
 * text no command reaches (W-57). When the draft was written against an older
 * version, it is marked outdated and the differences are returned instead of
 * overwriting the newer content (W-68). Starting an attempt never writes the
 * artifact version, so the draft reaches the item only through `applyIteration`.
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - base version of the draft the caller saw and the tab session.
 * @returns the item with `started`, or with `outdated` and the differences.
 */
async resumeIteration( writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardResumeIterationInput, ): Promise<BoardResumeIterationResult>

/**
 * Take a new attempt over one draft a collision moved to this item (§2.3,
 * W-98). The key must be a draft `transferredDrafts` listed here and inside its
 * retention window, because a key of another item, or one already past D-09, is
 * not work this item may turn into an attempt. When the draft's base version is
 * still current the item links it under the new attempt's key and the attempt
 * starts; otherwise the draft is marked outdated, the differing fields come
 * back, and the item is not written (W-68). Neither outcome writes the artifact
 * version, so the work reaches the item only through `applyIteration`.
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - the transferred draft key and the tab opening the attempt.
 * @returns the item with `started`, or with `outdated` and the differences.
 */
async recoverTransferredDraft( writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardRecoverDraftInput, ): Promise<BoardRecoverDraftResult>

/**
 * Apply the live attempt: write a new version and hash, count the round,
 * record the learning scope, release the lock, and return to
 * `PENDIENTE_CRITERIO`. A pending candidate must be resolved in the same call,
 * and only the current attempt applies (W-40, W-57).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - attempt, generation, session, base version, optional summary and
 * evidence, the scope, and the choice.
 * @returns the item and the released attempt.
 */
async applyIteration( writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardApplyIterationInput, ): Promise<BoardIterationResult>

/**
 * The resolved effect policy (D-12): the reversal window per action type, the
 * retention of a settled effect record, the timeout one dispatch attempt gets
 * from its adapter, and the lease a crashed acceptance is given.
 * @returns a copy of the resolved policy.
 */
effectPolicy(): EffectPolicy

/**
 * Register the adapter of one action type. The registry is mounted from
 * outside the board, the way `registerCheck` mounts a control: a deployment
 * owns the mail, inventory, or shipment client, and the board only decides
 * when to call it. A second adapter for one action type replaces the first.
 * @param actionType - action type the adapter emits (`mail.send`, ...).
 * @param adapter - the implementation.
 * @returns the disposer that removes this registration.
 */
registerEffectAdapter(actionType: string, adapter: BoardEffectAdapter): () => void

/**
 * Approve the exact artifact version and accept one execution for it: the
 * approval, the reservation, and the outbox message are acquired in one
 * command, so a crash cannot leave an authorized item without its intention
 * (§10.1). The reservation is per tenant and `effect_key`, so a competing
 * execution of the same effect is refused with `EFFECT_TAKEN` while it is
 * `RESERVADA` or `DESPACHADA`.
 *
 * When the `faberloomAccess` service is mounted, the acceptance asks it for
 * the CEO signature W-16 requires and lets its refusal propagate unchanged;
 * a composition without that service enforces no signature here, because the
 * board cannot tell which action types are protected.
 *
 * The item lands in `DELEGADO_EN_VENTANA` when the action type has a reversal
 * window, and in `EJECUCION_PENDIENTE` when it has none (D-12). The controls
 * run again immediately before the transition, exactly as `approve` does.
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - approval expectations, execution identity, and destination.
 * @returns the item, its reservation, and its outbox message.
 */
async approveWithExecution( writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardExecutionInput, ): Promise<BoardEffectExecution>

/**
 * Revert a delegated execution inside its window. The effect has not happened
 * and cannot have happened, so the reservation is released and the outbox
 * message cancelled; a revert at or after the deadline is refused (W-18) and
 * a delegated item with no recorded deadline is refused outright (W-17).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - optimistic token and optional reason.
 * @returns the item back in `PENDIENTE_CRITERIO`.
 */
async revert(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardRevertInput = {}): Promise<FaberLoomBoardItem>

/**
 * Expire the reversal window: the item moves to `EJECUCION_PENDIENTE` and the
 * effect becomes dispatchable. An item whose window is still open is refused
 * with `WINDOW_OPEN`, and one that is not delegated with `NOT_DELEGATED`, so a
 * revert and an expiry produce exactly one transition (W-18).
 * @param writer - the acting identity.
 * @param id - item id.
 * @returns the item in `EJECUCION_PENDIENTE`.
 */
async expireWindow(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem>

/**
 * Run the controls again before the effect leaves (W-50, W-75). A blocking
 * failure, a declared control with no adapter, or a confirmation failure the
 * approval never accepted invalidates the acceptance: the item returns to
 * `PENDIENTE_CRITERIO`, the reservation is released, and the message is
 * cancelled, so a fresh approval of the same effect is accepted (W-95).
 * @param writer - the acting identity.
 * @param id - item id.
 * @returns whether the effect may still leave, and the item after the attempt.
 */
async revalidateEffect(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<BoardEffectRevalidation>

/**
 * Consent to emit one effect: the outbox consumer. Before it calls the
 * adapter it verifies, inside one tenant section, that the message is
 * dispatchable, that the reservation is still `RESERVADA` for this execution,
 * that the item still authorizes the effect, and that the controls still
 * pass. Any failed check emits nothing, releases the reservation, and marks
 * the message non-dispatchable (W-95, W-102).
 *
 * An item still inside its reversal window keeps the message `PENDIENTE` and
 * reports `WINDOW_OPEN`: nothing leaves before `reversal_deadline` (W-19).
 * @param actor - the tenant the consumer acts for.
 * @param effectKey - effect to emit.
 * @returns what the attempt produced.
 */
async dispatchEffect(actor: BoardActor, effectKey: string): Promise<BoardDispatchOutcome>

/**
 * The messages this tenant may still emit, oldest first. A cancelled,
 * dispatched, or failed message is not listed: it is not dispatchable.
 * @param actor - the tenant the consumer acts for.
 * @returns the dispatchable messages.
 */
async pendingEffects(actor: BoardActor): Promise<readonly BoardOutboxMessage[]>

/**
 * Everything one item's external effect looks like to the panel: the
 * reservation, the outbox message, the visible alerts, and whether a
 * dispatched effect still awaits reconciliation.
 * @param actor - the authenticated reader.
 * @param id - item id.
 * @returns the effect projection, or null when the item authorized none.
 */
async effectStatus(actor: BoardActor, id: FaberLoomBoardItemId): Promise<BoardEffectStatus | null>

/**
 * Reconcile a dispatched effect with what the destination reports.
 * `CONFIRMADO` closes the item as `EJECUTADO`; `FALLIDO` moves it to
 * `ERROR_RECUPERABLE` with that outcome, which is what makes a retry legal;
 * `DESCONOCIDO` records the attempt and leaves the item in its unknown state
 * (W-21, W-76).
 *
 * A reconciliation after an administrative close updates the outcome, raises
 * a visible alert, writes an audit event, and never reopens the item (W-85).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - the outcome the destination reported.
 * @returns the item after the reconciliation.
 */
async reconcile(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardReconcileInput): Promise<FaberLoomBoardItem>

/**
 * Retry a failed execution. The retry keeps the original `executionId`, the
 * same reservation, and the same idempotency key (W-84, W-77); it moves the
 * item back to `EJECUCION_PENDIENTE` so the consumer may emit it again.
 *
 * An unknown outcome is refused with `OUTCOME_UNKNOWN` unless the adapter of
 * that action type declares the destination idempotent, because a destination
 * that may already have the effect cannot be sent twice (W-21).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - optimistic token.
 * @returns the item in `EJECUCION_PENDIENTE`.
 */
async retry(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardRetryInput = {}): Promise<FaberLoomBoardItem>

/**
 * Close an item administratively while its effect outcome is unknown: Owner
 * or Admin of the tenant, with a reason, and the reservation stays
 * `DESPACHADA` so the reconciliation remains open (D-9, W-65). A pending
 * candidate becomes a new linked item in the same command (W-86).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - optimistic token and the mandatory reason.
 * @returns the closed item and the item the candidate became.
 */
async adminClose( writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardAdminCloseInput, ): Promise<BoardAdminCloseResult>

/**
 * The visible alerts of this tenant, newest first. A late confirmation after
 * an administrative close raises one, and the panel reads it here (W-85).
 * @param actor - the tenant the reader acts for.
 * @returns the alerts.
 */
async alerts(actor: BoardActor): Promise<readonly BoardEffectAlert[]>

/**
 * Delete settled effect records past their retention window. A reservation
 * that is still live and a message that was never settled are never pruned:
 * they carry a decision that a human may still need to see. Audit events of
 * effects no item names are pruned by the same window.
 * @param actor - the tenant the operator acts for.
 * @returns how many rows were removed.
 */
async pruneEffects(actor: BoardActor): Promise<number>

/**
 * Release the reservations no item reaches and no consumer can emit.
 *
 * An acceptance writes the reservation and its message before it commits the
 * item. A crash in between leaves a `RESERVADA` row whose key no item records:
 * `revert`, `reconcile`, and `pruneEffects` all need an item for it, so the key
 * would stay taken and every other execution of that effect would be refused
 * with `EFFECT_TAKEN`. A row older than `effectReservationLeaseMs` is released,
 * its message cancelled, an audit event stored, and an alert raised (D-12).
 *
 * A row whose key an item records is never swept, in whatever state: a failed
 * execution still needs its reservation to retry (W-84). A row younger than the
 * lease is left alone, because its acceptance may still be committing.
 * @param actor - the tenant the operator acts for.
 * @returns the released keys and the rows the sweep wrote.
 */
async recoverOrphanedReservations(actor: BoardActor): Promise<BoardOrphanRecovery>

/**
 * Read the audit history of one item.
 * @param actor - the authenticated reader.
 * @param id - item id.
 * @returns the events, oldest first.
 */
async events(actor: BoardActor, id: FaberLoomBoardItemId): Promise<readonly BoardEvent[]>

/**
 * Submit a correction as the next revision, awaiting a fresh review. The
 * revision carries the content the caller supplies, so the controls of the
 * next approval evaluate the corrected artifact.
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - summary, evidence, optional document reference, content, and origins.
 * @returns the updated item.
 */
async submitRevision(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardSubmitInput): Promise<FaberLoomBoardItem>

/**
 * Record that the item waits for data.
 * @param writer - the acting identity.
 * @param id - item id.
 * @returns the updated item.
 */
async requestData(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem>

/**
 * Mark the item failed. `DESCONOCIDO` records an effect that may or may not
 * have happened: the item stays recoverable and verifiable, and it is never
 * `EJECUTADO` without confirmation (W-22).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param outcome - `FALLIDO` when the destination refused the effect, `DESCONOCIDO` when it did not answer.
 * @returns the updated item.
 */
async fail( writer: BoardWriter, id: FaberLoomBoardItemId, outcome: 'FALLIDO' | 'DESCONOCIDO' = 'FALLIDO', ): Promise<FaberLoomBoardItem>

/**
 * Reopen the item for another attempt.
 * @param writer - the acting identity.
 * @param id - item id.
 * @returns the updated item.
 */
async reopen(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem>

/**
 * Complete an approved item that carries no live effect.
 *
 * An item that accepted an execution closes through its reconciliation, never
 * through this command: it is refused with `EFFECT_NOT_CONCILIATED` unless the
 * reservation of its `effectKey` is `CONCILIADA` (W-84). An item that never had
 * an effect keeps the legacy path around `complete`.
 * @param writer - the acting identity.
 * @param id - item id.
 * @returns the updated item.
 */
async complete(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem>

/**
 * Permanently remove one item from the work table, regardless of state.
 * @param writer - the acting identity.
 * @param id - item id.
 * @returns whether the item existed and was removed.
 */
async remove(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<boolean>

/**
 * Link the item to the routine that will run it, or unlink it with `null`.
 * @param writer - the acting identity.
 * @param id - item id.
 * @param routineId - routine id to attach, or null to detach.
 * @returns the updated item.
 */
async setRoutine(writer: BoardWriter, id: FaberLoomBoardItemId, routineId: string | null): Promise<FaberLoomBoardItem>

/**
 * Approve or reject the exact revision. A reject returns the item to the
 * pending column; an approve follows the WorkLoom preconditions and binds to
 * the hash the caller names, never to whatever is current (W-09).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - decision, exact revision, artifact hash, and optional note.
 * @returns the updated item.
 */
async review(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardReviewInput): Promise<FaberLoomBoardItem>

/**
 * Invalidate a current approval: the item must be revalidated before approval
 * or effects.
 * @param writer - the acting identity.
 * @param id - item id.
 * @param reason - why the item went stale.
 * @returns the updated item.
 */
async markStale(writer: BoardWriter, id: FaberLoomBoardItemId, reason: string): Promise<FaberLoomBoardItem>

/**
 * Clear staleness after checking the changed condition.
 * @param writer - the acting identity.
 * @param id - item id.
 * @param changed - whether the underlying condition actually changed.
 * @returns the updated item.
 */
async revalidate(writer: BoardWriter, id: FaberLoomBoardItemId, changed: boolean): Promise<FaberLoomBoardItem>

/**
 * Record an effect on an item that never had a reserved one. Approval never
 * sends: an explicit authorization is required, and a stale or unapproved item
 * refuses.
 *
 * An item that carries an `effectKey` is refused with `EFFECT_VIA_OUTBOX`: its
 * effect has a reservation and a message, so it is recorded by the consumer's
 * outcome, and this path would bypass `EFFECT_TAKEN` (W-84).
 * @param writer - the acting identity.
 * @param id - item id.
 * @param input - external reference, authorization, and optional detail.
 * @returns the updated item.
 */
async recordEffect(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardEffectInput): Promise<FaberLoomBoardItem>

/**
 * Read one item the actor is allowed to see.
 * @param actor - the authenticated reader.
 * @param id - item id.
 * @returns the item.
 */
async get(actor: BoardActor, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem>

/**
 * List the actor's items. There is no unfiltered listing: every read is
 * scoped to one identity and, when the deployment knows it, one company.
 * @param actor - the authenticated reader.
 * @param filter - optional state, status, and space filters.
 * @returns items in the canonical queue order (§4): unclassified and
 * space-less first, then the severity, due date, value, creation, and id tuple.
 */
async list( actor: BoardActor, filter: { status?: BoardStatus; state?: BoardState; spaceId?: string } = {}, ): Promise<FaberLoomBoardItem[]>
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
 * List the context entries attached to one Space that the actor may read,
 * newest first. Visibility is the same as {@link list}: a `shared` entry is
 * visible to any reader, while a `local` or `pending` entry is visible only
 * to its author and the Space owner.
 * @param actor - the acting identity.
 * @param spaceId - the Space whose entries are read.
 * @returns the visible entries of that Space.
 */
async listForSpace(actor: FaberLoomContextActor, spaceId: string): Promise<readonly FaberLoomContextEntry[]>

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
 * Move every entry the owner holds on one Space to another Space.
 *
 * A duplicate Space is folded into its keeper; the entries keyed to the
 * duplicate would otherwise become invisible when its row disappears. Only
 * the owning identity's entries move, and each move appends a version so the
 * history states where the entry now lives.
 * @param actor - the acting identity.
 * @param fromSpaceId - Space being folded away.
 * @param toSpaceId - Space that survives.
 * @returns the number of entries moved.
 */
async reassign(actor: FaberLoomContextActor, fromSpaceId: string, toSpaceId: string): Promise<number>

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
 * Export one context record: the entries the actor may read, optionally
 * restricted to one Space, with each entry's version history. JSON is the
 * default; Markdown renders one section per entry.
 * @param actor - the acting identity.
 * @param options - the optional Space and format.
 * @returns the export body and suggested file name.
 */
async export(actor: FaberLoomContextActor, options: FaberLoomContextExportOptions = {}): Promise<FaberLoomContextExport>

/**
 * Import a context record produced by {@link export}. Each entry whose title
 * does not already exist in its Space is created under the actor's placement
 * (an owner writes shared, a member's entry starts pending); an equal title
 * is skipped, so importing the same record twice is idempotent.
 * @param actor - the acting identity.
 * @param payload - the export body.
 * @returns the created and skipped counts.
 */
async import(actor: FaberLoomContextActor, payload: string): Promise<FaberLoomContextImportResult>

/**
 * Replace one Space's context record wholesale (owner only): entries whose
 * title is not in the new set are removed, a retained title gets a new
 * version, and a new title is created.
 * @param actor - the acting identity.
 * @param spaceId - the Space whose record is replaced.
 * @param entries - the new full set of title and body.
 * @returns the resulting entries.
 */
async replace( actor: FaberLoomContextActor, spaceId: string, entries: readonly FaberLoomContextReplaceEntry[], ): Promise<readonly FaberLoomContextEntry[]>

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
 * Publish this home's Admin/CEO edits of baseline agents to the deployment and
 * apply newer editions to this home, after seeding has run. A failure is
 * logged and the next pass retries.
 * @returns what the pass published and applied, or undefined when it is off or failed.
 */
async syncGlobal(): Promise<GlobalAgentReport | undefined>

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

<a id="ctxfaberloomharnessprojection--faberloomharnessprojection"></a>

### `ctx.faberloomHarnessProjection` — `FaberLoomHarnessProjection`

The harness projection service: read one scope's product records, write its harness files, and retire the files the previous projection owned.

```ts cordis-catalog
/**
 * Read the records one scope registers: its agents and their skills, its work
 * flows, routines, memory, and context. A product domain this process does
 * not hold open is named in `unreadableDomains`; a Space scope naming a Space
 * the open spaces domain does not hold is refused.
 * @param scope - the Workspace or Space to read.
 * @returns the scope's records.
 * @throws when a Space scope names a Space the open spaces domain does not hold.
 */
async readUsage(scope: HarnessScope): Promise<HarnessUsage>

/**
 * Write the complete projection of one scope into an explicit directory and
 * return what it wrote and retired. The manifest is written last, so an
 * interrupted run leaves the previous ownership record in place and the next
 * run still prunes from it.
 * @param scope - the scope being projected.
 * @param root - absolute scope directory the files land in.
 * @returns the written paths, the pruned paths, and the records included.
 * @throws when a Space scope names a Space the open spaces domain does not hold.
 */
async project(scope: HarnessScope, root: string): Promise<HarnessProjectionReport>

/**
 * Resolve one scope's real directory and project it. It returns undefined
 * instead of writing when the scope has no registered folder: the projection
 * is disabled, the workspace registry is not mounted, the Workspace is not
 * registered, the Space mirrors no Workspace, or the open spaces domain does
 * not hold the named Space.
 * @param scope - the scope to project.
 * @returns the projection report, or undefined when the scope has no folder.
 */
async refresh(scope: HarnessScope): Promise<HarnessProjectionReport | undefined>

/**
 * Retire every file one projection declared. Only paths that projection's own
 * manifest lists are removed, so a foreign file in the same folder survives;
 * a directory the removal emptied is removed too, and the manifest itself
 * stays as the record of what was owned.
 * @param root - absolute scope directory.
 * @returns the retired paths, relative to that directory.
 * @throws when the manifest exists but is not a readable projection manifest.
 */
async clean(root: string): Promise<string[]>
```

Source: [`packages/faberloom/harness-projection/src/index.ts`](../../packages/faberloom/harness-projection/src/index.ts)

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
 * @param connectionId - the mail connection to read, or undefined for the default one.
 * @returns the envelopes, or an empty list when no mailbox is configured.
 */
async listInbox(ownerId: string, limit?: number, connectionId?: string): Promise<ImapMessage[]>

/**
 * Read one mailbox message's body, read-only.
 * @param ownerId - the owning identity.
 * @param uid - the message UID.
 * @param connectionId - the mail connection to read, or undefined for the default one.
 * @returns the decoded body, or null when no mailbox is configured or the message has no body.
 */
async readEmail(ownerId: string, uid: number, connectionId?: string): Promise<ImapMessageContent>

/**
 * Mark one message as read (`\Seen`). Unlike the poller this writes to the
 * mailbox, so it runs only for an explicit user gesture.
 * @param ownerId - the owning identity.
 * @param uid - the message UID.
 * @param connectionId - the mail connection to update, or undefined for the default one.
 * @returns true when the mailbox accepted the flag update, false without a mailbox.
 */
async markSeen(ownerId: string, uid: number, connectionId?: string): Promise<boolean>

/**
 * Move one message to the Trash mailbox, trying the configured name and then
 * the built-in candidates. Writes to the mailbox on an explicit gesture only.
 * @param ownerId - the owning identity.
 * @param uid - the message UID.
 * @param connectionId - the mail connection to update, or undefined for the default one.
 * @returns the mailbox the message moved to.
 * @throws when every candidate mailbox rejects the move.
 */
async moveToTrash(ownerId: string, uid: number, connectionId?: string): Promise<string>

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

<a id="ctxfaberloommcpregistry--faberloommcpregistry"></a>

### `ctx.faberloomMcpRegistry` — `FaberLoomMcpRegistry`

The MCP server registry published as `ctx.faberloomMcpRegistry`.

```ts cordis-catalog
/**
 * List one owner's saved servers, name-ascending, each carrying whether the
 * credential seam resolves its entries and whether it is mounted.
 * @param ownerId - the identity whose servers are read.
 * @returns the owner's saved servers.
 */
list(ownerId: string): Promise<readonly FaberLoomMcpServer[]>

/**
 * Persist one server and reconcile its mount; an enabled server mounts
 * process-globally, and every `env` or `headers` value goes to the credential
 * seam.
 * @param ownerId - the identity the server belongs to.
 * @param input - the server's name, transport, secret values, and enabled flag.
 * @returns the saved server as a caller reads it.
 */
save(ownerId: string, input: McpServerInput): Promise<FaberLoomMcpServer>

/**
 * Remove one saved server, unmounting it and dropping the credentials its
 * entries held.
 * @param ownerId - the identity the server belongs to.
 * @param name - the server to remove.
 * @returns whether a server was removed.
 */
remove(ownerId: string, name: string): Promise<boolean>

/**
 * Prove one candidate server works by connecting in an isolated scope, listing
 * its tools, and closing again.
 * @param input - the candidate server with its secret values.
 * @returns `{ ok: true, tools }`, or a named failure with every secret redacted.
 */
probe(input: McpServerInput): Promise<McpProbeResult>
```

Source: [`packages/faberloom/mcp-registry/src/types.ts`](../../packages/faberloom/mcp-registry/src/types.ts)

<a id="ctxfaberloommcpserver--faberloommcpserver"></a>

### `ctx.faberloomMcpServer` — `FaberLoomMcpServer`

FaberLoom's server face for other agents.

```ts cordis-catalog
/**
 * Answer one request on behalf of a token holder without an HTTP request.
 *
 * This is the same validation and the same tools the socket serves; the caller
 * is the bridge, which has already authenticated the public client with the
 * token the gateway forwarded. A revoked or foreign token is refused here too,
 * so a stale registration cannot outlive its token.
 * @param body - the JSON-RPC request body.
 * @param token - the bearer token the public client presented.
 * @param accept - the Accept header the public client sent.
 * @returns the complete answer for the gateway to relay.
 */
async request(body: string, token: string, accept: string = 'application/json'): Promise<FaberLoomMcpAnswer>

/**
 * Mint one bearer token for a client the owner names.
 * @param label - who the token is for.
 * @param scopes - tool names the client may call, or null for the full surface.
 * @param companyId - company scope the token acts for, or null for the deployment's none.
 * @returns the token, which is only shown here.
 */
async mintToken( label: string, scopes: readonly string[] | null = null, companyId: string | null = null, ): Promise<FaberLoomMcpToken>

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

The product memory service: versioned teachings, contextual performance, the correction registry, learning candidates, maturity metrics, late errors, and portable knowledge.

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
 * Entry point for every human correction: an inline edit, an answered doubt,
 * or an applied iteration. The record is durable and identical in structure
 * for all three origins. A candidate is created only when the chosen scope is
 * not `puntual`; nothing is promoted here (W-34, W-35).
 *
 * Both writes land on the domain write chain in order: the correction first,
 * because it is the fact, and the candidate second. A candidate write that
 * fails rejects the call and leaves the correction recorded.
 * @param actor - identity and scope of the caller.
 * @param input - origin payload, lineage, classifications, and chosen scope.
 * @returns the correction and the candidate it produced, when it produced one.
 */
async onCorrection(actor: LearningActor, input: CorrectionInput): Promise<CorrectionOutcome>

/**
 * Read one correction. Only an identity holding scope over its origin sees it.
 * @param actor - identity and scope of the caller.
 * @param id - correction id.
 * @returns the correction.
 */
async getCorrection(actor: LearningActor, id: FaberLoomCorrectionId): Promise<FaberLoomCorrection>

/**
 * List the corrections the actor holds scope over.
 * @param actor - identity and scope of the caller.
 * @param filter - optional item, space, account, and agent filters.
 * @returns the corrections, oldest first.
 */
async listCorrections(actor: LearningActor, filter: CorrectionFilter = {}): Promise<FaberLoomCorrection[]>

/**
 * Read one candidate. Reading is limited to whoever holds scope over its
 * origin (§6.3).
 * @param actor - identity and scope of the caller.
 * @param id - candidate id.
 * @returns the candidate.
 */
async getCandidate(actor: LearningActor, id: FaberLoomCandidateId): Promise<FaberLoomCandidate>

/**
 * List the candidates the actor holds scope over.
 * @param actor - identity and scope of the caller.
 * @param filter - optional item, space, account, agent, and status filters.
 * @returns the candidates, oldest first.
 */
async listCandidates(actor: LearningActor, filter: CandidateFilter = {}): Promise<FaberLoomCandidate[]>

/**
 * Promote one candidate to its allowed destination. This is the only path
 * that activates learning, and it revalidates tenant, account, space,
 * classification, and provenance against that destination before committing
 * (W-35, W-47, W-60). A destination wider than the allowed one is rejected;
 * widening goes through {@link widenCandidate}.
 * @param actor - identity and scope of the caller.
 * @param id - candidate id.
 * @param input - destination and the classifications it accepts.
 * @returns the promoted candidate.
 */
async promoteCandidate( actor: LearningActor, id: FaberLoomCandidateId, input: CandidatePromotionInput, ): Promise<FaberLoomCandidate>

/**
 * Widen a candidate to a wider destination. Widening never moves the
 * original candidate: it produces a new candidate with reviewed content,
 * which still needs its own promotion (W-47). The new candidate revalidates
 * tenant, space, account, classification, and provenance against the wider
 * destination.
 * @param actor - identity and scope of the caller.
 * @param id - candidate to widen.
 * @param input - wider destination, reviewed content, and accepted classifications.
 * @returns the new candidate.
 */
async widenCandidate( actor: LearningActor, id: FaberLoomCandidateId, input: CandidateWideningInput, ): Promise<FaberLoomCandidate>

/**
 * Record what happened to one item, for the maturity metrics. Calls append:
 * the latest outcome of an item decides how the item is counted.
 * @param actor - identity and scope of the caller.
 * @param input - item, task type, and result.
 * @returns nothing.
 */
async recordOutcome(actor: LearningActor, input: LearningOutcomeInput): Promise<void>

/**
 * Maturity metrics per task type `(space, artifactType, actionType)`. Each
 * metric is reported on its own: there is no composite index, no cohort
 * rule, and no threshold, because the cohort definition and the alert
 * threshold are unsigned (§10.2). Success is an approval with no correction
 * of any origin, so an answered doubt disqualifies it (W-80).
 * @param actor - identity and scope of the caller.
 * @param filter - optional task-type and period filters.
 * @returns one entry per task type, sorted by its three fields.
 */
async maturity(actor: LearningActor, filter: MaturityFilter = {}): Promise<readonly MaturityTaskTypeMetrics[]>

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

<a id="ctxfaberloommirror--faberloommirror"></a>

### `ctx.faberloomMirror` — `FaberLoomMirror`

The desktop side of the product mirror. It owns the compare-and-apply rule, the row journal, and the push debounce; the gateway owns the transport and the owner's own home.

```ts cordis-catalog
/**
 * Write the status document and say where it lives, so an operator reading a
 * host log has the state in one line instead of guessing from the panels. A
 * panel may call it too; the cycle calls it after every attempt.
 * @returns resolution after the document is written.
 */
async refreshStatus(): Promise<void>

/**
 * The owner skills root this side reads and writes.
 * @returns the absolute skills root.
 */
skillsRoot(): string

/**
 * The home this side mirrors: the storage root's parent when a deployment named
 * one, and the harness home otherwise. The status document belongs to the
 * medium's home, which is why the two are separate.
 * @returns the absolute home directory.
 */
home(): string

/**
 * Absolute path of the status document this side keeps.
 * @returns the absolute path.
 */
statusPath(): string

/**
 * One status snapshot: what the mirror is wired to and what its last cycle did.
 * @returns the document written to {@link statusPath}.
 */
status(): Record<string, unknown>

/** Write the status document; a failure is logged, never fatal to a cycle. */
async writeStatus(): Promise<void>

/** Clear the running timers without ending the mirror, for a service this process keeps. */
clearTimers(): void

/** Stop the timers; a stopped mirror never starts another cycle. */
stop(): void

/**
 * One full cycle: read this home, pull the remote document and apply it, then
 * push every local row the journal does not already match.
 * @returns what the cycle did, or undefined when the mirror is unwired or the peer refused.
 */
async sync(): Promise<FaberLoomMirrorSyncResult | undefined>

/**
 * Apply one document another side sent, without a cycle of this process:
 * validate the version, write or delete the rows, and write the skill files.
 * @param received - the parsed document the caller sent.
 * @returns what landed and the locations this process could not reach.
 * @throws when the document version or its structure is refused.
 */
async importDocument(received: unknown): Promise<FaberLoomMirrorImportResult>

/**
 * Read this home as one transfer document, for the side that serves it.
 * @returns the document and the locations this process cannot reach.
 */
async exportDocument(): Promise<FaberLoomMirrorExportResult>

/**
 * Write the skill bundles one received document carries.
 * @param skills - bundle name to `SKILL.md` text; a null entry is skipped.
 * @returns the bundles written and the names refused or unreadable.
 */
async writeMirroredSkills( skills: Readonly<Record<string, string | null>>, ): Promise<{ written: string[]; skipped: FaberLoomMirrorSkip[] }>

/**
 * Read the remote document from the gateway.
 * @returns the parsed document, or undefined when the request failed.
 */
async pull(): Promise<FaberLoomMirrorDocument | undefined>

/**
 * Absolute path of the row journal this side keeps between processes.
 * @returns the absolute path.
 */
journalPath(): string

/**
 * Read every skill bundle this owner holds as `name -> SKILL.md` text.
 * @returns the bundle texts and the bundles with no readable `SKILL.md`.
 */
async readSkills(): Promise<{ skills: Record<string, string>; skipped: readonly FaberLoomMirrorSkip[] }>
```

Source: [`packages/faberloom/mirror/src/index.ts`](../../packages/faberloom/mirror/src/index.ts)

<a id="ctxfaberloommodelcatalog--providermodelcatalog"></a>

### `ctx.faberloomModelCatalog` — `ProviderModelCatalog`

The model catalog service, published as `ctx.faberloomModelCatalog`.

Every call resolves its credential reference through the credentials seam, or through the launch environment while no seam is mounted, so a changed reference reaches the next call with no restart. No method caches a credential value.

```ts cordis-catalog
/**
 * The fixed provider protocol table.
 * @returns the frozen table, in the order the plugin declares it.
 */
providers(): readonly ProviderDescriptor[]

/**
 * Ask one provider which models it currently serves, authenticating with the
 * named credential reference.
 * @param providerId - the provider id to reach.
 * @param credentialRef - the reference resolved through `ctx.credentials`, or the launch environment.
 * @returns the normalized models, and records them as this provider's cached snapshot.
 * @throws LlmError `UNSUPPORTED_PROVIDER` for an unknown id, the credential error
 * `resolveCredential` raises, `TRANSPORT` when the request never completed, and
 * the probe failure codes when the provider rejected the request.
 */
discover(providerId: string, credentialRef: CredentialRef): Promise<DiscoveredModel[]>

/**
 * Probe whether one credential reference authenticates against a provider,
 * with a single attempt and a bounded timeout.
 * @param providerId - the provider id to probe.
 * @param credentialRef - the reference resolved through `ctx.credentials`, or the launch environment.
 * @returns the verdict, the HTTP status, a safe detail, and the served models on success.
 */
probe(providerId: string, credentialRef: CredentialRef): Promise<ProviderProbe>

/**
 * Read the cached last discovery per provider, without touching the network.
 * @returns one frozen snapshot per provider discovered so far, ordered by provider id.
 */
models(): readonly ModelCatalogSnapshot[]
```

Types: [CredentialRef](credentials.zh.md)

Source: [`packages/faberloom/model-catalog/src/types.ts`](../../packages/faberloom/model-catalog/src/types.ts)

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
 * Set who may see one routine. Only its owner may change it: a `private`
 * routine stops being published to its Space, so no other member, or their
 * agent, reads or edits it even while holding every module permission. The
 * definition version is untouched.
 * @param ownerId - the acting identity.
 * @param id - routine id.
 * @param visibility - `shared` or `private`.
 * @returns the updated routine.
 * @throws when the routine is absent or owned by another identity.
 */
async setRoutineVisibility(ownerId: string, id: FaberLoomRoutineId, visibility: RoutineVisibility): Promise<FaberLoomRoutine>

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
 * @param options - `skipCloudReady` leaves the routines that can run on the VPS
 *   to the VPS, for a desktop that mirrors to one and reads the same mailbox.
 * @returns the executions started or deduped.
 */
async ingest( ownerId: string, event: IngestEvent, options: { readonly skipCloudReady?: boolean } = {}, ): Promise<StartExecutionResult[]>

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

<a id="ctxfaberloomsessionagent--faberloomsessionagent"></a>

### `ctx.faberloomSessionAgent` — `FaberLoomSessionAgent`

The Space session composition service: resolves one session's Space agent, installs its persona, tool mask, and skills, and makes an `@Name` mention route its turn to that catalog agent.

```ts cordis-catalog
/**
 * The model route one session's Space agent runs on. It is a complete route
 * only when the agent declares both a provider and a model and stores an API
 * key; otherwise the value is `undefined`, so an unrouted or unkeyed agent
 * leaves the session on the deployment default. A session controller reads
 * this through `ctx.get('faberloomSessionAgent')` and applies it as the
 * session's default, below any explicit selection of its own.
 * @param agent - the session's agent.
 * @returns the agent's route, or `undefined`.
 */
routeFor(agent: Agent): SessionAgentRoute | undefined

/**
 * The scope one live Space session reads: its own Space, every sub-Space
 * below it, and the granted subtrees. A session outside a Space returns
 * `undefined`; a Space session whose scope is not cached reads it first, so a
 * tool call never observes an empty scope for a resolved session.
 * @param agent - the session's agent.
 * @returns the current scope, or `undefined`.
 */
async scopeFor(agent: Agent): Promise<SpaceScope | undefined>

/**
 * Read one Space subtree for a tool result. The caller authorizes the read
 * first: a Space in the session's own subtree needs no grant, and one outside
 * it is recorded through {@link grantRead}.
 * @param agent - the session's agent.
 * @param spaceId - the Space to describe.
 * @returns the Space subtree, or `undefined` when the actor cannot read it.
 */
async describeSpace(agent: Agent, spaceId: string): Promise<SpaceScopeNode | undefined>

/**
 * Whether the session already covers one Space: its own subtree or a granted
 * subtree. A covered Space needs no approval before a tool reads it.
 * @param agent - the session's agent.
 * @param spaceId - the Space to check.
 * @returns `true` when the Space is in the readable scope.
 */
coversSpace(agent: Agent, spaceId: string): boolean

/**
 * Refuse file or shell access that targets a Space outside this session's
 * scope, and refuse writes to a granted Space. The check covers the file
 * tools' path arguments and a folder spelling inside a shell command; a path
 * outside every Space (an attachment, a temp file, a skill installation)
 * stays readable exactly as before. A granted Space is no longer foreign, so
 * reads reopen it, while `write`, `edit`, and shell commands remain refused
 * because the grant is read-only.
 * @param agent - the session's agent.
 * @param toolName - the tool the model called.
 * @param args - the call's raw arguments.
 * @returns the refusal text, or undefined to allow the call.
 */
denyForeignRead(agent: Agent, toolName: string, args: unknown): string | undefined

/**
 * Record a durable read grant for one Space and refresh the session's scope.
 * The spaces service refuses a Space the actor may not read, so a grant can
 * never widen product access; it only records that this session may use it.
 * The grant is one log-only session event, so a resume replays it.
 * @param agent - the session's agent.
 * @param spaceId - the Space to grant.
 * @throws when the session is not a Space session or the actor cannot read the Space.
 */
async grantRead(agent: Agent, spaceId: string): Promise<void>
```

Types: [Agent](core.zh.md)

Source: [`packages/faberloom/session-agent/src/index.ts`](../../packages/faberloom/session-agent/src/index.ts)

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
 * Move every shared Session recorded under one Space to another Space.
 *
 * Folding a duplicate Space into its keeper deletes the duplicate row; the
 * transcripts keyed to it would otherwise disappear from the catalog. The
 * console still holds the original placement, so a later `sync` can import the
 * row again under the old Space; that Space no longer exists, and the import is
 * reported as skipped by its caller.
 * @param fromSpaceId - Space being folded away.
 * @param toSpaceId - Space that survives.
 * @returns the number of rows moved.
 */
async reassign(fromSpaceId: string, toSpaceId: string): Promise<number>

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
 * Create or update one share grant for a (resource, grantee) pair, notify a
 * new grantee by email, and publish it to the console when one is configured.
 * A new grant starts `pending`; re-sharing an already-accepted grant only moves
 * its permissions and stays `active`. Only an `active` grant authorizes an
 * action.
 * @param ownerId - the identity granting access.
 * @param input - resource, resource name, grantee email, and permissions.
 * @returns the created or updated grant.
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
 * Change the permissions one existing grant carries without re-inviting the
 * grantee: the console upsert keeps the grant active and only the permission
 * set moves, and the published snapshot is preserved. A no-op when the console
 * is not configured.
 * @param ownerId - the identity that owns the resource.
 * @param resource - the resource the grant names.
 * @param resourceName - the resource display name.
 * @param granteeEmail - the grantee whose permissions change.
 * @param permissions - the new permission set.
 */
async updatePermissions( ownerId: string, resource: FaberLoomShareResource, resourceName: string, granteeEmail: string, permissions: readonly string[], ): Promise<void>

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
 * The local copies this member materialized for other members' items, keyed
 * by local copy id, so a panel can decide whether the member holds the
 * module permission that lets it remove the copy.
 * @param actorId - the member reading.
 * @returns local copy id → its Space and resource family.
 */
async importedLocalCopies( actorId: string, ): Promise<ReadonlyMap<string, { spaceId: string; kind: FaberLoomSharedContentKind }>>

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
 * Forget the local copy a member materialized for one imported console row, so
 * a later sync materializes it again once the member regains the view
 * permission. A missing row is ignored.
 * @param readerId - the member that materialized the copy.
 * @param consoleId - the console-side row id.
 */
async clearContentLocal(readerId: string, consoleId: string): Promise<void>

/**
 * Import the console's shared-content rows for one member and prune the local
 * rows the console no longer carries, so a withdrawn item stops showing. A
 * no-op when the console is not configured. The reader reads back the removed
 * rows (with their `localId`) before this runs, so it can delete the
 * materialized copies.
 * @param readerId - the identity whose incoming items are imported.
 */
async syncContent(readerId: string): Promise<void>

/**
 * Retire one item another member shared in a Space, on this member's behalf:
 * tombstone its console row so the author's next publish does not resurrect
 * it, and drop the local import so it stops showing here and for every member
 * on their next sync. A no-op when the id is not an imported copy this member
 * holds, or the console is not configured.
 * @param actorId - the member retiring the item.
 * @param localId - the local copy id the retiring action names.
 * @returns true when an imported console row was retired.
 */
async deleteImported(actorId: string, localId: string): Promise<boolean>
```

Source: [`packages/faberloom/shares/src/index.ts`](../../packages/faberloom/shares/src/index.ts)

<a id="ctxfaberloomspaces--faberloomspaces"></a>

### `ctx.faberloomSpaces` — `FaberLoomSpaces`

The product spaces service. It owns the durable space records, the effective context resolution, the personal scope, the opaque work-directory references, and console-role access control; every operation carries the authenticated actor.

```ts cordis-catalog
/**
 * Create one space owned by the actor, scoped to its company, under an
 * optional parent the actor manages or holds `create-subspace` on. Every
 * identity may create its own root space, including a console read-only role.
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
 * Apply a mutable patch to one space the actor may manage. A grantee without
 * `manage-members` may change only `parentId`, and only with `move-space` on
 * this Space plus `create-subspace` on the destination.
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
 * Fold duplicate Spaces into one keeper.
 *
 * The keeper keeps its identity and Workspace binding and absorbs the
 * duplicates' members, exclusions, sources, context, prompt, and agent. Memory
 * entries that were attached to a duplicate are re-pointed at the keeper, and
 * its files move with them, so nothing the owner captured becomes invisible.
 * Curated context entries and shared Sessions are not handled here: the caller
 * checks them before merging, because a record keyed to the duplicate would be
 * lost with it.
 * @param actor - the acting identity.
 * @param keeperId - Space that survives.
 * @param duplicates - Spaces to fold into the keeper.
 * @returns the updated keeper.
 * @throws when either side is absent or the actor cannot manage it.
 */
async merge( actor: SpaceActor, keeperId: FaberLoomSpaceId, duplicates: readonly FaberLoomSpaceId[], ): Promise<FaberLoomSpace>

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
 * Edit one memory entry the actor owns, keeping its identity, placement, and
 * capture origin. A member cannot rewrite the owner's entry, exactly as with
 * visibility: memory that one identity captured stays that identity's fact.
 * @param actor - the acting identity.
 * @param id - memory entry id.
 * @param patch - the text and/or visibility to replace.
 * @returns the updated entry.
 * @throws when the entry is absent, owned by another identity, or the text is empty.
 */
async updateMemory( actor: SpaceActor, id: string, patch: { readonly text?: string; readonly visibility?: FaberLoomMemoryVisibility }, ): Promise<FaberLoomSpaceMemory>

/**
 * Set who may see one memory entry. Only its owner may change it: a `private`
 * entry stops being published to its Spaces, so no other member, or their
 * agent, reads or edits it even while holding every module permission.
 * @param actor - the acting identity.
 * @param id - memory entry id.
 * @param visibility - `shared` or `private`.
 * @returns the updated entry.
 * @throws when the entry is absent or owned by another identity.
 */
async setMemoryVisibility( actor: SpaceActor, id: string, visibility: FaberLoomMemoryVisibility, ): Promise<FaberLoomSpaceMemory>

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
 * A readable Space's curated context entries (`ctx.faberloomContext`) join
 * the scored text so a Space is found by what its context remembers, not
 * only by its title, map, and memory.
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
 * List the durable consultations a Space holds for this owner, newest first,
 * so the panel can report the Space's live agents.
 * @param spaceId - the Space whose consultations are read.
 * @returns one row per caller session consulting the Space.
 */
@Remote('spaceAgentRuntime') async spaceAgentRuntime(spaceId: string): Promise<readonly FaberLoomConsultationRow[]>

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
 * Set who may see one work flow (owner only). A `private` flow stops being
 * shared: no other member, and no other member's agent, reads or edits it.
 * @param id - work flow id.
 * @param visibility - `shared` or `private`.
 * @returns the refreshed rows.
 */
@Remote('setWorkflowVisibility') async setWorkflowVisibility(id: string, visibility: string): Promise<readonly FaberLoomWorkflowRow[]>

/**
 * Create an empty work flow and return the refreshed list.
 * @param name - display name.
 * @param spaceId - the Space the flow belongs to, or absent for the personal scope.
 * @returns the refreshed rows.
 */
@Remote('createWorkflow') async createWorkflow(name: string, spaceId?: string): Promise<readonly FaberLoomWorkflowRow[]>

/**
 * Remove one work flow the actor owns and return the refreshed list. A flow
 * another member shared stays read-only here. Deleting a Space flow publishes
 * the removal at once, so its members drop their copy without waiting.
 * @param id - work flow id.
 * @returns the refreshed rows.
 */
@Remote('deleteWorkflow') async deleteWorkflow(id: string): Promise<readonly FaberLoomWorkflowRow[]>

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
 * Replace the permissions one grantee holds on a Space, keeping the grant
 * active (no re-invite). The owner or a privileged role may change it.
 * @param id - space id.
 * @param email - the grantee whose permissions change.
 * @param permissions - the new permission set.
 * @returns the resource's outgoing grant rows.
 */
@Remote('setSpacePermissions') async setSpacePermissions(id: string, email: string, permissions: readonly string[]): Promise<readonly FaberLoomShareGrantRow[]>

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
 * Export the workspace/space context record for the browser to download.
 * @param spaceId - a Space to restrict to, or undefined for the personal scope plus every Space.
 * @param format - `json` (default) or `markdown`.
 * @returns the export body and file name.
 */
@Remote('exportContext') async exportContext(spaceId?: string, format?: string): Promise<FaberLoomContextExportRow>

/**
 * Write one exported view into a space's folder as a real file, so the agent's
 * file tools and the user see the same document: a Work Flow's portable JSON
 * (or its Archify HTML) or a Context export. The file lands under
 * `<space dir>/exportaciones/`.
 * @param spaceId - the space whose folder receives the export.
 * @param kind - `workflow` or `context`.
 * @param targetId - the Work Flow id, or the context's space id (empty for the owner's own).
 * @param format - `json` (default) or `archify` for a workflow, `markdown` for context.
 * @returns the written path and its byte count.
 */
@Remote('exportSpaceViewToFolder') async exportSpaceViewToFolder( spaceId: string, kind: string, targetId: string, format?: string, ): Promise<{ path: string; bytes: number }>

/**
 * Import a context record and return the refreshed entries.
 * @param payload - the exported JSON body.
 * @returns the refreshed rows.
 */
@Remote('importContext') async importContext(payload: string): Promise<readonly FaberLoomContextRow[]>

/**
 * Replace one Space's context record wholesale (owner only) and return the refreshed rows.
 * @param spaceId - the Space whose record is replaced.
 * @param entriesJson - the new entries as a JSON array of `{ title, body }`.
 * @returns the refreshed rows.
 */
@Remote('replaceContext') async replaceContext(spaceId: string, entriesJson: string): Promise<readonly FaberLoomContextRow[]>

/**
 * Capture the panel's local Sessions into one Space and return the refreshed
 * shared catalog.
 * @param spaceId - the Space to share the Sessions in.
 * @param sessions - the local Sessions the panel offers.
 * @returns the Space's shared Session rows.
 */
@Remote('captureSpaceSessions') async captureSpaceSessions( spaceId: string, sessions: readonly FaberLoomSharedSessionRef[], ): Promise<readonly FaberLoomSharedSessionRow[]>

/**
 * Sync one Space's Sessions in both directions and list its catalog: the
 * Sessions this host's area holds and the catalog does not carry yet are
 * published first, so the button also sends a conversation that already
 * existed, and then the other side's rows are mirrored into the area. The
 * mirror is what carries the catalog between one owner's machines, so neither
 * direction depends on the Space having been granted to another person.
 * @param spaceId - the Space to sync and list.
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
 * Turn an existing folder into a Space. The folder is adopted in place as a
 * root; with a parent, a folder outside that parent is moved inside it first,
 * so the Workspaces sidebar can render the same nesting.
 * @param title - display title; defaults to the folder name.
 * @param path - absolute existing folder.
 * @param parentId - parent Space when this is a sub-space.
 * @returns the refreshed overview.
 */
@Remote('createSpaceFromFolder') async createSpaceFromFolder(title: string, path: string, parentId?: string): Promise<FaberLoomOverview>

/**
 * Remove a space from the product: drop its Workspace registration, archive
 * its Sessions, and delete the space record. The physical folder and every
 * file in it stay where they are; deleting product metadata never deletes
 * operator files.
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
 * Read the full Markdown of one skill so the owner can edit it: the owner's own
 * copy when one exists, then the deployment-wide edition, then the shared or
 * role catalog copy the list shows.
 * @param name - skill name.
 * @returns the SKILL.md content.
 */
@Remote('skillMarkdown') async skillMarkdown(name: string): Promise<string>

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
 * Install one or more skills from a folder the user named, through the native
 * installer, so the copies and their `.dsh-skill-install.json` markers are the
 * ones the skill provider reads back. The source is a single skill directory (holding
 * `SKILL.md`) or a directory of skill directories; the installer validates
 * every candidate before writing, copies each whole skill directory with its
 * assets, reports an unchanged repeat install instead of copying again, and
 * skips an existing name unless `replace` is set.
 * @param source - folder to install from; resolved inside the workspace when the call has one.
 * @param destination - `workspace` writes under the workspace project skills root, `global` under `$DSH_HOME/skills`.
 * @param replace - true replaces a skill of the same name; false skips it.
 * @param workspaceRoot - the session's resolved workspace root; omitted uses the deployment default.
 * @returns the resolved destination root and one outcome per candidate.
 */
@Remote('installSkill') async installSkill( source: string, destination: FaberLoomSkillInstallDestination, replace?: boolean, workspaceRoot?: string, ): Promise<FaberLoomSkillInstallReport>

/**
 * Install a whole harness the operator picked — one folder, or one `.zip` —
 * into the user's own Harness home, through the native installer: its skills,
 * agents, rules, commands, scripts, hooks, and MCP server configurations,
 * each into the root the product already reads that kind from, so the copies
 * are live for every session of every Workspace and Space without a restart.
 * The destination is not a choice: a harness is the user's own setup, and the
 * rules land in the managed block of the home's own instructions file, which
 * is what makes them always on.
 * @param source - absolute folder or `.zip` the operator chose in the host's own dialog.
 * @param replace - rewrite a piece that is already there instead of skipping it.
 * @returns one part outcome per kind the source carried.
 */
@Remote('installHarness') async installHarness(source: string, replace?: boolean): Promise<FaberLoomHarnessReport>

/**
 * List the skills installed from a folder under the global root and, when a
 * workspace resolves, the workspace root, read back from the installer's
 * `.dsh-skill-install.json` markers.
 * @returns the install rows, sorted by name.
 */
@Remote('skillInstalls') async skillInstalls(): Promise<readonly FaberLoomSkillInstallRow[]>

/**
 * Remove one recorded install through the native installer, which removes a
 * directory only when it carries the install marker.
 * @param name - installed skill name.
 * @param destination - root the install landed in.
 * @returns the refreshed install rows.
 * @throws when the identity is read-only or names no marked install.
 */
@Remote('uninstallSkill') async uninstallSkill(name: string, destination: FaberLoomSkillInstallDestination): Promise<readonly FaberLoomSkillInstallRow[]>

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
 * Save one mailbox message's attachment(s) as real files inside a space's
 * folder, so the agent's file tools and the sidebar conversation work on the
 * actual document instead of a browser download. The files land under
 * `<space dir>/correo-adjuntos/`, the same convention the model tool uses.
 * @param spaceId - destination space.
 * @param uid - the message UID.
 * @param name - save only the attachment with this exact name; every attachment otherwise.
 * @returns the written files, each with its path and byte count.
 */
@Remote('saveSpaceAttachment') async saveSpaceAttachment( spaceId: string, uid: string, name?: string, ): Promise<{ files: readonly { name: string; path: string; bytes: number }[] }>

/**
 * Send one file that lives in a space's folder as an email attachment through
 * the owner's SMTP row. The path must resolve inside the space folder, so a
 * panel action can never mail an arbitrary file on the host.
 * @param spaceId - the space whose folder holds the file.
 * @param path - the file path, relative to the space folder (or absolute inside it).
 * @param to - comma-separated recipients.
 * @param subject - message subject.
 * @param text - plain-text body.
 * @returns the generated `Message-ID` and the accepted recipients.
 */
@Remote('sendSpaceFileByEmail') async sendSpaceFileByEmail( spaceId: string, path: string, to: string, subject: string, text: string, ): Promise<{ messageId: string; accepted: readonly string[] }>

/**
 * Turn one email into a Space: reuse the space with the same title when it
 * already exists, otherwise create it with its agent and Workspace, store the
 * email as the space's memory, and attach every file it carried.
 * @param uid - the message UID.
 * @param name - the space title (usually the subject).
 * @param agentId - the agent put in charge, when chosen and the space is new.
 * @param from - the sender line the browser already holds, for the seeded context.
 * @param spaceId - an existing space to attach the email to, when chosen.
 * @returns the space, its Workspace id, and the email as a first-message seed.
 */
@Remote('spaceFromEmail') async spaceFromEmail( uid: string, name: string, agentId?: string, from?: string, spaceId?: string, ): Promise<FaberLoomSpaceFromEmail>

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
 * @param spaceId - Space the routine belongs to; absent for the personal scope.
 * @returns the created routine.
 */
@Remote('routineFromEmail') async routineFromEmail( uid: string, name: string, instruction: string, subject?: string, from?: string, spaceId?: string, ): Promise<FaberLoomRoutineCreated>

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
 * Create a specialist from a proposal, preserving the conversation as its
 * origin and never copying another client's context (plan §6.5, F33–F35).
 * @param text - the responsibility the conversation described.
 * @param name - display name for the specialist.
 * @param spaceId - space it belongs to, or null for the personal scope.
 * @returns the refreshed overview.
 */
@Remote('createAgentFromWork') async createAgentFromWork(text: string, name: string, spaceId: string | null): Promise<FaberLoomOverview>

/**
 * Create a routine from a confirmed proposal and activate it; the owner
 * clicked the create action, so the routine should be usable immediately.
 * @param text - the procedure the conversation described.
 * @param name - display name for the routine.
 * @param spaceId - Space the routine belongs to; absent for the personal scope.
 * @returns the refreshed overview.
 */
@Remote('createRoutineFromWork') async createRoutineFromWork(text: string, name: string, spaceId?: string): Promise<FaberLoomOverview>

/**
 * Preview the audience and material that would change before linking work to a
 * space (F41); the user confirms before anything becomes visible.
 * @param spaceId - the candidate space.
 * @returns the preview the panel shows.
 */
@Remote('linkPreview') async linkPreview(spaceId: string): Promise<FaberLoomLinkPreview>

/**
 * Write the harness of one scope into its own folder: the agents, skills, work
 * flows, routines, memory, and context that scope used, plus the entrypoints
 * each CLI reads. The Space panel's "Preparar harness" button calls this.
 * @param kind - whether the scope is a registered Workspace or a product Space.
 * @param id - the Workspace id or the Space id.
 * @param title - display title the generated instructions carry.
 * @returns what the run wrote and pruned, or null when this deployment does not mount the projection row.
 */
@Remote('prepareHarness') async prepareHarness(kind: 'workspace' | 'space', id: string, title: string): Promise<FaberLoomHarnessProjection | null>

/**
 * Read one space's editable configuration.
 * @param id - the Space id.
 * @returns the editable fields, or undefined when this owner holds no such Space.
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
 * Read a Space's whole area once, for the panel's search and its grouping by
 * Session. Hidden entries are included; the read is bounded by the area
 * reader's entry and depth limits.
 * @param id - space id.
 * @returns the area's root and every entry under it.
 */
@Remote('spaceTree') async spaceTree(id: string): Promise<{ root: string; entries: readonly FaberLoomSpaceTreeEntry[] }>

/**
 * Rename one entry of a Space's area, keeping it in the same folder. The new
 * name is a single path segment: separators and the two directory aliases are
 * refused, so a rename cannot move the entry out of the area.
 * @param id - space id.
 * @param path - workspace-relative entry path.
 * @param name - the new entry name.
 */
@Remote('renameSpaceEntry') async renameSpaceEntry(id: string, path: string, name: string): Promise<void>

/**
 * Delete one or more entries of a Space's area. A directory is removed with
 * its contents; the area's own root is refused.
 * @param id - space id.
 * @param paths - workspace-relative entry paths.
 * @returns how many entries were removed.
 */
@Remote('deleteSpaceEntries') async deleteSpaceEntries(id: string, paths: readonly string[]): Promise<{ deleted: number }>

/**
 * Open one file of a Space's area with the application the operating system
 * associates with it, so Word, Excel, PDF, images, and video open the way the
 * user's file manager opens them. The path is workspace-relative and may not
 * leave the area; a deployment with no native opener (the Web) reports that
 * instead of pretending it opened anything.
 * @param id - space id.
 * @param path - workspace-relative file path.
 * @returns whether the operating system took the file.
 */
@Remote('openSpaceFile') async openSpaceFile(id: string, path: string): Promise<{ opened: boolean }>

/**
 * Open a space's conversation area: create the workdir when needed, register
 * it as a workspace titled after the space, and return its id so the browser
 * can start a session in it.
 * @param id - space id.
 * @returns the registered workspace projection.
 */
@Remote('openSpaceWorkspace') async openSpaceWorkspace(id: string): Promise<FaberLoomSpaceWorkspace>

/**
 * Adopt an existing folder as a space's conversation area: register the folder
 * as a Workspace titled after the space (reusing one already registered at the
 * same path) and point the space at it, so the Space and the sidebar Workspace
 * name the same directory instead of the deterministic `spaces/<ref>` area.
 * @param id - space id.
 * @param path - absolute folder the user chose.
 * @returns the adopted workspace projection.
 */
@Remote('adoptSpaceWorkspace') async adoptSpaceWorkspace(id: string, path: string): Promise<FaberLoomSpaceWorkspace>

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
 * List the MCP servers this owner installed, name-ascending, each carrying
 * its transport, whether it is enabled and mounted, and its credential entry
 * names with whether the seam holds a value; no value or reference crosses.
 * @returns the owner's saved servers.
 */
@Remote('mcpServers') async mcpServers(): Promise<readonly FaberLoomMcpServerRow[]>

/**
 * Install or replace one MCP server for this owner and mount it when enabled.
 * Every environment or header value goes to the credential seam, so a read
 * never returns one.
 * @param input - the server's name, transport, secret values, and enabled flag.
 * @returns the refreshed server list.
 * @throws when the identity is read-only or the transport's required field is missing.
 */
@Remote('saveMcpServer') async saveMcpServer(input: FaberLoomMcpServerInput): Promise<readonly FaberLoomMcpServerRow[]>

/**
 * Remove one MCP server, unmounting it and dropping the credentials its
 * entries held.
 * @param name - the server to remove.
 * @returns the refreshed server list.
 * @throws when the identity is read-only.
 */
@Remote('removeMcpServer') async removeMcpServer(name: string): Promise<readonly FaberLoomMcpServerRow[]>

/**
 * Test one candidate MCP server before it is saved, reporting the tools it
 * registered or the named reason it failed with every supplied secret
 * redacted. Nothing is written and no seam value is read.
 * @param input - the candidate server with its secret values.
 * @returns `{ ok: true, tools }`, or a named failure with its redacted detail.
 */
@Remote('probeMcpServer') async probeMcpServer(input: FaberLoomMcpServerInput): Promise<FaberLoomMcpProbeResult>

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
 * Assign or correct the human severity.
 * @param id - board item id.
 * @param severity - LOW, MEDIUM, HIGH, or CRITICAL.
 * @param rowVersion - expected optimistic token.
 * @param source - who assigned it.
 * @param confidence - original classifier confidence.
 * @returns the refreshed detail.
 */
@Remote('boardSetSeverity') async boardSetSeverity( id: string, severity: FaberLoomBoardSeverity, rowVersion: number, source: 'RULE' | 'LLM' | 'HUMAN', confidence: number | null, ): Promise<FaberLoomBoardDetail | undefined>

/**
 * Save inline edits as a new version and record the correction they are
 * (§6.3, W-34). The board commit happens first; the correction is written
 * afterwards and is best effort, so it may be missing while the item is
 * committed and `correctionError` then carries the message the panel shows on
 * one line.
 * @param id - board item id.
 * @param input - base version, row version, and changes.
 * @returns the refreshed detail and the correction failure, when any.
 */
@Remote('boardSaveEdits') async boardSaveEdits(id: string, input: FaberLoomBoardEditsInput): Promise<FaberLoomBoardEditResult>

/**
 * Approve the exact version and hash.
 * @param id - board item id.
 * @param input - expected row, artifact version, and hash.
 * @returns the refreshed detail.
 */
@Remote('boardApprove') async boardApprove(id: string, input: FaberLoomBoardApproveInput): Promise<FaberLoomBoardDetail | undefined>

/**
 * Save edits and approve the resulting version atomically.
 * @param id - board item id.
 * @param input - approval expectations plus the edits.
 * @returns the refreshed detail.
 */
@Remote('boardApproveWithEdits') async boardApproveWithEdits( id: string, input: FaberLoomBoardApproveInput & FaberLoomBoardEditsInput, ): Promise<FaberLoomBoardDetail | undefined>

/**
 * Discard an item with a signed reason.
 * @param id - board item id.
 * @param input - expected row, reason, and optional note.
 * @returns the refreshed detail.
 */
@Remote('boardDiscard') async boardDiscard(id: string, input: FaberLoomBoardDiscardInput): Promise<FaberLoomBoardDetail | undefined>

/**
 * Adopt or keep the pending candidate.
 * @param id - board item id.
 * @param candidateId - candidate the user saw.
 * @param candidateHash - hash the user saw.
 * @param decision - adopt or keep.
 * @returns the refreshed detail.
 */
@Remote('boardResolveCandidate') async boardResolveCandidate( id: string, candidateId: string, candidateHash: string, decision: 'adopt' | 'keep', ): Promise<FaberLoomBoardDetail | undefined>

/**
 * Assign a space to an item. A collision can close the item the caller named
 * and keep a peer live (§2.3), so the detail is read for the item the board
 * answered with and not for the id the view had; the drafts the collision
 * moved to it arrive in that detail (W-98).
 * @param id - board item id.
 * @param workspaceId - target space id.
 * @returns the refreshed detail of the live item.
 */
@Remote('boardAssignWorkspace') async boardAssignWorkspace(id: string, workspaceId: string): Promise<FaberLoomBoardDetail | undefined>

/**
 * Read the audit history of one item.
 * @param id - board item id.
 * @returns the events, oldest first.
 */
@Remote('boardEvents') async boardEvents(id: string): Promise<readonly FaberLoomBoardEventRow[]>

/**
 * Read one item's iteration attempt (§9.7.1). The board applies the owner and
 * company rule before answering, so the panel never re-derives who may see
 * the attempt (W-31).
 * @param id - board item id.
 * @returns the attempt, or undefined when the reader holds no item with that id.
 */
@Remote('boardIteration') async boardIteration(id: string): Promise<FaberLoomBoardIteration | undefined>

/**
 * Read the pinned context an iteration chat starts from (§8.5, §9.7). It is
 * minimised to the item: the board filters the item by owner and company, the
 * spaces service filters the title, and no account history or space memory
 * travels with it. The summary and the working draft travel only while the
 * item's data class is within the ceiling the deployment declared for the
 * provider the session runs on (W-48); above it the context keeps metadata
 * alone, so a model that may not receive the content receives none of it.
 * @param id - board item id.
 * @param providerId - provider the session runs on; an empty string means the
 * session names none, so the configured default is assumed.
 * @returns the context, or undefined when the reader holds no item with that id.
 */
@Remote('boardIterationContext') async boardIterationContext(id: string, providerId: string): Promise<FaberLoomBoardIterationContext | undefined>

/**
 * Start an iteration attempt over the version the caller saw. Starting never
 * changes the artifact version (W-11).
 * @param id - board item id.
 * @param baseVersion - artifact version the panel shows.
 * @param actorSession - tab opening the attempt, so two tabs are two attempts.
 * @returns the attempt after the commit.
 */
@Remote('boardIterationStart') async boardIterationStart( id: string, baseVersion: number, actorSession: string, ): Promise<FaberLoomBoardIteration>

/**
 * Store one write of the attempt's work as its working draft. A write for an
 * attempt that already ended is archived and the item is left untouched
 * (W-57), which is what `linked: false` tells the panel. A write from another
 * tab session is refused with `LOCK_HELD` and stores nothing (§9.7.1).
 * @param id - board item id.
 * @param input - attempt, generation, session, base version, and the draft summary.
 * @returns the stored draft and whether the item still links it.
 */
@Remote('boardIterationSaveDraft') async boardIterationSaveDraft( id: string, input: FaberLoomBoardIterationSaveInput, ): Promise<FaberLoomBoardIterationDraftRow>

/**
 * Apply the live attempt with the scope its correction teaches, writing one
 * new version and releasing the lock (W-34, W-40). The correction is recorded
 * after the commit and is best effort: it may be missing while the item is
 * committed, which is what `correctionError` reports.
 * @param id - board item id.
 * @param input - attempt, generation, session, base version, scope, and the candidate choice when one is pending.
 * @returns the attempt after the commit and the correction failure, when any.
 */
@Remote('boardIterationApply') async boardIterationApply( id: string, input: FaberLoomBoardIterationApplyInput, ): Promise<FaberLoomBoardIterationApplyResult>

/**
 * Extend the live attempt's lock while this tab works it (D-09, §9.7.1). The
 * board refuses a stale attempt id, a stale generation, another tab session,
 * or an expired deadline with `LOCK_LOST`, `ITERATION_STALE`, or `LOCK_HELD`
 * and no effects (W-43), so a renewal never touches the item's content or
 * version.
 * @param id - board item id.
 * @param input - attempt id, generation, and the tab session holding it.
 * @returns the attempt after the renewal.
 */
@Remote('boardIterationRenew') async boardIterationRenew(id: string, input: FaberLoomBoardIterationLockInput): Promise<FaberLoomBoardIteration>

/**
 * Save and exit, carry to SpaceLoom, or return without resolving: the attempt
 * releases the lock and keeps its draft (W-67, W-97).
 * @param id - board item id.
 * @param input - attempt, session, and the exit the user chose.
 * @returns the attempt after the commit.
 */
@Remote('boardIterationPause') async boardIterationPause( id: string, input: FaberLoomBoardIterationPauseInput, ): Promise<FaberLoomBoardIteration>

/**
 * Discard the attempt's work and release the lock. The version does not
 * change except through an explicit candidate adoption (W-41).
 * @param id - board item id.
 * @param input - attempt, session, and the candidate choice when one is pending.
 * @returns the attempt after the commit.
 */
@Remote('boardIterationCancel') async boardIterationCancel( id: string, input: FaberLoomBoardIterationCancelInput, ): Promise<FaberLoomBoardIteration>

/**
 * Take a new attempt over the retained draft. A draft written against an
 * older version is returned with its differences instead of overwriting the
 * newer content (W-68). The tab session is required: the resumed attempt
 * belongs to the session that opened it (§9.7.1).
 * @param id - board item id.
 * @param baseVersion - base version of the draft the caller saw.
 * @param actorSession - tab opening the attempt, so a resumed attempt belongs to it.
 * @returns the new attempt, or the stale draft's differences.
 */
@Remote('boardIterationResume') async boardIterationResume(id: string, baseVersion: number, actorSession: string): Promise<FaberLoomBoardIterationResume>

/**
 * Recover one draft a collision transferred to this item as the live draft of
 * a new attempt (§2.3, W-98). The board refuses a key that is not transferred
 * here or is past retention, and a draft written against an older version comes
 * back with its differences and no item write (W-68). Recovery never applies
 * the work: the panel still needs the normal Apply with a scope.
 * @param id - board item id.
 * @param draftKey - transferred draft key the detail listed.
 * @param actorSession - tab opening the attempt, so the attempt belongs to it.
 * @returns the new attempt, or the stale draft's differences.
 */
@Remote('boardIterationRecover') async boardIterationRecover( id: string, draftKey: string, actorSession: string, ): Promise<FaberLoomBoardIterationRecover>

/**
 * Read the item's retained draft and, when it was written against an older
 * version, the fields where it disagrees. Reading never changes the version.
 * @param id - board item id.
 * @param iterationId - attempt to read; omitted reads the draft the item links.
 * @returns the projected draft and its differences.
 */
@Remote('boardIterationDraft') async boardIterationDraft(id: string, iterationId?: string): Promise<FaberLoomBoardIterationDraftRead>

/**
 * Read the external effect of one item: the reservation that protects it, the
 * durable intention to emit it, the visible alerts it raised, and whether a
 * dispatched effect still awaits reconciliation (E15, §10.1).
 * @param id - board item id.
 * @returns the effect, or null when the item authorized none.
 */
@Remote('boardEffectStatus') async boardEffectStatus(id: string): Promise<FaberLoomBoardEffectStatus | null>

/**
 * The visible alerts of this tenant, newest first, with the item each names
 * resolved to its title. A late confirmation after an administrative close
 * raises one and never reopens the item (W-85).
 * @returns the alerts the Mesa shows.
 */
@Remote('boardEffectAlerts') async boardEffectAlerts(): Promise<readonly FaberLoomBoardEffectAlertRow[]>

/**
 * The effect policy the Mesa offers an executing approval: the action types an
 * acceptance may name and the reversal window of each (D-12).
 * @returns the action types and their windows.
 */
@Remote('boardEffectPolicy') async boardEffectPolicy(): Promise<FaberLoomBoardEffectPolicy>

/**
 * Approve the exact artifact and accept one execution for it: the approval,
 * the reservation, and the intention to emit are one command (§10.1). The
 * access service refuses a protected action type without an active CEO
 * signature and its refusal reaches the panel unchanged (W-16).
 * @param id - board item id.
 * @param input - approval expectations and the execution identity.
 * @returns the refreshed detail.
 */
@Remote('boardApproveWithExecution') async boardApproveWithExecution( id: string, input: FaberLoomBoardExecutionInput, ): Promise<FaberLoomBoardDetail | undefined>

/**
 * Revert a delegated execution inside its window: the reservation is released,
 * the intention is cancelled, and the item returns to the pending column
 * (W-18). A revert at or after the deadline is refused by the board.
 * @param id - board item id.
 * @param input - optimistic token and optional reason.
 * @returns the refreshed detail.
 */
@Remote('boardEffectRevert') async boardEffectRevert(id: string, input: FaberLoomBoardRevertInput): Promise<FaberLoomBoardDetail | undefined>

/**
 * Retry a failed execution, keeping the original execution identity, its
 * reservation, and its idempotency key (W-84). An unknown outcome is refused
 * unless the destination declared itself idempotent (W-21).
 * @param id - board item id.
 * @param input - optimistic token.
 * @returns the refreshed detail.
 */
@Remote('boardEffectRetry') async boardEffectRetry(id: string, input: FaberLoomBoardRetryInput): Promise<FaberLoomBoardDetail | undefined>

/**
 * Reconcile a dispatched effect with what the destination reports. A
 * confirmation executes the item, a failure makes it retryable, and an unknown
 * outcome leaves it recoverable (W-21, W-76).
 * @param id - board item id.
 * @param input - the outcome the destination reported.
 * @returns the refreshed detail.
 */
@Remote('boardEffectReconcile') async boardEffectReconcile( id: string, input: FaberLoomBoardReconcileInput, ): Promise<FaberLoomBoardDetail | undefined>

/**
 * Close an item administratively while its effect outcome is unknown: Owner or
 * Admin of the tenant, with a reason, and the reservation stays open so the
 * reconciliation remains possible (D-9, W-65).
 * @param id - board item id.
 * @param input - optimistic token and the mandatory reason.
 * @returns the closed detail and the item a pending candidate became.
 */
@Remote('boardEffectAdminClose') async boardEffectAdminClose( id: string, input: FaberLoomBoardAdminCloseInput, ): Promise<FaberLoomBoardAdminCloseResult>

/**
 * Whether one protected action type carries an active CEO signature for this
 * reader's tenant, so the panel can say why approval would refuse (W-16).
 * @param actionType - the action type the approval would run.
 * @returns the signature state for this reader.
 */
@Remote('boardSignatureStatus') async boardSignatureStatus(actionType: string): Promise<FaberLoomSignatureRow>

/**
 * Every protected action type and the signature state that covers it, which is
 * what the signature panel lists.
 * @returns one row per protected action type, in the order the deployment declares them.
 */
@Remote('boardSignatures') async boardSignatures(): Promise<readonly FaberLoomSignatureRow[]>

/**
 * Issue one CEO signature for the acting identity's tenant. The access service
 * refuses an identity that is not a configured signing authority, and its
 * refusal reaches the panel unchanged.
 * @param input - the action types the signature covers and an optional expiry.
 * @returns the refreshed signature rows.
 */
@Remote('boardSignatureIssue') async boardSignatureIssue(input: SignatureIssueInput): Promise<readonly FaberLoomSignatureRow[]>

/**
 * Revoke one signature of the acting identity's tenant; the next approval of a
 * covered action type refuses from that instant.
 * @param signatureId - signature to revoke.
 * @returns the refreshed signature rows.
 */
@Remote('boardSignatureRevoke') async boardSignatureRevoke(signatureId: string): Promise<readonly FaberLoomSignatureRow[]>

/**
 * Clear staleness after checking whether the underlying condition changed.
 * @param id - board item id.
 * @param changed - whether the artifact actually changed.
 * @returns the refreshed detail.
 */
@Remote('boardRevalidate') async boardRevalidate(id: string, changed: boolean): Promise<FaberLoomBoardDetail | undefined>

/**
 * Read the caller's edit draft.
 * @param id - board item id.
 * @returns the draft, or null.
 */
@Remote('boardGetDraft') async boardGetDraft(id: string): Promise<FaberLoomBoardDraftRow | null>

/**
 * Save one draft write, conditional on its revision and writer tab.
 * @param id - board item id.
 * @param input - base version, revision, tab, and changes.
 * @returns the stored draft.
 */
@Remote('boardSaveDraft') async boardSaveDraft(id: string, input: FaberLoomBoardDraftInput): Promise<FaberLoomBoardDraftRow>

/**
 * Take the writer seat for one tab.
 * @param id - board item id.
 * @param writerSession - the requesting tab.
 * @returns the draft with this tab as writer.
 */
@Remote('boardTakeDraft') async boardTakeDraft(id: string, writerSession: string): Promise<FaberLoomBoardDraftRow>

/**
 * Discard the caller's edit draft.
 * @param id - board item id.
 */
@Remote('boardDiscardDraft') async boardDiscardDraft(id: string): Promise<void>

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
 * Create one routine the owner can then activate, or activate immediately
 * when the caller asked for a working routine (the MCP create tool does).
 * @param name - display name.
 * @param intent - the procedure the routine performs.
 * @param spaceId - Space the routine belongs to; empty or absent for the personal scope.
 * @param activate - activate the new routine before returning.
 * @returns the refreshed overview.
 */
@Remote('createRoutine') async createRoutine(name: string, intent: string, spaceId?: string, activate?: boolean): Promise<FaberLoomOverview>

/**
 * Activate or pause one routine.
 * @param id - routine id.
 * @param active - true activates, false pauses.
 * @returns the refreshed overview.
 */
@Remote('setRoutineActive') async setRoutineActive(id: string, active: boolean): Promise<FaberLoomOverview>

/**
 * Set who may see one routine (owner only). A `private` routine stops being
 * published: no other member, and no other member's agent, reads or edits it.
 * @param id - routine id.
 * @param visibility - `shared` or `private`.
 * @returns the refreshed overview.
 */
@Remote('setRoutineVisibility') async setRoutineVisibility(id: string, visibility: string): Promise<FaberLoomOverview>

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
 * Edit one space-memory entry the owner controls and return the refreshed
 * list. The entry keeps its id, placement, and capture origin; only the text
 * and visibility change.
 * @param id - memory entry id.
 * @param text - replacement text.
 * @param visibility - optional `shared` or `private`.
 * @returns the refreshed memory rows, oldest first.
 */
@Remote('editSpaceMemory') async editSpaceMemory(id: string, text: string, visibility?: string): Promise<readonly FaberLoomSpaceMemoryRow[]>

/**
 * Delete one space-memory entry the owner controls and return the refreshed
 * list. Deleting a space never deletes its memory; this is the only path that
 * removes an entry, and it is explicit.
 * @param id - memory entry id.
 * @returns the remaining memory rows, oldest first.
 */
@Remote('deleteSpaceMemory') async deleteSpaceMemory(id: string): Promise<readonly FaberLoomSpaceMemoryRow[]>

/**
 * Set who may see one memory entry (owner only). A `private` entry stops
 * being published: no other member, and no other member's agent, reads or
 * edits it.
 * @param id - memory entry id.
 * @param visibility - `shared` or `private`.
 * @returns the refreshed memory rows, oldest first.
 */
@Remote('setMemoryVisibility') async setMemoryVisibility(id: string, visibility: string): Promise<readonly FaberLoomSpaceMemoryRow[]>
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
 * Set who may see one work flow. Only its owner may change it: a `private`
 * flow stops being shared or published, so no other member, or their agent,
 * reads or edits it even while holding every module permission. Setting it
 * private also revokes its outgoing direct grants, because a grantee's
 * imported copy carries its own visibility and must stop resolving. The graph
 * version is untouched, so a staged change stays based on the same version.
 * @param actor - the acting identity.
 * @param id - work flow id.
 * @param visibility - `shared` or `private`.
 * @returns the updated work flow.
 * @throws when the flow is absent or owned by another identity.
 */
async setVisibility(actor: WorkFlowActor, id: WorkFlowId, visibility: WorkFlowVisibility): Promise<WorkFlow>

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
