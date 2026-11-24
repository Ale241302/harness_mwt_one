import { publicToolName } from '@deepseek-ai/dsh-mcp-client'
import { describe, expect, it } from 'vitest'
import { bindingName, jsonSchemaToType, renderCatalog } from '../src/index.ts'
import type { UpstreamTool } from '../src/index.ts'

describe('binding names', () => {
  it('matches the harness public tool name for every name shape', () => {
    const cases = [
      ['mwt', 'sales_order_create'],
      ['sicop', 'listar_contratos'],
      ['fx', 'admin.reset'],
      ['fx', 'with space'],
      ['fx', 'a'.repeat(80)],
      ['fx', 'ñandú'],
      ['fx', 'add'],
    ] as const
    for (const [server, raw] of cases) {
      expect(bindingName(server, raw), `${server}/${raw}`).toBe(publicToolName(server, raw))
    }
  })

  it('keeps lossy variants distinct', () => {
    expect(bindingName('fx', 'admin.reset')).not.toBe(bindingName('fx', 'admin_reset'))
  })
})

describe('catalog declarations', () => {
  it('renders required, optional, nested, and enum argument types', () => {
    const type = jsonSchemaToType({
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: { sku: { type: 'string' }, qty: { type: 'integer' } },
            required: ['sku', 'qty'],
          },
        },
        state: { type: 'string', enum: ['open', 'closed'] },
        note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['customerId', 'lines'],
    })
    expect(type).toContain('customerId: string;')
    expect(type).toContain('lines: Array<{')
    expect(type).toContain('sku: string;')
    expect(type).toContain('qty: number;')
    expect(type).toContain('state?: "open" | "closed";')
    expect(type).toContain('note?: string | null;')
  })

  it('resolves local $ref and degrades unknown constructs to unknown', () => {
    const root = {
      type: 'object',
      properties: { a: { $ref: '#/$defs/Money' }, b: { $ref: 'https://example.com/x.json' }, c: { not: {} } },
      $defs: { Money: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] } },
    }
    const type = jsonSchemaToType(root)
    expect(type).toContain('amount: number;')
    expect(type).toContain('b?: unknown;')
    expect(type).toContain('c?: unknown;')
  })

  it('renders tuple items, intersections, literals, and open objects', () => {
    expect(jsonSchemaToType({ type: 'array', items: [{ type: 'string' }, { type: 'number' }] })).toBe('[string, number]')
    expect(jsonSchemaToType({ allOf: [{ type: 'object', properties: { a: { type: 'string' } } }, { type: 'object', properties: { b: { type: 'number' } } }] }))
      .toContain('a?: string;')
    expect(jsonSchemaToType({ const: 'fixed' })).toBe('"fixed"')
    expect(jsonSchemaToType({ type: 'object', additionalProperties: true })).toBe('Record<string, unknown>')
    expect(jsonSchemaToType({ type: 'object', properties: { 'a-b': { type: 'boolean' } } })).toContain('"a-b"?: boolean;')
    expect(jsonSchemaToType({ type: ['string', 'null'] })).toBe('string | null')
    expect(jsonSchemaToType(true)).toBe('unknown')
    expect(jsonSchemaToType({ type: 'object', additionalProperties: { type: 'string' } })).toBe('Record<string, string>')
  })

  it('renders one declare for every selected server', () => {
    const tools: UpstreamTool[] = [
      { serverName: 'mwt', rawName: 'sales_order_create', binding: 'mcp__mwt__sales_order_create', description: 'Create a sales order.', inputSchema: { type: 'object', properties: { customerId: { type: 'string' } }, required: ['customerId'] } },
      { serverName: 'sicop', rawName: 'listar_contratos', binding: 'mcp__sicop__listar_contratos', description: 'List contracts.', inputSchema: { type: 'object', properties: {} } },
    ]
    const text = renderCatalog([
      { serverName: 'mwt', tools: [tools[0] as UpstreamTool] },
      { serverName: 'sicop', tools: [tools[1] as UpstreamTool] },
    ], 8192)
    expect(text).toContain('// Upstream servers: mwt (1 tools), sicop (1 tools).')
    expect(text).toContain('const r = await tools.<name>(args)')
    expect(text).toContain('declare const tools: {')
    expect(text).toContain('// mwt — 1 tools')
    expect(text).toContain('mcp__mwt__sales_order_create: (args: {')
    expect(text).toContain('mcp__sicop__listar_contratos: (args: Record<string, unknown>) => Promise<McpToolResult>;')
    expect(text).toContain('declare type McpToolResult = { content: McpContentBlock[]; structuredContent?: unknown };')
  })

  it('truncates at a tool boundary and says how to narrow', () => {
    const tools: UpstreamTool[] = Array.from({ length: 40 }, (_, index) => ({
      serverName: 'fx',
      rawName: `tool_${String(index)}`,
      binding: `mcp__fx__tool_${String(index)}`,
      description: 'A tool with a description long enough to consume the catalog budget.',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    }))
    const text = renderCatalog([{ serverName: 'fx', tools }], 512)
    const body = text.split('// Truncated at')[0] ?? ''
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(512)
    expect(text).toContain('// Truncated at 512 bytes. Call catalog({ server: "<name>" }) for one server.')
    expect(text).not.toContain('mcp__fx__tool_39')
  })
})

describe('catalog edge cases', () => {
  it('degrades remote and broken refs, and renders every scalar and union form', () => {
    expect(jsonSchemaToType({
      type: 'object',
      properties: { deep: { $ref: '#/a/b' }, missing: { $ref: '#/nope' } },
      a: 5,
    })).toContain('deep?: unknown;\n  missing?: unknown;')
    expect(jsonSchemaToType({ enum: [undefined] })).toBe('unknown')
    expect(jsonSchemaToType({ anyOf: [{}, { type: 'string' }] })).toBe('unknown')
    expect(jsonSchemaToType({ type: 'array', items: { type: 'string' } })).toBe('string[]')
    expect(jsonSchemaToType({ type: 'array', items: { type: ['string', 'null'] } })).toBe('Array<string | null>')
    expect(jsonSchemaToType({ type: 'frobnicate' })).toBe('unknown')
    expect(jsonSchemaToType(5)).toBe('unknown')
    expect(jsonSchemaToType({ type: [5, 'string'] })).toBe('unknown')
    expect(jsonSchemaToType({ properties: { a: { type: 'string' } } })).toContain('a?: string;')
  })

  it('renders open objects with declared and open additional properties', () => {
    expect(jsonSchemaToType({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: true,
    })).toContain('[key: string]: unknown;')
    expect(jsonSchemaToType({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: { type: 'number' },
    })).toContain('[key: string]: number;')
  })

  it('trims descriptions and annotates a lossy binding with the upstream name', () => {
    const long = `x${'y'.repeat(300)}`
    const text = renderCatalog([{
      serverName: 'fx',
      tools: [
        {
          serverName: 'fx',
          rawName: 'admin.reset',
          binding: 'mcp__fx__admin_reset_abc123',
          description: `${long}\nsecond line`,
          inputSchema: { type: 'object', properties: {} },
        },
        {
          serverName: 'fx',
          rawName: 'quiet',
          binding: 'mcp__fx__quiet',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          serverName: 'fx',
          rawName: 'blank',
          binding: 'mcp__fx__blank',
          description: '   ',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    }], 8192)
    expect(text).toContain(`/** x${'y'.repeat(238)}… (upstream name: admin.reset) */`)
    expect(text).toContain('mcp__fx__quiet: (args: Record<string, unknown>) => Promise<McpToolResult>;')
    expect(text.split('\n').filter(line => line.includes('mcp__fx__quiet'))).toHaveLength(1)
    expect(text).toContain('mcp__fx__blank:')
  })
})
