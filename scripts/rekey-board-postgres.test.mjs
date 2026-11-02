/**
 * Promesas que estas pruebas fijan para `scripts/rekey-board-postgres.mjs`:
 *
 * 1. El dry-run (modo por defecto) planea, exporta y no escribe.
 * 2. El apply deriva la clave canónica solo de una referencia que el ítem
 *    declara, y una segunda pasada no cambia nada.
 * 3. Una clave derivada nunca pisa la de otro ítem vivo: se reporta la colisión
 *    y el ítem conserva la clave que tenía.
 * 4. Un ítem sin referencia propia conserva `legacy:<uuid>`, también cuando su
 *    evidencia o su documento nombran un expediente: esos tokens identifican el
 *    asunto, no la fila (ADR-007).
 * 5. La clave calculada coincide con `businessKeyOf` del servicio.
 *
 * Se ejecuta solo:
 *   node --test scripts/rekey-board-postgres.test.mjs
 *
 * Usa PGlite, el PostgreSQL de WASM que ya usa `gateway/board-api.test.mjs`.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

import { businessKeyOf, classify, liveDuplicateGroups, runRekey } from './rekey-board-postgres.mjs'

const PGLITE_ENTRY = new URL('../gateway/node_modules/@electric-sql/pglite/dist/index.js', import.meta.url)
const { PGlite } = await import(PGLITE_ENTRY.href)

const TENANT = '5525986c-3b09-4d13-bf8f-43ccaa2deae3'
const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

/** Esquema mínimo con la misma forma y el mismo índice que `mesa_items`. */
const SCHEMA = `
CREATE TABLE mesa_items (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  owner_id text NOT NULL DEFAULT 'owner',
  space_id uuid,
  business_key text NOT NULL,
  state text NOT NULL,
  row_version bigint NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  title text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_id text,
  idempotency_key text,
  tenant_key text,
  space_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX mesa_items_live_business_key_uniq ON mesa_items (tenant_id, business_key)
  WHERE state <> ALL (ARRAY['APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO']::text[]);
CREATE TABLE mesa_events (
  tenant_id uuid NOT NULL,
  item_id uuid NOT NULL,
  seq integer NOT NULL,
  actor text NOT NULL,
  command text NOT NULL,
  from_state text,
  to_state text NOT NULL,
  payload jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, item_id, seq)
);
`

let db
const tempDirs = []

/** Directorio de exportación desechable por prueba. */
async function exportDir() {
  const dir = await mkdtemp(join(tmpdir(), 'rekey-test-'))
  tempDirs.push(dir)
  return dir
}

/**
 * Sembrar una fila con la forma que dejó la migración.
 * @param {{ id: string, tenure?: string, key?: string, state?: string, payload?: Record<string, unknown>,
 *   rowVersion?: number }} spec - fila.
 * @returns {Promise<Record<string, unknown>>} la fila sembrada.
 */
async function seed(spec) {
  const payload = spec.payload ?? {}
  const row = {
    tenant_id: spec.tenure ?? TENANT,
    id: spec.id,
    business_key: spec.key ?? `legacy:${spec.id}`,
    state: spec.state ?? 'PENDIENTE_CRITERIO',
    row_version: spec.rowVersion ?? 7,
    payload: { ...payload, businessKey: payload['businessKey'] ?? `legacy:${spec.id}` },
  }
  await db.query(
    `INSERT INTO mesa_items (tenant_id, id, business_key, state, row_version, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [row.tenant_id, row.id, row.business_key, row.state, row.row_version, JSON.stringify(row.payload)],
  )
  return row
}

/** Leer una fila tal como quedó. */
async function read(id) {
  const { rows } = await db.query(
    'SELECT business_key, state, row_version, payload FROM mesa_items WHERE tenant_id = $1 AND id = $2',
    [TENANT, id],
  )
  return rows[0]
}

/** Un payload legado con una revisión, como los 436 migrados. */
function legacyPayload(evidence, documentRef = null, extra = {}) {
  return {
    ownerId: 'owner',
    companyId: TENANT,
    spaceId: null,
    title: 'Falta el SAP',
    state: 'PENDIENTE_CRITERIO',
    status: 'waiting_approval',
    sourceRef: null,
    accountRef: null,
    artifactType: 'tarea',
    revisions: [{ version: 1, summary: 's', evidence, content: null, documentRef, at: '2026-10-22T00:03:17.673Z' }],
    ...extra,
  }
}

const uuid = suffix => `00000000-0000-4000-8000-0000000000${suffix}`

before(async () => {
  db = new PGlite()
  await db.exec(SCHEMA)
})

// Cada prueba arranca de una Mesa vacía: los conteos del reporte son del tenant
// entero y no deben arrastrar filas de otra prueba.
beforeEach(async () => {
  await db.exec('TRUNCATE mesa_items, mesa_events')
})

after(async () => {
  await db?.close()
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

describe('businessKeyOf frente al servicio (§2.1)', () => {
  it('reproduce los vectores del servicio, incluidos el espacio, la cuenta y el tenant nulos', () => {
    assert.equal(
      businessKeyOf({
        companyId: TENANT, spaceId: null, accountRef: null, sourceRef: 'PF 2515-2026', artifactType: 'tarea',
      }),
      '27b4544014dfbf1500f3e8cda98a4a83e07517a3d121017f9424b5b99b819290',
    )
    assert.equal(
      businessKeyOf({
        companyId: TENANT, spaceId: null, accountRef: 'Sondel S.A.', sourceRef: 'PF 2515-2026', artifactType: 'tarea',
      }),
      '48b411496824c7b524ef98596ff62f124a087947763b10c2cb0537b8c9274d5d',
    )
    assert.equal(
      businessKeyOf({ companyId: 'co-1', spaceId: 'sp-1', accountRef: 'Eguisa', sourceRef: 'OC-1', artifactType: 'proforma' }),
      'ace516da7c2f97b70cb20fc6514a3a457705e906a627b58b55f137f4cc37a36f',
    )
    // Caso y espacios internos son la misma identidad.
    assert.equal(
      businessKeyOf({ companyId: null, spaceId: null, accountRef: null, sourceRef: 'oc  100', artifactType: '' }),
      '65c8032b61eddd43464c578c2f7425db649586516ff07161f059ae39dd96d864',
    )
    assert.throws(() => businessKeyOf({ companyId: null, spaceId: null, accountRef: null, sourceRef: '  ', artifactType: 'tarea' }), /SOURCE_REQUIRED/u)
  })
})

describe('clasificación de una fila', () => {
  it('adopta solo la referencia que el propio ítem declara', () => {
    assert.deepEqual(
      classify({ id: uuid('01'), payload: legacyPayload(['oc:1'], null, { sourceRef: 'OC-9001' }) }),
      { reason: 'recorded', detail: 'source_ref', source: 'OC-9001', adoptable: true },
    )
    // Una clave de productor sí es una fuente declarada.
    assert.deepEqual(
      classify({ id: uuid('02'), payload: { ...legacyPayload(['oc:1']), businessKey: 'OC-9002' } }),
      { reason: 'recorded', detail: 'producer_key', source: 'OC-9002', adoptable: true },
    )
  })

  it('no confunde la marca legacy:<id> de la migración con una fuente', () => {
    assert.equal(classify({ id: uuid('03'), payload: legacyPayload(['oc:1']) }).reason, 'legacy')
    assert.equal(classify({ id: uuid('04'), payload: legacyPayload(['oc:1']) }).source, null)
  })

  it('nombra el asunto de un documento o de la evidencia sin adoptarlo', () => {
    assert.deepEqual(
      classify({ id: uuid('05'), payload: legacyPayload([], 'mwt:expediente:PF 2515-2026') }),
      {
        reason: 'document',
        detail: 'document_ref:mwt:expediente:PF 2515-2026',
        source: 'PF 2515-2026',
        adoptable: false,
      },
    )
    assert.deepEqual(
      classify({ id: uuid('06'), payload: legacyPayload(['fase:PRODUCCION fin 2026-08-21', 'expediente:PF 2455-2026']) }),
      { reason: 'evidence', detail: 'evidence:PF 2455-2026', source: 'PF 2455-2026', adoptable: false },
    )
  })

  it('no propone nada cuando la evidencia no lleva un token reconocible', () => {
    // Es la forma de 405 de los 436 ítems: referencias con esquema propio
    // (`expediente:`, `sap:`, `documento:`, `execution:`) que el patrón del
    // servicio no reconoce.
    const entry = classify({
      id: uuid('09'),
      payload: legacyPayload(['expediente:2457-2026', 'documento:PO 800119 (kind=OC)', 'sap:269502']),
    })
    assert.deepEqual(entry, { reason: 'legacy', detail: 'no_recorded_reference', source: null, adoptable: false })
  })

  it('declara ambiguo el ítem que mezcla dos referencias', () => {
    const two = classify({ id: uuid('07'), payload: legacyPayload(['PF 2457-2026', 'PF 2458-2026']) })
    assert.equal(two.reason, 'legacy')
    assert.equal(two.detail, 'ambiguous_evidence:PF 2457-2026,PF 2458-2026')
    const twoDocs = classify({ id: uuid('08'), payload: legacyPayload([], 'PF 2500-2026 / OC 8001-2026') })
    assert.equal(twoDocs.reason, 'legacy')
    assert.equal(twoDocs.detail, 'ambiguous_document:PF 2500-2026,OC 8001-2026')
  })
})

describe('dry-run', () => {
  it('planea y exporta sin escribir una sola fila', async () => {
    const id = uuid('11')
    await seed({ id, payload: legacyPayload(['oc:1'], null, { sourceRef: 'OC-7001' }) })
    const dir = await exportDir()

    const report = await runRekey(db, { tenant: TENANT, apply: false, exportDir: dir })

    assert.equal(report.mode, 'dry-run')
    const entry = report.entries.find(row => row.id === id)
    assert.equal(entry.action, 'rekeyed')
    // La fila quedó intacta.
    assert.equal((await read(id)).business_key, `legacy:${id}`)
    assert.equal(Number((await read(id)).row_version), 7)
    // El export previo existe y trae las claves actuales.
    const exported = JSON.parse(await readFile(report.exportPath, 'utf8'))
    assert.equal(exported.mode, 'dry-run')
    assert.ok(exported.entries.some(row => row.id === id && row.from === `legacy:${id}`))
    assert.match(report.exportPath, /rekey-5525986c-dry-run-.*\.json$/u)
  })
})

describe('apply', () => {
  it('deriva la clave canónica, conserva el payload y no se repite la segunda vez', async () => {
    const id = uuid('21')
    const payload = legacyPayload(['oc:1'], null, { sourceRef: 'OC-7002' })
    await seed({ id, payload })
    const dir = await exportDir()

    const first = await runRekey(db, { tenant: TENANT, apply: true, exportDir: dir })
    const expected = businessKeyOf({
      companyId: TENANT, spaceId: null, accountRef: null, sourceRef: 'OC-7002', artifactType: 'tarea',
    })
    const migrated = await read(id)
    assert.equal(migrated.business_key, expected)
    assert.equal(Number(migrated.row_version), 8)
    assert.match(first.revertPath, /-revert\.sql$/u)
    const revert = await readFile(first.revertPath, 'utf8')
    assert.match(revert, /^UPDATE mesa_items AS item$/mu)
    assert.ok(revert.includes(`('${id}'::uuid, 'legacy:${id}')`))
    assert.deepEqual(migrated.payload, { ...payload, businessKey: `legacy:${id}` })
    assert.equal(migrated.state, 'PENDIENTE_CRITERIO')
    assert.equal(first.verification.itemsMatch, true)
    assert.equal(first.verification.liveKeysUnique, true)
    // Un evento `rekey` deja la traza.
    const events = await db.query(
      'SELECT command, from_state, to_state, payload FROM mesa_events WHERE tenant_id = $1 AND item_id = $2',
      [TENANT, id],
    )
    assert.equal(events.rows.length, 1)
    assert.equal(events.rows[0].command, 'rekey')
    assert.equal(events.rows[0].payload.to, expected)

    const second = await runRekey(db, { tenant: TENANT, apply: true, exportDir: dir })
    const again = second.entries.find(row => row.id === id)
    assert.equal(again.action, 'unchanged')
    assert.equal(Number((await read(id)).row_version), 8)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM mesa_events WHERE tenant_id = $1 AND item_id = $2', [TENANT, id])).rows[0].n, 1)
  })

  it('no pisa la clave de otro ítem vivo y la reporta', async () => {
    const live = uuid('31')
    const legacy = uuid('32')
    const payload = legacyPayload(['oc:1'], null, { sourceRef: 'OC-7003' })
    const derived = businessKeyOf({
      companyId: TENANT, spaceId: null, accountRef: null, sourceRef: 'OC-7003', artifactType: 'tarea',
    })
    await seed({ id: live, key: derived, payload: { ...payload, sourceRef: 'OC-7003' } })
    await seed({ id: legacy, payload })
    const dir = await exportDir()

    const report = await runRekey(db, { tenant: TENANT, apply: true, exportDir: dir })

    const entry = report.entries.find(row => row.id === legacy)
    assert.equal(entry.action, 'collision')
    assert.equal(entry.collisionWith, live)
    assert.equal((await read(legacy)).business_key, `legacy:${legacy}`)
    assert.equal((await read(live)).business_key, derived)
    assert.equal(report.summary.collisions, 1)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM mesa_events WHERE tenant_id = $1 AND item_id = $2', [TENANT, legacy])).rows[0].n, 0)
  })

  it('no deja que dos filas del mismo plan adopten la misma clave', async () => {
    const first = uuid('41')
    const second = uuid('42')
    const payload = legacyPayload(['oc:1'], null, { sourceRef: 'OC-7004' })
    await seed({ id: first, payload })
    await seed({ id: second, payload })
    const dir = await exportDir()

    const report = await runRekey(db, { tenant: TENANT, apply: true, exportDir: dir })

    const entries = report.entries.filter(row => row.id === first || row.id === second)
    assert.equal(entries[0].action, 'rekeyed')
    assert.equal(entries[1].action, 'collision')
    assert.equal(entries[1].collisionWith, first)
    assert.equal(report.summary.rekeyed, 1)
    assert.equal(report.verification.liveKeysUnique, true)
  })
})

describe('identidad permanente', () => {
  it('conserva legacy:<uuid> cuando el único rastro es el expediente del asunto', async () => {
    const id = uuid('51')
    const payload = legacyPayload([
      'expediente:PF 2457-2026',
      'documento:PO 800119 (kind=OC)',
      'oc:PO 800119',
      'sap:269502',
    ])
    await seed({ id, payload })
    const dir = await exportDir()

    const report = await runRekey(db, { tenant: TENANT, apply: true, exportDir: dir })

    const entry = report.entries.find(row => row.id === id)
    assert.equal(entry.reason, 'evidence')
    assert.equal(entry.action, 'unchanged')
    assert.equal(entry.to, `legacy:${id}`)
    assert.equal((await read(id)).business_key, `legacy:${id}`)
    assert.equal((await read(id)).row_version.toString(), '7')
  })

  it('un documento que nombra el expediente no reemplaza la clave del aviso', async () => {
    const id = uuid('52')
    await seed({ id, payload: legacyPayload([], 'mwt:expediente:PF 2515-2026') })
    const dir = await exportDir()

    const report = await runRekey(db, { tenant: TENANT, apply: true, exportDir: dir })

    const entry = report.entries.find(row => row.id === id)
    assert.equal(entry.reason, 'document')
    assert.equal(entry.action, 'unchanged')
    assert.equal((await read(id)).business_key, `legacy:${id}`)
  })

  it('reporta la distribución por motivo y no toca otro tenant', async () => {
    const rows = [
      { id: uuid('61'), tenure: OTHER_TENANT, payload: legacyPayload(['oc:1'], null, { sourceRef: 'OC-7999' }) },
      { id: uuid('62'), payload: legacyPayload(['oc:1'], null, { sourceRef: 'OC-7998' }) },
      { id: uuid('63'), payload: legacyPayload([], 'PF 2515-2026') },
      { id: uuid('64'), payload: legacyPayload(['expediente:PF 2455-2026']) },
      { id: uuid('65'), payload: legacyPayload(['PF 2457-2026', 'PF 2458-2026']) },
    ]
    for (const row of rows) await seed(row)
    const dir = await exportDir()

    const report = await runRekey(db, { tenant: TENANT, apply: false, exportDir: dir })

    assert.equal(report.summary.scanned, 4)
    assert.deepEqual(report.summary.buckets, { recorded: 1, document: 1, evidence: 1, legacy: 1 })
    // En seco solo el ítem con referencia declarada cambiaría de clave.
    assert.deepEqual(report.finalKeyOrigins, { legacy: 3, derived: 1, other: 0 })
    // El ítem del otro tenant ni se lee.
    assert.equal(report.entries.some(row => row.id === uuid('61')), false)
    const other = await db.query('SELECT business_key FROM mesa_items WHERE tenant_id = $1', [OTHER_TENANT])
    assert.equal(other.rows[0].business_key, `legacy:${uuid('61')}`)
  })

  it('no toca la clave que decidió un productor y la informa aparte', async () => {
    const live = uuid('66')
    // Fila viva con clave de productor y un sourceRef que no concuerda: es el
    // caso real de los 4 ítems que el dry-run contra la Mesa reporta.
    await seed({
      id: live,
      key: 'PF 2520-2026',
      payload: legacyPayload(['oc:1'], null, { sourceRef: 'PF 2520-2026', businessKey: 'PF 2520-2026' }),
    })
    const dir = await exportDir()

    const report = await runRekey(db, { tenant: TENANT, apply: true, exportDir: dir })

    assert.equal((await read(live)).business_key, 'PF 2520-2026')
    assert.equal(report.summary.inScope, 0)
    assert.equal(report.summary.outOfScope, 1)
    assert.equal(report.summary.rekeyed, 0)
    assert.equal(report.liveIdentityObservations.length, 1)
    assert.equal(report.liveIdentityObservations[0].id, live)
    assert.match(report.liveIdentityObservations[0].proposal, /^[0-9a-f]{64}$/u)
  })

  it('no crea duplicados vivos y no confunde los terminales con un daño', async () => {
    const shared = 'PF 2520-2026'
    await seed({ id: uuid('71'), key: shared, state: 'SUSTITUIDO', payload: legacyPayload(['oc:1']) })
    await seed({ id: uuid('72'), key: shared, state: 'DESCARTADO', payload: legacyPayload(['oc:1']) })
    await seed({ id: uuid('73'), key: shared, state: 'PENDIENTE_CRITERIO', payload: legacyPayload(['oc:1']) })
    const dir = await exportDir()

    const report = await runRekey(db, { tenant: TENANT, apply: false, exportDir: dir })

    assert.deepEqual(report.existingLiveDuplicates, [])
    // Un grupo real de duplicados vivos se reporta, no se corrige en silencio.
    assert.deepEqual(
      liveDuplicateGroups([
        { id: 'a', state: 'PENDIENTE_CRITERIO', business_key: 'k' },
        { id: 'b', state: 'ERROR_RECUPERABLE', business_key: 'k' },
        { id: 'c', state: 'SUSTITUIDO', business_key: 'k' },
      ]),
      [{ key: 'k', ids: ['a', 'b'] }],
    )
  })
})
