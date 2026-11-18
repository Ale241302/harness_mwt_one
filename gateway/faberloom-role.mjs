// El rol con el que FaberLoom trata a un usuario de la consola.
//
// La consola administra un inquilino; FaberLoom, cuando el rol es admin, ceo o
// superadmin, lee la cola de todas las empresas de la instalacion. Un Admin/CEO
// de un cliente externo recibia asi el trabajo de MWT.ONE y de los demas
// clientes. Solo los dominios operadores conservan el rol tal cual.

/** Dominios que operan MWT.ONE. */
export const MWT_OPERATOR_DOMAINS = new Set(['muitowork.com'])

/** Roles que la consola entiende como administracion de la instalacion. */
export const INSTALLATION_WIDE_ROLES = new Set(['admin', 'superadmin', 'ceo'])

/**
 * Roles cuya llave compartida responde fuera de MWT.ONE, SICOP y el correo: la
 * administracion de la consola (Admin/CEO) y Marluvas, el socio que trabaja en
 * el mismo producto. El resto de los roles conserva el alcance de producto.
 */
export const UNRESTRICTED_KEY_ROLES = new Set(['admin', 'superadmin', 'ceo', 'marluvas'])

/**
 * @param {object} user - usuario autenticado por la consola.
 * @returns {string} el rol que viaja al parche de dsh.
 */
export function faberloomRole(user) {
  const role = String((user && user.role) || 'client_b2b')
  const email = String((user && user.email) || '').toLowerCase()
  const at = email.lastIndexOf('@')
  const domain = at < 0 ? '' : email.slice(at + 1)
  if (MWT_OPERATOR_DOMAINS.has(domain)) return role
  return INSTALLATION_WIDE_ROLES.has(role.toLowerCase()) ? 'client_b2b' : role
}

/**
 * Si la llave compartida de la cuenta responde fuera de MWT.ONE, SICOP y el
 * correo. Se decide por el rol de la consola, no por el rol degradado que ve el
 * producto: un Admin/CEO con correo externo corre como client_b2b para no leer
 * la cola de otra empresa, pero su llave no queda limitada al alcance de
 * producto. Un rol desconocido o ausente conserva el limite.
 * @param {object} user - usuario autenticado por la consola.
 * @returns {boolean} true cuando la sesion no aplica el alcance de producto.
 */
export function faberloomKeyUnrestricted(user) {
  const role = String((user && user.role) || '').toLowerCase()
  return UNRESTRICTED_KEY_ROLES.has(role)
}
