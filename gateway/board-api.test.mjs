/**
 * Promesas de la API de la Mesa que estas pruebas fijan:
 *
 * 1. Dos usuarios del mismo tenant leen y editan el mismo ítem.
 * 2. Otro tenant no lo ve: la respuesta es `NOT_FOUND`, no un 403 que confirme
 *    que el ítem existe.
 * 3. Un `client_b2b` no lee ni escribe lo ajeno dentro de su propio tenant.
 * 4. La identidad sale de la sesión: un `tenantId` en el cuerpo se rechaza.
 *
 * Se ejecuta solo: `node --test gateway/board-api.test.mjs`.
 *
 * Por defecto usa PGlite: PostgreSQL real compilado a WASM, con roles, RLS y
 * `SET LOCAL ROLE`. Aplica el mismo `schema.sql` canónico que el operador, dos
 * veces, así que la suite prueba también la idempotencia y las políticas. Para
 * una base PostgreSQL real se define `BOARD_TEST_DATABASE_URL`; esa base la
 * prepara el rol de migración (el login de runtime no ejecuta DDL). Ver
 * `gateway/BOARD-API.md`.
 */

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { after, before, describe, it } from 'node:test'

import { PGlite } from '@electric-sql/pglite'
import express from 'express'

import {
  applyMesaSchema,
  createBoardRouter,
  mesaSchemaFile,
  mesaSchemaSql,
  mesaSpaceUuid,
  mesaTenantUuid,
  normalizeActor,
} from './board-api.mjs'

const DATABASE_URL = process.env.BOARD_TEST_DATABASE_URL
let pool
let closePool
let server
let baseUrl
const runId = crypto.randomUUID().slice(0, 8)
let counter = 0

/**
 * Pool mínimo sobre una única conexión PGlite. La API pide `connect()`,
 * `BEGIN`/`COMMIT` y `SET LOCAL`: PGlite los soporta en su conexión única.
 * @param {PGlite} database - in-process PostgreSQL.
 * @returns {object} a pg-Pool-compatible adapter.
 */
function pglitePool(database) {
  const client = {
    query: (sql, params) => database.query(sql, params),
    release() {},
  }
  return {
    exec: sql => database.exec(sql),
    query: (sql, params) => database.query(sql, params),
    connect: async () => client,
  }
}

/** Tenant único por prueba: la base real conserva filas entre ejecuciones. */
function tenant(label) {
  return `t-${runId}-${label}`
}

/** Actor de prueba; el rol se normaliza a minúsculas en el servidor. */
function actor(tenantId, email, role = 'admin') {
  return { tenantId, email, role }
}

/** Una petición HTTP con la identidad en headers, nunca en el cuerpo. */
async function request(method, path, options = {}) {
  const headers = { ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) }
  if (options.actor !== undefined) {
    headers['x-test-email'] = options.actor.email
    headers['x-test-tenant'] = options.actor.tenantId
    headers['x-test-role'] = options.actor.role
    if (Array.isArray(options.actor.tenantIds)) headers['x-test-tenants'] = options.actor.tenantIds.join(',')
  }
  if (options.tenant !== undefined) headers['x-board-tenant'] = options.tenant
  Object.assign(headers, options.headers ?? {})
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  return {
    status: response.status,
    headers: response.headers,
    body: text.length === 0 ? null : JSON.parse(text),
  }
}

/** Crea un ítem válido y devuelve el recurso. */
async function createItem(who, overrides = {}) {
  counter += 1
  const key = `k-${runId}-${counter}`
  const response = await request('POST', '/items', {
    actor: who,
    body: {
      runId: `run-${key}`,
      idempotencyKey: `idem-${key}`,
      businessKey: `bk-${key}`,
      title: 'Preparado de prueba',
      evidence: ['oc:505288'],
      ...overrides,
    },
  })
  assert.equal(response.status, 201, JSON.stringify(response.body))
  return response.body.item
}

before(async () => {
  if (DATABASE_URL === undefined) {
    const db = new PGlite()
    pool = pglitePool(db)
    closePool = () => db.close()
    // El bootstrap canónico, dos veces: la segunda ejecución prueba idempotencia.
    await applyMesaSchema(pool)
    await applyMesaSchema(pool)
  } else {
    const { default: pg } = await import('pg')
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
    closePool = () => pool.end()
    // Una base real la prepara el rol de migración (docker/00-init.sql aplica
    // el bootstrap dos veces); el login de runtime no es dueño de las tablas y
    // no debe ejecutar DDL.
    const present = await pool.query("SELECT to_regclass('public.mesa_items')::text AS table")
    if (present.rows[0]?.table === null) {
      throw new Error('schema.sql no está aplicado en BOARD_TEST_DATABASE_URL')
    }
  }

  const app = express()
  app.use('/board', createBoardRouter({
    pool,
    // En producción el gateway resuelve esto de su cookie firmada y del rol
    // guardado. Aquí los headers hacen visible que la API no lee el cuerpo.
    resolveActor: req => ({
      email: req.get('x-test-email'),
      tenantId: req.get('x-test-tenant'),
      tenantIds: (req.get('x-test-tenants') ?? '').split(',').filter(entry => entry.length > 0),
      role: req.get('x-test-role'),
    }),
  }))
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}/board`
})

after(async () => {
  await new Promise(resolve => server.close(resolve))
  await closePool()
})

describe('identidad y tenant', () => {
  it('dos usuarios del mismo tenant leen y editan el mismo ítem', async () => {
    const acme = tenant('acme')
    const alice = actor(acme, 'alice@acme.test')
    const bob = actor(acme, 'bob@acme.test')
    const item = await createItem(alice)

    const list = await request('GET', '/items', { actor: bob })
    assert.equal(list.status, 200)
    assert.deepEqual(list.body.items.map(entry => entry.id), [item.id])

    const read = await request('GET', `/items/${item.id}`, { actor: bob })
    assert.equal(read.status, 200)
    assert.equal(read.body.item.ownerId, 'alice@acme.test')

    const edited = await request('PATCH', `/items/${item.id}`, {
      actor: bob,
      body: { state: 'APROBADO', payload: { note: 'visto por bob' }, rowVersion: 1 },
    })
    assert.equal(edited.status, 200)
    assert.equal(edited.body.item.state, 'APROBADO')
    assert.equal(edited.body.item.rowVersion, 2)
    assert.deepEqual(edited.body.item.payload, { note: 'visto por bob' })

    const events = await request('GET', `/items/${item.id}/events`, { actor: bob })
    assert.equal(events.status, 200)
    assert.deepEqual(events.body.events.map(event => event.command), ['created', 'updated'])
    assert.deepEqual(events.body.events.map(event => event.actor), ['alice@acme.test', 'bob@acme.test'])
  })

  it('otro tenant no ve el ítem y recibe NOT_FOUND, no NO_ACCESS', async () => {
    const acme = tenant('acme-2')
    const globex = tenant('globex-2')
    const item = await createItem(actor(acme, 'alice@acme.test'))
    const intruder = actor(globex, 'carol@globex.test')

    const read = await request('GET', `/items/${item.id}`, { actor: intruder })
    assert.equal(read.status, 404)
    assert.equal(read.body.code, 'NOT_FOUND')

    const edited = await request('PATCH', `/items/${item.id}`, {
      actor: intruder,
      body: { state: 'DESCARTADO', rowVersion: 1 },
    })
    assert.equal(edited.status, 404)
    assert.equal(edited.body.code, 'NOT_FOUND')

    const events = await request('GET', `/items/${item.id}/events`, { actor: intruder })
    assert.equal(events.status, 404)
    assert.equal(events.body.code, 'NOT_FOUND')

    const list = await request('GET', '/items', { actor: intruder })
    assert.equal(list.status, 200)
    assert.deepEqual(list.body.items, [])

    const original = await request('GET', `/items/${item.id}`, { actor: actor(acme, 'alice@acme.test') })
    assert.equal(original.body.item.state, 'PENDIENTE_CRITERIO')
    assert.equal(original.body.item.rowVersion, 1)
  })

  it('un client_b2b no lee ni escribe el ítem de otro usuario del mismo tenant', async () => {
    const acme = tenant('acme-3')
    const owner = actor(acme, 'duena@acme.test', 'client_b2b')
    const intruder = actor(acme, 'intruso@acme.test', 'client_b2b')
    const item = await createItem(owner)

    const read = await request('GET', `/items/${item.id}`, { actor: intruder })
    assert.equal(read.status, 403)
    assert.equal(read.body.code, 'NO_ACCESS')

    const edited = await request('PATCH', `/items/${item.id}`, {
      actor: intruder,
      body: { payload: { robado: true }, rowVersion: 1 },
    })
    assert.equal(edited.status, 403)
    assert.equal(edited.body.code, 'NO_ACCESS')

    const events = await request('GET', `/items/${item.id}/events`, { actor: intruder })
    assert.equal(events.status, 403)

    const list = await request('GET', '/items', { actor: intruder })
    assert.equal(list.status, 200)
    assert.deepEqual(list.body.items, [])

    const ownEdit = await request('PATCH', `/items/${item.id}`, {
      actor: owner,
      body: { payload: { propio: true }, rowVersion: 1 },
    })
    assert.equal(ownEdit.status, 200)
    assert.deepEqual(ownEdit.body.item.payload, { propio: true })
  })

  it('un cuerpo sin sesión responde UNAUTHENTICATED y conserva el request id', async () => {
    const response = await request('GET', '/items', { headers: { 'x-request-id': 'req-board-1' } })
    assert.equal(response.status, 401)
    assert.equal(response.body.code, 'UNAUTHENTICATED')
    assert.equal(response.body.request_id, 'req-board-1')
    assert.equal(response.headers.get('x-request-id'), 'req-board-1')
  })

  it('el tenantId y el ownerId del cuerpo se rechazan en vez de ignorarse', async () => {
    const acme = tenant('acme-4')
    const who = actor(acme, 'alice@acme.test')
    const base = {
      runId: 'run-1',
      idempotencyKey: 'idem-1',
      businessKey: 'bk-1',
      title: 'x',
      evidence: ['e'],
    }

    const withTenant = await request('POST', '/items', {
      actor: who,
      body: { ...base, tenantId: tenant('ajeno') },
    })
    assert.equal(withTenant.status, 400)
    assert.equal(withTenant.body.code, 'INVALID_INPUT')

    const withOwner = await request('POST', '/items', {
      actor: who,
      body: { ...base, ownerId: 'otro@acme.test' },
    })
    assert.equal(withOwner.status, 400)
    assert.equal(withOwner.body.code, 'INVALID_INPUT')
  })
})

describe('creación e idempotencia', () => {
  it('repite la misma clave de idempotencia sin duplicar y devuelve el mismo ítem', async () => {
    const acme = tenant('idem')
    const who = actor(acme, 'alice@acme.test')
    const body = {
      runId: 'run-idem',
      idempotencyKey: 'idem-idem',
      businessKey: 'bk-idem',
      title: 'Preparado',
      evidence: ['oc:1'],
    }

    const first = await request('POST', '/items', { actor: who, body })
    const second = await request('POST', '/items', { actor: who, body })
    assert.equal(first.status, 201)
    assert.equal(second.status, 200)
    assert.equal(second.headers.get('idempotent-replay'), 'true')
    assert.equal(second.body.item.id, first.body.item.id)

    const list = await request('GET', '/items', { actor: who })
    assert.equal(list.body.items.length, 1)
  })

  it('la misma clave de idempotencia con otra clave de negocio es DUPLICATE', async () => {
    const acme = tenant('idem-2')
    const who = actor(acme, 'alice@acme.test')
    const body = {
      runId: 'run-a',
      idempotencyKey: 'idem-a',
      businessKey: 'bk-a',
      title: 'Preparado',
      evidence: ['oc:1'],
    }
    await request('POST', '/items', { actor: who, body })
    const clash = await request('POST', '/items', {
      actor: who,
      body: { ...body, businessKey: 'bk-otra' },
    })
    assert.equal(clash.status, 409)
    assert.equal(clash.body.code, 'DUPLICATE')
  })

  it('una clave de negocio viva es DUPLICATE y vuelve a estar libre al cerrar el ítem', async () => {
    const acme = tenant('idem-3')
    const who = actor(acme, 'alice@acme.test')
    const item = await createItem(who, { businessKey: 'bk-compartida' })

    const clash = await request('POST', '/items', {
      actor: who,
      body: {
        runId: 'run-b',
        idempotencyKey: 'idem-b',
        businessKey: 'bk-compartida',
        title: 'Otro',
        evidence: ['oc:2'],
      },
    })
    assert.equal(clash.status, 409)
    assert.equal(clash.body.code, 'DUPLICATE')

    const closed = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: { state: 'APROBADO', rowVersion: 1 },
    })
    assert.equal(closed.status, 200)

    const fresh = await request('POST', '/items', {
      actor: who,
      body: {
        runId: 'run-c',
        idempotencyKey: 'idem-c',
        businessKey: 'bk-compartida',
        title: 'Rehecho',
        evidence: ['oc:3'],
      },
    })
    assert.equal(fresh.status, 201)
  })

  it('acepta el id que el productor ya asignó y rechaza uno inválido', async () => {
    const acme = tenant('id-propio')
    const who = actor(acme, 'alice@acme.test')
    const id = crypto.randomUUID()
    const base = {
      runId: 'run-id',
      idempotencyKey: 'idem-id',
      businessKey: 'bk-id',
      title: 'Con id propio',
      evidence: ['oc:9'],
      id,
    }

    const created = await request('POST', '/items', { actor: who, body: base })
    assert.equal(created.status, 201)
    assert.equal(created.body.item.id, id)

    const invalid = await request('POST', '/items', {
      actor: who,
      body: { ...base, id: 'no-es-uuid', idempotencyKey: 'idem-id-2', businessKey: 'bk-id-2' },
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.code, 'INVALID_INPUT')
  })

  it('exige runId, idempotencyKey y evidencia real', async () => {
    const acme = tenant('requisitos')
    const who = actor(acme, 'alice@acme.test')
    const base = {
      runId: 'run-1',
      idempotencyKey: 'idem-1',
      businessKey: 'bk-1',
      title: 'x',
      evidence: ['e'],
    }

    const noRun = await request('POST', '/items', {
      actor: who,
      body: { ...base, runId: '   ' },
    })
    assert.equal(noRun.status, 422)
    assert.equal(noRun.body.code, 'NO_RUN')

    const noIdem = await request('POST', '/items', {
      actor: who,
      body: { ...base, idempotencyKey: '' },
    })
    assert.equal(noIdem.status, 422)
    assert.equal(noIdem.body.code, 'NO_RUN')

    const noEvidence = await request('POST', '/items', {
      actor: who,
      body: { ...base, evidence: [] },
    })
    assert.equal(noEvidence.status, 422)
    assert.equal(noEvidence.body.code, 'NO_EVIDENCE')

    const noTitle = await request('POST', '/items', {
      actor: who,
      body: { ...base, title: '' },
    })
    assert.equal(noTitle.status, 400)
    assert.equal(noTitle.body.code, 'INVALID_INPUT')
  })
})

describe('concurrencia y auditoría', () => {
  it('una versión vieja responde STALE_ROW y no pisa la escritura ganadora', async () => {
    const acme = tenant('stale')
    const who = actor(acme, 'alice@acme.test')
    const item = await createItem(who)

    const first = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: { payload: { version: 'primera' }, rowVersion: 1 },
    })
    assert.equal(first.status, 200)

    const stale = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: { payload: { version: 'segunda' }, rowVersion: 1 },
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.code, 'STALE_ROW')
    assert.equal(stale.body.details.rowVersion, 2)

    const current = await request('GET', `/items/${item.id}`, { actor: who })
    assert.deepEqual(current.body.item.payload, { version: 'primera' })
    assert.equal(current.body.item.rowVersion, 2)

    const next = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: { payload: { version: 'tercera' }, rowVersion: 2 },
    })
    assert.equal(next.status, 200)
  })

  it('append de auditoría no cambia la versión y respeta after y limit', async () => {
    const acme = tenant('eventos')
    const who = actor(acme, 'alice@acme.test')
    const item = await createItem(who)

    const appended = await request('POST', `/items/${item.id}/events`, {
      actor: who,
      body: { command: 'note', payload: { text: 'revisar con Álvaro' } },
    })
    assert.equal(appended.status, 201)
    assert.equal(appended.body.event.seq, 2)
    assert.equal(appended.body.event.command, 'note')
    assert.deepEqual(appended.body.event.payload, { text: 'revisar con Álvaro' })

    const tail = await request('GET', `/items/${item.id}/events?after=1`, { actor: who })
    assert.equal(tail.status, 200)
    assert.deepEqual(tail.body.events.map(event => event.seq), [2])

    const limited = await request('GET', `/items/${item.id}/events?limit=1`, { actor: who })
    assert.deepEqual(limited.body.events.map(event => event.seq), [1])

    const current = await request('GET', `/items/${item.id}`, { actor: who })
    assert.equal(current.body.item.rowVersion, 1)
  })
})

describe('transiciones de la Mesa', () => {
  it('aprobar exige severidad confirmada y el evento guarda el comando', async () => {
    const acme = tenant('trans-approve')
    const who = actor(acme, 'alice@acme.test')
    const item = await createItem(who)

    const bare = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: { state: 'APROBADO', rowVersion: 1, command: 'approve' },
    })
    assert.equal(bare.status, 422)
    assert.equal(bare.body.code, 'SEVERITY_REQUIRED')

    const approved = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: { state: 'APROBADO', rowVersion: 1, command: 'approve', payload: { severity: 'ALTA' } },
    })
    assert.equal(approved.status, 200)
    assert.equal(approved.body.item.state, 'APROBADO')
    assert.equal(approved.body.item.payload.severity, 'ALTA')

    const events = await request('GET', `/items/${item.id}/events`, { actor: who })
    assert.deepEqual(events.body.events.map(event => event.command), ['created', 'approve'])
  })

  it('descartar exige una razón de la lista cerrada', async () => {
    const acme = tenant('trans-discard')
    const who = actor(acme, 'alice@acme.test')
    const item = await createItem(who)

    const noReason = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: { state: 'DESCARTADO', rowVersion: 1, command: 'discard', payload: {} },
    })
    assert.equal(noReason.status, 422)
    assert.equal(noReason.body.code, 'REASON_REQUIRED')

    const wrongReason = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: { state: 'DESCARTADO', rowVersion: 1, command: 'discard', payload: { discardReason: 'PORQUE_SI' } },
    })
    assert.equal(wrongReason.status, 422)
    assert.equal(wrongReason.body.code, 'REASON_REQUIRED')

    const discarded = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: {
        state: 'DESCARTADO',
        rowVersion: 1,
        command: 'discard',
        payload: { discardReason: 'DUPLICADO', discardNote: 'ya existía' },
      },
    })
    assert.equal(discarded.status, 200)
    assert.equal(discarded.body.item.state, 'DESCARTADO')
    assert.equal(discarded.body.item.payload.discardReason, 'DUPLICADO')
  })

  it('iterar exige un espacio asignado', async () => {
    const acme = tenant('trans-iterate')
    const who = actor(acme, 'alice@acme.test')
    const item = await createItem(who)

    const noSpace = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: { state: 'ITERANDO', rowVersion: 1, command: 'iterate', payload: {} },
    })
    assert.equal(noSpace.status, 422)
    assert.equal(noSpace.body.code, 'WORKSPACE_REQUIRED')

    const iterating = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: {
        state: 'ITERANDO',
        rowVersion: 1,
        command: 'iterate',
        payload: { spaceId: 'sp-loop', iterationId: 'it-1', iterationBaseVersion: 1 },
      },
    })
    assert.equal(iterating.status, 200)
    assert.equal(iterating.body.item.state, 'ITERANDO')
    assert.equal(iterating.body.item.payload.spaceId, 'sp-loop')

    const done = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: { state: 'APROBADO', rowVersion: 2, command: 'approve', payload: { spaceId: 'sp-loop', severity: 'MEDIA' } },
    })
    assert.equal(done.status, 200)
  })

  it('un candidato pendiente impide cerrar el ítem', async () => {
    const acme = tenant('trans-candidate')
    const who = actor(acme, 'alice@acme.test')
    const candidate = { id: 'cand-1', hash: 'hash-1', summary: 'versión nueva' }
    const item = await createItem(who, { payload: { pendingCandidate: candidate } })

    const blocked = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: {
        state: 'DESCARTADO',
        rowVersion: 1,
        command: 'discard',
        payload: { pendingCandidate: candidate, discardReason: 'DUPLICADO' },
      },
    })
    assert.equal(blocked.status, 409)
    assert.equal(blocked.body.code, 'CANDIDATE_PENDING')

    const resolved = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: {
        state: 'DESCARTADO',
        rowVersion: 1,
        command: 'discard',
        payload: { pendingCandidate: null, discardReason: 'DUPLICADO' },
      },
    })
    assert.equal(resolved.status, 200)
    assert.equal(resolved.body.item.state, 'DESCARTADO')
  })

  it('el espacio del comando se persiste en la columna y mueve el filtro', async () => {
    const acme = tenant('trans-space')
    const who = actor(acme, 'alice@acme.test')
    const item = await createItem(who)

    const moved = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: {
        rowVersion: 1,
        spaceId: 'sp-nuevo',
        command: 'assign_workspace',
        payload: { ...item.payload, spaceId: 'sp-nuevo' },
      },
    })
    assert.equal(moved.status, 200)
    assert.equal(moved.body.item.spaceId, 'sp-nuevo')

    const bySpace = await request('GET', '/items?spaceId=sp-nuevo', { actor: who })
    assert.deepEqual(bySpace.body.items.map(entry => entry.id), [item.id])

    const cleared = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: { rowVersion: 2, spaceId: null, payload: { ...item.payload, spaceId: null } },
    })
    assert.equal(cleared.status, 200)
    assert.equal(cleared.body.item.spaceId, null)
  })

  it('descartar con OTRA exige nota', async () => {
    const acme = tenant('trans-otra')
    const who = actor(acme, 'alice@acme.test')
    const item = await createItem(who)

    const withoutNote = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: {
        state: 'DESCARTADO',
        rowVersion: 1,
        command: 'discard',
        payload: { discardReason: 'OTRA' },
      },
    })
    assert.equal(withoutNote.status, 422)
    assert.equal(withoutNote.body.code, 'REASON_REQUIRED')

    const withNote = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: {
        state: 'DESCARTADO',
        rowVersion: 1,
        command: 'discard',
        payload: { discardReason: 'OTRA', discardNote: 'lo pidió el cliente' },
      },
    })
    assert.equal(withNote.status, 200)
    assert.equal(withNote.body.item.payload.discardNote, 'lo pidió el cliente')
  })

  it('un estado terminal rechaza una transición con comando y no toca la fila', async () => {
    const acme = tenant('trans-terminal')
    const who = actor(acme, 'alice@acme.test')
    const item = await createItem(who)

    const approved = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: { state: 'APROBADO', rowVersion: 1, command: 'approve', payload: { severity: 'BAJA' } },
    })
    assert.equal(approved.status, 200)

    const reopened = await request('PATCH', `/items/${item.id}`, {
      actor: who,
      body: {
        state: 'DESCARTADO',
        rowVersion: 2,
        command: 'discard',
        payload: { discardReason: 'DUPLICADO' },
      },
    })
    assert.equal(reopened.status, 409)
    assert.equal(reopened.body.code, 'TERMINAL_STATE')

    const current = await request('GET', `/items/${item.id}`, { actor: who })
    assert.equal(current.body.item.state, 'APROBADO')
    assert.equal(current.body.item.rowVersion, 2)
  })
})

describe('entidades del actor', () => {
  it('un admin selecciona otra de sus entidades con x-board-tenant', async () => {
    const alpha = tenant('ent-alpha')
    const beta = tenant('ent-beta')
    const admin = {
      tenantId: alpha,
      email: 'admin@mwt.test',
      role: 'admin',
      tenantIds: [alpha, beta],
    }
    const alphaItem = await createItem(actor(alpha, 'a@alpha.test'))
    const betaItem = await createItem(actor(beta, 'b@beta.test'))

    const inAlpha = await request('GET', '/items', { actor: admin })
    assert.deepEqual(inAlpha.body.items.map(entry => entry.id), [alphaItem.id])

    const inBeta = await request('GET', '/items', { actor: admin, tenant: beta })
    assert.deepEqual(inBeta.body.items.map(entry => entry.id), [betaItem.id])

    const written = await request('PATCH', `/items/${betaItem.id}`, {
      actor: admin,
      tenant: beta,
      body: { payload: { revisado: true }, rowVersion: 1 },
    })
    assert.equal(written.status, 200)
    assert.deepEqual(written.body.item.payload, { revisado: true })

    // Sin la cabecera, la entidad por defecto no ve la fila de la otra.
    const hidden = await request('GET', `/items/${betaItem.id}`, { actor: admin })
    assert.equal(hidden.status, 404)
  })

  it('un client_b2b no puede seleccionar otra entidad ni una que no le pertenece', async () => {
    const alpha = tenant('ent-gamma')
    const beta = tenant('ent-delta')
    const client = {
      tenantId: alpha,
      email: 'cliente@alpha.test',
      role: 'client_b2b',
      tenantIds: [alpha, beta],
    }

    const other = await request('GET', '/items', { actor: client, tenant: beta })
    assert.equal(other.status, 403)
    assert.equal(other.body.code, 'NO_ACCESS')

    const admin = { ...client, role: 'ceo', tenantIds: [alpha] }
    const unknown = await request('GET', '/items', { actor: admin, tenant: beta })
    assert.equal(unknown.status, 403)
    assert.equal(unknown.body.code, 'NO_ACCESS')
  })
})

describe('listas y filtros', () => {
  it('filtra por state y spaceId sin concatenar SQL', async () => {
    const acme = tenant('filtros')
    const who = actor(acme, 'alice@acme.test')
    await createItem(who, { spaceId: 'sp-uno' })
    const approved = await createItem(who, { spaceId: 'sp-dos' })
    await request('PATCH', `/items/${approved.id}`, {
      actor: who,
      body: { state: 'APROBADO', rowVersion: 1 },
    })

    const byState = await request('GET', '/items?state=APROBADO', { actor: who })
    assert.deepEqual(byState.body.items.map(item => item.id), [approved.id])

    const bySpace = await request('GET', '/items?spaceId=sp-uno', { actor: who })
    assert.equal(bySpace.body.items.length, 1)
    assert.equal(bySpace.body.items[0].spaceId, 'sp-uno')

    const injection = await request('GET', "/items?spaceId=sp-uno'%20OR%20'1'='1", { actor: who })
    assert.equal(injection.status, 200)
    assert.deepEqual(injection.body.items, [])

    const badState = await request('GET', '/items?state=NO_EXISTE', { actor: who })
    assert.equal(badState.status, 400)
    assert.equal(badState.body.code, 'INVALID_INPUT')
  })

  it('pagina con offset sobre un orden estable', async () => {
    const acme = tenant('pagina')
    const who = actor(acme, 'alice@acme.test')
    const first = await createItem(who)
    const second = await createItem(who)
    const third = await createItem(who)

    const page1 = await request('GET', '/items?limit=2&offset=0', { actor: who })
    const page2 = await request('GET', '/items?limit=2&offset=2', { actor: who })
    assert.equal(page1.body.items.length, 2)
    assert.equal(page2.body.items.length, 1)
    const seen = [...page1.body.items, ...page2.body.items].map(entry => entry.id)
    assert.equal(new Set(seen).size, 3)
    assert.deepEqual(new Set(seen), new Set([first.id, second.id, third.id]))

    const bad = await request('GET', '/items?offset=-1', { actor: who })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.code, 'INVALID_INPUT')
  })

  it('el límite se acota y un valor inválido se rechaza', async () => {
    const acme = tenant('limite')
    const who = actor(acme, 'alice@acme.test')
    await createItem(who)
    await createItem(who)

    const one = await request('GET', '/items?limit=1', { actor: who })
    assert.equal(one.body.items.length, 1)

    const bad = await request('GET', '/items?limit=abc', { actor: who })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.code, 'INVALID_INPUT')
  })
})

describe('contrato de construcción', () => {
  it('exige pool y resolveActor en vez de fallar en la primera request', () => {
    assert.throws(() => createBoardRouter({ pool }), /resolveActor/)
    assert.throws(() => createBoardRouter({ resolveActor: () => null }), /pool/)
    assert.throws(
      () => createBoardRouter({ pool, resolveActor: () => null, dbRole: 'mesa_app; DROP TABLE x' }),
      /dbRole/u,
    )
  })

  it('un id que no es uuid responde NOT_FOUND, no un 500', async () => {
    const who = actor(tenant('id-invalido'), 'alice@acme.test')
    const read = await request('GET', '/items/no-es-uuid', { actor: who })
    assert.equal(read.status, 404)
    assert.equal(read.body.code, 'NOT_FOUND')

    const events = await request('GET', '/items/no-es-uuid/events', { actor: who })
    assert.equal(events.status, 404)
    assert.equal(events.body.code, 'NOT_FOUND')
  })
})

describe('esquema único', () => {
  it('la API lee el schema.sql canónico y no guarda DDL propio', () => {
    const file = mesaSchemaFile()
    assert.match(file, /packages[\\/]faberloom[\\/]board[\\/]postgres[\\/]schema\.sql$/u)
    const sql = mesaSchemaSql()
    assert.equal(sql, readFileSync(file, 'utf8'))
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.mesa_items/u)
    assert.doesNotMatch(sql, /tenant_id text/u)
    assert.match(sql, /mesa_items_tenant_idempotency_key_uniq/u)
  })

  it('proyecta claves no uuid a un uuid estable y respeta un uuid', () => {
    const derived = mesaTenantUuid('acme')
    assert.match(derived, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    assert.equal(mesaTenantUuid('acme'), derived)
    assert.notEqual(mesaTenantUuid('globex'), derived)
    assert.equal(
      mesaTenantUuid('11111111-1111-4111-8111-111111111111'),
      '11111111-1111-4111-8111-111111111111',
    )
    assert.match(mesaSpaceUuid('sp-uno'), /^[0-9a-f-]{36}$/u)
    assert.notEqual(mesaSpaceUuid('sp-uno'), mesaTenantUuid('sp-uno'))
  })
})

describe('RLS de PostgreSQL', () => {
  it('la política oculta y rechaza filas de otro tenant aunque el SQL no filtre', async () => {
    const acme = tenant('rls-acme')
    const globex = tenant('rls-globex')
    const item = await createItem(actor(acme, 'alice@acme.test'))
    const acmeId = mesaTenantUuid(acme)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // El login de runtime entra al rol restringido; FORCE RLS alcanza al dueño
      // de las tablas, pero un superusuario sin SET ROLE seguiría viendo todo.
      await client.query('SET LOCAL ROLE mesa_app')
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [mesaTenantUuid(globex)])
      await client.query("SELECT set_config('app.actor_id', $1, true)", ['alice@acme.test'])
      await client.query("SELECT set_config('app.role', $1, true)", ['client_b2b'])

      const hidden = await client.query('SELECT id FROM mesa_items WHERE id = $1', [item.id])
      assert.deepEqual(hidden.rows, [])

      await assert.rejects(
        client.query(
          `INSERT INTO mesa_items (tenant_id, id, owner_id, business_key, state, payload)
           VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)`,
          [acmeId, crypto.randomUUID(), 'alice@acme.test', 'bk-rls', 'PENDIENTE_CRITERIO'],
        ),
        error => error.code === '42501',
      )
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})

describe('normalizeActor', () => {
  it('normaliza email y rol, y cae a legalEntityIds[0] para el tenant', () => {
    assert.deepEqual(
      normalizeActor({ email: '  Alice@ACME.test ', legalEntityIds: ['acme'], role: 'Admin' }),
      { email: 'alice@acme.test', tenantId: 'acme', role: 'admin', tenantIds: ['acme'] },
    )
  })

  it('el tenant se pasa a minúsculas y el rol también', () => {
    assert.deepEqual(
      normalizeActor({ email: 'A@B.test', tenantId: '  ACME  ', role: 'CEO' }),
      { email: 'a@b.test', tenantId: 'acme', role: 'ceo', tenantIds: ['acme'] },
    )
  })

  it('reúne las entidades legales sin duplicar y con el tenant primero', () => {
    assert.deepEqual(
      normalizeActor({
        email: 'a@b.test',
        tenantId: 'ACME',
        legalEntityIds: ['otra', 'ACME', '  tercera '],
      }).tenantIds,
      ['acme', 'otra', 'tercera'],
    )
  })

  it('un rol ausente no concede privilegios', () => {
    assert.equal(normalizeActor({ email: 'a@b.test', tenantId: 't' }).role, '')
  })

  it('sin email válido o sin tenant no hay actor', () => {
    assert.equal(normalizeActor({ tenantId: 't' }), null)
    assert.equal(normalizeActor({ email: 'no-es-email', tenantId: 't' }), null)
    assert.equal(normalizeActor({ email: 'a@b.test' }), null)
    assert.equal(normalizeActor(null), null)
  })
})
