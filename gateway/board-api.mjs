/**
 * API HTTP de la Mesa central (Opción A, A-58/D-5).
 *
 * El ítem vive en PostgreSQL (`mesa_items` + `mesa_events`) y no en el
 * `faberloom_board.json` de cada `DSH_HOME`. Este módulo es la capa que
 * persiste y autoriza: no implementa el motor de estados, las aprobaciones, la
 * iteración, los candidatos ni los efectos; esas reglas siguen en
 * `@deepseek-ai/dsh-faberloom-board` hasta que la API las cubra.
 *
 * Dos reglas mandan sobre el resto:
 *
 * 1. El actor sale de la sesión de cada request (`resolveActor`), nunca del
 *    cuerpo. El servidor no acepta `tenantId`, `ownerId`, `email` ni `role` en
 *    el JSON: los rechaza con `INVALID_INPUT`.
 * 2. Toda consulta lleva `tenant_id = $1` escrito en el SQL, además de RLS con
 *    `app.tenant_id` fijado por transacción. La segunda barrera no reemplaza a
 *    la primera: una consulta futura que olvide el filtro sigue topando con la
 *    política.
 *
 * Los códigos de error son estables y forman parte del contrato: `NO_ACCESS`,
 * `NOT_FOUND`, `STALE_ROW`, `DUPLICATE`, `NO_RUN`, `NO_EVIDENCE`, más los de
 * transporte `UNAUTHENTICATED`, `INVALID_INPUT` e `INTERNAL`.
 */

import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import express from 'express'

/** Estados que la Mesa persiste hoy (`BoardState` del paquete del board). */
export const BOARD_STATES = Object.freeze([
  'PENDIENTE_CRITERIO',
  'ITERANDO',
  'ESPERANDO_OTRO',
  'DELEGADO_EN_VENTANA',
  'EJECUCION_PENDIENTE',
  'ERROR_RECUPERABLE',
  'ERROR_SIN_SALIDA',
  'DESCONOCIDO',
  'APROBADO',
  'EJECUTADO',
  'DESCARTADO',
  'SUSTITUIDO',
])

/**
 * Estados que liberan la clave de negocio. La unicidad es solo entre ítems
 * vivos, igual que en el board: un ítem cerrado no impide volver a preparar el
 * mismo artefacto. Debe coincidir con el predicado del índice
 * `mesa_items_live_business_key`.
 */
export const TERMINAL_STATES = Object.freeze(['APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO'])

/** Roles de consola que operan cualquier ítem de su tenant. */
const ADMIN_ROLES = new Set(['admin', 'superadmin', 'ceo'])

/**
 * Campos que solo resuelve el servidor. Un cuerpo que los traiga se rechaza en
 * vez de ignorarlos: silenciar un `tenantId` ajeno haría creer al cliente que
 * cambió de tenant.
 */
const SERVER_OWNED_FIELDS = Object.freeze([
  'tenantId',
  'tenant_id',
  'companyId',
  'company_id',
  'ownerId',
  'owner_id',
  'email',
  'role',
])

const MAX_TEXT = 256
const MAX_TITLE = 500
const MAX_EVIDENCE = 100
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const DEFAULT_EVENT_LIMIT = 200
const MAX_EVENT_LIMIT = 500

/** Error con un código estable y su status HTTP. */
export class BoardError extends Error {
  /**
   * @param {string} code - stable machine-readable code.
   * @param {number} status - HTTP status.
   * @param {string} message - human-readable message safe to return.
   * @param {unknown} [details] - optional field-level detail.
   */
  constructor(code, status, message, details) {
    super(message)
    this.name = 'BoardError'
    this.code = code
    this.status = status
    this.details = details
  }
}

// ── Esquema ────────────────────────────────────────────────────────────────
//
// No hay DDL en este módulo. El único esquema es
// `packages/faberloom/board/postgres/schema.sql`: lo aplican el operador y la
// suite de este módulo. Un segundo DDL embebido divergió una vez (ids `text`,
// `CASCADE`, una política `FOR ALL`); leer el archivo canónico impide que vuelva
// a pasar.
//
// Orden de resolución de la ruta:
//   1. `options.schemaFile`;
//   2. `MESA_SCHEMA_FILE`;
//   3. `schema.sql` junto a este módulo (la imagen copia el archivo ahí);
//   4. `../packages/faberloom/board/postgres/schema.sql` (repo).
// Una ruta relativa se resuelve contra el directorio de este módulo, no contra
// el cwd del proceso.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const IMAGE_SCHEMA_FILE = resolve(MODULE_DIR, 'schema.sql')
const REPO_SCHEMA_FILE = resolve(MODULE_DIR, '../packages/faberloom/board/postgres/schema.sql')

/**
 * Ruta del `schema.sql` canónico que se aplicaría, sin leerlo.
 * @param {{ schemaFile?: string }} [options] - override for tests or a deployment.
 * @returns {string} absolute path of the first candidate that exists.
 * @throws {Error} when no candidate exists.
 */
export function mesaSchemaFile(options = {}) {
  const candidates = [
    options.schemaFile,
    process.env.MESA_SCHEMA_FILE,
    IMAGE_SCHEMA_FILE,
    REPO_SCHEMA_FILE,
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) continue
    const file = isAbsolute(candidate) ? candidate : resolve(MODULE_DIR, candidate)
    if (existsSync(file)) return file
  }
  throw new Error(
    'board-api: no se encontró schema.sql; define MESA_SCHEMA_FILE o copia '
    + 'packages/faberloom/board/postgres/schema.sql junto a este módulo',
  )
}

/**
 * El esquema canónico como texto, para un operador o para `applyMesaSchema`.
 * @param {{ schemaFile?: string }} [options] - override for tests or a deployment.
 * @returns {string} the complete idempotent bootstrap, including BEGIN/COMMIT.
 */
export function mesaSchemaSql(options = {}) {
  return readFileSync(mesaSchemaFile(options), 'utf8')
}

/**
 * Aplica el esquema canónico. Es idempotente: la segunda ejecución no cambia
 * nada. Se envía como un solo script para que el `BEGIN`/`COMMIT` del archivo y
 * los bloques `DO $$ … $$` lleguen completos a PostgreSQL.
 * @param {{ query: Function, connect?: Function, exec?: Function }} target - `pg` Pool, a checked-out client, or a PGlite-like adapter.
 * @param {{ schemaFile?: string }} [options] - override for tests or a deployment.
 * @returns {Promise<void>} resolves after the script commits.
 */
export async function applyMesaSchema(target, options = {}) {
  const sql = mesaSchemaSql(options)
  if (typeof target.exec === 'function') {
    await target.exec(sql)
    return
  }
  const client = typeof target.connect === 'function' ? await target.connect() : target
  try {
    await client.query(sql)
  } catch (error) {
    // Un error a mitad del script deja la transacción abierta y abortada; la
    // conexión no debe volver al pool en ese estado.
    await rollbackQuietly(client)
    throw error
  } finally {
    if (typeof client.release === 'function') client.release()
  }
}

// ── Identificadores externos ───────────────────────────────────────────────
//
// El esquema canónico usa uuid para `tenant_id`, `id` y `space_id`. El gateway
// entrega el tenant como `companyId` y el space como referencia opaca, y ninguno
// garantiza ser un uuid. Para no rechazar sesiones válidas ni inventar un
// tenant nuevo en cada request, un valor que no es uuid se proyecta a un UUIDv5
// determinista (RFC 4122, SHA-1 sobre el namespace + el nombre). Dos procesos
// calculan el mismo uuid para la misma clave, y `tenant_key` / `space_key`
// conservan la clave original para devolverla y para soporte.
//
// Namespaces fijos: cámbialos solo con una migración, porque cambian el tenant
// físico de cada fila.

const TENANT_NAMESPACE = '5f0c7a2e-1b9d-4c3a-8e6f-2d4b7c9a0e11'
const SPACE_NAMESPACE = 'b7e4d1c8-3a6f-4e29-9c05-6a8f2b4d7e13'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/**
 * @param {string} namespace - UUID namespace, hyphenated.
 * @param {string} name - the opaque identifier.
 * @returns {string} a UUIDv5 for `name`, or `name` lowercased when it already is one.
 */
function uuidForKey(namespace, name) {
  if (UUID_RE.test(name)) return name.toLowerCase()
  const digest = crypto
    .createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest()
  const bytes = Buffer.from(digest.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * UUID estable de un tenant del gateway. Un uuid se devuelve tal cual.
 * @param {string} tenantKey - normalized tenant id from the session.
 * @returns {string} the value stored in `mesa_items.tenant_id`.
 */
export function mesaTenantUuid(tenantKey) {
  return uuidForKey(TENANT_NAMESPACE, tenantKey)
}

/**
 * UUID estable de un Space. Un uuid se devuelve tal cual.
 * @param {string} spaceKey - opaque space id from the request.
 * @returns {string} the value stored in `mesa_items.space_id`.
 */
export function mesaSpaceUuid(spaceKey) {
  return uuidForKey(SPACE_NAMESPACE, spaceKey)
}

// ── Identidad ──────────────────────────────────────────────────────────────

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} value @returns {string | undefined} */
function firstText(...values) {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text.length > 0) return text
  }
  return undefined
}

/**
 * Normaliza el actor que entrega la sesión. Email y tenant se pasan a
 * minúsculas: `owner_id` se guarda así, y `resolveClientId` del gateway ya
 * escribe el `companyId` del board en minúsculas. Dos formas del mismo id no
 * deben abrir dos espacios de datos.
 *
 * Precedencia del tenant: `tenantId`, `tenant_id`, `companyId`, `company_id`,
 * `ent` (la empresa elegida en el gateway), `entityId`, `legalEntityIds[0]`,
 * `ents[0]`. Un actor sin email válido o sin tenant no es un actor.
 *
 * @param {unknown} raw - `{ email, tenantId, role }` or a session record carrying them.
 * @returns {{ email: string, tenantId: string, role: string } | null} normalized actor, or null.
 */
export function normalizeActor(raw) {
  if (!isObject(raw)) return null
  const source = isObject(raw.user) ? { ...raw, ...raw.user } : raw
  const email = firstText(source.email, source.mail)?.toLowerCase()
  const tenantId = firstText(
    source.tenantId,
    source.tenant_id,
    source.companyId,
    source.company_id,
    source.ent,
    source.entityId,
    Array.isArray(source.legalEntityIds) ? source.legalEntityIds[0] : undefined,
    Array.isArray(source.ents) ? source.ents[0] : undefined,
  )?.toLowerCase()
  if (email === undefined || !/^[^\s@]+@[^\s@]+$/.test(email)) return null
  if (tenantId === undefined || tenantId.length > MAX_TEXT) return null
  const role = typeof source.role === 'string' ? source.role.trim().toLowerCase() : ''
  return { email, tenantId, role }
}

/**
 * Lector por defecto: `req.boardActor` (lo fija un middleware de autenticación),
 * después `req.session` y después `req.user`; un candidato que no normaliza deja
 * pasar al siguiente. El gateway monta la ruta con su propio resolvedor cuando
 * el rol no viaja en la cookie; ver `BOARD-API.md`.
 * @param {import('express').Request} req - incoming request.
 * @returns {{ email: string, tenantId: string, role: string } | null} normalized actor, or null.
 */
export function readActorFromRequest(req) {
  for (const candidate of [req.boardActor, req.session, req.user]) {
    const actor = normalizeActor(candidate)
    if (actor !== null) return actor
  }
  return null
}

/** @param {string} role @returns {boolean} */
function isAdmin(role) {
  return ADMIN_ROLES.has(role)
}

/**
 * Compara el dueño sin distinguir mayúsculas: los ítems migrados pueden traer
 * el email como lo escribió el sistema anterior, y negarle la escritura a su
 * dueño por eso sería un fallo de la migración, no una regla.
 * @param {string} ownerId - stored `owner_id`.
 * @param {string} email - normalized session email.
 * @returns {boolean} true when the actor owns the row.
 */
function ownsItem(ownerId, email) {
  return typeof ownerId === 'string' && ownerId.toLowerCase() === email
}

/**
 * @param {{ email: string, role: string }} actor
 * @param {{ tenant_id: string, owner_id: string }} item
 * @param {string} tenantId - uuid derived from the session tenant key.
 * @returns {void}
 * @throws {BoardError} `NOT_FOUND` for another tenant; `NO_ACCESS` when a non-admin does not own the item.
 */
function assertReadable(actor, item, tenantId) {
  if (item.tenant_id !== tenantId) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')
  if (isAdmin(actor.role) || ownsItem(item.owner_id, actor.email)) return
  throw new BoardError('NO_ACCESS', 403, 'el ítem pertenece a otro usuario del tenant')
}

/**
 * @param {{ email: string, role: string }} actor
 * @param {{ tenant_id: string, owner_id: string }} item
 * @param {string} tenantId - uuid derived from the session tenant key.
 * @returns {void}
 * @throws {BoardError} `NOT_FOUND` for another tenant; `NO_ACCESS` when a non-admin does not own the item.
 */
function assertWritable(actor, item, tenantId) {
  if (item.tenant_id !== tenantId) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')
  if (isAdmin(actor.role) || ownsItem(item.owner_id, actor.email)) return
  throw new BoardError('NO_ACCESS', 403, 'solo el dueño o un administrador del tenant puede escribir este ítem')
}

// ── Validación ─────────────────────────────────────────────────────────────

/** @param {string} message @param {unknown} [details] @returns {BoardError} */
function invalid(message, details) {
  return new BoardError('INVALID_INPUT', 400, message, details)
}

/** @param {string} message @returns {BoardError} */
function duplicate(message) {
  return new BoardError('DUPLICATE', 409, message)
}

/** @param {import('express').Request} req @returns {Record<string, unknown>} */
function readBody(req) {
  if (req.body === undefined || req.body === null) return {}
  if (!isObject(req.body)) throw invalid('el cuerpo debe ser un objeto JSON')
  return req.body
}

/** @param {Record<string, unknown>} body @returns {void} */
function rejectServerOwnedFields(body) {
  const present = SERVER_OWNED_FIELDS.filter(field => Object.hasOwn(body, field))
  if (present.length > 0) {
    throw invalid(`el servidor resuelve ${present.join(', ')} desde la sesión; no se acepta en el cuerpo`)
  }
}

/**
 * @param {Record<string, unknown>} body
 * @param {string} field
 * @param {{ code?: string, max?: number }} [options]
 * @returns {string}
 */
function requiredText(body, field, options = {}) {
  const value = body[field]
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length === 0) {
    throw new BoardError(options.code ?? 'INVALID_INPUT', options.code === undefined ? 400 : 422, `falta ${field}`)
  }
  if (text.length > (options.max ?? MAX_TEXT)) throw invalid(`${field} supera ${options.max ?? MAX_TEXT} caracteres`)
  return text
}

/**
 * @param {Record<string, unknown>} body
 * @param {string} field
 * @param {number} [max]
 * @returns {string | null}
 */
function optionalText(body, field, max = MAX_TEXT) {
  const value = body[field]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw invalid(`${field} debe ser texto`)
  const text = value.trim()
  if (text.length > max) throw invalid(`${field} supera ${max} caracteres`)
  return text.length === 0 ? null : text
}

/**
 * @param {Record<string, unknown>} body
 * @param {string} field
 * @returns {Record<string, unknown>}
 */
function optionalObject(body, field) {
  const value = body[field]
  if (value === undefined) return {}
  if (!isObject(value)) throw invalid(`${field} debe ser un objeto JSON`)
  return value
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function readEvidence(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BoardError('NO_EVIDENCE', 422, 'un ítem requiere al menos una referencia de evidencia')
  }
  if (value.length > MAX_EVIDENCE) throw invalid(`evidence admite como máximo ${MAX_EVIDENCE} referencias`)
  const seen = new Set()
  const evidence = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw invalid('cada referencia de evidence debe ser texto no vacío')
    }
    const ref = entry.trim()
    if (seen.has(ref)) continue
    seen.add(ref)
    evidence.push(ref)
  }
  return evidence
}

/**
 * @param {unknown} value
 * @param {string} [field]
 * @returns {string}
 */
function readState(value, field = 'state') {
  if (typeof value !== 'string' || !BOARD_STATES.includes(value)) {
    throw invalid(`${field} no es un estado de la Mesa`, { allowed: BOARD_STATES })
  }
  return value
}

/**
 * @param {import('express').Request} req
 * @param {string} name
 * @param {number} [max]
 * @returns {string | null}
 */
function queryText(req, name, max = MAX_TEXT) {
  const value = req.query[name]
  if (value === undefined) return null
  if (typeof value !== 'string') throw invalid(`${name} debe ser un solo valor`)
  const text = value.trim()
  if (text.length > max) throw invalid(`${name} supera ${max} caracteres`)
  return text.length === 0 ? null : text
}

/**
 * @param {import('express').Request} req
 * @param {string} name
 * @param {number} fallback
 * @param {number} max
 * @returns {number}
 */
function queryLimit(req, name, fallback, max) {
  const value = req.query[name]
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw invalid(`${name} debe ser un entero positivo`)
  const parsed = Number.parseInt(value, 10)
  if (parsed < 1) throw invalid(`${name} debe ser un entero positivo`)
  return Math.min(parsed, max)
}

// ── Filas ──────────────────────────────────────────────────────────────────

/** @param {unknown} value @param {unknown} fallback @returns {unknown} */
function asJson(value, fallback) {
  if (value === null || value === undefined) return fallback
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch (parseError) {
    // Un jsonb guardado por otra herramienta no debería llegar como texto; si
    // llega, se devuelve el texto en vez de romper la lectura del ítem.
    return value
  }
}

/** @param {unknown} value @returns {string | null} */
function toIso(value) {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return null
}

/**
 * @param {Record<string, unknown>} row - `mesa_items` row.
 * @returns {Record<string, unknown>} the stable JSON item.
 */
function itemJson(row) {
  return {
    id: row.id,
    // La clave que mandó la sesión; el uuid derivado solo se usa para aislar.
    tenantId: row.tenant_key ?? row.tenant_id,
    ownerId: row.owner_id,
    spaceId: row.space_key ?? row.space_id ?? null,
    businessKey: row.business_key,
    state: row.state,
    // `bigint` llega como texto o BigInt según el driver; el contrato es número.
    rowVersion: Number(row.row_version),
    title: row.title ?? null,
    evidence: asJson(row.evidence, []),
    payload: asJson(row.payload, {}),
    runId: row.run_id ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

/**
 * @param {Record<string, unknown>} row - `mesa_events` row.
 * @returns {Record<string, unknown>} the stable JSON event.
 */
function eventJson(row) {
  return {
    seq: Number(row.seq),
    actor: row.actor,
    command: row.command,
    fromState: row.from_state ?? null,
    toState: row.to_state ?? null,
    payload: asJson(row.payload, {}),
    at: toIso(row.at),
  }
}

/**
 * Un id de ruta que no es uuid no puede existir en la tabla canónica. Se
 * responde `NOT_FOUND` en vez de dejar que PostgreSQL devuelva 22P02 (un 500
 * que además distingue "mal formado" de "no existe").
 * @param {string} value - `req.params.id`.
 * @returns {string} the normalized uuid.
 * @throws {BoardError} `NOT_FOUND` when the value is not a uuid.
 */
function readItemId(value) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!UUID_RE.test(id)) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')
  return id
}

// ── SQL ────────────────────────────────────────────────────────────────────
//
// Todo valor viaja como parámetro. Los únicos textos fijos son nombres de
// columna y cláusulas que no dependen del request.

const ITEM_COLUMNS = `id, tenant_id, tenant_key, owner_id, space_id, space_key,
  business_key, state, row_version, title, evidence, payload, run_id,
  created_at, updated_at`

const SELECT_ITEM_SQL = `SELECT ${ITEM_COLUMNS}
  FROM mesa_items
  WHERE tenant_id = $1 AND id = $2`

const SELECT_ITEM_FOR_UPDATE_SQL = `${SELECT_ITEM_SQL}
  FOR UPDATE`

const SELECT_BY_IDEMPOTENCY_SQL = `SELECT ${ITEM_COLUMNS}
  FROM mesa_items
  WHERE tenant_id = $1 AND idempotency_key = $2`

const SELECT_LIVE_BUSINESS_KEY_SQL = `SELECT id
  FROM mesa_items
  WHERE tenant_id = $1
    AND business_key = $2
    AND NOT (state = ANY($3::text[]))
  LIMIT 1`

const INSERT_ITEM_SQL = `INSERT INTO mesa_items (
    tenant_id, id, owner_id, tenant_key, space_id, space_key, business_key,
    state, row_version, title, evidence, payload, run_id, idempotency_key
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10::jsonb, $11::jsonb, $12, $13)
  RETURNING ${ITEM_COLUMNS}`

const UPDATE_ITEM_SQL = `UPDATE mesa_items
  SET state = $3,
      payload = $4::jsonb,
      row_version = row_version + 1
  WHERE tenant_id = $1 AND id = $2 AND row_version = $5
  RETURNING ${ITEM_COLUMNS}`

const LIST_ITEMS_SQL = `SELECT ${ITEM_COLUMNS}
  FROM mesa_items
  WHERE tenant_id = $1
    AND ($2::text IS NULL OR state = $2)
    AND ($3::uuid IS NULL OR space_id = $3::uuid)
    AND ($4::text IS NULL OR lower(owner_id) = $4)
  ORDER BY created_at DESC, id DESC
  LIMIT $5`

const NEXT_EVENT_SEQ_SQL = `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
  FROM mesa_events
  WHERE tenant_id = $1 AND item_id = $2`

const INSERT_EVENT_SQL = `INSERT INTO mesa_events (
    tenant_id, item_id, seq, actor, command, from_state, to_state, payload
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
  RETURNING seq, actor, command, from_state, to_state, payload, at`

const LIST_EVENTS_SQL = `SELECT seq, actor, command, from_state, to_state, payload, at
  FROM mesa_events
  WHERE tenant_id = $1 AND item_id = $2 AND seq > $3
  ORDER BY seq ASC
  LIMIT $4`

// ── Transacciones ──────────────────────────────────────────────────────────

const ROLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u

/**
 * Ejecuta un bloque con el contexto de RLS fijado: tenant, actor y rol, y el
 * rol de base `mesa_app` (el mismo que conceden los GRANT del esquema). Todo es
 * local a la transacción (`set_config(..., true)` / `SET LOCAL`), así que la
 * conexión vuelve al pool sin contexto pegado.
 * @template T
 * @param {{ connect: () => Promise<{ query: Function, release: Function }> }} pool - pg-compatible pool.
 * @param {{ email: string, tenantId: string, role: string }} actor - session identity.
 * @param {(client: { query: Function }, tenantId: string) => Promise<T>} work - statements to run inside the transaction; receives the derived tenant uuid.
 * @param {{ dbRole?: string | false }} [options] - database role; `false` keeps the login's role (tests or an already-scoped connection).
 * @returns {Promise<T>} the block's result after COMMIT.
 */
async function withTenant(pool, actor, work, options = {}) {
  const tenantId = mesaTenantUuid(actor.tenantId)
  const dbRole = options.dbRole === undefined ? 'mesa_app' : options.dbRole
  if (typeof dbRole === 'string' && !ROLE_NAME.test(dbRole)) {
    throw new Error('board-api: dbRole debe ser un identificador SQL simple')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (dbRole !== false) await client.query(`SET LOCAL ROLE ${dbRole}`)
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
    await client.query("SELECT set_config('app.actor_id', $1, true)", [actor.email])
    await client.query("SELECT set_config('app.role', $1, true)", [actor.role])
    const result = await work(client, tenantId)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await rollbackQuietly(client)
    throw error
  } finally {
    client.release()
  }
}

/**
 * Un ROLLBACK fallido deja la conexión inservible; `release` la descarta. El
 * error que importa es el de la operación original, no el del rollback.
 * @param {{ query: Function }} client - the transaction connection.
 * @returns {Promise<void>} resolves even when the rollback failed.
 */
async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK')
  } catch (rollbackError) {
    console.error('[board-api] rollback fallido:', rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
  }
}

// ── Router ─────────────────────────────────────────────────────────────────

/** @param {unknown} error @returns {boolean} */
function isUniqueViolation(error) {
  return isObject(error) && error.code === '23505'
}

/**
 * @param {unknown} error
 * @returns {{ status: number, code: string, message: string, details?: unknown }}
 */
function mapError(error) {
  if (error instanceof BoardError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    }
  }
  if (isUniqueViolation(error)) {
    return { status: 409, code: 'DUPLICATE', message: 'la clave de idempotencia o de negocio ya está tomada' }
  }
  if (isObject(error) && (error.type === 'entity.parse.failed' || error instanceof SyntaxError)) {
    return { status: 400, code: 'INVALID_INPUT', message: 'el cuerpo no es JSON válido' }
  }
  if (isObject(error) && error.type === 'entity.too.large') {
    return { status: 413, code: 'INVALID_INPUT', message: 'el cuerpo supera el límite permitido' }
  }
  return { status: 500, code: 'INTERNAL', message: 'error interno de la Mesa' }
}

/**
 * Envuelve un handler async para que express 4 reciba el rechazo.
 * @param {(req: import('express').Request, res: import('express').Response) => Promise<void>} handler
 * @returns {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => void}
 */
function route(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next)
  }
}

/**
 * Construye el router de la Mesa. Se monta en `/board`:
 *
 * ```js
 * app.use('/board', createBoardRouter({ pool, resolveActor }))
 * ```
 *
 * `resolveActor` es obligatorio: la identidad no se adivina. Un montaje sin
 * resolvedor falla al construir, no responde 401 a todo el mundo.
 *
 * @param {{
 *   pool: { query: Function, connect: Function },
 *   resolveActor: (req: import('express').Request) => unknown | Promise<unknown>,
 *   generateId?: () => string,
 *   bodyLimit?: string,
 *   dbRole?: string | false,
 * }} options - the pool and the session reader; `generateId` is for tests.
 * @returns {import('express').Router} an express router under `/board`.
 */
export function createBoardRouter(options) {
  const { pool, resolveActor, generateId = () => crypto.randomUUID() } = options ?? {}
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new Error('board-api: se requiere un pool pg con query() y connect()')
  }
  if (typeof resolveActor !== 'function') {
    throw new Error('board-api: resolveActor es obligatorio para leer la identidad de la sesión')
  }
  const bodyLimit = options?.bodyLimit ?? '256kb'
  // El login de runtime entra a `mesa_app` con SET LOCAL ROLE, igual que
  // `withTenant()` del paquete del esquema. `false` sirve para una conexión que
  // ya usa el rol, o para un motor de prueba sin roles.
  const dbRole = options?.dbRole ?? 'mesa_app'
  if (typeof dbRole === 'string' && !ROLE_NAME.test(dbRole)) {
    throw new Error('board-api: dbRole debe ser un identificador SQL simple')
  }
  const router = express.Router()

  router.use((req, res, next) => {
    const incoming = req.get('x-request-id')
    const requestId = typeof incoming === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming)
      ? incoming
      : crypto.randomUUID()
    req.requestId = requestId
    res.setHeader('X-Request-Id', requestId)
    // La respuesta lleva datos de un tenant: ningún proxy compartido debe
    // guardarla y servirla a otra sesión.
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  router.use(express.json({ limit: bodyLimit, strict: true }))

  /**
   * @param {import('express').Request} req
   * @returns {Promise<{ email: string, tenantId: string, role: string }>}
   */
  async function requireActor(req) {
    const actor = normalizeActor(await resolveActor(req))
    if (actor === null) {
      throw new BoardError('UNAUTHENTICATED', 401, 'la sesión no identifica email y tenant')
    }
    return actor
  }

  router.get('/items', route(async (req, res) => {
    const actor = await requireActor(req)
    const state = queryText(req, 'state')
    if (state !== null && !BOARD_STATES.includes(state)) {
      throw invalid('state no es un estado de la Mesa', { allowed: BOARD_STATES })
    }
    const spaceId = queryText(req, 'spaceId')
    const limit = queryLimit(req, 'limit', DEFAULT_LIMIT, MAX_LIMIT)
    const ownerFilter = isAdmin(actor.role) ? null : actor.email

    const result = await withTenant(pool, actor, (client, tenantId) => client.query(LIST_ITEMS_SQL, [
      tenantId,
      state,
      spaceId === null ? null : mesaSpaceUuid(spaceId),
      ownerFilter,
      limit,
    ]), { dbRole })
    res.json({ items: result.rows.map(itemJson) })
  }))

  router.get('/items/:id', route(async (req, res) => {
    const actor = await requireActor(req)
    const id = readItemId(req.params.id)
    const item = await withTenant(pool, actor, async (client, tenantId) => {
      const result = await client.query(SELECT_ITEM_SQL, [tenantId, id])
      return result.rows[0] ?? null
    }, { dbRole })
    if (item === null) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')
    assertReadable(actor, item, mesaTenantUuid(actor.tenantId))
    res.json({ item: itemJson(item) })
  }))

  router.post('/items', route(async (req, res) => {
    const actor = await requireActor(req)
    const body = readBody(req)
    rejectServerOwnedFields(body)

    const runId = requiredText(body, 'runId', { code: 'NO_RUN', max: MAX_TEXT })
    const idempotencyKey = requiredText(body, 'idempotencyKey', { code: 'NO_RUN', max: MAX_TEXT })
    const businessKey = requiredText(body, 'businessKey', { max: MAX_TEXT })
    const title = requiredText(body, 'title', { max: MAX_TITLE })
    const evidence = readEvidence(body.evidence)
    const state = body.state === undefined ? 'PENDIENTE_CRITERIO' : readState(body.state)
    const spaceId = optionalText(body, 'spaceId')
    const payload = optionalObject(body, 'payload')

    const outcome = await withTenant(pool, actor, async (client, tenantId) => {
      const prior = await client.query(SELECT_BY_IDEMPOTENCY_SQL, [tenantId, idempotencyKey])
      const existing = prior.rows[0] ?? null
      if (existing !== null) {
        if (ownsItem(existing.owner_id, actor.email) && existing.business_key === businessKey) {
          return { item: existing, replay: true }
        }
        throw duplicate('la clave de idempotencia ya pertenece a otro ítem')
      }

      const clash = await client.query(SELECT_LIVE_BUSINESS_KEY_SQL, [tenantId, businessKey, TERMINAL_STATES])
      if (clash.rows[0] !== undefined) throw duplicate('la clave de negocio ya pertenece a un ítem vivo')

      const id = generateId()
      let inserted
      try {
        inserted = await client.query(INSERT_ITEM_SQL, [
          tenantId,
          id,
          actor.email,
          actor.tenantId,
          spaceId === null ? null : mesaSpaceUuid(spaceId),
          spaceId,
          businessKey,
          state,
          title,
          JSON.stringify(evidence),
          JSON.stringify(payload),
          runId,
          idempotencyKey,
        ])
      } catch (error) {
        if (isUniqueViolation(error)) throw duplicate('la clave de idempotencia o de negocio ya está tomada')
        throw error
      }

      await client.query(INSERT_EVENT_SQL, [
        tenantId,
        id,
        1,
        actor.email,
        'created',
        null,
        state,
        JSON.stringify({ businessKey, runId, spaceId }),
      ])
      return { item: inserted.rows[0], replay: false }
    }, { dbRole })

    if (outcome.replay) res.setHeader('Idempotent-Replay', 'true')
    res.status(outcome.replay ? 200 : 201).json({ item: itemJson(outcome.item) })
  }))

  router.patch('/items/:id', route(async (req, res) => {
    const actor = await requireActor(req)
    const body = readBody(req)
    rejectServerOwnedFields(body)

    const rawVersion = body.rowVersion
    if (!Number.isSafeInteger(rawVersion) || rawVersion < 1 || rawVersion > 2_147_483_647) {
      throw invalid('rowVersion es obligatorio y debe ser un entero positivo de 32 bits')
    }
    const hasState = Object.hasOwn(body, 'state')
    const hasPayload = Object.hasOwn(body, 'payload')
    if (!hasState && !hasPayload) throw invalid('el PATCH requiere state, payload o ambos')
    const nextState = hasState ? readState(body.state) : null
    const nextPayload = hasPayload ? optionalObject(body, 'payload') : null
    const id = readItemId(req.params.id)

    const item = await withTenant(pool, actor, async (client, tenantId) => {
      // La política de UPDATE es de dueño, así que un `FOR UPDATE` directo
      // ocultaría la fila de un `client_b2b` ajeno y devolvería 404 donde el
      // contrato pide 403. Primero se lee con la política de SELECT (tenant) y
      // se autoriza; el lock llega después, ya sobre una fila que el actor puede
      // escribir.
      const visible = await client.query(SELECT_ITEM_SQL, [tenantId, id])
      const seen = visible.rows[0] ?? null
      if (seen === null) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')
      assertWritable(actor, seen, tenantId)

      const current = await client.query(SELECT_ITEM_FOR_UPDATE_SQL, [tenantId, id])
      const row = current.rows[0] ?? null
      if (row === null) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')
      if (Number(row.row_version) !== rawVersion) {
        throw new BoardError('STALE_ROW', 409, 'el ítem cambió desde que se leyó', { rowVersion: Number(row.row_version) })
      }

      const state = nextState ?? row.state
      const payload = nextPayload ?? asJson(row.payload, {})
      const updated = await client.query(UPDATE_ITEM_SQL, [
        tenantId,
        id,
        state,
        JSON.stringify(payload),
        rawVersion,
      ])
      const next = updated.rows[0] ?? null
      if (next === null) throw new BoardError('STALE_ROW', 409, 'el ítem cambió desde que se leyó')

      const nextSeq = await client.query(NEXT_EVENT_SEQ_SQL, [tenantId, id])
      await client.query(INSERT_EVENT_SQL, [
        tenantId,
        id,
        Number(nextSeq.rows[0].next_seq),
        actor.email,
        'updated',
        row.state,
        next.state,
        JSON.stringify({ changed: [hasState ? 'state' : null, hasPayload ? 'payload' : null].filter(Boolean), rowVersion: Number(next.row_version) }),
      ])
      return next
    }, { dbRole })

    res.json({ item: itemJson(item) })
  }))

  router.get('/items/:id/events', route(async (req, res) => {
    const actor = await requireActor(req)
    const after = queryText(req, 'after')
    const afterSeq = after === null ? 0 : Number(after)
    if (after !== null && (!/^\d+$/.test(after) || !Number.isSafeInteger(afterSeq) || afterSeq > 2_147_483_647)) {
      throw invalid('after debe ser un entero no negativo de 32 bits')
    }
    const limit = queryLimit(req, 'limit', DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT)
    const id = readItemId(req.params.id)

    const events = await withTenant(pool, actor, async (client, tenantId) => {
      const item = await client.query(SELECT_ITEM_SQL, [tenantId, id])
      const row = item.rows[0] ?? null
      if (row === null) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')
      assertReadable(actor, row, tenantId)
      const result = await client.query(LIST_EVENTS_SQL, [tenantId, id, afterSeq, limit])
      return result.rows.map(eventJson)
    }, { dbRole })

    res.json({ events })
  }))

  router.post('/items/:id/events', route(async (req, res) => {
    const actor = await requireActor(req)
    const body = readBody(req)
    rejectServerOwnedFields(body)
    const command = requiredText(body, 'command', { max: MAX_TEXT })
    const payload = body.payload === undefined ? null : optionalObject(body, 'payload')
    const id = readItemId(req.params.id)

    const event = await withTenant(pool, actor, async (client, tenantId) => {
      const visible = await client.query(SELECT_ITEM_SQL, [tenantId, id])
      const seen = visible.rows[0] ?? null
      if (seen === null) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')
      assertWritable(actor, seen, tenantId)

      // `mesa_events.payload` es NOT NULL: un append sin payload guarda `{}`.
      const current = await client.query(SELECT_ITEM_FOR_UPDATE_SQL, [tenantId, id])
      const row = current.rows[0] ?? null
      if (row === null) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')

      const nextSeq = await client.query(NEXT_EVENT_SEQ_SQL, [tenantId, id])
      const inserted = await client.query(INSERT_EVENT_SQL, [
        tenantId,
        id,
        Number(nextSeq.rows[0].next_seq),
        actor.email,
        command,
        row.state,
        row.state,
        JSON.stringify(payload ?? {}),
      ])
      return inserted.rows[0]
    }, { dbRole })

    res.status(201).json({ event: eventJson(event) })
  }))

  router.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error)
      return
    }
    const mapped = mapError(error)
    if (mapped.status >= 500) {
      console.error(`[board-api] ${req.requestId ?? 'sin-request-id'}:`, error)
    }
    res.status(mapped.status).json({
      code: mapped.code,
      message: mapped.message,
      ...(mapped.details === undefined ? {} : { details: mapped.details }),
      request_id: req.requestId ?? crypto.randomUUID(),
    })
  })

  return router
}

/**
 * Monta la API bajo `/board`. `server.mjs` no llama a esto todavía; la
 * activación es una línea deliberada, no un efecto de importar el módulo.
 * @param {import('express').Application} app - the gateway express app.
 * @param {Parameters<typeof createBoardRouter>[0]} options - router options.
 * @returns {import('express').Router} the mounted router.
 */
export function installBoardApi(app, options) {
  if (!app || typeof app.use !== 'function') throw new Error('board-api: installBoardApi requiere una app express')
  const router = createBoardRouter(options)
  app.use('/board', router)
  return router
}

/**
 * Crea el pool de PostgreSQL desde `DATABASE_URL`. Falla al construir si la
 * variable no existe: una Mesa sin base no debe arrancar a medias.
 * @param {{ connectionString?: string, max?: number, statementTimeoutMs?: number }} [options] - overrides for tests or a deployment.
 * @returns {Promise<import('pg').Pool>} a pg Pool.
 */
export async function createBoardPool(options = {}) {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL
  if (typeof connectionString !== 'string' || connectionString.trim().length === 0) {
    throw new Error('board-api: DATABASE_URL es obligatoria')
  }
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'mesa-board-api',
  })
  // Un cliente inactivo que pierde la conexión emite `error` en el pool; sin
  // este listener, Node lo trata como no manejado y tumba el gateway.
  pool.on('error', error => {
    console.error('[board-api] cliente inactivo:', error instanceof Error ? error.message : String(error))
  })
  return pool
}
