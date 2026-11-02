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
// Las columnas extra (`title`, `evidence`, `run_id`, `idempotency_key`) son
// nullable a propósito: `scripts/migrate-board-postgres.mjs` inserta las
// columnas del board histórico y no las conoce, así que los defaults las
// completan sin romper la migración.

const TABLES_SQL = [
  `CREATE TABLE IF NOT EXISTS mesa_items (
     tenant_id text NOT NULL,
     id text NOT NULL,
     owner_id text NOT NULL,
     space_id text,
     business_key text NOT NULL DEFAULT '',
     state text NOT NULL DEFAULT 'PENDIENTE_CRITERIO',
     row_version integer NOT NULL DEFAULT 1,
     title text,
     evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
     payload jsonb NOT NULL DEFAULT '{}'::jsonb,
     run_id text,
     idempotency_key text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, id)
   )`,
  `CREATE TABLE IF NOT EXISTS mesa_events (
     tenant_id text NOT NULL,
     item_id text NOT NULL,
     seq integer NOT NULL,
     actor text NOT NULL,
     command text NOT NULL,
     from_state text,
     to_state text,
     payload jsonb,
     at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, item_id, seq),
     FOREIGN KEY (tenant_id, item_id) REFERENCES mesa_items (tenant_id, id) ON DELETE CASCADE
   )`,
  // Una base creada por una versión anterior (o por la migración) ya tiene la
  // tabla, y `CREATE TABLE IF NOT EXISTS` no añade columnas. Estas cuatro son
  // las que este módulo necesita además de las históricas.
  `ALTER TABLE mesa_items ADD COLUMN IF NOT EXISTS title text`,
  `ALTER TABLE mesa_items ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE mesa_items ADD COLUMN IF NOT EXISTS run_id text`,
  `ALTER TABLE mesa_items ADD COLUMN IF NOT EXISTS idempotency_key text`,
  `CREATE INDEX IF NOT EXISTS mesa_items_tenant_state
     ON mesa_items (tenant_id, state, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS mesa_items_tenant_owner
     ON mesa_items (tenant_id, lower(owner_id))`,
  `CREATE INDEX IF NOT EXISTS mesa_items_tenant_space
     ON mesa_items (tenant_id, space_id)
     WHERE space_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mesa_items_idempotency_key
     ON mesa_items (tenant_id, idempotency_key)
     WHERE idempotency_key IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mesa_items_live_business_key
     ON mesa_items (tenant_id, business_key)
     WHERE business_key <> ''
       AND state NOT IN ('APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO')`,
]

const RLS_SQL = [
  `ALTER TABLE mesa_items ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE mesa_items FORCE ROW LEVEL SECURITY`,
  `ALTER TABLE mesa_events ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE mesa_events FORCE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS mesa_items_tenant_isolation ON mesa_items`,
  `CREATE POLICY mesa_items_tenant_isolation ON mesa_items
     USING (tenant_id = current_setting('app.tenant_id', true))
     WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`,
  `DROP POLICY IF EXISTS mesa_events_tenant_isolation ON mesa_events`,
  `CREATE POLICY mesa_events_tenant_isolation ON mesa_events
     USING (tenant_id = current_setting('app.tenant_id', true))
     WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`,
]

/**
 * Sentencias del esquema, en orden. Se ejecutan una por una para que el mismo
 * arreglo sirva a `pg` y a `pg-mem`, que no acepta varias sentencias juntas.
 * @param {{ rls?: boolean }} [options] - `rls: false` omite las políticas (pg-mem no las implementa).
 * @returns {readonly string[]} DDL idempotente.
 */
export function mesaSchemaStatements(options = {}) {
  return options.rls === false ? [...TABLES_SQL] : [...TABLES_SQL, ...RLS_SQL]
}

/**
 * El esquema como un solo texto, para documentación o un `schema.sql` aplicado
 * por un operador.
 * @param {{ rls?: boolean }} [options] - `rls: false` omite las políticas.
 * @returns {string} DDL terminado en punto y coma.
 */
export function mesaSchemaSql(options = {}) {
  return `${mesaSchemaStatements(options).map(statement => `${statement};`).join('\n\n')}\n`
}

/**
 * Aplica el esquema sobre un pool. La primera ejecución crea; las siguientes no
 * cambian nada.
 * @param {{ query: (text: string) => Promise<unknown> }} pool - a `pg` Pool (or pg-mem adapter).
 * @param {{ rls?: boolean }} [options] - `rls: false` for engines without row security.
 * @returns {Promise<void>} resolves after the last statement.
 */
export async function applyMesaSchema(pool, options = {}) {
  for (const statement of mesaSchemaStatements(options)) await pool.query(statement)
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
 * @param {{ email: string, tenantId: string, role: string }} actor
 * @param {{ tenant_id: string, owner_id: string }} item
 * @returns {void}
 * @throws {BoardError} `NOT_FOUND` for another tenant; `NO_ACCESS` when a non-admin does not own the item.
 */
function assertReadable(actor, item) {
  if (item.tenant_id !== actor.tenantId) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')
  if (isAdmin(actor.role) || ownsItem(item.owner_id, actor.email)) return
  throw new BoardError('NO_ACCESS', 403, 'el ítem pertenece a otro usuario del tenant')
}

/**
 * @param {{ email: string, tenantId: string, role: string }} actor
 * @param {{ tenant_id: string, owner_id: string }} item
 * @returns {void}
 * @throws {BoardError} `NOT_FOUND` for another tenant; `NO_ACCESS` when a non-admin does not own the item.
 */
function assertWritable(actor, item) {
  if (item.tenant_id !== actor.tenantId) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')
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
    tenantId: row.tenant_id,
    ownerId: row.owner_id,
    spaceId: row.space_id ?? null,
    businessKey: row.business_key,
    state: row.state,
    rowVersion: row.row_version,
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
    seq: row.seq,
    actor: row.actor,
    command: row.command,
    fromState: row.from_state ?? null,
    toState: row.to_state ?? null,
    payload: asJson(row.payload, null),
    at: toIso(row.at),
  }
}

// ── SQL ────────────────────────────────────────────────────────────────────
//
// Todo valor viaja como parámetro. Los únicos textos fijos son nombres de
// columna y cláusulas que no dependen del request.

const ITEM_COLUMNS = `id, tenant_id, owner_id, space_id, business_key, state,
  row_version, title, evidence, payload, run_id, created_at, updated_at`

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
    AND business_key <> ''
    AND NOT (state = ANY($3::text[]))
  LIMIT 1`

const INSERT_ITEM_SQL = `INSERT INTO mesa_items (
    tenant_id, id, owner_id, space_id, business_key, state, row_version,
    title, evidence, payload, run_id, idempotency_key
  ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8::jsonb, $9::jsonb, $10, $11)
  RETURNING ${ITEM_COLUMNS}`

const UPDATE_ITEM_SQL = `UPDATE mesa_items
  SET state = $3,
      payload = $4::jsonb,
      row_version = row_version + 1,
      updated_at = now()
  WHERE tenant_id = $1 AND id = $2 AND row_version = $5
  RETURNING ${ITEM_COLUMNS}`

const LIST_ITEMS_SQL = `SELECT ${ITEM_COLUMNS}
  FROM mesa_items
  WHERE tenant_id = $1
    AND ($2::text IS NULL OR state = $2)
    AND ($3::text IS NULL OR space_id = $3)
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

/**
 * Ejecuta un bloque con `app.tenant_id` fijado para RLS. El setting es local a
 * la transacción (`set_config(..., true)`), así que la conexión vuelve al pool
 * sin tenant pegado.
 * @template T
 * @param {{ connect: () => Promise<{ query: Function, release: Function }> }} pool - pg-compatible pool.
 * @param {string} tenantId - tenant resolved from the session.
 * @param {(client: { query: Function }) => Promise<T>} work - statements to run inside the transaction.
 * @returns {Promise<T>} the block's result after COMMIT.
 */
async function withTenant(pool, tenantId, work) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
    const result = await work(client)
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

    const result = await withTenant(pool, actor.tenantId, client => client.query(LIST_ITEMS_SQL, [
      actor.tenantId,
      state,
      spaceId,
      ownerFilter,
      limit,
    ]))
    res.json({ items: result.rows.map(itemJson) })
  }))

  router.get('/items/:id', route(async (req, res) => {
    const actor = await requireActor(req)
    const item = await withTenant(pool, actor.tenantId, async client => {
      const result = await client.query(SELECT_ITEM_SQL, [actor.tenantId, req.params.id])
      return result.rows[0] ?? null
    })
    if (item === null) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')
    assertReadable(actor, item)
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

    const outcome = await withTenant(pool, actor.tenantId, async client => {
      const prior = await client.query(SELECT_BY_IDEMPOTENCY_SQL, [actor.tenantId, idempotencyKey])
      const existing = prior.rows[0] ?? null
      if (existing !== null) {
        if (ownsItem(existing.owner_id, actor.email) && existing.business_key === businessKey) {
          return { item: existing, replay: true }
        }
        throw duplicate('la clave de idempotencia ya pertenece a otro ítem')
      }

      const clash = await client.query(SELECT_LIVE_BUSINESS_KEY_SQL, [actor.tenantId, businessKey, TERMINAL_STATES])
      if (clash.rows[0] !== undefined) throw duplicate('la clave de negocio ya pertenece a un ítem vivo')

      const id = generateId()
      let inserted
      try {
        inserted = await client.query(INSERT_ITEM_SQL, [
          actor.tenantId,
          id,
          actor.email,
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
        actor.tenantId,
        id,
        1,
        actor.email,
        'created',
        null,
        state,
        JSON.stringify({ businessKey, runId, spaceId }),
      ])
      return { item: inserted.rows[0], replay: false }
    })

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

    const item = await withTenant(pool, actor.tenantId, async client => {
      const current = await client.query(SELECT_ITEM_FOR_UPDATE_SQL, [actor.tenantId, req.params.id])
      const row = current.rows[0] ?? null
      if (row === null) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')
      assertWritable(actor, row)
      if (row.row_version !== rawVersion) {
        throw new BoardError('STALE_ROW', 409, 'el ítem cambió desde que se leyó', { rowVersion: row.row_version })
      }

      const state = nextState ?? row.state
      const payload = nextPayload ?? asJson(row.payload, {})
      const updated = await client.query(UPDATE_ITEM_SQL, [
        actor.tenantId,
        req.params.id,
        state,
        JSON.stringify(payload),
        rawVersion,
      ])
      const next = updated.rows[0] ?? null
      if (next === null) throw new BoardError('STALE_ROW', 409, 'el ítem cambió desde que se leyó')

      const nextSeq = await client.query(NEXT_EVENT_SEQ_SQL, [actor.tenantId, req.params.id])
      await client.query(INSERT_EVENT_SQL, [
        actor.tenantId,
        req.params.id,
        Number(nextSeq.rows[0].next_seq),
        actor.email,
        'updated',
        row.state,
        next.state,
        JSON.stringify({ changed: [hasState ? 'state' : null, hasPayload ? 'payload' : null].filter(Boolean), rowVersion: next.row_version }),
      ])
      return next
    })

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

    const events = await withTenant(pool, actor.tenantId, async client => {
      const item = await client.query(SELECT_ITEM_SQL, [actor.tenantId, req.params.id])
      const row = item.rows[0] ?? null
      if (row === null) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')
      assertReadable(actor, row)
      const result = await client.query(LIST_EVENTS_SQL, [actor.tenantId, req.params.id, afterSeq, limit])
      return result.rows.map(eventJson)
    })

    res.json({ events })
  }))

  router.post('/items/:id/events', route(async (req, res) => {
    const actor = await requireActor(req)
    const body = readBody(req)
    rejectServerOwnedFields(body)
    const command = requiredText(body, 'command', { max: MAX_TEXT })
    const payload = body.payload === undefined ? null : optionalObject(body, 'payload')

    const event = await withTenant(pool, actor.tenantId, async client => {
      const current = await client.query(SELECT_ITEM_FOR_UPDATE_SQL, [actor.tenantId, req.params.id])
      const row = current.rows[0] ?? null
      if (row === null) throw new BoardError('NOT_FOUND', 404, 'el ítem no existe en este tenant')
      assertWritable(actor, row)

      const nextSeq = await client.query(NEXT_EVENT_SEQ_SQL, [actor.tenantId, req.params.id])
      const inserted = await client.query(INSERT_EVENT_SQL, [
        actor.tenantId,
        req.params.id,
        Number(nextSeq.rows[0].next_seq),
        actor.email,
        command,
        row.state,
        row.state,
        payload === null ? null : JSON.stringify(payload),
      ])
      return inserted.rows[0]
    })

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
