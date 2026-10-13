/**
 * Read the connection facts out of an MCP server's documentation: how the
 * harness reaches the server (a local program to run, or a URL to call), and
 * which values the server authenticates with. The reader returns only names and
 * meanings, never a value: a placeholder such as `YOUR_API_KEY` documents that a
 * value is needed, and the value itself comes from the user. A document that
 * settles no transport, or settles two, is refused by name instead of guessed.
 * @module @deepseek-ai/dsh-tool-faberloom/src/mcp-extract
 */

import type {
  McpHttpTransport,
  McpStdioTransport,
  McpTransportInput,
} from '@deepseek-ai/dsh-faberloom-mcp-registry'

/** Why a document could not be turned into a reachable server. */
export type McpExtractionRefusal = 'empty' | 'no-transport' | 'ambiguous-transport'

/** One value the documentation asks for and only the user can supply. */
export interface McpRequiredValue {
  /** Environment-variable or request-header name, exactly as the document spells it. */
  readonly name: string
  /** Where the value travels: the server's environment, or its request headers. */
  readonly kind: 'environment' | 'header'
  /** What the documentation says the value is for. */
  readonly meaning: string
}

/** What one document says about reaching the server. */
export interface McpExtraction {
  /** Local server name derived from the document, or null when it names none. */
  readonly serverName: string | null
  /** The transport the document settles, or null when it settles none or two. */
  readonly transport: McpTransportInput | null
  /** The values the document asks for, in the order it first names them. */
  readonly required: readonly McpRequiredValue[]
  /** The named reason the document was refused, or null when it was read. */
  readonly refusal: McpExtractionRefusal | null
}

/** Programs a documentation page launches a stdio server with. */
const LAUNCHERS = new Set(['npx', 'bunx', 'pnpx', 'pnpm', 'yarn', 'node', 'deno', 'python', 'python3', 'uvx', 'uv', 'docker'])

/** Request-header names a documentation page asks for. */
const HEADER_NAME = /^(?:authorization|api[-_]?key|x-api-key|x-auth-token|x-access-token|x-token|.*-token|.*-key)$/i

/** Words that mark the surrounding text as describing a credential. */
const CREDENTIAL_WORDS = /\b(?:api\s?key|access\s?token|auth(?:orization)?|token|secret|password|credential|env(?:ironment)? var)\b/i

/** Placeholder prefixes a documentation page uses instead of a real value; the name beside them is not an environment variable. */
const PLACEHOLDER_PREFIX = /^(?:YOUR|MY|REPLACE|CHANGE|INSERT|PASTE|EXAMPLE|SAMPLE|SOME)_/

/** Longest meaning excerpt kept from one documentation line. */
const MAX_MEANING = 200

/** Longest local server name the MCP client namespace accepts. */
const MAX_NAME = 32

/**
 * Split one line into tokens, honoring single and double quotes.
 * @param text - the line or span to split.
 * @returns the tokens in order.
 */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote = ''
  for (const character of text) {
    if (quote !== '') {
      if (character === quote) quote = ''
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += character
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}

/** Strip the markdown markers a documentation line or span may carry. */
function stripMarkers(line: string): string {
  return line.replace(/^[\s>*+-]+/, '').replace(/^\$\s*/, '').replace(/^`+|`+$/g, '').trim()
}

/** The contents of every fenced code block, without the fence lines. */
function fencedBlocks(text: string): string[] {
  const blocks: string[] = []
  let inside = false
  let buffer: string[] = []
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      if (inside && buffer.length > 0) blocks.push(buffer.join('\n'))
      inside = !inside
      buffer = []
      continue
    }
    if (inside) buffer.push(line)
  }
  return blocks
}

/** Every backticked inline span, in order. */
function inlineSpans(text: string): string[] {
  const spans: string[] = []
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    if (match[1] !== undefined) spans.push(match[1])
  }
  return spans
}

/** Read one launcher command out of one candidate line, or null when the line has none. */
function commandFromLine(line: string): McpStdioTransport | null {
  const tokens = tokenize(stripMarkers(line))
  const head = tokens[0]
  if (head === undefined || !LAUNCHERS.has(head)) return null
  const args: string[] = []
  for (const token of tokens.slice(1)) {
    if (token.startsWith('#')) break
    args.push(token)
  }
  return { transport: 'stdio', command: head, args, cwd: '' }
}

/** The first launcher command the document shows, from its fences, spans, or plain lines. */
function findCommand(text: string): McpStdioTransport | null {
  for (const candidate of [...fencedBlocks(text), ...inlineSpans(text)]) {
    for (const line of candidate.split('\n')) {
      const command = commandFromLine(line)
      if (command !== null) return command
    }
  }
  for (const line of text.split('\n')) {
    const command = commandFromLine(line)
    if (command !== null) return command
  }
  return null
}

/** Whether one URL's own line or path marks it as the server's endpoint rather than a reference link. */
function looksLikeEndpoint(url: string, line: string): boolean {
  if (/(?:url|endpoint|streamable[- ]?http|server\s+address)/i.test(line)) return true
  try {
    const parsed = new URL(url)
    if (/\bmcp\./i.test(parsed.hostname)) return true
    return /\/(?:mcp|sse|messages?|http)$/i.test(parsed.pathname)
  } catch {
    return false
  }
}

/** The first endpoint URL the document shows, or null when it shows none. */
function findUrl(text: string): McpHttpTransport | null {
  for (const line of text.split('\n')) {
    for (const match of line.matchAll(/https?:\/\/[^\s"'`<>)\]]+/g)) {
      const url = match[0].replace(/[.,;:]+$/, '')
      if (looksLikeEndpoint(url, line)) return { transport: 'streamable-http', url }
    }
  }
  return null
}

/** One line shortened to the meaning excerpt, or the generic sentence when the line is empty. */
function meaningOf(line: string, name: string, kind: 'environment' | 'header'): string {
  const cleaned = stripMarkers(line).replace(/\s+/g, ' ').trim()
  if (cleaned.length === 0) return `The ${kind} value "${name}" the documentation asks for.`
  return cleaned.length <= MAX_MEANING ? cleaned : `${cleaned.slice(0, MAX_MEANING)}…`
}

/** Append one required value once, keeping the order the document first names it. */
function addRequired(
  required: McpRequiredValue[],
  seen: Set<string>,
  name: string,
  kind: 'environment' | 'header',
  line: string,
): void {
  const key = `${kind}\u0000${name}`
  if (seen.has(key)) return
  seen.add(key)
  required.push({ name, kind, meaning: meaningOf(line, name, kind) })
}

/** Whether one ALL-CAPS name is a placeholder the document writes instead of a real variable name. */
function isPlaceholder(name: string, line: string): boolean {
  if (PLACEHOLDER_PREFIX.test(name)) return true
  return new RegExp(`[<{\\[]\\s*${name}\\s*[>}\\]]`).test(line)
}

/** Read the required values one line names, appending each once. */
function requiredFromLine(line: string, required: McpRequiredValue[], seen: Set<string>): void {
  const header = /^\s*(?:[-*]\s*)?`?([A-Za-z][A-Za-z0-9-]*)`?\s*:\s*(\S.*)$/.exec(line)
  if (header?.[1] !== undefined && header[2] !== undefined && (HEADER_NAME.test(header[1]) || /bearer/i.test(header[2]))) {
    addRequired(required, seen, header[1], 'header', line)
    return
  }
  const headerWord = /headers?\s*[:=]?\s*`?([a-z][a-z0-9-]*)`?/i.exec(line)
  if (headerWord?.[1] !== undefined && HEADER_NAME.test(headerWord[1])) {
    addRequired(required, seen, headerWord[1], 'header', line)
    return
  }
  for (const token of tokenize(stripMarkers(line))) {
    const assignment = /^([A-Z][A-Z0-9_]{1,})=/.exec(token)
    if (assignment?.[1] !== undefined && !isPlaceholder(assignment[1], line)) {
      addRequired(required, seen, assignment[1], 'environment', line)
    }
  }
  const envFlag = /(?:--env|--environment|-e)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line)
  if (envFlag?.[1] !== undefined) addRequired(required, seen, envFlag[1], 'environment', line)
  if (!CREDENTIAL_WORDS.test(line)) return
  for (const match of line.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
    const name = match[1]
    // A bare acronym such as API or HTTP is prose, not a variable; an
    // environment name the document asks for is underscored or ends in a
    // credential word.
    if (name === undefined || !name.includes('_') || isPlaceholder(name, line)) continue
    addRequired(required, seen, name, 'environment', line)
  }
}

/** Sanitize one candidate into a local server name the MCP client accepts, or null. */
function sanitizeName(candidate: string): string | null {
  const cleaned = candidate.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_NAME)
  return cleaned.length === 0 ? null : cleaned
}

/** Derive the best local name the document offers, or null when it names none. */
function deriveServerName(text: string, command: McpStdioTransport | null): string | null {
  if (command !== null) {
    for (const arg of command.args) {
      if (arg.startsWith('-')) continue
      const scoped = /^@[^/]+\/(.+)$/.exec(arg)
      const base = scoped?.[1] ?? arg
      if (!/mcp/i.test(base)) continue
      const name = sanitizeName(base.replace(/^server-/, ''))
      if (name !== null) return name
    }
  }
  const heading = /^#{1,6}\s+(.+)$/m.exec(text)
  if (heading?.[1] !== undefined) {
    const name = sanitizeName(heading[1])
    if (name !== null) return name
  }
  return null
}

/** One server entry inside a parsed `mcpServers` object. */
interface JsonServerEntry {
  readonly command?: unknown
  readonly args?: unknown
  readonly cwd?: unknown
  readonly url?: unknown
  readonly env?: unknown
  readonly headers?: unknown
}

/** Every `mcpServers` entry, from the first JSON block that carries one. */
function jsonServers(text: string): Array<{ name: string; entry: JsonServerEntry }> | null {
  for (const candidate of [text, ...fencedBlocks(text), ...inlineSpans(text)]) {
    const trimmed = candidate.trim()
    if (!trimmed.startsWith('{')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const servers = (parsed as { mcpServers?: unknown }).mcpServers
    if (typeof servers !== 'object' || servers === null) continue
    return Object.entries(servers as Record<string, unknown>).map(([name, entry]) => ({
      name,
      entry: (typeof entry === 'object' && entry !== null ? entry : {}) as JsonServerEntry,
    }))
  }
  return null
}

/** Read the required values of one JSON server entry. */
function requiredFromJson(entry: JsonServerEntry, required: McpRequiredValue[], seen: Set<string>): void {
  if (typeof entry.env === 'object' && entry.env !== null) {
    for (const name of Object.keys(entry.env)) {
      addRequired(required, seen, name, 'environment', `The server reads ${name} from its environment.`)
    }
  }
  if (typeof entry.headers === 'object' && entry.headers !== null) {
    for (const name of Object.keys(entry.headers)) {
      addRequired(required, seen, name, 'header', `The server reads the ${name} request header.`)
    }
  }
}

/** Read one server entry into a transport, or null when it names neither branch. */
function transportFromJson(entry: JsonServerEntry): McpTransportInput | null {
  if (typeof entry.command === 'string' && entry.command.length > 0) {
    return {
      transport: 'stdio',
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args.filter((arg): arg is string => typeof arg === 'string') : [],
      cwd: typeof entry.cwd === 'string' ? entry.cwd : '',
    }
  }
  if (typeof entry.url === 'string' && entry.url.length > 0) {
    return { transport: 'streamable-http', url: entry.url }
  }
  return null
}

/**
 * Read the connection facts out of one documentation page.
 *
 * A `mcpServers` JSON block wins over prose: it names the server, its transport,
 * and its credential names explicitly. Otherwise the reader takes the first
 * launcher command it sees and the first endpoint URL it sees, and names every
 * environment or header value the page asks for. Values are never read out of
 * the page — a placeholder documents that a value is needed, not what it is.
 * @param documentation - the text the user handed over.
 * @returns the facts found, the values still needed, and the refusal when the page settles none.
 */
export function extractMcpDocumentation(documentation: string): McpExtraction {
  const text = documentation.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (text.length === 0) return { serverName: null, transport: null, required: [], refusal: 'empty' }

  const required: McpRequiredValue[] = []
  const seen = new Set<string>()
  const servers = jsonServers(text)
  const first = servers?.[0]
  if (first !== undefined) {
    requiredFromJson(first.entry, required, seen)
    const transport = transportFromJson(first.entry)
    if (transport === null) return { serverName: sanitizeName(first.name) ?? first.name, transport: null, required, refusal: 'no-transport' }
    return { serverName: sanitizeName(first.name) ?? first.name, transport, required, refusal: null }
  }

  const command = findCommand(text)
  const url = findUrl(text)
  for (const line of text.split('\n')) requiredFromLine(line, required, seen)

  if (command !== null && url !== null) {
    return { serverName: deriveServerName(text, command), transport: null, required, refusal: 'ambiguous-transport' }
  }
  const transport = command ?? url
  if (transport === null) return { serverName: deriveServerName(text, null), transport: null, required, refusal: 'no-transport' }
  return { serverName: deriveServerName(text, command), transport, required, refusal: null }
}
