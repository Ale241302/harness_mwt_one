/**
 * One knowledge proposal: the seven business fields an external agent may send,
 * their approved bounds, and the canonical content hash that makes a retry
 * distinguishable from a different proposal on the same client key.
 *
 * The parser is the boundary for both the MCP tool and a direct board call. It
 * rejects unknown keys and every authority field, so a caller cannot name the
 * owner, the company, the state, or an approval; the board derives those.
 * @module @deepseek-ai/dsh-faberloom-board/src/proposal
 */

import { createHash } from 'node:crypto'
import { canonicalIdentityField } from './keys.ts'
import type { FaberLoomBoardItemId } from './types.ts'

/** Artifact type one knowledge proposal carries. */
export const PROPOSAL_ARTIFACT_TYPE = 'propuesta-conocimiento'

/** Approved bounds of the seven business fields. */
export const PROPOSAL_LIMITS = {
  /** Repository-relative path of the file the proposal changes. */
  archivo: 512,
  /** Revision the proposal was prepared against. */
  versionBase: 128,
  /** Proposed change, as text or a bounded diff. */
  cambio: 20_000,
  /** Why the change is proposed. */
  motivo: 2_000,
  /** One evidence reference. */
  evidenciaItem: 512,
  /** Evidence references allowed per proposal. */
  evidenciaItems: 20,
  /** Client idempotency key, unique per owner and space. */
  claveCliente: 128,
  /** Display title. */
  title: 200,
} as const

/** The seven fields a producer may send. */
export interface BoardProposalInput {
  readonly archivo: string
  readonly versionBase: string
  readonly cambio: string
  readonly motivo: string
  readonly evidencia: readonly string[]
  readonly claveCliente: string
  readonly title: string
}

/** Receipt of one accepted proposal. */
export interface BoardProposalReceipt {
  /** Always true: a conflict is an error, never a partial receipt. */
  readonly recibida: true
  /** Durable item id the proposal created or resolved to. */
  readonly id: FaberLoomBoardItemId
}

/** Fields that only the server may set. */
const AUTHORITY_FIELDS = new Set([
  'id', 'ownerId', 'companyId', 'tenantId', 'spaceId', 'role', 'readOnly',
  'state', 'status', 'rowVersion', 'version', 'artifactHash', 'approvedRevision',
  'approvalEvidence', 'effects', 'events', 'revisions', 'human', 'token',
  'scope', 'scopes', 'effectKey', 'executionId', 'supersedesItemId',
  'createdAt', 'updatedAt', 'severity', 'dataClass', 'runId', 'idempotencyKey',
])

/** The seven accepted keys. */
const ACCEPTED_FIELDS = new Set([
  'archivo', 'versionBase', 'cambio', 'motivo', 'evidencia', 'claveCliente', 'title',
])

/**
 * Normalize one text field: Unicode NFC, trimmed, no NUL, no outer whitespace.
 * @param value - raw value.
 * @returns the normalized text.
 */
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('faberloom: PROPOSAL_FIELD_INVALID — every field must be a string')
  return value.normalize('NFC').replaceAll('\u0000', '').trim()
}

/**
 * Check one bounded text field.
 * @param field - field name for the message.
 * @param value - normalized value.
 * @param maximum - approved bound.
 * @returns the value.
 * @throws {Error} `PROPOSAL_FIELD_REQUIRED` or `PROPOSAL_LIMIT`.
 */
function bounded(field: string, value: string, maximum: number): string {
  if (value.length === 0) throw new Error(`faberloom: PROPOSAL_FIELD_REQUIRED — ${field} is required`)
  if (value.length > maximum) {
    throw new Error(`faberloom: PROPOSAL_LIMIT — ${field} exceeds ${String(maximum)} characters`)
  }
  return value
}

/**
 * Check one repository-relative path. The proposal is data, but a later
 * applicator resolves this field, so an absolute path, a parent segment, or a
 * Windows separator is refused at entry rather than carried forward.
 * @param value - normalized path.
 * @returns the path.
 * @throws {Error} `PROPOSAL_FIELD_INVALID` for an unsafe path.
 */
function repositoryPath(value: string): string {
  const path = bounded('archivo', value, PROPOSAL_LIMITS.archivo)
  if (path.startsWith('/') || /^[A-Za-z]:/u.test(path) || path.includes('\\') || path.split('/').includes('..')) {
    throw new Error('faberloom: PROPOSAL_FIELD_INVALID — archivo must be a repository-relative path')
  }
  return path
}

/**
 * Parse and normalize one proposal.
 * @param raw - the caller's object, already untrusted.
 * @returns the seven bounded fields.
 * @throws {Error} `PROPOSAL_AUTHORITY_FIELD`, `PROPOSAL_FIELD_UNKNOWN`, or a field error.
 */
export function parseProposalInput(raw: unknown): BoardProposalInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('faberloom: PROPOSAL_FIELD_INVALID — a proposal is an object with seven fields')
  }
  const record = raw as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (ACCEPTED_FIELDS.has(key)) continue
    if (AUTHORITY_FIELDS.has(key)) {
      throw new Error(`faberloom: PROPOSAL_AUTHORITY_FIELD — ${key} is set by the server, not by the proposal`)
    }
    throw new Error(`faberloom: PROPOSAL_FIELD_UNKNOWN — ${key} is not a proposal field`)
  }
  const clave = canonicalIdentityField(text(record['claveCliente']))
  if (clave === null) throw new Error('faberloom: PROPOSAL_FIELD_REQUIRED — claveCliente is required')
  bounded('claveCliente', clave, PROPOSAL_LIMITS.claveCliente)
  const evidence = record['evidencia']
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error('faberloom: PROPOSAL_FIELD_REQUIRED — evidencia needs at least one reference')
  }
  if (evidence.length > PROPOSAL_LIMITS.evidenciaItems) {
    throw new Error(`faberloom: PROPOSAL_LIMIT — evidencia exceeds ${String(PROPOSAL_LIMITS.evidenciaItems)} references`)
  }
  return {
    archivo: repositoryPath(text(record['archivo'])),
    versionBase: bounded('versionBase', text(record['versionBase']), PROPOSAL_LIMITS.versionBase),
    cambio: bounded('cambio', text(record['cambio']), PROPOSAL_LIMITS.cambio),
    motivo: bounded('motivo', text(record['motivo']), PROPOSAL_LIMITS.motivo),
    evidencia: evidence.map((entry, index) => bounded(
      `evidencia[${String(index)}]`,
      text(entry),
      PROPOSAL_LIMITS.evidenciaItem,
    )),
    claveCliente: clave,
    title: bounded('title', text(record['title']), PROPOSAL_LIMITS.title),
  }
}

/**
 * Hash the seven normalized fields in a fixed order. Two retries of the same
 * proposal hash equally; any changed field hashes differently, which is what
 * turns a reused client key into a conflict instead of a silent overwrite.
 * @param input - normalized proposal.
 * @returns lowercase hex sha256.
 */
export function proposalContentHash(input: BoardProposalInput): string {
  return createHash('sha256')
    .update(JSON.stringify([
      input.archivo,
      input.versionBase,
      input.cambio,
      input.motivo,
      input.evidencia,
      input.claveCliente,
      input.title,
    ]))
    .digest('hex')
}
