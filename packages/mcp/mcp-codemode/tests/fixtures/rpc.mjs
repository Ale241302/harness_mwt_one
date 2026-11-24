/**
 * Raw JSON-RPC upstream for the facade's error-path tests. It speaks the stdio
 * framing the MCP client expects and returns results a schema-validating server
 * would refuse: a tool without a name, duplicate tool names, a non-array
 * `content`, and a tool-level error with no text block.
 *
 * `QUIRKY_MODE` selects the tool list: `quirky` (default), `nameless`,
 * `duplicate`, or `list-error`.
 */

import { appendFileSync } from 'node:fs'

const mode = process.env.QUIRKY_MODE ?? 'quirky'
const log = process.env.QUIRKY_LOG

/** One tool list per test scenario. */
const TOOL_LISTS = {
  quirky: [
    { name: 'plain', inputSchema: { type: 'object' } },
    { name: 'empty-desc', description: '', inputSchema: { type: 'object' } },
    { name: 'no-text-error', inputSchema: { type: 'object' } },
  ],
  'empty-name': [{ name: '', description: 'A tool without a name.', inputSchema: { type: 'object' } }],
  duplicate: [{ name: 'dup', inputSchema: { type: 'object' } }, { name: 'dup', inputSchema: { type: 'object' } }],
  'list-error': [],
}

function callResult(name) {
  switch (name) {
    case 'no-text-error':
      return { isError: true, content: [{ type: 'image', data: 'eA==', mimeType: 'image/png' }] }
    default:
      return { content: [] }
  }
}

function respond(message) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'quirky-upstream', version: '1.0.0' },
    }
  }
  if (message.method === 'tools/list') {
    if (mode === 'list-error') throw new Error('list exploded')
    return { tools: TOOL_LISTS[mode] ?? TOOL_LISTS.quirky }
  }
  if (message.method === 'tools/call') return callResult(message.params.name)
  throw new Error(`unsupported method ${String(message.method)}`)
}

process.stdin.setEncoding('utf8')
let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let newline = buffer.indexOf('\n')
  while (newline >= 0) {
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    newline = buffer.indexOf('\n')
    if (log !== undefined) appendFileSync(log, `${line}\n`)
    const message = JSON.parse(line)
    if (message.id === undefined) continue
    let frame
    try {
      frame = { jsonrpc: '2.0', id: message.id, result: respond(message) }
    } catch (error) {
      frame = { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } }
    }
    process.stdout.write(`${JSON.stringify(frame)}\n`)
  }
})
process.stdin.on('end', () => { process.exit(0) })
