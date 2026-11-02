#!/usr/bin/env node
/**
 * Cerrar la identidad de los ítems de la Mesa que se migraron sin `sourceRef`
 * (P1 del cierre). Decide, ítem por ítem, si el registro permite derivar una
 * clave canónica o si `legacy:<uuid>` es la identidad permanente, y solo escribe
 * cuando el registro declara una referencia propia del ítem.
 *
 * La política (ADR-007) es deliberadamente más estrecha que `proposeSourceRef`
 * del servicio: un token de expediente (`PF 2515-2026`) en `documentRef` o en
 * `evidence` identifica el *asunto*, no la fila, y la Mesa guarda varios ítems
 * por asunto. Adoptarlo colapsaría filas distintas, que es la avería de 313
 * artefactos que el servicio ya registró y revirtió.
 *
 * Uso:
 *   node scripts/rekey-board-postgres.mjs --tenant <uuid>
 *   node scripts/rekey-board-postgres.mjs --tenant <uuid> --apply
 *
 * `--dry-run` es el modo por defecto: lee, planea, exporta y no escribe.
 * El script es idempotente: una segunda pasada no encuentra nada que cambiar.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Estados que el índice `mesa_items_live_business_key_uniq` excluye. */
export const TERMINAL_STATES = ['APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO']

/**
 * Tokens de referencia que un registro legado puede llevar en su documento o
 * su evidencia. Es el mismo patrón del servicio (`proposeSourceRef`).
 */
export const SOURCE_REF_PATTERN = /\b(?:OC|PF|PED|EXP|COT)[-_ ]?\d{4,}(?:\s*[-_]\s*(?:19|20)\d{2})?\b/giu

/** Marca que escribe la migración cuando el ítem no tenía clave. */
const LEGACY_KEY = /^legacy:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/**
 * Forma canónica de un campo de identidad. Idéntica a
 * `canonicalIdentityField` de `packages/faberloom/board/src/keys.ts`.
 * @param {unknown} value - campo crudo, o null.
 * @returns {string | null} el valor canónico, o null.
 */
export function canonicalIdentityField(value) {
  const text = (typeof value === 'string' ? value : '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toUpperCase()
  return text.length === 0 ? null : text
}

/**
 * Clave de negocio de un ítem (§2.1). Réplica de `businessKeyOf`:
 * sha256 sobre los cinco campos canónicos, cada uno prefijado con su longitud
 * para que dos tuplas distintas no puedan concatenarse al mismo byte string.
 * @param {{ companyId: string | null, spaceId: string | null, accountRef: string | null,
 *   sourceRef: string, artifactType: string }} input - campos de identidad.
 * @returns {string} sha256 en hex minúsculas.
 */
export function businessKeyOf(input) {
  const source = canonicalIdentityField(input.sourceRef)
  if (source === null) throw new Error('faberloom: SOURCE_REQUIRED — a business key needs a source reference')
  const fields = [input.companyId, input.spaceId, input.accountRef, input.sourceRef, input.artifactType]
    .map(field => canonicalIdentityField(field))
  return createHash('sha256')
    .update(fields.map(field => field === null ? 'n:' : `v:${String(field.length)}:${field}`).join('\u0000'))
    .digest('hex')
}

/**
 * Referencia que el propio ítem declara, o null. Es el único campo que identifica
 * la fila: `sourceRef` explícito, o una clave de productor que no sea la marca
 * `legacy:<uuid>` de la migración (esa marca no es una fuente, es el id).
 * @param {Record<string, unknown>} payload - registro completo del board.
 * @param {string} id - id del ítem.
 * @returns {{ value: string, detail: 'source_ref' | 'producer_key' } | null} la referencia o null.
 */
export function recordedSourceOf(payload, id) {
  const source = typeof payload.sourceRef === 'string' ? payload.sourceRef.trim() : ''
  if (source.length > 0) return { value: source, detail: 'source_ref' }
  const producer = typeof payload.businessKey === 'string' ? payload.businessKey.trim() : ''
  if (producer.length === 0) return null
  // La migración escribió `legacy:<id>` como clave provisional. Rehashearla
  // produciría una clave que ya no dice de qué ítem viene, y no aporta dedupe.
  if (LEGACY_KEY.test(producer) || producer === `legacy:${id}`) return null
  return { value: producer, detail: 'producer_key' }
}

/**
 * Tokens de referencia del documento de la última revisión, con el mismo patrón
 * que usa el servicio. El patrón corta en el separador del año (`PF 2515` en
 * `PF 2515-2026`), así que el token por sí solo no distingue expedientes de años
 * distintos: es una razón más para no adoptarlo como identidad (ADR-007).
 * @param {Record<string, unknown>} payload - registro completo del board.
 * @returns {{ tokens: readonly string[], document: string }} tokens en mayúsculas
 *   sin repetir, y el campo crudo tal como se registró.
 */
function documentOf(payload) {
  const revisions = Array.isArray(payload.revisions) ? payload.revisions : []
  const last = revisions[revisions.length - 1]
  const document = typeof last?.documentRef === 'string' ? last.documentRef.trim() : ''
  return { tokens: [...new Set((document.match(SOURCE_REF_PATTERN) ?? []).map(token => token.toUpperCase()))], document }
}

/**
 * Tokens de referencia de la evidencia de la última revisión.
 * @param {Record<string, unknown>} payload - registro completo del board.
 * @returns {readonly string[]} tokens en mayúsculas, sin repetir.
 */
function evidenceTokensOf(payload) {
  const revisions = Array.isArray(payload.revisions) ? payload.revisions : []
  const last = revisions[revisions.length - 1]
  const evidence = Array.isArray(last?.evidence) ? last.evidence : []
  const found = new Set()
  for (const reference of evidence) {
    if (typeof reference !== 'string') continue
    for (const token of reference.match(SOURCE_REF_PATTERN) ?? []) found.add(token.toUpperCase())
  }
  return [...found]
}

/**
 * Clasificar una fila: qué referencia registra y si esa referencia identifica la
 * fila o solo el asunto que la fila trata.
 * @param {Record<string, unknown>} row - fila de `mesa_items` (id, business_key,
 *   state, payload).
 * @returns {{ reason: 'recorded' | 'document' | 'evidence' | 'legacy', detail: string,
 *   source: string | null, adoptable: boolean }} la clasificación.
 */
export function classify(row) {
  const payload = row.payload ?? {}
  const recorded = recordedSourceOf(payload, row.id)
  if (recorded !== null) {
    return { reason: 'recorded', detail: recorded.detail, source: recorded.value, adoptable: true }
  }
  const document = documentOf(payload)
  if (document.tokens.length === 1) {
    // El token nombra el expediente; la fila es un aviso sobre él. Se reporta y
    // no se adopta (ADR-007).
    return {
      reason: 'document',
      detail: `document_ref:${document.document}`,
      source: document.tokens[0],
      adoptable: false,
    }
  }
  if (document.tokens.length > 1) {
    return { reason: 'legacy', detail: `ambiguous_document:${document.tokens.join(',')}`, source: null, adoptable: false }
  }
  const evidenceTokens = evidenceTokensOf(payload)
  if (evidenceTokens.length === 1) {
    return { reason: 'evidence', detail: `evidence:${evidenceTokens[0]}`, source: evidenceTokens[0], adoptable: false }
  }
  if (evidenceTokens.length > 1) {
    return { reason: 'legacy', detail: `ambiguous_evidence:${evidenceTokens.join(',')}`, source: null, adoptable: false }
  }
  return { reason: 'legacy', detail: 'no_recorded_reference', source: null, adoptable: false }
}

/**
 * Planear la migración de un tenant entero sin escribir nada.
 *
 * El alcance son las filas que todavía llevan la marca provisional
 * `legacy:<id>` de la migración: son las únicas cuya clave no la decidió un
 * productor. Una fila viva con clave propia se clasifica e informa, pero no se
 * toca; su identidad es asunto del servicio que la escribió, no de este backfill.
 *
 * Una clave derivada nunca pisa la de otro ítem vivo: si el destino ya pertenece
 * a una fila no terminal, el ítem conserva su clave y se reporta la colisión.
 * Dos filas del mismo plan que derivan la misma clave también colisionan: gana
 * la primera por id y la segunda se reporta.
 * @param {readonly Record<string, unknown>[]} rows - filas del tenant.
 * @returns {{ entries: readonly Record<string, unknown>[], summary: Record<string, unknown> }} el plan.
 */
export function planRekey(rows) {
  const ordered = [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)))
  /** Claves que ya reclama un ítem vivo, y el ítem que las reclama. */
  const liveKeys = new Map()
  for (const row of ordered) {
    if (TERMINAL_STATES.includes(String(row.state))) continue
    liveKeys.set(String(row.business_key), String(row.id))
  }

  const entries = []
  const claimed = new Map()
  for (const row of ordered) {
    const id = String(row.id)
    const from = typeof row.business_key === 'string' ? row.business_key : ''
    const classified = classify(row)
    const entry = {
      id,
      scope: from === `legacy:${id}` ? 'legacy' : 'live',
      state: String(row.state),
      from,
      proposal: null,
      reason: classified.reason,
      detail: classified.detail,
      source: classified.source,
      to: from,
      action: 'unchanged',
    }

    if (!classified.adoptable) {
      entries.push(entry)
      continue
    }
    const proposal = businessKeyOf({
      companyId: typeof row.company_id === 'string' ? row.company_id : (typeof row.tenant_id === 'string' ? row.tenant_id : null),
      spaceId: row.payload?.spaceId ?? (typeof row.space_id === 'string' ? row.space_id : null),
      accountRef: row.payload?.accountRef ?? null,
      sourceRef: classified.source,
      artifactType: row.payload?.artifactType ?? '',
    })
    entry.proposal = proposal
    if (entry.scope !== 'legacy' || proposal === from) {
      entries.push(entry)
      continue
    }
    const holder = liveKeys.get(proposal)
    if (holder !== undefined && holder !== id) {
      entries.push({ ...entry, action: 'collision', collisionWith: holder })
      continue
    }
    const planned = claimed.get(proposal)
    if (planned !== undefined && planned !== id) {
      entries.push({ ...entry, action: 'collision', collisionWith: planned })
      continue
    }
    claimed.set(proposal, id)
    liveKeys.set(proposal, id)
    if (from !== '') liveKeys.delete(from)
    entries.push({ ...entry, to: proposal, action: 'rekeyed' })
  }

  const scoped = entries.filter(entry => entry.scope === 'legacy')
  /** Distribución por motivo de las filas en alcance. */
  const buckets = { recorded: 0, document: 0, evidence: 0, legacy: 0 }
  for (const entry of scoped) buckets[entry.reason] += 1
  const summary = {
    scanned: entries.length,
    inScope: scoped.length,
    outOfScope: entries.length - scoped.length,
    rekeyed: scoped.filter(entry => entry.action === 'rekeyed').length,
    unchanged: scoped.filter(entry => entry.action === 'unchanged').length,
    collisions: scoped.filter(entry => entry.action === 'collision').length,
    buckets,
    adopted: scoped.filter(entry => entry.action === 'rekeyed').length,
  }
  return { entries, summary }
}

/**
 * Grupos de claves que comparten más de un ítem vivo. Un grupo preexistente no
 * lo crea esta migración; se reporta para que nadie lo confunda con un daño
 * nuevo y para probar que el apply no agregó ninguno.
 * @param {readonly Record<string, unknown>[]} rows - filas del tenant.
 * @returns {readonly { key: string, ids: readonly string[] }[]} los grupos.
 */
export function liveDuplicateGroups(rows) {
  const byKey = new Map()
  for (const row of rows) {
    if (TERMINAL_STATES.includes(String(row.state))) continue
    const key = String(row.business_key)
    const ids = byKey.get(key) ?? []
    ids.push(String(row.id))
    byKey.set(key, ids)
  }
  return [...byKey.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

/**
 * Distribución de las claves finales por origen.
 * @param {readonly Record<string, unknown>[]} entries - filas del plan.
 * @returns {Record<string, number>} conteo por origen.
 */
function finalKeyOrigins(entries) {
  const origins = { legacy: 0, derived: 0, other: 0 }
  for (const entry of entries) {
    if (String(entry.to).startsWith('legacy:')) origins.legacy += 1
    else if (/^[0-9a-f]{64}$/u.test(String(entry.to))) origins.derived += 1
    else origins.other += 1
  }
  return origins
}

/**
 * Filas vivas cuya clave no coincide con lo que declara su propio registro. No
 * las toca este backfill: su identidad la escribió el servicio, y cambiarla es
 * una decisión aparte. Se informan para que el dueño las resuelva.
 * @param {readonly Record<string, unknown>[]} entries - filas del plan.
 * @returns {readonly Record<string, unknown>[]} observaciones.
 */
function liveIdentityObservations(entries) {
  return entries
    .filter(entry => entry.scope === 'live' && entry.proposal !== null && entry.proposal !== entry.from)
    .map(entry => ({
      id: entry.id,
      state: entry.state,
      from: entry.from,
      proposal: entry.proposal,
      reason: entry.reason,
      detail: entry.detail,
      blockedBy: entry.collisionWith ?? null,
    }))
}

/**
 * Reporte completo del plan, apto para archivo y para stdout.
 * @param {readonly Record<string, unknown>[]} rows - filas del tenant.
 * @param {{ tenant: string, mode: 'dry-run' | 'apply' }} meta - contexto de la corrida.
 * @returns {Record<string, unknown>} el reporte.
 */
export function buildReport(rows, meta) {
  const { entries, summary } = planRekey(rows)
  return {
    tool: 'rekey-board-postgres',
    policy: 'ADR-007-identidad-mesa',
    mode: meta.mode,
    tenant: meta.tenant,
    at: new Date().toISOString(),
    summary,
    finalKeyOrigins: finalKeyOrigins(entries),
    existingLiveDuplicates: liveDuplicateGroups(rows),
    liveIdentityObservations: liveIdentityObservations(entries),
    entries,
  }
}

/** Cargar `pg` desde el workspace o desde `gateway/node_modules`. */
function loadPg() {
  const bases = [import.meta.url, new URL('../gateway/package.json', import.meta.url).href]
  const failures = []
  for (const base of bases) {
    try {
      return createRequire(base)('pg')
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(`rekey: no se encontró el módulo "pg" — ${failures.join(' | ')}`)
}

/**
 * Leer las filas del tenant bajo la sesión que exige RLS.
 * @param {{ query: Function }} client - conexión abierta.
 * @param {string} tenant - uuid del tenant.
 * @returns {Promise<readonly Record<string, unknown>[]>} filas.
 */
async function readRows(client, tenant) {
  const { rows } = await client.query(
    'SELECT id, tenant_id, space_id, business_key, state, payload FROM mesa_items WHERE tenant_id = $1 ORDER BY id',
    [tenant],
  )
  return rows.map(row => ({ ...row, id: String(row.id), business_key: String(row.business_key) }))
}

/**
 * Aplicar una clave nueva solo si el destino sigue libre. La condición viaja en
 * el UPDATE, así que un escritor concurrente no puede colarse entre el plan y la
 * escritura.
 * @param {{ query: Function }} client - conexión de la transacción.
 * @param {{ tenant: string, id: string, to: string, state: string }} change - cambio.
 * @returns {Promise<boolean>} true si la fila se actualizó.
 */
async function applyKey(client, change) {
  const { rows } = await client.query(
    `UPDATE mesa_items
        SET business_key = $3, row_version = row_version + 1
      WHERE tenant_id = $1 AND id = $2
        AND NOT EXISTS (
          SELECT 1 FROM mesa_items other
           WHERE other.tenant_id = $1 AND other.business_key = $3 AND other.id <> $2
             AND other.state <> ALL($4::text[])
        )
      RETURNING id`,
    [change.tenant, change.id, change.to, TERMINAL_STATES],
  )
  if (rows.length === 0) return false
  await client.query(
    `INSERT INTO mesa_events (tenant_id, item_id, seq, actor, command, from_state, to_state, payload, at)
     SELECT $1, $2, COALESCE(MAX(seq), 0) + 1, 'rekey', 'rekey', $3, $3, $4::jsonb, now()
       FROM mesa_events WHERE tenant_id = $1 AND item_id = $2`,
    [change.tenant, change.id, change.state, JSON.stringify({
      from: change.from, to: change.to, sourceRef: change.source, policy: 'ADR-007',
    })],
  )
  return true
}

/**
 * Verificar las invariantes dentro de la misma transacción del apply.
 * @param {{ query: Function }} client - conexión de la transacción.
 * @param {string} tenant - uuid del tenant.
 * @param {number} expected - filas leídas al planear.
 * @returns {Promise<Record<string, unknown>>} los conteos verificados.
 */
async function verify(client, tenant, expected) {
  const { rows } = await client.query(
    `SELECT
       COUNT(*)::int AS items,
       COUNT(*) FILTER (WHERE state <> ALL($2::text[]))::int AS live,
       COUNT(DISTINCT business_key) FILTER (WHERE state <> ALL($2::text[]))::int AS live_keys
     FROM mesa_items WHERE tenant_id = $1`,
    [tenant, TERMINAL_STATES],
  )
  const row = rows[0] ?? {}
  const checks = {
    items: Number(row.items ?? 0),
    live: Number(row.live ?? 0),
    liveKeys: Number(row.live_keys ?? 0),
    itemsMatch: Number(row.items ?? 0) === expected,
    liveKeysUnique: Number(row.live_keys ?? 0) === Number(row.live ?? 0),
  }
  if (!checks.itemsMatch) throw new Error(`rekey: el tenant tenía ${String(expected)} ítems y quedaron ${String(checks.items)}`)
  if (!checks.liveKeysUnique) throw new Error(`rekey: ${String(checks.live - checks.liveKeys)} clave(s) viva(s) duplicada(s) tras el apply`)
  return checks
}

/** Leer los argumentos de la línea de comandos. */
function parseArgs(argv) {
  const out = { apply: false, tenant: undefined, databaseUrl: undefined, role: 'mesa_app', exportDir: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') out.apply = true
    else if (arg === '--dry-run') out.apply = false
    else if (arg === '--tenant') out.tenant = argv[++index]
    else if (arg === '--database-url') out.databaseUrl = argv[++index]
    else if (arg === '--role') out.role = argv[++index]
    else if (arg === '--export-dir') out.exportDir = argv[++index]
    else if (arg === '--help' || arg === '-h') out.help = true
    else throw new Error(`rekey: argumento desconocido ${arg}`)
  }
  return out
}

/** Nombre de archivo estable por corrida, con fecha. */
function stampName(tenant, mode, extension) {
  const at = new Date().toISOString().replace(/[:.]/gu, '-')
  return `rekey-${tenant.slice(0, 8)}-${mode}-${at}.${extension}`
}

/**
 * Sentencia que devuelve a su clave anterior cada fila que esta corrida cambió.
 * Se escribe junto al export: es la reversión concreta de este apply, no una
 * receta genérica.
 * @param {string} tenant - uuid del tenant.
 * @param {readonly Record<string, unknown>[]} entries - filas del plan ya aplicado.
 * @returns {string} SQL de reversión.
 */
function revertSqlOf(tenant, entries) {
  const changed = entries.filter(entry => entry.action === 'rekeyed' && entry.to !== entry.from)
  const header = `-- reversión de rekey-board-postgres (ADR-007) · tenant ${tenant} · ${new Date().toISOString()}\n`
  if (changed.length === 0) return `${header}-- esta corrida no cambió ninguna clave\n`
  const values = changed
    .map(entry => `  ('${String(entry.id)}'::uuid, '${String(entry.from).replace(/'/gu, "''")}')`)
    .join(',\n')
  return `${header}BEGIN;\nSET LOCAL ROLE mesa_app;\nSELECT set_config('app.tenant_id', '${tenant}', true);\n`
    + `SELECT set_config('app.role', 'admin', true);\n`
    + `UPDATE mesa_items AS item\n   SET business_key = revert.business_key\n  FROM (VALUES\n${values}\n  ) AS revert(id, business_key)\n`
    + ` WHERE item.tenant_id = '${tenant}'::uuid AND item.id = revert.id;\nCOMMIT;\n`
}

/**
 * Ejecutar una corrida completa sobre una conexión ya abierta y autenticada.
 * Exporta las claves actuales antes de escribir, y solo escribe con `apply`.
 * @param {{ query: Function, release?: Function }} client - conexión.
 * @param {{ tenant: string, apply: boolean, exportDir: string }} options - corrida.
 * @returns {Promise<Record<string, unknown>>} el reporte.
 */
export async function runRekey(client, options) {
  const mode = options.apply ? 'apply' : 'dry-run'
  const rows = await readRows(client, options.tenant)
  const report = buildReport(rows, { tenant: options.tenant, mode })

  await mkdir(options.exportDir, { recursive: true })
  const exportPath = join(options.exportDir, stampName(options.tenant, mode, 'json'))
  await writeFile(exportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  report.exportPath = exportPath

  if (!options.apply) return report

  const changes = report.entries.filter(entry => entry.action === 'rekeyed')
  for (const change of changes) {
    const from = String(change.from)
    const applied = await applyKey(client, {
      tenant: options.tenant,
      id: String(change.id),
      to: String(change.to),
      from,
      state: String(change.state),
      source: change.source,
    })
    if (!applied) {
      change.action = 'collision'
      change.to = from
    }
  }
  const revertPath = exportPath.replace(/\.json$/u, '-revert.sql')
  await writeFile(revertPath, revertSqlOf(options.tenant, report.entries), 'utf8')
  report.revertPath = revertPath
  report.summary.rekeyed = report.entries.filter(entry => entry.action === 'rekeyed').length
  report.summary.collisions = report.entries.filter(entry => entry.action === 'collision').length
  report.summary.adopted = report.summary.rekeyed
  report.verification = await verify(client, options.tenant, rows.length)
  return report
}

/** Punto de entrada. */
async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help === true || args.tenant === undefined) {
    process.stdout.write('uso: rekey-board-postgres.mjs --tenant <uuid> [--apply] [--database-url <url>] [--export-dir <dir>] [--role mesa_app]\n')
    process.exit(args.help === true ? 0 : 2)
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(args.tenant)) {
    throw new Error(`rekey: --tenant debe ser un uuid, no ${args.tenant}`)
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(args.role)) throw new Error(`rekey: rol inválido ${args.role}`)

  const databaseUrl = args.databaseUrl ?? process.env.MESA_DATABASE_URL ?? process.env.DATABASE_URL
  if (databaseUrl === undefined) throw new Error('rekey: falta --database-url o MESA_DATABASE_URL')

  const pg = loadPg()
  const pool = new pg.Pool({ connectionString: databaseUrl })
  const client = await pool.connect()
  let report
  try {
    await client.query('BEGIN')
    // RLS se evalúa con el rol de la transacción; el login de runtime es
    // NOINHERIT y entra al grupo explícitamente (igual que la migración).
    await client.query(`SET LOCAL ROLE ${args.role}`)
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', args.tenant])
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_id', ''])
    // El backfill opera sobre todos los owners del tenant, así que corre con el
    // rol privilegiado que aceptan las políticas.
    await client.query('SELECT set_config($1, $2, true)', ['app.role', 'admin'])
    report = await runRekey(client, {
      tenant: args.tenant,
      apply: args.apply,
      exportDir: resolve(args.exportDir ?? '.artifacts/mesa-rekey'),
    })
    if (args.apply) await client.query('COMMIT')
    else await client.query('ROLLBACK')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
    await pool.end()
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
