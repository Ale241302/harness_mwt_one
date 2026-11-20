/**
 * O8A · the MWT.ONE transport over one tool call.
 *
 * The deployment names the two MCP tools it trusts: one read of an expediente
 * and one write. The adapter maps the proposal onto those calls and parses the
 * narrow answer shapes; it guesses no tool name and holds no credential. A
 * server that may have accepted the write but did not answer is reported as
 * {@link MwtDeliveryUnknown}, so the proposal stays unknown for conciliation.
 */

import { MwtDeliveryUnknown, type MwtRemoteState, type MwtTarget, type MwtTransport } from './types.ts'

/** One tool invocation, as the harness exposes it. */
export type MwtToolInvoker = (tool: string, args: Record<string, unknown>) => Promise<unknown>

/** How the deployment names its MWT tools. */
export interface MwtToolTransportOptions {
  /** Invoker wired to the MCP server. */
  readonly call: MwtToolInvoker
  /** Tool that reads one expediente. */
  readonly readTool: string
  /** Tool that writes one expediente revision. */
  readonly writeTool: string
}

/** Fields expediente_editar documents as writable. */
const WRITABLE_FIELDS = new Set([
  'brand_id',
  'modo_operacion',
  'freight_mode',
  'dispatch_mode',
  'incoterm',
  'forma_pago',
  'operating_company_id',
  'credit_days',
  'credit_days_mwt',
  'credit_days_cliente',
  'moneda',
  'po_number',
  'estado',
  'origin',
  'destination',
  'tracking',
  'carrier',
  'shipment_date',
  'eta',
  'origin_country',
  'destination_country',
])

/** Credit fields expediente_editar receives as JSON integers. */
const CREDIT_DAY_FIELDS = new Set(['credit_days', 'credit_days_mwt', 'credit_days_cliente'])

/** MCP envelopes and state metadata are not expediente fields. */
const STATE_METADATA = new Set([
  'content',
  'structuredContent',
  'isError',
  'campos',
  'fields',
  'documentos',
  'documents',
  'version',
  'etag',
  'updated_at',
])

/** Read one field from an unknown record. */
function field(record: Record<string, unknown>, name: string): unknown {
  return record[name]
}

/** Narrow an unknown value to a record, or null. */
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Parse one MCP text item without accepting a non-object JSON value. */
function parseTextRecord(text: string): Record<string, unknown> | null {
  try {
    return record(JSON.parse(text))
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

/** Unwrap structured MCP content or the first JSON object in text content. */
function unwrapAnswer(answer: unknown): Record<string, unknown> {
  const body = record(answer) ?? {}
  const structured = record(field(body, 'structuredContent'))
  if (structured !== null) return structured
  const content = field(body, 'content')
  if (Array.isArray(content)) {
    for (const entry of content) {
      const item = record(entry)
      const text = item === null ? undefined : field(item, 'text')
      if (typeof text !== 'string') continue
      const parsed = parseTextRecord(text)
      if (parsed !== null) return parsed
    }
  }
  return body
}

/** Convert a remote field value to the service's comparable representation. */
function remoteField(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * Parse MCP content or a direct answer into comparable destination state.
 * @param answer - tool answer to unwrap.
 * @returns root or nested fields, documents and the available revision token.
 */
export function parseRemoteState(answer: unknown): MwtRemoteState {
  const body = unwrapAnswer(answer)
  const fieldsRaw = Object.fromEntries(Object.entries(body).filter(([key]) => !STATE_METADATA.has(key)))
  Object.assign(fieldsRaw, record(field(body, 'campos')) ?? {}, record(field(body, 'fields')) ?? {})
  const fields = Object.fromEntries(Object.entries(fieldsRaw).map(([key, value]) => [key, remoteField(value)]))
  const documentsRaw = field(body, 'documentos') ?? field(body, 'documents') ?? []
  const documents = Array.isArray(documentsRaw)
    ? documentsRaw.flatMap((entry) => {
      const item = record(entry)
      if (item === null) return []
      const name = field(item, 'nombre') ?? field(item, 'name')
      const sha256 = field(item, 'sha256') ?? field(item, 'hash')
      if (typeof name !== 'string' || typeof sha256 !== 'string') return []
      return [{ name, sha256, bytes: Number(field(item, 'bytes') ?? 0) }]
    })
    : []
  const version = field(body, 'version') ?? field(body, 'etag') ?? field(body, 'updated_at')
  const versionText = typeof version === 'string'
    ? version
    : typeof version === 'number' ? String(version) : ''
  return { version: versionText, fields, documents }
}

/** Validate and map an approved revision without invoking expediente_editar. */
function approvedChanges(body: Parameters<MwtTransport['write']>[1]): Record<string, string | number> {
  if (body.documents.length > 0) {
    throw new Error('faberloom: expediente_editar no soporta escribir documentos')
  }
  const changes: Record<string, string | number> = {}
  for (const entry of body.fields) {
    if (!WRITABLE_FIELDS.has(entry.field)) {
      throw new Error(`faberloom: expediente_editar no acepta el campo ${entry.field}`)
    }
    if (!CREDIT_DAY_FIELDS.has(entry.field)) {
      changes[entry.field] = entry.value
      continue
    }
    const value = Number(entry.value)
    if (entry.value.trim().length === 0 || !Number.isSafeInteger(value)) {
      throw new Error(`faberloom: ${entry.field} debe ser un entero seguro`)
    }
    changes[entry.field] = value
  }
  return changes
}

/**
 * Build the transport over one invoker.
 * @param options - invoker and the two tool names the deployment trusts.
 * @returns the transport the write service registers.
 */
export function createMwtToolTransport(options: MwtToolTransportOptions): MwtTransport {
  return {
    read: async (target: MwtTarget): Promise<MwtRemoteState> => {
      const answer = await options.call(options.readTool, {
        expediente_id: target.expedienteId,
      })
      const state = parseRemoteState(answer)
      if (state.version.length === 0) {
        throw new Error('faberloom: la lectura del expediente no trajo versión; no se puede preparar una escritura')
      }
      return state
    },
    write: async (target, body) => {
      const changes = approvedChanges(body)
      let answer: unknown
      try {
        answer = await options.call(options.writeTool, {
          expediente_id: target.expedienteId,
          cambios: changes,
        })
      } catch (error) {
        // The invoker cannot tell whether the server committed; the service must
        // leave the proposal unknown rather than assume a failure.
        throw new MwtDeliveryUnknown(error instanceof Error ? error.message : String(error))
      }
      const result = unwrapAnswer(answer)
      const ref = field(result, 'ref') ?? field(result, 'id') ?? field(result, 'referencia')
      return { ref: typeof ref === 'string' ? ref : '' }
    },
  }
}
