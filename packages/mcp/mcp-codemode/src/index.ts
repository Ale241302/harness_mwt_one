/**
 * Public entry of the Code Mode facade: connect upstream MCP servers once, then
 * expose `run_code` and `catalog` to an external MCP client.
 * @module @deepseek-ai/dsh-mcp-codemode
 */

import { executeProgram } from './executor.ts'
import { renderCatalog } from './sdk.ts'
import { connectUpstreams } from './upstream.ts'
import type { CodeModeFacade } from './server.ts'
import type { FacadeConfig, ProgramOutcome } from './types.ts'

export type { CodeModeFacade } from './server.ts'
export { CATALOG_TOOL, RUN_CODE_TOOL, SERVER_INSTRUCTIONS, createCodeModeServer, renderOutcome } from './server.ts'
export { bindingName, jsonSchemaToType, renderCatalog } from './sdk.ts'
export type {
  FacadeConfig,
  HttpUpstream,
  ProgramErrorKind,
  ProgramFailure,
  ProgramLog,
  ProgramOutcome,
  ProgramSuccess,
  StdioUpstream,
  UpstreamConfig,
  UpstreamSummary,
  UpstreamTool,
} from './types.ts'

/** Resolved execution bounds shared by every run of one facade. */
interface Limits {
  readonly timeoutMs: number
  readonly maxOutputBytes: number
  readonly maxUpstreamResultBytes: number
  readonly maxCatalogBytes: number
  readonly maxPendingCalls: number
  readonly maxOldGenerationSizeMb: number
  readonly nodeExecutable: string
  readonly cwd: string
}

function positiveInteger(name: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(`mcp-codemode: ${name} must be a positive integer`)
  return resolved
}

function resolveLimits(config: FacadeConfig): Limits {
  return {
    timeoutMs: positiveInteger('timeoutMs', config.timeoutMs, 60_000),
    maxOutputBytes: positiveInteger('maxOutputBytes', config.maxOutputBytes, 262_144),
    maxUpstreamResultBytes: positiveInteger('maxUpstreamResultBytes', config.maxUpstreamResultBytes, 16 * 1024 * 1024),
    maxCatalogBytes: positiveInteger('maxCatalogBytes', config.maxCatalogBytes, 262_144),
    maxPendingCalls: positiveInteger('maxPendingCalls', config.maxPendingCalls, 32),
    maxOldGenerationSizeMb: positiveInteger('maxOldGenerationSizeMb', config.maxOldGenerationSizeMb, 512),
    nodeExecutable: config.nodeExecutable ?? process.execPath,
    cwd: config.cwd ?? process.cwd(),
  }
}

/**
 * Connect every upstream and build the facade the MCP server serves.
 *
 * Upstream connections and `tools/list` run here, in the parent: a client that
 * never calls `run_code` still costs only two tool schemas, and no upstream
 * credential is ever handed to a program process.
 * @param config - Upstreams plus deployment bounds; see {@link FacadeConfig}.
 * @returns A connected facade; call `close()` to release the upstream clients.
 */
export async function createCodeModeFacade(config: FacadeConfig): Promise<CodeModeFacade> {
  if (config.upstreams.length === 0) throw new Error('mcp-codemode: at least one upstream server is required')
  const limits = resolveLimits(config)
  const upstreams = await connectUpstreams(config)
  return {
    servers: upstreams.servers,
    async run(code: string, _description: string, signal?: AbortSignal): Promise<ProgramOutcome> {
      // `description` is a model-authored label for the client UI; this facade has no UI to feed.
      return executeProgram({
        code,
        bindings: upstreams.bindings,
        ...limits,
        ...signal === undefined ? {} : { signal },
      })
    },
    catalog(server?: string): string {
      if (server === undefined) return renderCatalog(upstreams.servers, limits.maxCatalogBytes)
      const selected = upstreams.servers.find(candidate => candidate.serverName === server)
      if (selected === undefined) {
        const known = upstreams.servers.map(candidate => candidate.serverName).join(', ')
        throw new Error(`unknown upstream server "${server}"; configured servers: ${known}`)
      }
      return renderCatalog([selected], limits.maxCatalogBytes)
    },
    close: upstreams.close,
  }
}
