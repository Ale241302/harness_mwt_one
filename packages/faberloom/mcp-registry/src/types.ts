/**
 * Consumer-facing types of the MCP registry: the saved server as it reads back,
 * the input a caller saves or probes, and the probe verdict.
 * @module @deepseek-ai/dsh-faberloom-mcp-registry/types
 */

/** Transport a saved MCP server is reached through. */
export type McpTransportKind = 'stdio' | 'streamable-http'

/** A saved stdio server: the executable it spawns and where. */
export interface McpStdioTransport {
  /** Selects the child-process transport. */
  transport: 'stdio'
  /** Executable used to start the server. */
  command: string
  /** Arguments passed directly, without shell interpolation. */
  args: readonly string[]
  /** Working directory for the child process; empty means the process default. */
  cwd: string
}

/** A saved Streamable HTTP server: the endpoint it is reached at. */
export interface McpHttpTransport {
  /** Selects the Streamable HTTP transport. */
  transport: 'streamable-http'
  /** Absolute HTTP(S) endpoint URL. */
  url: string
}

/** The transport of one saved server, discriminated on `transport`. */
export type McpTransport = McpStdioTransport | McpHttpTransport

/** Caller input for a stdio server; an omitted field takes its default. */
export interface McpStdioTransportInput {
  /** Selects the child-process transport. */
  transport: 'stdio'
  /** Executable used to start the server. */
  command: string
  /** Arguments passed directly; defaults to none. */
  args?: readonly string[]
  /** Working directory for the child process; defaults to the process default. */
  cwd?: string
}

/** Caller input for a Streamable HTTP server. */
export interface McpHttpTransportInput {
  /** Selects the Streamable HTTP transport. */
  transport: 'streamable-http'
  /** Absolute HTTP(S) endpoint URL. */
  url: string
}

/** Caller input transport, discriminated on `transport`. */
export type McpTransportInput = McpStdioTransportInput | McpHttpTransportInput

/**
 * One server a caller saves or probes. Every `env` and `headers` value is a
 * secret: `save` stores it in the credential seam, and the durable record and
 * every returned server keep only its name and the reference.
 */
export interface McpServerInput {
  /** Local namespace for the server's tool names; `[A-Za-z0-9_-]{1,32}`. */
  name: string
  /** The transport the server is reached through. */
  transport: McpTransportInput
  /** Environment-variable secrets keyed by name; omitted keeps the saved entries. */
  env?: Readonly<Record<string, string>>
  /** Request-header secrets keyed by name; omitted keeps the saved entries. */
  headers?: Readonly<Record<string, string>>
  /** Whether the server mounts after save; omitted preserves the saved state, and a new server defaults to enabled. */
  enabled?: boolean
}

/** One saved environment or header entry: its name, its reference, and whether the seam holds a value. */
export interface McpSecretRef {
  /** Environment-variable or header name. */
  name: string
  /** Credential reference the value is stored under; never the value. */
  credentialRef: string
  /** Whether the credential seam currently resolves a value for the reference. */
  present: boolean
}

/** One saved server as a caller reads it; no field ever carries a secret value. */
export interface FaberLoomMcpServer {
  /** Local namespace for the server's tool names. */
  name: string
  /** The transport the server is reached through. */
  transport: McpTransport
  /** Environment entries and the references their values live under. */
  env: readonly McpSecretRef[]
  /** Header entries and the references their values live under. */
  headers: readonly McpSecretRef[]
  /** Whether the server mounts while the process runs. */
  enabled: boolean
  /** Whether the server's MCP client is mounted in this process right now. */
  mounted: boolean
  /**
   * The redacted reason the last mount attempt failed, or null when the server
   * is mounted or has not been attempted since this process started. A server
   * with an error is saved but not proven; it is never presented as working.
   */
  error: string | null
  /** ISO-8601 instant the record was created. */
  createdAt: string
  /** ISO-8601 instant the record was last written. */
  updatedAt: string
}

/** Why a probe could not establish that the server works. */
export type McpProbeFailure = 'unreachable' | 'bad-credential' | 'protocol'

/** One tool a successful probe registered: its public name and the server's own description. */
export interface McpProbeTool {
  /** Model-facing name, `mcp__<serverName>__<rawName>`. */
  readonly name: string
  /** The server's description, as it advertises it. */
  readonly description: string
}

/** The verdict of one probe: the tools it registered, or a named failure carrying the server's own words. */
export type McpProbeResult =
  | { readonly ok: true; readonly tools: readonly string[]; readonly toolInfo: readonly McpProbeTool[] }
  | { readonly ok: false; readonly failure: McpProbeFailure; readonly detail: string }

/** The MCP server registry published as `ctx.faberloomMcpRegistry`. */
export interface FaberLoomMcpRegistry {
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
   * @returns `{ ok: true, tools, toolInfo }`, or a named failure with every secret redacted.
   */
  probe(input: McpServerInput): Promise<McpProbeResult>

  /**
   * Call one tool on the live mounted client of a saved server. The guarded
   * names in the mail policy are refused before any call leaves, so this
   * method can never mutate a mailbox even when a future caller asks. A server
   * that is not mounted for this owner rejects; the call is bounded by the
   * registry's `toolCallTimeoutMs`.
   *
   * The payload is the server's own JSON: the first text block parsed as JSON,
   * or `structuredContent` when the server sends it. It is untrusted data and
   * the caller narrows it.
   * @param ownerId - the identity the server belongs to.
   * @param serverName - the saved server to call.
   * @param toolName - the server's raw tool name, never the public `mcp__` name.
   * @param args - tool arguments as a JSON object; omission sends none.
   * @param timeoutMs - budget for this call; a panel read passes a short one so a
   *   slow server never blocks the surface, and omission keeps the deployment timeout.
   * @returns the parsed JSON payload.
   * @throws when the server is not mounted, the name is governed, the tool
   *   reports a failure, or the call exceeds the timeout.
   */
  callTool(
    ownerId: string,
    serverName: string,
    toolName: string,
    args?: Readonly<Record<string, unknown>>,
    timeoutMs?: number,
  ): Promise<unknown>

  /**
   * Call one mailbox action the owner just asked for from the Correo panel.
   * Only the reversible message actions are accepted: flags, move, and the
   * bulk variants the panel does not use today. Sending, permanent deletion,
   * folders and webhooks stay refused. This is the owner's gesture, not a
   * model tool call; the model-facing guarded set is unchanged.
   * @param ownerId - the identity the server belongs to.
   * @param serverName - the saved server to call.
   * @param toolName - the server's raw tool name.
   * @param args - tool arguments as a JSON object.
   * @param timeoutMs - budget for this call.
   * @returns the parsed JSON payload.
   * @throws when the server is not mounted, the name is not an owner action,
   *   the tool reports a failure, or the call exceeds the timeout.
   */
  callOwnerAction(
    ownerId: string,
    serverName: string,
    toolName: string,
    args?: Readonly<Record<string, unknown>>,
    timeoutMs?: number,
  ): Promise<unknown>

  /**
   * The raw tool names the mounted server currently publishes, for capability
   * checks. An unmounted server returns an empty list.
   * @param ownerId - the identity the server belongs to.
   * @param serverName - the saved server to inspect.
   * @returns the raw names, without the public `mcp__` prefix.
   */
  toolsFor(ownerId: string, serverName: string): Promise<readonly string[]>

  /**
   * The JSON parameters one mounted server's tool declares, so a caller can use
   * a capability the server really advertises instead of guessing its fields.
   * An unmounted server or unknown tool returns null.
   * @param ownerId - the identity the server belongs to.
   * @param serverName - the saved server to inspect.
   * @param toolName - the server's raw tool name.
   * @returns the declared JSON schema, or null.
   */
  toolSchemaFor(
    ownerId: string,
    serverName: string,
    toolName: string,
  ): Promise<Readonly<Record<string, unknown>> | null>
}
