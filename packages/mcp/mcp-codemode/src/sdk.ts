/**
 * Binding-name derivation and the TypeScript declarations a model reads from
 * `catalog`. Names are the harness's public MCP tool names, so a program written
 * against this facade runs unchanged against the same servers inside the
 * harness.
 * @module @deepseek-ai/dsh-mcp-codemode/src/sdk
 */

import { createHash } from 'node:crypto'
import type { UpstreamSummary, UpstreamTool } from './types.ts'

/**
 * DeepSeek function-name contract: at most 64 characters. Wire-protocol
 * constant shared with `@deepseek-ai/dsh-mcp-client`, not configuration.
 */
const MAX_BINDING_LENGTH = 64

/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_BINDING_CHARS = /[^A-Za-z0-9_-]/g

/** Hex characters of the identity hash appended when normalization is lossy. */
const HASH_LENGTH = 12

/** Recursion bound for nested schema rendering. */
const MAX_SCHEMA_DEPTH = 8

/** Schema keywords rendered as a TypeScript type; everything else becomes `unknown`. */
const SELF_REFERENTIAL_KEYWORDS = ['anyOf', 'oneOf', 'allOf'] as const

/** Characters allowed in a bare TypeScript property name. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Longest tool description copied into a catalog declaration. */
const MAX_DESCRIPTION_CHARS = 240

/**
 * Result value every binding resolves with: the harness MCP bridge's canonical
 * `{ content, structuredContent? }`. Declared once per catalog so a program can
 * read the envelope without guessing.
 */
const RESULT_DECLARATIONS = [
  'declare type McpContentBlock = { type: string; text?: string; data?: string; mimeType?: string; [key: string]: unknown };',
  'declare type McpToolResult = { content: McpContentBlock[]; structuredContent?: unknown };',
].join('\n')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Derive the program-facing key for one upstream tool.
 *
 * This is the harness's `publicToolName` derivation: `mcp__<server>__<raw>`,
 * with invalid characters replaced by `_`. A lossy or over-long result appends
 * the first 12 hex characters of `sha256(serverName + "\0" + rawName)`, so two
 * distinct tools never collapse onto one key.
 * @param serverName - Configured namespace of the upstream server.
 * @param rawName - The tool name the upstream server advertises.
 * @returns The `tools` key a program calls.
 */
export function bindingName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_BINDING_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_BINDING_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_BINDING_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

function propertyKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key)
}

function resolveRef(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined
  let node: unknown = root
  for (const rawSegment of ref.slice(2).split('/')) {
    if (!isRecord(node)) return undefined
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~')
    node = node[segment]
    if (node === undefined) return undefined
  }
  return node
}

function literalType(schema: Record<string, unknown>): string | undefined {
  const declared = schema.const
  if (declared !== undefined) return JSON.stringify(declared)
  const values = schema.enum
  if (!Array.isArray(values) || values.length === 0) return undefined
  const members = values.filter((value: unknown) => value !== undefined).map(value => JSON.stringify(value))
  return members.length === 0 ? undefined : [...new Set(members)].join(' | ')
}

function unionType(members: readonly string[]): string {
  const unique = [...new Set(members)]
  return unique.includes('unknown') ? 'unknown' : unique.join(' | ')
}

function arrayOf(itemType: string): string {
  return itemType.includes('\n') || itemType.includes(' | ') ? `Array<${itemType}>` : `${itemType}[]`
}

function objectType(schema: Record<string, unknown>, root: unknown, depth: number): string {
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === 'string') : [])
  const keys = Object.keys(properties).sort()
  const additional = schema.additionalProperties
  if (keys.length === 0) {
    return isRecord(additional) ? `Record<string, ${jsonSchemaToType(additional, root, depth + 1)}>` : 'Record<string, unknown>'
  }
  const pad = '  '.repeat(depth + 1)
  const lines = keys.map((key) => {
    const property = properties[key]
    const optional = required.has(key) ? '' : '?'
    return `${pad}${propertyKey(key)}${optional}: ${jsonSchemaToType(property, root, depth + 1)};`
  })
  if (additional === true || isRecord(additional)) {
    const value = isRecord(additional) ? jsonSchemaToType(additional, root, depth + 1) : 'unknown'
    lines.push(`${pad}[key: string]: ${value};`)
  }
  return `{\n${lines.join('\n')}\n${'  '.repeat(depth)}}`
}

function typeOfDeclaration(type: string, schema: Record<string, unknown>, root: unknown, depth: number): string {
  switch (type) {
    case 'object':
      return objectType(schema, root, depth)
    case 'array': {
      const items = schema.items
      if (Array.isArray(items)) {
        const tuple = items.map(item => jsonSchemaToType(item, root, depth + 1))
        return `[${tuple.join(', ')}]`
      }
      return arrayOf(jsonSchemaToType(items, root, depth + 1))
    }
    case 'string':
      return 'string'
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    default:
      return 'unknown'
  }
}

/**
 * Render one JSON Schema node as a TypeScript type. The renderer is total: any
 * construct it does not model (remote `$ref`, `not`, conditional keywords, an
 * unknown `type`) becomes `unknown`, so catalog generation never fails on a
 * third-party schema.
 * @param schema - JSON Schema node as the upstream advertised it.
 * @param root - Document root for local `$ref` resolution; defaults to `schema`.
 * @param depth - Current nesting depth, used for indentation and the recursion bound.
 * @returns A TypeScript type expression.
 */
export function jsonSchemaToType(schema: unknown, root: unknown = schema, depth = 0): string {
  if (depth > MAX_SCHEMA_DEPTH || schema === undefined || schema === true) return 'unknown'
  if (!isRecord(schema)) return 'unknown'
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(root, schema.$ref)
    return target === undefined ? 'unknown' : jsonSchemaToType(target, root, depth + 1)
  }
  const literal = literalType(schema)
  if (literal !== undefined) return literal
  for (const keyword of SELF_REFERENTIAL_KEYWORDS) {
    const members = schema[keyword]
    if (Array.isArray(members) && members.length > 0) {
      const rendered = members.map(member => jsonSchemaToType(member, root, depth))
      return keyword === 'allOf' ? `(${rendered.join(' & ')})` : unionType(rendered)
    }
  }
  const type = schema.type
  if (Array.isArray(type)) {
    return unionType(type.map(member => typeof member === 'string' ? typeOfDeclaration(member, schema, root, depth) : 'unknown'))
  }
  if (typeof type === 'string') return typeOfDeclaration(type, schema, root, depth)
  if (isRecord(schema.properties)) return objectType(schema, root, depth)
  return 'unknown'
}

function renderDescription(tool: UpstreamTool): string {
  const parts: string[] = []
  const description = tool.description?.trim().split('\n')[0]?.trim()
  if (description !== undefined && description.length > 0) {
    const bounded = description.length > MAX_DESCRIPTION_CHARS ? `${description.slice(0, MAX_DESCRIPTION_CHARS - 1)}…` : description
    parts.push(bounded)
  }
  const expected = `mcp__${tool.serverName}__${tool.rawName}`
  if (tool.binding !== expected) parts.push(`(upstream name: ${tool.rawName})`)
  return parts.join(' ').replaceAll('*/', '*\\/')
}

function renderDeclaration(tool: UpstreamTool): string {
  const args = jsonSchemaToType(tool.inputSchema)
  const parameters = args === 'Record<string, unknown>' || args === 'unknown' ? 'args: Record<string, unknown>' : `args: ${args}`
  const doc = renderDescription(tool)
  const docLine = doc.length === 0 ? '' : `  /** ${doc} */\n`
  return `${docLine}  ${propertyKey(tool.binding)}: (${parameters}) => Promise<McpToolResult>;`
}

/** Header for a catalog response: which servers, how many tools, how to narrow it. */
function renderHeader(servers: readonly UpstreamSummary[]): string {
  const inventory = servers.map(server => `${server.serverName} (${String(server.tools.length)} tools)`).join(', ')
  const narrowing = servers.length > 1
    ? ' Pass { server: "<name>" } to load one server only.'
    : ''
  return `// Upstream servers: ${inventory}.${narrowing}\n// Every entry below is async: \`const r = await tools.<name>(args)\`.\n// A tool failure rejects with that tool's message; the program may catch it and continue.\n`
}

/**
 * Render the `catalog` response for the selected upstream servers.
 *
 * The output is one `declare const tools` object, so a model can read it as
 * documentation and paste it into a TypeScript file unchanged.
 * @param servers - Connected servers whose declarations should appear.
 * @param maxBytes - Byte cap for the complete text; excess is cut at a tool boundary.
 * @returns Catalog text ending with a newline.
 */
export function renderCatalog(servers: readonly UpstreamSummary[], maxBytes: number): string {
  const preamble = `${renderHeader(servers)}\n${RESULT_DECLARATIONS}\n`
  const opening = 'declare const tools: {'
  const lines: string[] = [opening]
  const closing = '};'
  let used = Buffer.byteLength(`${preamble}${opening}\n${closing}\n`, 'utf8')
  let truncated = false
  outer: for (const server of servers) {
    if (servers.length > 1) {
      const section = `\n  // ${server.serverName} — ${String(server.tools.length)} tools`
      used += Buffer.byteLength(section, 'utf8')
      lines.push(section)
    }
    for (const tool of server.tools) {
      const declaration = renderDeclaration(tool)
      const size = Buffer.byteLength(`\n${declaration}`, 'utf8')
      if (used + size > maxBytes) {
        truncated = true
        break outer
      }
      used += size
      lines.push(declaration)
    }
  }
  const body = `${preamble}${lines.join('\n')}\n${closing}\n`
  if (!truncated) return body
  return `${body}\n// Truncated at ${String(maxBytes)} bytes. Call catalog({ server: "<name>" }) for one server.\n`
}
