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

/** Read one field from an unknown record. */
function field(record: Record<string, unknown>, name: string): unknown {
  return record[name]
}

/** Narrow an unknown value to a record, or null. */
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Parse the read answer into the state the service compares. */
export function parseRemoteState(answer: unknown): MwtRemoteState {
  const body = record(answer) ?? {}
  const fieldsRaw = record(field(body, 'campos')) ?? record(field(body, 'fields')) ?? {}
  const fields: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(fieldsRaw)) {
    fields[key] = value === null || value === undefined
      ? null
      : typeof value === 'string' ? value : (typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value))
  }
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
  const version = field(body, 'version') ?? field(body, 'etag')
  const versionText = typeof version === 'string'
    ? version
    : typeof version === 'number' ? String(version) : ''
  return { version: versionText, fields, documents }
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
        expediente: target.expedienteId,
        coleccion: target.collection,
      })
      const state = parseRemoteState(answer)
      if (state.version.length === 0) {
        throw new Error('faberloom: la lectura del expediente no trajo versión; no se puede preparar una escritura')
      }
      return state
    },
    write: async (target, body, writeOptions) => {
      let answer: unknown
      try {
        answer = await options.call(options.writeTool, {
          expediente: target.expedienteId,
          coleccion: target.collection,
          campos: body.fields,
          documentos: body.documents,
          version_esperada: body.expectedVersion,
          idempotency_key: writeOptions.idempotencyKey,
        })
      } catch (error) {
        // The invoker cannot tell whether the server committed; the service must
        // leave the proposal unknown rather than assume a failure.
        throw new MwtDeliveryUnknown(error instanceof Error ? error.message : String(error))
      }
      const result = record(answer) ?? {}
      const ref = field(result, 'ref') ?? field(result, 'id') ?? field(result, 'referencia')
      return { ref: typeof ref === 'string' ? ref : '' }
    },
  }
}
