/**
 * Configuration, upstream, and program-protocol types for the Code Mode facade.
 * @module @deepseek-ai/dsh-mcp-codemode/src/types
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export type { JsonValue }

/** A local upstream MCP server the facade spawns in the parent process. */
export interface StdioUpstream {
  /** Namespace for this server's binding names; unique across the configuration. */
  readonly serverName: string
  readonly transport: 'stdio'
  /** Executable that starts the upstream server. */
  readonly command: string
  readonly args?: readonly string[]
  /**
   * Explicit environment for the upstream child. Omit to inherit the MCP
   * SDK's safe subset; a provided object is used as-is, so credentials reach
   * only this child and never the program process.
   */
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
}

/** A remote upstream MCP server reached with Streamable HTTP. */
export interface HttpUpstream {
  /** Namespace for this server's binding names; unique across the configuration. */
  readonly serverName: string
  readonly transport: 'http'
  /** Streamable HTTP endpoint, for example `https://mcp.example.com/mcp`. */
  readonly url: string
  /** Extra request headers (tokens included) applied by the parent on every dispatch. */
  readonly headers?: Readonly<Record<string, string>>
}

/** One upstream MCP server. */
export type UpstreamConfig = StdioUpstream | HttpUpstream

/** Deployment-varying facade limits and launch choices. */
export interface FacadeConfig {
  /** Upstream servers whose tools programs may call; at least one. */
  readonly upstreams: readonly UpstreamConfig[]
  /** Per-`tools/call` deadline for an upstream dispatch, in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum UTF-8 bytes of the complete `run_code` output (logs plus result JSON). */
  readonly maxOutputBytes?: number
  /** Maximum UTF-8 bytes of one upstream result handed to the program. */
  readonly maxUpstreamResultBytes?: number
  /** Maximum UTF-8 bytes of one `catalog` response before it is truncated. */
  readonly maxCatalogBytes?: number
  /** Maximum upstream calls in flight from one program. */
  readonly maxPendingCalls?: number
  /** V8 old-generation heap limit for the program process, in MiB. */
  readonly maxOldGenerationSizeMb?: number
  /** Node executable that runs programs; defaults to the current process. */
  readonly nodeExecutable?: string
  /** Working directory of the program process; defaults to the facade's own. */
  readonly cwd?: string
}

/** One upstream tool as a program sees it. */
export interface UpstreamTool {
  readonly serverName: string
  readonly rawName: string
  /** Key on the `tools` object: the harness's public MCP tool name. */
  readonly binding: string
  readonly description?: string
  /** Tool input schema exactly as the upstream advertised it. */
  readonly inputSchema: Record<string, unknown>
}

/** One connected upstream server and the tools it advertised. */
export interface UpstreamSummary {
  readonly serverName: string
  readonly tools: readonly UpstreamTool[]
}

/** One captured console line from a program. */
export interface ProgramLog {
  readonly level: 'log' | 'error'
  readonly text: string
}

/** Failure classes a program run reports to the model. */
export type ProgramErrorKind
  = | 'exception'
    | 'type-stripping'
    | 'timeout'
    | 'output-limit'
    | 'invalid-output'
    | 'worker-exit'
    | 'protocol'
    | 'aborted'

/** A program that returned; `value` is absent when it returned nothing. */
export interface ProgramSuccess {
  readonly ok: true
  readonly logs: readonly ProgramLog[]
  readonly durationMs: number
  readonly value?: JsonValue
}

/** A program that failed before or after calling upstream tools. */
export interface ProgramFailure {
  readonly ok: false
  readonly kind: ProgramErrorKind
  readonly message: string
  readonly logs: readonly ProgramLog[]
  readonly durationMs: number
}

/** Terminal state of one `run_code` execution. */
export type ProgramOutcome = ProgramSuccess | ProgramFailure
