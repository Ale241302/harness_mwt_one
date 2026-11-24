/**
 * Tabla de uid/gid por inquilino y las operaciones que la leen.
 *
 * El gateway arranca un `dsh` por usuario dentro de un contenedor donde todo
 * corre como root, y root ignora los permisos: un agente con shell lee el home
 * de otro inquilino aunque el directorio esté en `0700`. Este módulo es la
 * única fuente del identificador con el que cada hijo deja de ser root:
 *
 * - La tabla vive en `<dir de DATA_DIR>/tenant-uids.json` (por defecto
 *   `/data/tenant-uids.json`) y la escribe `scripts/harden-homes.mjs` con
 *   `--apply`, o el gateway cuando aparece un inquilino que la tabla aún no
 *   nombra (una sola escritura atómica por inquilino nuevo).
 * - El uid y el gid son el mismo número, `30000 + slot`, fuera del rango que
 *   asignan las imágenes base.
 * - `shared` y `tenants` no son homes de inquilino: el primero es el
 *   directorio compartido del despliegue dentro de `DATA_DIR`, y el segundo el
 *   segmento reservado de `gateway/tenant-home.mjs` cuando varios usuarios
 *   comparten casa. Ninguno recibe uid propio.
 *
 * Quien lea este módulo desde `scripts/` tiene que poder importarlo en el
 * contenedor en marcha antes de que el gateway se actualice; por eso no
 * importa nada más que `node:fs` y `node:path`.
 */

import fs from 'node:fs'
import path from 'node:path'

/** Primer uid del rango de inquilinos. */
export const TENANT_UID_BASE = 30000

/** Último slot asignable; deja 30001..30999 para inquilinos. */
export const TENANT_UID_MAX_SLOT = 999

/** Versión del documento de la tabla. */
export const TENANT_UID_TABLE_VERSION = 1

/** Nombres de `DATA_DIR` que no son homes de inquilino. */
export const RESERVED_HOME_NAMES = Object.freeze(['shared', 'tenants'])

/**
 * Si un nombre de directorio de `DATA_DIR` está reservado y no recibe uid.
 * @param {string} name - nombre del directorio, sin ruta.
 * @returns {boolean} true cuando es `shared` o `tenants`.
 */
export function isReservedHomeName(name) {
  return RESERVED_HOME_NAMES.includes(name)
}

/**
 * El uid/gid que corresponde a un slot.
 * @param {number} slot - slot del inquilino, 1..999.
 * @returns {{ uid: number, gid: number, slot: number }} identificador del inquilino.
 * @throws {Error} cuando el slot no es un entero dentro del rango.
 */
export function tenantUidForSlot(slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > TENANT_UID_MAX_SLOT) {
    throw new Error(`slot de inquilino fuera de rango: ${String(slot)}`)
  }
  return { uid: TENANT_UID_BASE + slot, gid: TENANT_UID_BASE + slot, slot }
}

/**
 * Valida y devuelve la tabla ya normalizada.
 * @param {unknown} value - documento leído de disco o recién construido.
 * @param {string} [source] - ruta, solo para el mensaje de error.
 * @returns {{ version: number, base: number, tenants: Record<string, { uid: number, gid: number, slot: number }> }} tabla normalizada.
 * @throws {Error} cuando el documento no tiene la forma esperada o repite un uid.
 */
export function parseTenantUidTable(value, source) {
  const where = source ? ` en ${source}` : ''
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`la tabla de uids no es un objeto${where}`)
  }
  const table = /** @type {Record<string, unknown>} */ (value)
  if (table.version !== TENANT_UID_TABLE_VERSION) {
    throw new Error(`versión de tabla de uids no soportada${where}: ${String(table.version)}`)
  }
  if (table.base !== TENANT_UID_BASE) {
    throw new Error(`base de tabla de uids no soportada${where}: ${String(table.base)} (se espera ${TENANT_UID_BASE})`)
  }
  const raw = table.tenants
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`la tabla de uids no trae \`tenants\`${where}`)
  }
  const tenants = {}
  const used = new Set()
  for (const [id, entry] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
    if (id.trim().length === 0 || id.includes('/') || id === '.' || id === '..') {
      throw new Error(`clave de inquilino no válida en la tabla de uids${where}: ${JSON.stringify(id)}`)
    }
    if (entry === null || typeof entry !== 'object') {
      throw new Error(`entrada de inquilino no válida${where}: ${id}`)
    }
    const { uid, gid, slot } = /** @type {{ uid?: unknown, gid?: unknown, slot?: unknown }} */ (entry)
    if (!Number.isInteger(uid) || uid !== gid || uid !== TENANT_UID_BASE + Number(slot)) {
      throw new Error(`entrada de inquilino inconsistente${where}: ${id} (${String(uid)}:${String(gid)} slot ${String(slot)})`)
    }
    if (Number(slot) < 1 || Number(slot) > TENANT_UID_MAX_SLOT) {
      throw new Error(`slot fuera de rango${where}: ${id} (${String(slot)})`)
    }
    if (used.has(uid)) throw new Error(`uid repetido en la tabla${where}: ${String(uid)}`)
    used.add(uid)
    tenants[id] = { uid: Number(uid), gid: Number(uid), slot: Number(slot) }
  }
  return { version: TENANT_UID_TABLE_VERSION, base: TENANT_UID_BASE, tenants }
}

/**
 * Tabla vacía, con la forma que acepta `parseTenantUidTable`.
 * @returns {{ version: number, base: number, tenants: Record<string, never> }} tabla sin inquilinos.
 */
export function emptyTenantUidTable() {
  return { version: TENANT_UID_TABLE_VERSION, base: TENANT_UID_BASE, tenants: {} }
}

/**
 * Lee la tabla del disco.
 * @param {string} file - ruta de `tenant-uids.json`.
 * @returns {{ version: number, base: number, tenants: Record<string, { uid: number, gid: number, slot: number }> } | null} la tabla, o null si el archivo no existe.
 * @throws {Error} cuando el archivo existe y no se puede leer o no valida.
 */
export function readTenantUidTable(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw new Error(`no se pudo leer la tabla de uids ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseTenantUidTable(JSON.parse(text), file)
}

/**
 * Escribe la tabla de forma atómica (temporal en el mismo directorio y rename).
 * @param {string} file - ruta de `tenant-uids.json`.
 * @param {{ version: number, base: number, tenants: Record<string, { uid: number, gid: number, slot: number }> }} table - tabla a persistir.
 * @returns {void}
 */
export function writeTenantUidTable(file, table) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(table, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
}

/**
 * La entrada de un inquilino, si la tabla lo nombra.
 * @param {{ tenants: Record<string, { uid: number, gid: number, slot: number }> }} table - tabla vigente.
 * @param {string} id - id del inquilino (nombre del home bajo `DATA_DIR`).
 * @returns {{ uid: number, gid: number, slot: number } | null} entrada, o null cuando no está.
 */
export function uidForHomeId(table, id) {
  return Object.hasOwn(table.tenants, id) ? table.tenants[id] : null
}

/**
 * Asigna el primer slot libre a un inquilino que la tabla no nombra. No escribe
 * el archivo: el llamador decide cuándo persistir.
 * @param {{ tenants: Record<string, { uid: number, gid: number, slot: number }> }} table - tabla vigente; se modifica.
 * @param {string} id - id del inquilino.
 * @returns {{ uid: number, gid: number, slot: number }} entrada asignada.
 * @throws {Error} cuando no queda slot libre.
 */
export function assignTenantUid(table, id) {
  const used = new Set(Object.values(table.tenants).map(entry => entry.slot))
  for (let slot = 1; slot <= TENANT_UID_MAX_SLOT; slot++) {
    if (used.has(slot)) continue
    const entry = tenantUidForSlot(slot)
    table.tenants[id] = entry
    return entry
  }
  throw new Error(`sin slots de uid libres para ${id} (rango ${TENANT_UID_BASE + 1}..${TENANT_UID_BASE + TENANT_UID_MAX_SLOT})`)
}

/**
 * Cede al inquilino todo lo que haya dentro de su home.
 *
 * Hace falta en cada arranque y no solo en la migración: el gateway escribe
 * como root dentro del home (`harness.patch.yml`, `.board-token`,
 * `.consola-token`, `.agent-presets`, los directorios de Workspace recreados) y
 * un archivo `0600 root` o un directorio `0755 root` deja al hijo sin poder
 * leer su token o escribir en su propio espacio. Se recorren los enlaces sin
 * seguirlos (`lchown`) para no tocar nunca el destino de un symlink.
 *
 * @param {string} home - raíz del home del inquilino.
 * @param {number} uid - uid del inquilino.
 * @param {number} gid - gid del inquilino.
 * @returns {{ changed: number, failed: number, errors: string[], ms: number }} entradas corregidas, fallidas y sus mensajes.
 */
export function adoptHomeOwnership(home, uid, gid) {
  const startedAt = Date.now()
  let changed = 0
  let failed = 0
  const errors = []
  const claim = entryPath => {
    try {
      const stat = fs.lstatSync(entryPath)
      if (stat.uid === uid && stat.gid === gid) return
      fs.lchownSync(entryPath, uid, gid)
      changed += 1
    } catch (error) {
      failed += 1
      if (errors.length < 5) errors.push(`${entryPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  claim(home)
  const stack = [home]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      failed += 1
      if (errors.length < 5) errors.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name)
      claim(entryPath)
      if (entry.isDirectory()) stack.push(entryPath)
    }
  }
  return { changed, failed, errors, ms: Date.now() - startedAt }
}
