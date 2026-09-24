/**
 * Client-safe FaberLoom workspace rows. Every field is plain JSON: the browser
 * consumes these through the generated Remote client, so no host entity,
 * branded id, or Date crosses the boundary.
 */

/** One workspace space as the sidebar and Espacios panel render it. */
export interface FaberLoomSpaceRow {
  /** Space id. */
  readonly id: string
  /** Display title. */
  readonly title: string
  /** Parent space id, or null for a root space. */
  readonly parentId: string | null
  /** The agent in charge of the space (first agent whose owning space is this one), or null. */
  readonly agentId: string | null
  /** Display name of {@link FaberLoomSpaceRow.agentId}, or null. */
  readonly agentName: string | null
  /** The registered Workspace for the space's conversation area, or null when none is registered. */
  readonly workspaceId: string | null
}

/** One catalog agent as the Agentes panel renders it. */
export interface FaberLoomAgentRow {
  /** Agent id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Owning space id, or null for an unscoped agent. */
  readonly spaceId: string | null
  /** Whether the agent is still active in the catalog. */
  readonly active: boolean
}

/** One board item as the Mesa de trabajo panel renders it. */
export interface FaberLoomBoardRow {
  /** Board item id. */
  readonly id: string
  /** Item title. */
  readonly title: string
  /** Current status token. */
  readonly status: string
}

/** One routine as the Rutinas panel renders it. */
export interface FaberLoomRoutineRow {
  /** Routine id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Current status token. */
  readonly status: string
}

/** One space-scoped memory entry the Memoria panel renders. */
export interface FaberLoomSpaceMemoryRow {
  /** Entry id. */
  readonly id: string
  /** Remembered text. */
  readonly text: string
  /** Spaces the entry is attached to. */
  readonly spaceIds: readonly string[]
  /** ISO-8601 creation instant. */
  readonly createdAt: string
}

/** One mailbox envelope the Email panel lists. */
export interface FaberLoomInboxRow {
  /** Mailbox UID. */
  readonly id: string
  /** `Message-ID` header, or null. */
  readonly messageId: string | null
  /** `From` header, or null. */
  readonly from: string | null
  /** `Subject` header, or null. */
  readonly subject: string | null
  /** `Date` header, or null. */
  readonly date: string | null
}

/** One email draft as the Email panel reads it. */
export interface FaberLoomEmailDraftRow {
  /** Draft id. */
  readonly id: string
  /** Recipients. */
  readonly to: readonly string[]
  /** Carbon-copy recipients. */
  readonly cc: readonly string[]
  /** Subject line. */
  readonly subject: string
  /** Plain-text body. */
  readonly text: string
  /** Lifecycle status. */
  readonly status: string
  /** The AI's original text, when machine-written; otherwise null. */
  readonly aiText: string | null
  /** `Message-ID` this draft replies to, or null. */
  readonly inReplyTo: string | null
  /** Space the draft belongs to, or null. */
  readonly spaceId: string | null
  /** Creation instant, ISO-8601. */
  readonly createdAt: string
  /** Last update instant, ISO-8601. */
  readonly updatedAt: string
  /** Send instant, or null while unsent. */
  readonly sentAt: string | null
}

/** Create or replace input for one email draft. */
export interface EmailDraftSaveInput {
  /** Draft id, when updating. */
  readonly id?: string
  /** Recipients. */
  readonly to: readonly string[]
  /** Carbon-copy recipients. */
  readonly cc?: readonly string[]
  /** Subject line. */
  readonly subject: string
  /** Plain-text body. */
  readonly text: string
  /** The AI's original text, when the draft is machine-written. */
  readonly aiText?: string | null
  /** `Message-ID` this draft replies to. */
  readonly inReplyTo?: string | null
  /** Space the draft belongs to. */
  readonly spaceId?: string | null
}

/** One attachment of a message as the Email panel reads it. */
export interface FaberLoomEmailAttachment {
  /** File name. */
  readonly name: string
  /** Media type. */
  readonly mediaType: string
  /** Byte length. */
  readonly size: number
}

/** One decoded message as the Email panel reads it. */
export interface FaberLoomEmailContent {
  /** Plain-text body, empty when the message carried none. */
  readonly text: string
  /** HTML body, or null when the message carried none. */
  readonly html: string | null
  /** Attachment metadata, in order. */
  readonly attachments: readonly FaberLoomEmailAttachment[]
}

/** One attachment's bytes, base64-encoded, for download. */
export interface FaberLoomEmailAttachmentContent {
  /** File name. */
  readonly name: string
  /** Media type. */
  readonly mediaType: string
  /** Decoded bytes, base64-encoded. */
  readonly contentBase64: string
}

/** Auto-send policy as the Email panel reads it. */
export interface FaberLoomEmailPolicy {
  /** Whether automatic sending is enabled. */
  readonly enabled: boolean
  /** Consecutive clean AI sends required before automatic sending. */
  readonly threshold: number
  /** Consecutive AI drafts currently sent without owner edits. */
  readonly cleanSends: number
}

/** Update input for the auto-send policy. */
export interface EmailPolicySaveInput {
  /** Space the policy applies to; absent is the owner-wide policy. */
  readonly spaceId?: string | null
  /** Whether automatic sending is enabled. */
  readonly enabled: boolean
  /** Consecutive clean sends required. */
  readonly threshold: number
}

/** Input for one AI-written email draft. */
export interface EmailDraftAiInput {
  /** Recipients. */
  readonly to: readonly string[]
  /** Subject line. */
  readonly subject: string
  /** What the email should say, in the owner's words. */
  readonly instruction: string
  /** Body of the email being answered, when replying. */
  readonly replyToBody?: string | null
  /** Space the draft belongs to. */
  readonly spaceId?: string | null
}

/** One L1 memory row the Memoria panel renders, as the memory server returns it. */
export interface FaberLoomMemoryRow {
  /** Record id. */
  readonly id: string
  /** Memory kind token (episodic, persona, instruction). */
  readonly kind: string
  /** Record text. */
  readonly text: string
  /** Last update time, ISO. */
  readonly at: string
}

/** Consumer-facing types of the product connections service, re-exported so the
 * Remote boundary resolves them from this package's own public type subpath. */
export type { FaberLoomConnection, ConnectionInput, ConnectionProbe } from '@deepseek-ai/dsh-faberloom-connections'

/** One routine step as the editor reads it. */
export interface FaberLoomRoutineStepRow {
  /** Step id within the routine. */
  readonly id: string
  /** What the step does. */
  readonly instruction: string
  /** Handler that runs it. */
  readonly handler: string
  /** Steps that must finish first. */
  readonly dependsOn: readonly string[]
  /** Wait key the step waits for, or null. */
  readonly waitFor: string | null
  /** Whether the step performs an external effect. */
  readonly effect: boolean
}

/** One routine with its full editable definition. */
export interface FaberLoomRoutineDetail {
  /** Routine id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Lifecycle status. */
  readonly status: string
  /** Current version number. */
  readonly version: number
  /** Every stored version, ascending. */
  readonly versions: readonly number[]
  /** The procedure's intent. */
  readonly intent: string
  /** Trigger kind. */
  readonly triggerKind: string
  /** Trigger match, when the kind needs one. */
  readonly triggerMatch: string | null
  /** The steps in order. */
  readonly steps: readonly FaberLoomRoutineStepRow[]
  /** Expected result. */
  readonly expectedResult: string
  /** Permissions the routine requires. */
  readonly permissions: readonly string[]
  /** What happens on failure. */
  readonly failurePolicy: string
}

/** Editable routine fields. */
export interface RoutineSaveInput {
  /** Display name. */
  readonly name?: string
  /** The procedure's intent. */
  readonly intent?: string
  /** Trigger kind. */
  readonly triggerKind?: string
  /** Trigger match, or null. */
  readonly triggerMatch?: string | null
  /** Replacement steps, in order. */
  readonly steps?: readonly FaberLoomRoutineStepRow[]
  /** Expected result. */
  readonly expectedResult?: string
  /** Permissions, replaced wholesale. */
  readonly permissions?: readonly string[]
  /** Failure policy. */
  readonly failurePolicy?: string
}

/** One space with its full editable configuration. */
export interface FaberLoomSpaceDetail {
  /** Space id. */
  readonly id: string
  /** Display title. */
  readonly title: string
  /** Parent space id, or null for a root space. */
  readonly parentId: string | null
  /** Whether the space inherits its parent's context. */
  readonly inheritContext: boolean
  /** Spaces explicitly excluded from inheritance. */
  readonly excluded: readonly string[]
  /** Members with access. */
  readonly members: readonly string[]
  /** Commercial sources the space declares. */
  readonly sources: readonly { readonly kind: string; readonly ref: string }[]
  /** Context keys the space carries. */
  readonly contextKeys: readonly string[]
  /** The agent in charge of the space, or null when none is assigned. */
  readonly agentId: string | null
}

/** Editable space fields; an absent field stays unchanged. */
export interface SpaceSaveInput {
  /** New display title. */
  readonly title?: string
  /** New inheritance switch. */
  readonly inheritContext?: boolean
  /** New member list, replaced wholesale. */
  readonly members?: readonly string[]
  /** New responsible agent, or null to clear the assignment. */
  readonly agentId?: string | null
}

/** One board item with its review state. */
export interface FaberLoomBoardDetail {
  /** Board item id. */
  readonly id: string
  /** Item title. */
  readonly title: string
  /** Current status token. */
  readonly status: string
  /** Revision number being reviewed. */
  readonly version: number
  /** Summary of the prepared result. */
  readonly summary: string
  /** Evidence references. */
  readonly evidence: readonly string[]
  /** Approved revision number, or null. */
  readonly approvedRevision: number | null
  /** Whether the prepared result went stale. */
  readonly stale: boolean
  /** Why it went stale, or null. */
  readonly staleReason: string | null
  /** Recorded external effects. */
  readonly effects: readonly { readonly ref: string; readonly detail: string | null; readonly at: string }[]
}

/** Editable fields of a new teaching; the author is the signed-in owner. */
export interface TeachingSaveInput {
  /** Application scope. */
  readonly scope: string
  /** The teaching text. */
  readonly text: string
  /** Where it came from (a case reference, the user, a document). */
  readonly source: string
  /** Owning space, when scoped. */
  readonly spaceId?: string
  /** Owning agent, when scoped. */
  readonly agentId?: string
  /** Owning skill, when scoped. */
  readonly skill?: string
  /** Task label, when scoped. */
  readonly task?: string
  /** Whether an explicit instruction is remembered active; inferred ones stay candidates. */
  readonly active?: boolean
}

/** Editable fields of one autonomy grant. */
export interface GrantSaveInput {
  /** The action to authorize. */
  readonly action: string
  /** Optional agent scope. */
  readonly agentId?: string
  /** Optional context scope. */
  readonly context?: string
  /** Optional note. */
  readonly note?: string
  /** Optional ISO-8601 expiry. */
  readonly expiresAt?: string
}

/** Fields for minting one MCP client token. */
export interface McpTokenInput {
  /** Who the token is for. */
  readonly label: string
  /** Tool names the client may call; empty or absent means the full surface. */
  readonly scopes?: readonly string[]
}

/** One MCP client token as the panels read it. */
export interface FaberLoomMcpTokenRow {
  /** The bearer token an external client presents. */
  readonly token: string
  /** Who the token was minted for. */
  readonly label: string
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 revocation instant, or null while it works. */
  readonly revokedAt: string | null
  /** Tool names the client may call, or null for the full surface. */
  readonly scopes: readonly string[] | null
}

/** One external MCP server the harness is connected to as a client. */
export interface FaberLoomMcpClientStatus {
  /** Server name from the deployment (e.g. `mwt`). */
  readonly name: string
  /** Tool names this server published, sorted. */
  readonly tools: readonly string[]
}

/** A space's conversation area as the Spaces panel reads it. */
export interface FaberLoomSpaceWorkspace {
  /** Whether a workspace is already registered for the space's workdir. */
  readonly registered: boolean
  /** Workspace id, when registered (used to start sessions in it). */
  readonly workspaceId: string | null
  /** Workspace display title, when registered. */
  readonly title: string | null
  /** Live sessions currently grouped under the workspace. */
  readonly sessions: number
}

/** Input for one new board revision prepared for review. */
export interface BoardRevisionInput {
  /** What was prepared, in one paragraph. */
  readonly summary: string
  /** Evidence references backing the summary (at least one). */
  readonly evidence: readonly string[]
}

/** The owner's MWT.ONE access as the Connections panel presents it. */
export interface FaberLoomMwtStatus {
  /** The authenticated identity. */
  readonly ownerId: string
  /** The console role. */
  readonly role: string
  /** The active company id, or null when the user has none or several. */
  readonly companyId: string | null
  /** Every company the user belongs to; the chat can query any of them. */
  readonly companyIds: readonly string[]
  /** Every company with its resolved display name (null when unknown). */
  readonly companies: readonly { readonly id: string; readonly name: string | null }[]
  /** External MCP servers connected for this identity, with their tools. */
  readonly servers: readonly FaberLoomMcpClientStatus[]
}

/** One versioned teaching as the panels read it. */
export interface FaberLoomTeachingRow {
  /** Stable teaching id shared by every version. */
  readonly id: string
  /** Application scope. */
  readonly scope: string
  /** Owning space id, or null. */
  readonly spaceId: string | null
  /** Owning agent id, or null. */
  readonly agentId: string | null
  /** Owning skill, or null. */
  readonly skill: string | null
  /** Task label it applies to, or null. */
  readonly task: string | null
  /** The teaching text. */
  readonly text: string
  /** Where it came from. */
  readonly source: string
  /** Who stated it. */
  readonly author: string
  /** Lifecycle status. */
  readonly status: string
  /** Monotonic version. */
  readonly version: number
  /** References where it was recovered and used. */
  readonly uses: readonly string[]
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
}

/** Contextual performance the panel shows as evidence. */
export interface FaberLoomPerformanceRow {
  /** Total recorded outcomes. */
  readonly uses: number
  /** Approved outcomes. */
  readonly approved: number
  /** Corrected outcomes. */
  readonly corrected: number
  /** Corrections caused by an agent error. */
  readonly agentFailures: number
  /** Corrections by cause. */
  readonly correctionsByCause: Readonly<Record<string, number>>
  /** Corrected over uses, or null when there is no sample. */
  readonly correctionRate: number | null
}

/** One spend group of the cost panel. */
export interface FaberLoomCostRow {
  /** Display key: model id, agent id, or task label. */
  readonly key: string
  /** Known spend accumulated in the group. */
  readonly cost: number
  /** Selection records in the group. */
  readonly records: number
  /** True when some record in the group carried no cost. */
  readonly partial: boolean
}

/** Per-user spend summary the cost panel shows. */
export interface FaberLoomCostSummary {
  /** Shared currency, or null when mixed or unknown. */
  readonly currency: string | null
  /** Known spend over every considered selection. */
  readonly total: number
  /** Selection records considered. */
  readonly records: number
  /** True when some considered record carried no cost. */
  readonly partial: boolean
  /** ISO-8601 instant of the oldest considered selection. */
  readonly since: string | null
  /** ISO-8601 instant the summary was computed. */
  readonly at: string
  /** Spend grouped by effective model. */
  readonly byModel: readonly FaberLoomCostRow[]
  /** Spend grouped by agent. */
  readonly byAgent: readonly FaberLoomCostRow[]
  /** Spend grouped by task. */
  readonly byTask: readonly FaberLoomCostRow[]
}

/** One autonomy grant as the panels read it. */
export interface FaberLoomGrantRow {
  /** Stable grant id. */
  readonly id: string
  /** The action it authorizes. */
  readonly action: string
  /** Agent it is scoped to, or null for any agent. */
  readonly agentId: string | null
  /** Context it is scoped to, or null for any context. */
  readonly context: string | null
  /** Optional note. */
  readonly note: string | null
  /** ISO-8601 expiry, or null for no expiry. */
  readonly expiresAt: string | null
  /** Whether it was revoked. */
  readonly revoked: boolean
}

/** One execution as the panels render it. */
export interface FaberLoomExecutionRow {
  /** Execution id. */
  readonly id: string
  /** Routine that produced it. */
  readonly routineId: string
  /** Routine name the case belongs to, or the id when it was removed. */
  readonly routineName: string
  /** Routine version the execution started with. */
  readonly routineVersion: number
  /** Current status token. */
  readonly status: string
  /** Wait pattern the execution is blocked on, or null. */
  readonly waitingFor: string | null
  /** When the wait stops being reasonable, or null when it has no deadline. */
  readonly deadlineAt: string | null
  /** Stable reason code, or null. */
  readonly reason: string | null
  /** Steps already done. */
  readonly doneSteps: number
  /** Steps in the running version. */
  readonly totalSteps: number
  /** Per-step status, in the order the routine declares them. */
  readonly steps: readonly {
    readonly id: string
    readonly status: string
    readonly text: string | null
    readonly reason: string | null
    /** Whether the step records a business effect. */
    readonly effect: boolean
  }[]
  /** Evidence entries gathered. */
  readonly evidenceCount: number
  /** The event that started or resumed the case, or null. */
  readonly event: { readonly key: string; readonly type: string; readonly subject: string | null } | null
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** Last durable update, ISO-8601. */
  readonly updatedAt: string
}

/** One skill available to the owner. */
export interface FaberLoomSkillRow {
  /** Skill name (its directory), unique within the role catalog and the owner's uploads. */
  readonly name: string
  /** Description from the skill frontmatter. */
  readonly description: string
  /** Module the skill belongs to, when the frontmatter declares one. */
  readonly module: string | null
  /** Action the skill covers, when the frontmatter declares one. */
  readonly action: string | null
  /** Where the skill came from: the role catalog or the owner's own uploads. */
  readonly origin: 'role' | 'owner'
  /** Ids of the agents that already list this skill. */
  readonly assignedTo: readonly string[]
}

/** One agent with its full editable configuration. */
export interface FaberLoomAgentDetail {
  /** Agent id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Responsibility statement; the agent's base instruction. */
  readonly responsibility: string
  /** Assigned skill names. */
  readonly skills: readonly string[]
  /** Executable tools the agent may run. */
  readonly tools: readonly string[]
  /** Whether the agent is active in the catalog. */
  readonly active: boolean
  /** Owning space id, or null. */
  readonly spaceId: string | null
  /** Primary model id from the agent policy, or null when unset. */
  readonly primaryModelId: string | null
  /** Whether the agent must use only its primary model. */
  readonly exclusive: boolean
  /** Ordered fallbacks used when the provider is unavailable. */
  readonly fallbacks: readonly string[]
  /** Authorized escalation, or null when none is configured. */
  readonly escalation: AgentEscalationInput | null
  /** Shared execution budget, or null when none is configured. */
  readonly budget: AgentBudgetInput | null
  /** Model provider id, or null when unset. */
  readonly provider: string | null
  /** Model id within the provider, or null when unset. */
  readonly model: string | null
  /** Whether a provider API key is stored; the key itself is never returned. */
  readonly hasApiKey: boolean
  /** Whether the agent may browse the open web; otherwise only MWT.ONE MCP. */
  readonly webAccess: boolean
  /** Whether the agent may query the MWT.ONE MCP server. */
  readonly mwtMcp: boolean
  /** Mail connection ids the agent may use. */
  readonly mailConnectionIds: readonly string[]
  /** Agent ids this agent may communicate with. */
  readonly subagentIds: readonly string[]
}

/** One model of the agent model pool, as the panel reads it. */
export interface FaberLoomModelRow {
  /** Pool id used by every policy field. */
  readonly id: string
  /** Provider name. */
  readonly provider: string
  /** Provider model id. */
  readonly model: string
  /** Verified capability tags. */
  readonly capabilities: readonly string[]
  /** Context window in tokens, or null when unknown. */
  readonly contextWindow: number | null
  /** Maximum output tokens, or null when unknown. */
  readonly maxOutput: number | null
  /** Input price per million tokens, or null when no rate is known. */
  readonly inputPerMillion: number | null
  /** Output price per million tokens, or null when no rate is known. */
  readonly outputPerMillion: number | null
  /** Currency of the rates, or null. */
  readonly currency: string | null
  /** Whether the provider is currently reachable. */
  readonly available: boolean
}

/** One ranked model recommendation the panel renders. */
export interface FaberLoomModelCandidate {
  /** Candidate model id. */
  readonly modelId: string
  /** Estimated cost per useful result, or null when it cannot be estimated. */
  readonly estimatedCost: number | null
  /** Evidence uses behind the estimate. */
  readonly uses: number
  /** Whether the model has no evidence for this task yet. */
  readonly provisional: boolean
  /** Why the candidate is suggested or limited. */
  readonly reasons: readonly string[]
}

/** What the recommender answered for one agent. */
export interface FaberLoomModelRecommendation {
  /** Recommended model id, or null when nothing is admissible. */
  readonly recommended: string | null
  /** Ordered alternatives after the recommendation. */
  readonly alternatives: readonly FaberLoomModelCandidate[]
  /** Uncertainty statements (missing rates, no evidence). */
  readonly uncertainty: readonly string[]
}

/** Editable escalation policy; absent fields stay unchanged. */
export interface AgentEscalationInput {
  /** Authorized escalation model ids. */
  readonly authorized: readonly string[]
  /** Conditions that justify escalating. */
  readonly conditions: readonly string[]
  /** Whether escalation proceeds automatically or asks first. */
  readonly mode: string
}

/** Editable budget policy; absent fields stay unchanged. */
export interface AgentBudgetInput {
  /** Maximum estimated cost per execution. */
  readonly perExecution: number
  /** Currency of the budget. */
  readonly currency: string
  /** Maximum provider attempts, including fallbacks. */
  readonly maxAttempts: number
  /** Maximum escalations within one execution. */
  readonly maxEscalations: number
}

/** Editable agent fields; an absent field stays unchanged. */
export interface AgentSaveInput {
  /** New display name. */
  readonly name?: string
  /** New responsibility statement. */
  readonly responsibility?: string
  /** Replacement skill list. */
  readonly skills?: readonly string[]
  /** New primary model id, or null to clear it. */
  readonly primaryModelId?: string | null
  /** New exclusivity flag. */
  readonly exclusive?: boolean
  /** Replacement ordered fallbacks. */
  readonly fallbacks?: readonly string[]
  /** Replacement escalation policy, or null to clear it. */
  readonly escalation?: AgentEscalationInput | null
  /** Replacement budget policy, or null to clear it. */
  readonly budget?: AgentBudgetInput | null
  /** New provider, or null to clear it. */
  readonly provider?: string | null
  /** New model id, or null to clear it. */
  readonly model?: string | null
  /** New provider API key; an empty string clears it. */
  readonly apiKey?: string
  /** New web-access switch. */
  readonly webAccess?: boolean
  /** New MWT.ONE MCP access switch. */
  readonly mwtMcp?: boolean
  /** Replacement mail-connection id list. */
  readonly mailConnectionIds?: readonly string[]
  /** Replacement communicating-agent id list. */
  readonly subagentIds?: readonly string[]
}

/** One read of the signed-in owner's workspace. */export interface FaberLoomOverview {
  /** Spaces the owner may read. */
  readonly spaces: readonly FaberLoomSpaceRow[]
  /** The agent catalog. */
  readonly agents: readonly FaberLoomAgentRow[]
  /** The owner's board items. */
  readonly board: readonly FaberLoomBoardRow[]
  /** The owner's routines. */
  readonly routines: readonly FaberLoomRoutineRow[]
  /** The owner's rows on the agent-memory server; empty when it is unreachable. */
  readonly memory: readonly FaberLoomMemoryRow[]
  /** Whether this identity may run the panel writes; read-only identities cannot. Spaces stay writable: the owner manages its own. */
  readonly canWrite: boolean
}

/** One product backup row as the panel reads it. */
export interface FaberLoomBackupRow {
  /** Stable backup id. */
  readonly id: string
  /** Capture instant, ISO-8601. */
  readonly createdAt: string
  /** Optional operator note. */
  readonly note: string | null
  /** Number of product domains captured. */
  readonly domains: number
  /** Total records across every captured table. */
  readonly records: number
  /** Integrity digest of the captured payload. */
  readonly digest: string
}

/** Integrity verdict the panel shows for one backup. */
export interface FaberLoomBackupVerify {
  /** Whether every table and the overall digest matched. */
  readonly ok: boolean
  /** Number of tables checked. */
  readonly tables: number
  /** Number of tables that did not match. */
  readonly badTables: number
}

/** Restore result the panel shows for one backup. */
export interface FaberLoomBackupRestore {
  /** True when nothing was written. */
  readonly dryRun: boolean
  /** Number of tables written or counted. */
  readonly tables: number
  /** Total records written or counted. */
  readonly written: number
  /** Number of domains the process did not have open. */
  readonly skipped: number
}

/** One suggested agent in a work proposal. */
export interface FaberLoomProposalAgent {
  /** Agent id. */
  readonly id: string
  /** Agent display name. */
  readonly name: string
}

/** An editable proposal built from a fresh conversation. */
export interface FaberLoomWorkProposal {
  /** Title derived from the first line of the request. */
  readonly title: string
  /** Space the work would belong to, or null for the personal scope. */
  readonly spaceId: string | null
  /** Catalog agents that could take the work. */
  readonly suggestedAgents: readonly FaberLoomProposalAgent[]
  /** Suggested step outline the user may accept or change. */
  readonly suggestedSteps: readonly string[]
}

/** Audience and material preview before linking private work to a space (F41). */
export interface FaberLoomLinkPreview {
  /** Identities that would gain visibility of the linked material. */
  readonly newlyVisibleTo: readonly string[]
  /** Context keys the space would contribute to the linked material. */
  readonly sharedContextKeys: readonly string[]
}
