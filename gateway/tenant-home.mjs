/**
 * Nombre de la casa y de la instancia de un tenant (Opción B).
 *
 * El gateway arranca hoy un proceso `dsh` por usuario, con `<dataDir>/<user.id>`
 * como `DSH_HOME`. La Opción B le da a cada tenant un solo proceso y una sola
 * casa: los usuarios del mismo tenant comparten sesiones, credenciales,
 * `storages` y servidor MCP. Este módulo decide esos dos nombres y nada más: no
 * crea directorios, no lee `process.env` por su cuenta y no arranca procesos.
 *
 * `gateway/server.mjs` sigue siendo el dueño del arranque. Llama a `homeFor` y a
 * `instanceKeyFor` donde hoy compone `path.join(dataDir, user.id)` y donde usa
 * `user.id` como clave del mapa `instances`. Con el flag apagado, que es el
 * valor por defecto, las dos funciones devuelven exactamente lo que el servidor
 * compone hoy: activar y revertir es cambiar una variable y reiniciar.
 *
 * La Opción B no es multi-tenant: no hay tenant por request, ni RLS, ni
 * identidad de auditoría por usuario dentro del proceso compartido. El único
 * aislamiento es el límite del proceso. Antes de activarla, leer los riesgos y
 * el criterio de activación de `ADRs_MESA/ADR-005-proceso-por-tenant.md`.
 */

import path from 'node:path'

/** Segmento de ruta admitido como clave de tenant: sin separadores ni `.`/`..`. */
const TENANT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Tope de longitud de una clave, muy por encima de cualquier id real. */
const TENANT_KEY_MAX_LENGTH = 128

/** Directorio, dentro de `DATA_DIR`, donde viven las casas compartidas. */
const TENANTS_DIR = 'tenants'

/**
 * Campos del usuario que pueden nombrar su tenant, en orden de precedencia.
 * `tenantId` es el campo propio; `legalEntityIds[0]` es el sustituto mientras la
 * consola no lo emita; `id` mantiene un despliegue de un solo tenant en pie.
 */
const TENANT_FIELDS = [
  { name: 'tenantId', read: user => user.tenantId },
  { name: 'legalEntityIds[0]', read: user => (Array.isArray(user.legalEntityIds) ? user.legalEntityIds[0] : undefined) },
  { name: 'id', read: user => user.id },
]

/** Un valor que puede ser un nombre de directorio, sin normalizarlo. */
function isDirectoryName(value) {
  // El patrón termina en `$`, que también casa antes de un salto final; exigir
  // que el valor ya esté recortado cierra ese hueco por sí solo.
  return value === value.trim() && value.length <= TENANT_KEY_MAX_LENGTH && TENANT_KEY_PATTERN.test(value)
}

/**
 * Clave de tenant de un usuario.
 *
 * Precedencia: `tenantId`, después `legalEntityIds[0]`, después `id`. Un campo
 * vacío o ausente pasa al siguiente; un campo presente que no sirve como nombre
 * de directorio lanza, porque caer al siguiente movería al usuario de casa sin
 * un error visible. Se recorta el espacio de los extremos y no se normaliza
 * nada más: dos claves que normalizaran al mismo nombre compartirían casa.
 *
 * @param {{ tenantId?: unknown, legalEntityIds?: unknown, id?: unknown }} user - the user record the gateway holds; missing fields fall through.
 * @returns {string} the tenant key, usable as one directory name.
 * @throws {Error} when no field names the tenant, or a present field is unusable.
 */
export function tenantKey(user) {
  const source = user !== null && typeof user === 'object' ? user : {}
  for (const field of TENANT_FIELDS) {
    const raw = field.read(source)
    if (raw === undefined || raw === null) continue
    if (typeof raw !== 'string') {
      throw new Error(`el campo ${field.name} del usuario no es texto: ${typeof raw}`)
    }
    const value = raw.trim()
    if (value.length === 0) continue
    if (!isDirectoryName(value)) {
      throw new Error(`el campo ${field.name} no sirve como nombre de directorio: ${JSON.stringify(raw)}`)
    }
    return value
  }
  throw new Error('el usuario no tiene tenantId, legalEntityIds[0] ni id con el que nombrar su casa')
}

/**
 * El `DSH_HOME` que comparte un tenant: `<dataDir>/tenants/<clave>`.
 *
 * La casa se anida bajo `tenants/` para que nunca coincida con
 * `<dataDir>/<user.id>`: activar o revertir el flag no pisa un home existente.
 *
 * @param {string} dataDir - the gateway users root (`DATA_DIR`).
 * @param {{ tenantId?: unknown, legalEntityIds?: unknown, id?: unknown }} user - the user whose tenant names the home.
 * @returns {string} the absolute path of the shared home.
 * @throws {Error} when the tenant key cannot be derived or is unusable.
 */
export function tenantHome(dataDir, user) {
  return path.join(dataDir, TENANTS_DIR, tenantKey(user))
}

/**
 * Clave del mapa `instances` cuando las casas se comparten: el tenant, no el
 * usuario. Dos usuarios del mismo tenant resuelven a la misma clave y por lo
 * tanto al mismo proceso.
 *
 * @param {{ tenantId?: unknown, legalEntityIds?: unknown, id?: unknown }} user - the user whose tenant names the key.
 * @returns {string} the tenant key, never a path.
 * @throws {Error} when the tenant key cannot be derived or is unusable.
 */
export function tenantInstanceKey(user) {
  return tenantKey(user)
}

/**
 * Si el gateway comparte casa y proceso por tenant.
 *
 * Solo el literal `'1'` lo activa: `'true'`, `'0'`, un valor ausente o un
 * `process.env` sin la variable dejan el comportamiento por usuario que se
 * despliega hoy.
 *
 * @param {Record<string, string | undefined>} [env] - the deployment environment, usually `process.env`.
 * @returns {boolean} true when `FABERLOOM_TENANT_HOME` is exactly `'1'`.
 */
export function shouldShareTenantHome(env) {
  return env?.FABERLOOM_TENANT_HOME === '1'
}

/**
 * El `DSH_HOME` que le toca a un usuario.
 *
 * Con el flag apagado devuelve `path.join(dataDir, user.id)`, la misma ruta que
 * `startInstance` compone hoy y sin sanear el id, para que apagarlo reproduzca
 * el despliegue actual tal cual. Con el flag encendido devuelve `tenantHome`.
 *
 * @param {string} dataDir - the gateway users root (`DATA_DIR`).
 * @param {{ tenantId?: unknown, legalEntityIds?: unknown, id?: unknown }} user - the user the request is for.
 * @param {Record<string, string | undefined>} [env] - the deployment environment, usually `process.env`.
 * @returns {string} the home this user must use.
 * @throws {Error} when the user has no usable id and the flag is off.
 */
export function homeFor(dataDir, user, env) {
  return shouldShareTenantHome(env) ? tenantHome(dataDir, user) : path.join(dataDir, legacyUserKey(user))
}

/**
 * Clave del mapa `instances` que le toca a un usuario.
 *
 * Existe para que la rama del flag viva en un solo sitio: el mapa se lee y se
 * escribe en una decena de puntos de `server.mjs`, y una copia de la condición
 * en cada uno es la forma segura de que dos de ellos dejen de coincidir.
 *
 * @param {{ tenantId?: unknown, legalEntityIds?: unknown, id?: unknown }} user - the user the request is for.
 * @param {Record<string, string | undefined>} [env] - the deployment environment, usually `process.env`.
 * @returns {string} the tenant key with the flag on, the user id with it off.
 * @throws {Error} when the key cannot be derived.
 */
export function instanceKeyFor(user, env) {
  return shouldShareTenantHome(env) ? tenantInstanceKey(user) : legacyUserKey(user)
}

/**
 * La clave por usuario que el servidor usa hoy.
 *
 * No recorta ni sanea el id: la ruta resultante tiene que ser idéntica a la que
 * compone `server.mjs`, incluido un id con espacios. Solo se rechaza el id
 * vacío, que hoy reventaría en `path.join` con un mensaje peor.
 *
 * @param {{ id?: unknown }} user - the user record.
 * @returns {string} the raw user id.
 * @throws {Error} when the id is missing or blank.
 */
function legacyUserKey(user) {
  const id = user !== null && typeof user === 'object' ? user.id : undefined
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('el usuario no tiene id con el que nombrar su home por usuario')
  }
  return id
}
