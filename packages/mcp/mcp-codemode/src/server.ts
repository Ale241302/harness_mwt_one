/**
 * MCP surface of the facade: exactly two tools, `run_code` and `catalog`, served
 * to an external client. Program results keep the harness `run_code` text
 * contract (`logs` then the returned value, or `code run failed (<kind>): …`),
 * so one program behaves the same here and inside the harness.
 * @module @deepseek-ai/dsh-mcp-codemode/src/server
 */

import { McpServer } from '@modelcontextprotocol/server'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { ProgramOutcome, UpstreamSummary } from './types.ts'

/** Stable name of the program-execution tool. */
export const RUN_CODE_TOOL = 'run_code'

/** Stable name of the schema-catalog tool. */
export const CATALOG_TOOL = 'catalog'

/** Server instructions published in the MCP `initialize` result. */
export const SERVER_INSTRUCTIONS = [
  'This server collapses many upstream MCP tools into two tools.',
  '`run_code` executes the body of an async TypeScript function in a fresh Node process;',
  'upstream tools are async functions on the `tools` object, named `mcp__<server>__<tool>`.',
  'Call `catalog` for the exact declarations before writing a program.',
  'Only what the program returns or prints is returned to you.',
].join(' ')

/** Model-facing `run_code` description. */
const RUN_CODE_DESCRIPTION = 'Execute a TypeScript program against the upstream MCP tools. Takes two required '
  + 'arguments: `code`, the BODY of an async function (erasable syntax only; top-level `await` and `return` '
  + 'work), and `description`, a short summary of what the program does. Call upstream tools as '
  + '`await tools.<name>(args)`; call `catalog` for the exact names and argument types. Only what you print or '
  + 'return is program output — curate it.'

/** Model-facing `description` parameter text, shared with the harness `run_code` tool. */
const DESCRIPTION_PARAMETER = 'Clear, concise description of what this program does in active voice, '
  + '5-10 words (shown in the UI). Examples: "Count overdue invoices for one client"; '
  + '"Read failing test and its fixture"; "Compare two suppliers\' unit prices".'

/** What one facade exposes to its MCP server. */
export interface CodeModeFacade {
  /** Run one program; resolves with logs and a value or a named failure. */
  readonly run: (code: string, description: string, signal?: AbortSignal) => Promise<ProgramOutcome>
  /** Render the declarations for one upstream server, or all of them. */
  readonly catalog: (server?: string) => string
  /** Connected upstreams, in configuration order. */
  readonly servers: readonly UpstreamSummary[]
  /** Close every upstream connection. */
  readonly close: () => Promise<void>
}

/**
 * Render one program outcome as the text the model receives.
 * @param outcome - Settled program result.
 * @returns Text and whether the tool call failed.
 */
export function renderOutcome(outcome: ProgramOutcome): { text: string; isError: boolean } {
  const captured = outcome.logs.map(log => log.text).join('\n')
  if (!outcome.ok) {
    const capturedText = outcome.logs.length > 0 ? `\nCaptured output:\n${captured}` : ''
    return { text: `code run failed (${outcome.kind}): ${outcome.message}${capturedText}`, isError: true }
  }
  const rendered = outcome.value === undefined
    ? ''
    : typeof outcome.value === 'string' ? outcome.value : JSON.stringify(outcome.value, null, 2)
  const parts = [captured, rendered].filter(part => part.length > 0)
  return { text: parts.length > 0 ? parts.join('\n') : '(run_code completed with no output)', isError: false }
}

/**
 * Build the MCP server that exposes the facade to one external client.
 *
 * The server registers only `run_code` and `catalog`, so a client's `tools/list`
 * carries two schemas regardless of how many upstream tools exist.
 * @param facade - Program runner and catalog renderer.
 * @returns A server ready for `connect(transport)`.
 */
export function createCodeModeServer(facade: CodeModeFacade): McpServer {
  const server = new McpServer(
    { name: 'dsh-mcp-codemode', version: '0.1.8' },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  )

  server.registerTool(RUN_CODE_TOOL, {
    title: 'Run Code',
    description: RUN_CODE_DESCRIPTION,
    inputSchema: z.object({
      code: z.string().describe('The program: the body of an async TypeScript function.'),
      description: z.string().describe(DESCRIPTION_PARAMETER),
    }),
  }, async (args, ctx): Promise<CallToolResult> => {
    if (args.description.trim().length === 0) throw new Error('invalid description: expected a non-empty string')
    const outcome = await facade.run(args.code, args.description, ctx.mcpReq.signal)
    const rendered = renderOutcome(outcome)
    return { content: [{ type: 'text', text: rendered.text }], ...rendered.isError ? { isError: true } : {} }
  })

  server.registerTool(CATALOG_TOOL, {
    title: 'Tool Catalog',
    description: 'List upstream tools as TypeScript declarations for `run_code`. Pass `server` to load one '
      + "server's declarations instead of every server's.",
    inputSchema: z.object({
      server: z.string().optional().describe('Namespace of one upstream server, as named in the response header.'),
    }),
  }, (args): CallToolResult => {
    const text = facade.catalog(args.server)
    return { content: [{ type: 'text', text }] }
  })

  return server
}
