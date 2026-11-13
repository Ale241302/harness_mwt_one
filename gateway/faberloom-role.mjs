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
