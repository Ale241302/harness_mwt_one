/**
 * The proforma check adapter over MWT.ONE (`ctx.faberloomBoard` registrations).
 *
 * The board declares six proforma controls and refuses every proforma approval
 * with `CHECK_UNAVAILABLE` until an adapter registers them. This row mounts the
 * registration from `ctx.effect`, so disposing its fiber removes all six, and
 * fills the source port with the MWT MCP reads. The MCP transport is the
 * existing tools seam: the `mwt` server's tools are already registered as
 * `mcp__mwt__<tool>`, so this row calls them through `ctx.tools.execute` instead
 * of opening its own JSON-RPC connection.
 *
 * @module @deepseek-ai/dsh-faberloom-checks-mwt
 */

import { ToolCallId } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { mcpMwtCheckClient } from './client.ts'
import { registerProformaChecks } from './source.ts'
import { jsonPayload } from './wire.ts'
import type { Context } from '@deepseek-ai/cordis'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'

export type * from './types.ts'
export { mcpMwtCheckClient } from './client.ts'
export { mwtCheckSource, registerProformaChecks } from './source.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'faberloom-checks-mwt'

/** Services this row reads: the board it registers on and the tools it calls. */
export const inject = ['faberloomBoard', 'tools']

/** MCP server name the MWT tools are mounted under in the shipped composition. */
const DEFAULT_SERVER_NAME = 'mwt'

/** Milliseconds one MWT tool call may take before the control fails. */
const DEFAULT_TOOL_TIMEOUT_MS = 15_000

/** Largest delay `AbortSignal.timeout` accepts; the platform ceiling, not a deployment choice. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Server names the MCP client's `mcp__<server>__` namespace accepts. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Deployment configuration of the check adapter.
 */
export interface Config {
  /**
   * MCP server name whose tools this row calls. Defaults to `mwt`; a deployment
   * that mounts the MWT server under another name sets it here. The server
   * itself, its endpoint, and its credential belong to the MCP registry row.
   */
  readonly serverName?: string
  /**
   * Milliseconds one MWT tool call may take. Defaults to
   * {@link DEFAULT_TOOL_TIMEOUT_MS}; a call that exceeds it aborts, and the
   * control reports failure instead of waiting (ADR-003).
   */
  readonly toolTimeoutMs?: number
  /**
   * Whether this row also provides `faberloomBoardFx`, the MWT ONE rate port
   * the board converts non-USD amounts with (D-3). Defaults to true.
   */
  readonly fx?: boolean
}

/** Validated configuration; both fields are deployment choices. */
export const Config: z<Config> = z.object({
  serverName: z.string().pattern(SERVER_NAME).default(DEFAULT_SERVER_NAME),
  toolTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TOOL_TIMEOUT_MS),
  fx: z.boolean().default(true),
})

/**
 * The MWT ONE pair that quotes one currency. Only the pairs the console serves
 * are mapped; anything else has no quote and the board refuses the amount.
 * @param currency - ISO code the producer billed in.
 * @returns the pair, or undefined when MWT does not quote it.
 */
export function fxPair(currency: string): string | undefined {
  if (currency === 'CRC') return 'usd-crc'
  if (currency === 'BRL') return 'usd-brl'
  return undefined
}

/**
 * Turn one `tipo_cambio` answer into the amount-to-USD multiplier. MWT reports
 * units of the second currency per USD, so the multiplier is its reciprocal.
 * @param currency - ISO code the producer billed in.
 * @param payload - the tool answer.
 * @returns the multiplier with its source and date, or undefined when invalid.
 */
export function usdRateOf(
  currency: string,
  payload: unknown,
): { readonly rate: number; readonly source: string; readonly date: string } | undefined {
  if (fxPair(currency) === undefined) return undefined
  const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {}
  const quoted = Number(record['rate'])
  if (!Number.isFinite(quoted) || quoted <= 0) return undefined
  const source = typeof record['source'] === 'string' && record['source'].trim().length > 0 ? record['source'] : 'MWT ONE'
  const stamp = typeof record['timestamp'] === 'string' ? Date.parse(record['timestamp']) : Number.NaN
  const date = Number.isNaN(stamp) ? new Date().toISOString().slice(0, 10) : new Date(stamp).toISOString().slice(0, 10)
  return { rate: 1 / quoted, source, date }
}

/**
 * Mount the six proforma controls on the board service.
 * @param ctx - the plugin's Cordis context, with `faberloomBoard` and `tools` injected.
 * @param config - validated deployment configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const serverName = config.serverName ?? DEFAULT_SERVER_NAME
  const toolTimeoutMs = config.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  let calls = 0
  const client = mcpMwtCheckClient(async (tool, args) => {
    calls += 1
    const toolName = `mcp__${serverName}__${tool}`
    const result = await ctx.tools.execute({
      callId: ToolCallId(`faberloom-checks-mwt-${String(calls)}`),
      name: toolName,
      arguments: args,
      signal: AbortSignal.timeout(toolTimeoutMs),
    })
    if (result.isError) throw new Error(`faberloom: ${toolName} failed: ${result.error.message}`)
    return result.value
  })
  ctx.effect(() => registerProformaChecks(ctx.faberloomBoard, client), 'faberloom.proformaChecks')
  if (config.fx !== false) {
    ctx.provide('faberloomBoardFx', {
      usdRate: async (currency: string) => {
        const pair = fxPair(currency)
        if (pair === undefined) return undefined
        calls += 1
        const toolName = `mcp__${serverName}__tipo_cambio`
        const result = await ctx.tools.execute({
          callId: ToolCallId(`faberloom-fx-mwt-${String(calls)}`),
          name: toolName,
          arguments: { par: pair },
          signal: AbortSignal.timeout(toolTimeoutMs),
        }).catch(() => undefined)
        if (result === undefined || result.isError) return undefined
        try {
          return usdRateOf(currency, jsonPayload(result.value))
        } catch {
          return undefined
        }
      },
    })
  }
}
