#!/usr/bin/env node
/**
 * Migración de propiedad de los homes de inquilino a un uid por inquilino.
 *
 * Todo corre como root en el contenedor del gateway, y root ignora los
 * permisos: un `dsh` de un inquilino lee el home de otro, incluidos sus tokens
 * MCP. Este script es la mitad de datos del arreglo: cada home pasa a ser de un
 * uid propio (`30000 + slot`), en `0700`, y los archivos del despliegue que
 * guardan secretos quedan en `0600 root`. La otra mitad es el gateway, que
 * arranca cada `dsh` con ese uid y sin los secretos en el entorno.
 *
 * Uso (dentro del contenedor del gateway, con el volumen montado en /data):
 *
 *   node scripts/harden-homes.mjs                 # dry run: imprime el plan
 *   node scripts/harden-homes.mjs --apply         # ejecuta
 *   node scripts/harden-homes.mjs --rollback <json> --apply   # revierte
 *
 * `--dry-run` es el valor por defecto; sin `--apply` no se escribe ni se cambia
 * nada. La tabla de uids es `/data/tenant-uids.json` y el registro de la corrida
 * `/data/harden-homes-<fecha>.json`; los dos viven en el volumen para
 * sobrevivir a la recreación del contenedor.
 *
 * Antes de ejecutar, `scripts/backup-harness.sh` (o el `tar` documentado en el
 * handoff) tiene que haber dejado un respaldo listable del volumen.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TENANT_UID_BASE,
  adoptHomeOwnership,
  assignTenantUid,
  emptyTenantUidTable,
  isReservedHomeName,
  readTenantUidTable,
  uidForHomeId,
  writeTenantUidTable,
} from '../gateway/tenant-uids.mjs'

/** Archivos de `/data` que guardan credenciales y quedan en `0600 root`. */
const SECRET_FILES = [
  'gateway-users.json',
  'mcp-token-index.json',
  'memory-users.json',
]

/** Directorio de secretos, dentro del mismo `/data`. */
const SECRETS_DIR = 'secrets'

/** Modo de los archivos de secretos tras la migración. */
const SECRET_MODE = '600'

/** Modo de cada home de inquilino tras la migración. */
const HOME_MODE = '700'

/** Modo de los directorios compartidos que el hijo de cada inquilino lee. */
const SHARED_DIR_MODE = '755'

/** Modo de los archivos compartidos que el hijo de cada inquilino lee. */
const SHARED_FILE_MODE = '644'

/**
 * Roles que editan el catálogo global de skills desde el panel. El primero de
 * esta lista (en el orden del archivo de usuarios) recibe el directorio: quien
 * edita una skill global escribe como su propio uid, y el catálogo tiene que
 * pertenecerle para que el panel no falle con EACCES.
 */
const SKILLS_OWNER_ROLES = new Set(['admin', 'superadmin', 'ceo'])

/** Modo del catálogo global: `2775` (setgid, grupo del dueño) y nadie más escribe. */
const SKILLS_DIR_MODE = '2775'

/**
 * Texto de uso del script.
 * @returns {string} ayuda en texto plano.
 */
function usage() {
  return [
    'Uso: node scripts/harden-homes.mjs [opciones]',
    '',
    '  --apply                ejecuta (sin esta bandera todo es dry run)',
    '  --data-dir <dir>       raíz de los homes (por defecto DATA_DIR o /data/users)',
    '  --table <file>         tabla de uids (por defecto <dir de data-dir>/tenant-uids.json)',
    '  --record <file>        registro de la corrida (por defecto <dir de data-dir>/harden-homes-<fecha>.json)',
    '  --rollback <file>      revierte una corrida desde su registro (con --apply ejecuta)',
    '  --help                 esta ayuda',
  ].join('\n')
}

/**
 * Lee los argumentos de la línea de comandos.
 * @param {string[]} argv - argumentos sin `node` ni la ruta del script.
 * @returns {{ apply: boolean, dataDir: string, tableFile: string, recordFile?: string, rollback?: string, help: boolean }} opciones normalizadas.
 */
function parseArgs(argv) {
  const dataDirDefault = process.env.DATA_DIR || '/data/users'
  const options = {
    apply: false,
    dataDir: dataDirDefault,
    tableFile: path.join(path.dirname(dataDirDefault), 'tenant-uids.json'),
    recordFile: undefined,
    rollback: undefined,
    help: false,
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    const value = () => {
      const next = argv[index + 1]
      if (next === undefined) throw new Error(`${arg} necesita un valor`)
      index += 1
      return next
    }
    if (arg === '--apply') options.apply = true
    else if (arg === '--dry-run') options.apply = false
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--data-dir') options.dataDir = path.resolve(value())
    else if (arg === '--table') options.tableFile = path.resolve(value())
    else if (arg === '--record') options.recordFile = path.resolve(value())
    else if (arg === '--rollback') options.rollback = path.resolve(value())
    else throw new Error(`argumento no reconocido: ${arg}`)
  }
  if (options.recordFile === undefined) {
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
    options.recordFile = path.join(path.dirname(options.dataDir), `harden-homes-${stamp}.json`)
  }
  return options
}

/**
 * Modo en octal sin ceros a la izquierda, como en `stat -c %a`.
 * @param {number} mode - bits de permiso de `fs.Stats`.
 * @returns {string} el modo, por ejemplo `700`.
 */
function octalMode(mode) {
  return (mode & 0o7777).toString(8).padStart(3, '0')
}

/**
 * `stat` de una ruta, o null si no existe. No sigue enlaces simbólicos.
 * @param {string} target - ruta absoluta.
 * @returns {{ uid: number, gid: number, mode: string } | null} propietario y modo.
 */
function snapshot(target) {
  try {
    const stat = fs.lstatSync(target)
    return { uid: stat.uid, gid: stat.gid, mode: octalMode(stat.mode) }
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

/**
 * Los homes de inquilino de `dataDir`: un directorio por inquilino, sin los
 * nombres reservados. Falla si `dataDir` no existe o si un nombre reservado no
 * es un directorio, en vez de saltárselo en silencio.
 * @param {string} dataDir - raíz de los homes.
 * @returns {{ tenants: { name: string, full: string }[], reserved: { name: string, full: string, reason: string }[] }} homes de inquilino y nombres reservados.
 */
function listHomes(dataDir) {
  const entries = fs.readdirSync(dataDir, { withFileTypes: true })
  const tenants = []
  const reserved = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const full = path.join(dataDir, entry.name)
    if (isReservedHomeName(entry.name)) {
      if (!entry.isDirectory()) throw new Error(`${full} tiene un nombre reservado y no es un directorio`)
      reserved.push({ name: entry.name, full, reason: 'nombre reservado: no es un home de inquilino' })
      continue
    }
    if (!entry.isDirectory()) throw new Error(`${full} no es un directorio: no se puede migrar un home`)
    tenants.push({ name: entry.name, full })
  }
  return { tenants, reserved }
}

/**
 * Los archivos de secretos de `/data`, con su estado actual. Los que no existen
 * se omiten con una nota: no todos los despliegues tienen los tres.
 * @param {string} dataDir - raíz de los homes; `/data` es su directorio padre.
 * @returns {{ path: string, before: { uid: number, gid: number, mode: string } | null }[]} rutas candidatas con su estado.
 */
function listSecrets(dataDir) {
  const dataRoot = path.dirname(dataDir)
  const candidates = SECRET_FILES.map(name => path.join(dataRoot, name))
  const secretsDir = path.join(dataRoot, SECRETS_DIR)
  try {
    for (const entry of fs.readdirSync(secretsDir, { withFileTypes: true })) {
      if (entry.isFile() || entry.isSymbolicLink()) candidates.push(path.join(secretsDir, entry.name))
    }
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }
  return candidates.map(target => ({ path: target, before: snapshot(target) }))
}

/**
 * Recorre `/data/shared` y `/data/users/shared`.
 *
 * Son datos compartidos por diseño (agentes globales, lista de exentos, skills
 * globales): el `dsh` de cada inquilino los lee, y con el hijo ya sin ser root
 * un archivo `0600 root` deja de estar a su alcance. No se relajan los permisos
 * de nada más.
 * @param {string} dataDir - raíz de los homes.
 * @returns {{ path: string, isDir: boolean, before: { uid: number, gid: number, mode: string } | null }[]} entradas compartidas con su estado.
 */
function listShared(dataDir) {
  const found = []
  const roots = [path.join(path.dirname(dataDir), 'shared'), path.join(dataDir, 'shared')]
  const walk = root => {
    let entries
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch (error) {
      if (error && error.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const full = path.join(root, entry.name)
      found.push({ path: full, isDir: entry.isDirectory(), before: snapshot(full) })
      if (entry.isDirectory()) walk(full)
    }
  }
  for (const root of roots) walk(root)
  return found
}

/**
 * El inquilino que edita el catálogo global de skills: el primero con rol
 * `admin`, `superadmin` o `ceo` en `gateway-users.json` que esté en la tabla de
 * uids. El orden del archivo decide, para que dos corridas elijan al mismo.
 * @param {string} dataDir - raíz de los homes; `gateway-users.json` vive en su directorio padre.
 * @param {{ tenants: Record<string, { uid: number, gid: number, slot: number }> }} table - tabla de uids vigente.
 * @returns {{ path: string, email: string, id: string, entry: { uid: number, gid: number, slot: number }, before: { uid: number, gid: number, mode: string } | null } | null} dueño propuesto, o null cuando no hay ninguno.
 */
export function resolveGlobalSkillsOwner(dataDir, table) {
  const file = path.join(path.dirname(dataDir), 'gateway-users.json')
  const skillsPath = path.join(path.dirname(dataDir), 'shared', 'skills')
  let state
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw new Error(`no se pudo leer ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const users = state?.users
  if (users === null || typeof users !== 'object') return null
  for (const [email, user] of Object.entries(users)) {
    if (user === null || typeof user !== 'object') continue
    if (!SKILLS_OWNER_ROLES.has(String(user.role ?? '').toLowerCase())) continue
    const id = user.id
    if (typeof id !== 'string' || !Object.hasOwn(table.tenants, id)) continue
    return { path: skillsPath, email, id, entry: table.tenants[id], before: snapshot(skillsPath) }
  }
  return null
}

/**
 * Imprime una línea por home y una por secreto, con el estado actual y el
 * objetivo, sin cambiar nada.
 * @param {{ tenants: { name: string, full: string }[], reserved: { name: string, full: string, reason: string }[] }} homes - homes detectados.
 * @param {{ table: { tenants: Record<string, { uid: number, gid: number, slot: number }> }, plans: { name: string, full: string, entry: { uid: number, gid: number, slot: number }, before: { uid: number, gid: number, mode: string } | null, pending: boolean }[] }} plan - plan calculado.
 * @param {{ path: string, before: { uid: number, gid: number, mode: string } | null }[]} secrets - secretos detectados.
 * @returns {void}
 */
function printPlan(homes, plan, secrets, shared) {
  console.log(`Homes de inquilino: ${plan.plans.length} · reservados: ${homes.reserved.length}`)
  for (const home of plan.plans) {
    const before = home.before === null ? 'no existe' : `${home.before.uid}:${home.before.gid} ${home.before.mode}`
    const target = `${home.entry.uid}:${home.entry.gid} ${HOME_MODE}`
    const state = home.before !== null && home.before.uid === home.entry.uid
      && home.before.gid === home.entry.gid && home.before.mode === HOME_MODE
      ? 'sin cambios'
      : (home.pending ? 'uid por asignar' : 'cambiará')
    console.log(`  ${home.name}  antes ${before} -> después ${target}  (${state})`)
  }
  for (const home of homes.reserved) {
    const before = snapshot(home.full)
    console.log(`  ${home.name}  ${before === null ? 'no existe' : `${before.uid}:${before.gid} ${before.mode}`}  (${home.reason})`)
  }
  console.log(`Archivos de secretos: ${secrets.length}`)
  for (const secret of secrets) {
    if (secret.before === null) {
      console.log(`  ${secret.path}  no existe (se omite)`)
      continue
    }
    const state = secret.before.uid === 0 && secret.before.gid === 0 && secret.before.mode === SECRET_MODE
      ? 'sin cambios'
      : 'cambiará'
    console.log(`  ${secret.path}  antes ${secret.before.uid}:${secret.before.gid} ${secret.before.mode} -> después 0:0 ${SECRET_MODE}  (${state})`)
  }
  console.log(`Datos compartidos que el hijo lee: ${shared.length}`)
  for (const entry of shared) {
    if (entry.before === null) continue
    // El catálogo global se imprime aparte, con su dueño.
    if (plan.skillsOwner !== null && entry.path === plan.skillsOwner.path) continue
    const target = entry.isDir ? SHARED_DIR_MODE : SHARED_FILE_MODE
    const state = entry.before.mode === target ? 'sin cambios' : 'cambiará'
    console.log(`  ${entry.path}  antes ${entry.before.uid}:${entry.before.gid} ${entry.before.mode} -> después ${target}  (${state})`)
  }
  if (plan.skillsOwner === null) {
    console.log('  catálogo global de skills: no hay Admin/CEO en la tabla; queda en root y el panel no podrá escribir (AVISO)')
  } else {
    const owner = plan.skillsOwner
    const before = owner.before === null ? 'no existe' : `${owner.before.uid}:${owner.before.gid} ${owner.before.mode}`
    const state = owner.before !== null && owner.before.uid === owner.entry.uid
      && owner.before.gid === owner.entry.gid && owner.before.mode === SKILLS_DIR_MODE
      ? 'sin cambios'
      : 'cambiará'
    console.log(`  ${owner.path}  antes ${before} -> después ${owner.entry.uid}:${owner.entry.gid} ${SKILLS_DIR_MODE}  (${state}; dueño ${owner.email})`)
  }
}

/**
 * Escribe el registro de la corrida antes de tocar nada, y lo reescribe al
 * final con el estado y las acciones. Es la entrada del `--rollback`.
 * @param {string} file - ruta del registro.
 * @param {Record<string, unknown>} record - documento completo.
 * @returns {void}
 */
function writeRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
}

/**
 * Migra: asigna uids, cede la propiedad de cada home, endurece los secretos y
 * persiste la tabla. Se detiene en el primer fallo y deja el registro en
 * `failed` con el punto exacto.
 * @param {{ apply: boolean, dataDir: string, tableFile: string, recordFile?: string }} options - opciones ya normalizadas.
 * @returns {number} código de salida del proceso.
 */
function migrate(options) {
  const homes = listHomes(options.dataDir)
  if (homes.tenants.length === 0) throw new Error(`${options.dataDir} no tiene ningún home de inquilino`)
  const table = readTenantUidTable(options.tableFile) ?? emptyTenantUidTable()

  // Cualquier home que la tabla nombre y ya no exista es un fallo: migrar con
  // una tabla que miente deja al gateway arrancando uids de homes ausentes.
  for (const id of Object.keys(table.tenants)) {
    if (!fs.existsSync(path.join(options.dataDir, id))) {
      throw new Error(`la tabla ${options.tableFile} nombra el home ${id}, que no existe bajo ${options.dataDir}`)
    }
  }

  const plans = homes.tenants.map(home => {
    const existing = uidForHomeId(table, home.name)
    const pending = existing === null
    const entry = existing ?? assignTenantUid(table, home.name)
    return { name: home.name, full: home.full, entry, pending, before: snapshot(home.full) }
  })
  const secrets = listSecrets(options.dataDir)
  const shared = listShared(options.dataDir)
  const skillsOwner = resolveGlobalSkillsOwner(options.dataDir, table)

  console.log(options.apply ? 'MODO: --apply' : 'MODO: dry run (nada se escribe; usa --apply para ejecutar)')
  console.log(`data-dir ${options.dataDir} · tabla ${options.tableFile}`)
  printPlan(homes, { table, plans, skillsOwner }, secrets, shared)

  if (!options.apply) {
    console.log('DRY RUN: no se escribió la tabla, no se cambió ningún propietario ni modo.')
    return 0
  }

  const record = {
    version: 1,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'started',
    dataDir: options.dataDir,
    tableFile: options.tableFile,
    base: TENANT_UID_BASE,
    homes: plans.map(home => ({
      name: home.name,
      path: home.full,
      before: home.before,
      target: { uid: home.entry.uid, gid: home.entry.gid, mode: HOME_MODE },
    })),
    reserved: homes.reserved.map(home => ({ name: home.name, path: home.full, before: snapshot(home.full) })),
    secrets: secrets.map(secret => ({
      path: secret.path,
      before: secret.before,
      target: secret.before === null ? null : { uid: 0, gid: 0, mode: SECRET_MODE },
    })),
    shared: shared.map(entry => ({
      path: entry.path,
      isDir: entry.isDir,
      before: entry.before,
      target: entry.before === null ? null : (entry.isDir ? SHARED_DIR_MODE : SHARED_FILE_MODE),
    })),
    sharedSkills: skillsOwner === null
      ? null
      : {
          path: skillsOwner.path,
          owner: skillsOwner.email,
          id: skillsOwner.id,
          before: skillsOwner.before,
          target: { uid: skillsOwner.entry.uid, gid: skillsOwner.entry.gid, mode: SKILLS_DIR_MODE },
        },
    applied: { homes: [], secrets: [], shared: [], sharedSkills: null },
    failure: null,
  }
  writeRecord(options.recordFile, record)
  console.log(`Registro de la corrida: ${options.recordFile}`)

  for (const home of plans) {
    const unchanged = home.before !== null && home.before.uid === home.entry.uid
      && home.before.gid === home.entry.gid && home.before.mode === HOME_MODE
    if (unchanged) {
      console.log(`  ${home.name} sin cambios`)
      continue
    }
    const result = adoptHomeOwnership(home.full, home.entry.uid, home.entry.gid)
    if (result.failed > 0) {
      record.status = 'failed'
      record.failure = { stage: 'chown', home: home.full, errors: result.errors, failed: result.failed }
      record.finishedAt = new Date().toISOString()
      writeRecord(options.recordFile, record)
      throw new Error(`chown de ${home.full} falló en ${result.failed} entrada(s): ${result.errors.join(' | ')}`)
    }
    fs.chmodSync(home.full, 0o700)
    record.applied.homes.push({ path: home.full, uid: home.entry.uid, gid: home.entry.gid, changed: result.changed, ms: result.ms })
    console.log(`  ${home.name} -> ${home.entry.uid}:${home.entry.gid} 0700 (${result.changed} entrada(s), ${result.ms} ms)`)
  }

  for (const secret of secrets) {
    if (secret.before === null) continue
    if (secret.before.uid === 0 && secret.before.gid === 0 && secret.before.mode === SECRET_MODE) {
      console.log(`  ${secret.path} sin cambios`)
      continue
    }
    fs.chownSync(secret.path, 0, 0)
    fs.chmodSync(secret.path, 0o600)
    record.applied.secrets.push({ path: secret.path, mode: SECRET_MODE })
    console.log(`  ${secret.path} -> 0:0 0600`)
  }

  for (const entry of shared) {
    if (entry.before === null) continue
    // El catálogo global tiene su propio dueño y modo: lo decide el paso
    // siguiente, no la regla genérica de datos compartidos.
    if (skillsOwner !== null && entry.path === skillsOwner.path) continue
    const target = entry.isDir ? SHARED_DIR_MODE : SHARED_FILE_MODE
    if (entry.before.mode === target) continue
    fs.chmodSync(entry.path, Number.parseInt(target, 8))
    record.applied.shared.push({ path: entry.path, mode: target })
    console.log(`  ${entry.path} -> ${target} (datos compartidos legibles por el hijo)`)
  }

  // El catálogo global lo escribe desde el panel el Admin/CEO con su propio uid.
  // `2775` deja leer a todos y escribir solo al dueño y a su grupo (el suyo),
  // que es la ruta más estrecha que mantiene "lo que un Admin edita vale para
  // todos" sin abrir el catálogo a cualquier inquilino.
  if (skillsOwner === null) {
    console.log('  AVISO: sin Admin/CEO en la tabla, el catálogo global queda en root: editar skills desde el panel fallará con EACCES')
  } else {
    const before = skillsOwner.before
    const unchanged = before !== null && before.uid === skillsOwner.entry.uid
      && before.gid === skillsOwner.entry.gid && before.mode === SKILLS_DIR_MODE
    if (unchanged) {
      console.log(`  ${skillsOwner.path} sin cambios (dueño ${skillsOwner.email})`)
    } else if (before === null) {
      console.log(`  ${skillsOwner.path} no existe: se omite`)
    } else {
      fs.chownSync(skillsOwner.path, skillsOwner.entry.uid, skillsOwner.entry.gid)
      fs.chmodSync(skillsOwner.path, Number.parseInt(SKILLS_DIR_MODE, 8))
      record.applied.sharedSkills = { path: skillsOwner.path, uid: skillsOwner.entry.uid, gid: skillsOwner.entry.gid, mode: SKILLS_DIR_MODE }
      console.log(`  ${skillsOwner.path} -> ${skillsOwner.entry.uid}:${skillsOwner.entry.gid} ${SKILLS_DIR_MODE} (dueño ${skillsOwner.email})`)
    }
  }

  // La tabla se escribe al final: su presencia es lo que habilita el modo uid en
  // el gateway, así que no debe existir si algún home quedó a medias.
  writeTenantUidTable(options.tableFile, table)
  console.log(`Tabla de uids escrita: ${options.tableFile} (${Object.keys(table.tenants).length} inquilino(s))`)

  record.status = 'completed'
  record.finishedAt = new Date().toISOString()
  writeRecord(options.recordFile, record)
  console.log('MIGRACIÓN COMPLETA')
  return 0
}

/**
 * Revierte una corrida: devuelve cada home a `root:root` y a su modo anterior,
 * restaura los modos de los secretos y aparta la tabla de uids para que un
 * gateway en modo uid no arranque con homes ya devueltos a root.
 * @param {{ apply: boolean, recordFile?: string, rollback?: string }} options - opciones ya normalizadas.
 * @returns {number} código de salida del proceso.
 */
function rollback(options) {
  const record = JSON.parse(fs.readFileSync(/** @type {string} */ (options.rollback), 'utf8'))
  if (record.version !== 1 || !Array.isArray(record.homes)) {
    throw new Error(`${options.rollback} no es un registro de harden-homes`)
  }
  console.log(options.apply ? 'MODO: --apply (revirtiendo)' : 'MODO: dry run del rollback (nada se escribe)')
  for (const home of record.homes) {
    const before = home.before
    if (before === null) {
      console.log(`  ${home.path} no existía al migrar: se omite`)
      continue
    }
    console.log(`  ${home.path} ${before.uid}:${before.gid} ${before.mode}`)
  }
  for (const secret of record.secrets ?? []) {
    if (secret.before === null) continue
    console.log(`  ${secret.path} ${secret.before.uid}:${secret.before.gid} ${secret.before.mode}`)
    if (!options.apply) continue
    fs.chownSync(secret.path, secret.before.uid, secret.before.gid)
    fs.chmodSync(secret.path, Number.parseInt(secret.before.mode, 8))
  }
  for (const entry of record.shared ?? []) {
    if (entry.before === null) continue
    console.log(`  ${entry.path} ${entry.before.uid}:${entry.before.gid} ${entry.before.mode}`)
    if (!options.apply) continue
    fs.chmodSync(entry.path, Number.parseInt(entry.before.mode, 8))
  }
  const skills = record.sharedSkills
  if (skills !== null && skills !== undefined && skills.before !== null) {
    console.log(`  ${skills.path} ${skills.before.uid}:${skills.before.gid} ${skills.before.mode} (dueño ${skills.owner})`)
    if (options.apply) {
      fs.chownSync(skills.path, skills.before.uid, skills.before.gid)
      fs.chmodSync(skills.path, Number.parseInt(skills.before.mode, 8))
    }
  }
  if (!options.apply) {
    console.log('DRY RUN: el rollback no cambió nada.')
    return 0
  }
  for (const home of record.homes) {
    const before = home.before
    if (before === null || !fs.existsSync(home.path)) continue
    const result = adoptHomeOwnership(home.path, before.uid, before.gid)
    if (result.failed > 0) {
      throw new Error(`rollback de ${home.path} falló en ${result.failed} entrada(s): ${result.errors.join(' | ')}`)
    }
    fs.chmodSync(home.path, Number.parseInt(before.mode, 8))
    console.log(`  ${home.path} -> ${before.uid}:${before.gid} ${before.mode} (${result.changed} entrada(s))`)
  }
  const tableFile = record.tableFile
  if (typeof tableFile === 'string' && fs.existsSync(tableFile)) {
    const aside = `${tableFile}.rollback-${Date.now()}`
    fs.renameSync(tableFile, aside)
    console.log(`  tabla de uids apartada en ${aside}: el gateway debe arrancar sin HARNESS_TENANT_UID=1 o fallará por tabla ausente`)
  }
  console.log('ROLLBACK COMPLETO')
  return 0
}

/**
 * Entrada del script.
 * @returns {void}
 */
function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  const code = options.rollback === undefined ? migrate(options) : rollback(options)
  process.exitCode = code
}

// Se ejecuta solo como CLI: los tests importan `resolveGlobalSkillsOwner` de
// este módulo y no deben disparar una migración.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(`FATAL: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
