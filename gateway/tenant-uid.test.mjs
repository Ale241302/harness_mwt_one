/**
 * El aislamiento por uid de inquilino: la tabla que asigna `30000 + slot`, lo
 * que no es un home, y el entorno que recibe el `dsh`. El gateway no se puede
 * arrancar en un test (necesita el despliegue), así que se prueban el módulo
 * real y las funciones puras recortadas del `server.mjs` que se envía, igual
 * que en `tools-mode.test.mjs`.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  TENANT_UID_BASE,
  adoptHomeOwnership,
  assignTenantUid,
  emptyTenantUidTable,
  isReservedHomeName,
  parseTenantUidTable,
  readTenantUidTable,
  tenantUidForSlot,
  uidForHomeId,
  writeTenantUidTable,
} from './tenant-uids.mjs'
import { resolveGlobalSkillsOwner } from '../scripts/harden-homes.mjs'

const source = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8')

/** Slice `function <name>(...) { ... }` out of the shipped source. */
function shippedFunction(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `server.mjs no define ${name}()`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`server.mjs: ${name}() no cierra`)
}

const deny = source.match(/const CHILD_ENV_DENY = new Set\(\[[^\]]*\]\)/u)
assert.ok(deny, 'server.mjs no declara CHILD_ENV_DENY')
const { stripChildSecrets } = new Function(`${deny[0]}
${shippedFunction('stripChildSecrets')}
return { stripChildSecrets }
`)()

test('un slot produce uid y gid 30000 + slot, y un slot fuera de rango lanza', () => {
  assert.deepEqual(tenantUidForSlot(1), { uid: 30001, gid: 30001, slot: 1 })
  assert.deepEqual(tenantUidForSlot(999), { uid: 30999, gid: 30999, slot: 999 })
  assert.throws(() => tenantUidForSlot(0), /fuera de rango/u)
  assert.throws(() => tenantUidForSlot(1000), /fuera de rango/u)
  assert.throws(() => tenantUidForSlot(1.5), /fuera de rango/u)
})

test('los nombres reservados no son homes de inquilino', () => {
  assert.equal(isReservedHomeName('shared'), true)
  assert.equal(isReservedHomeName('tenants'), true)
  assert.equal(isReservedHomeName('98fd3a06-ac69-446b-a4b8-ae18b2524f4b'), false)
})

test('asignar es idempotente y reutiliza el slot de la tabla', () => {
  const table = emptyTenantUidTable()
  const first = assignTenantUid(table, 'a')
  assert.deepEqual(first, { uid: 30001, gid: 30001, slot: 1 })
  assert.deepEqual(assignTenantUid(table, 'b'), { uid: 30002, gid: 30002, slot: 2 })
  // Quien ya está en la tabla se resuelve, no se reasigna.
  assert.deepEqual(uidForHomeId(table, 'a'), first)
  assert.deepEqual(uidForHomeId(table, 'b'), { uid: 30002, gid: 30002, slot: 2 })
  assert.equal(uidForHomeId(table, 'c'), null)
  const again = assignTenantUid(table, 'c')
  assert.equal(again.slot, 3)
})

test('una tabla inválida lanza en vez de asignar uids a ciegas', () => {
  const valid = { version: 1, base: TENANT_UID_BASE, tenants: { a: { uid: 30001, gid: 30001, slot: 1 } } }
  assert.deepEqual(parseTenantUidTable(valid), valid)
  assert.throws(() => parseTenantUidTable({ version: 2, base: TENANT_UID_BASE, tenants: {} }), /versión/u)
  assert.throws(() => parseTenantUidTable({ version: 1, base: 20000, tenants: {} }), /base/u)
  assert.throws(() => parseTenantUidTable({ version: 1, base: TENANT_UID_BASE, tenants: { a: { uid: 30001, gid: 30002, slot: 1 } } }), /inconsistente/u)
  assert.throws(() => parseTenantUidTable({ version: 1, base: TENANT_UID_BASE, tenants: { a: { uid: 30001, gid: 30001, slot: 1 }, b: { uid: 30001, gid: 30001, slot: 1 } } }), /repetido/u)
  assert.throws(() => parseTenantUidTable({ version: 1, base: TENANT_UID_BASE, tenants: { '../x': { uid: 30001, gid: 30001, slot: 1 } } }), /clave/u)
})

test('la tabla se lee y se escribe sin perder inquilinos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-uids-'))
  const file = path.join(dir, 'tenant-uids.json')
  assert.equal(readTenantUidTable(file), null)
  const table = emptyTenantUidTable()
  assignTenantUid(table, 'a')
  assignTenantUid(table, 'b')
  writeTenantUidTable(file, table)
  assert.deepEqual(readTenantUidTable(file), table)
  // Windows no aplica los bits POSIX: el 0600 se comprueba donde existe.
  if (process.platform !== 'win32') {
    assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600')
  }
  // Una segunda escritura con los mismos datos no cambia la tabla.
  writeTenantUidTable(file, table)
  assert.deepEqual(readTenantUidTable(file), table)
})

test('el hijo recibe todo menos las tres credenciales que no necesita', () => {
  const env = {
    SESSION_SECRET: 'x',
    DATABASE_URL: 'postgres://x',
    MEMORY_ADMIN_KEY: 'x',
    FABERLOOM_MIRROR_KEY: 'mirror',
    FABERLOOM_CEO_SIGNERS: 'ceo@mwt.one',
    DSH_HOME: '/data/users/a',
    HOME: '/data/users/a',
    MWT_MCP_GATEWAY_KEY: 'k',
    DEEPSEEK_API_KEY: 'k',
    DSH_PERMISSION_MODE: 'danger-full-access',
    VACIA: undefined,
  }
  const child = stripChildSecrets(env)
  for (const denied of ['SESSION_SECRET', 'DATABASE_URL', 'MEMORY_ADMIN_KEY']) {
    assert.equal(Object.hasOwn(child, denied), false, `${denied} llegó al hijo`)
  }
  // El espejo del escritorio y la lista de firmantes sí son del hijo: sin ellos
  // se rompen el espejo y la aceptación del CEO.
  assert.equal(child.FABERLOOM_MIRROR_KEY, 'mirror')
  assert.equal(child.FABERLOOM_CEO_SIGNERS, 'ceo@mwt.one')
  assert.equal(child.DSH_HOME, '/data/users/a')
  assert.equal(child.HOME, '/data/users/a')
  assert.equal(child.MWT_MCP_GATEWAY_KEY, 'k')
  assert.equal(child.DEEPSEEK_API_KEY, 'k')
  assert.equal(child.DSH_PERMISSION_MODE, 'danger-full-access')
  assert.equal(Object.hasOwn(child, 'VACIA'), false)
  assert.equal(Object.hasOwn(env, 'SESSION_SECRET'), true, 'la función no debe modificar el entorno del gateway')
})

test('la cesión de propiedad recorre el home sin seguir symlinks', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-home-'))
  fs.mkdirSync(path.join(home, 'storages'))
  fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), '{}')
  fs.writeFileSync(path.join(home, '.board-token'), 'x')
  fs.symlinkSync('/etc/passwd', path.join(home, 'enlace'))
  const target = process.getuid() === 0 ? 30001 : process.getuid()
  const result = adoptHomeOwnership(home, target, target)
  assert.equal(result.failed, 0)
  assert.ok(result.changed >= 4)
  assert.equal(fs.lstatSync(path.join(home, 'storages', 'workspace.json')).uid, target)
  // El enlace se cede a sí mismo, nunca a su destino.
  assert.equal(fs.lstatSync(path.join(home, 'enlace')).uid, target)
  assert.equal(fs.statSync('/etc/passwd').uid, 0)
  // Correrlo otra vez no cambia nada.
  const again = adoptHomeOwnership(home, target, target)
  assert.equal(again.changed, 0)
})

test('el gateway arranca el dsh con el uid del inquilino y sin las credenciales de despliegue', () => {
  // El uid/gid solo viaja cuando la tabla resolvió un inquilino.
  assert.match(source, /const tenant = tenantUidFor\(user\)/u)
  assert.match(source, /if \(tenant\) adoptTenantHome\(home, tenant\)/u)
  assert.match(source, /\.\.\.\(tenant \? \{ uid: tenant\.uid, gid: tenant\.gid \} : \{\}\)/u)
  // El entorno se filtra por la lista de denegación; la llave del espejo se
  // pasa explícita porque el MCP local del inquilino la valida.
  assert.match(source, /env: stripChildSecrets\(\{/u)
  assert.match(source, /\.\.\.\(cfg\.mirrorKey \? \{ FABERLOOM_MIRROR_KEY: cfg\.mirrorKey \} : \{\}\)/u)
  // Un inquilino nuevo recibe su uid y su entrada de passwd.
  assert.match(source, /const entry = assignTenantUid\(tenantUid\.table, user\.id\)/u)
  assert.match(source, /writeTenantUidTable\(tenantUid\.file, tenantUid\.table\)/u)
  assert.match(source, /ensureTenantPasswdEntry\(user\.id, entry\)/u)
  // Pedir el modo sin tabla ni jaula aborta el arranque.
  assert.match(source, /if \(table === null\) \{\s*console\.error\(`\[gateway\] FATAL: HARNESS_TENANT_UID=1 y no existe \$\{file\}/u)
})

test('el catálogo global de skills va al primer Admin/CEO de la tabla', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-owner-'))
  const dataDir = path.join(dir, 'users')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(path.join(dir, 'shared', 'skills'), { recursive: true })
  const table = emptyTenantUidTable()
  assignTenantUid(table, 'b2b')
  assignTenantUid(table, 'admin')
  assignTenantUid(table, 'ceo')
  const users = {
    users: {
      'cli@mwt.one': { id: 'cli', role: 'client_b2b' },
      'jefe@mwt.one': { id: 'admin', role: 'Admin' },
      'dueno@mwt.one': { id: 'ceo', role: 'ceo' },
      'fuera@mwt.one': { id: 'fuera-de-la-tabla', role: 'superadmin' },
    },
  }
  fs.writeFileSync(path.join(dir, 'gateway-users.json'), JSON.stringify(users))
  const owner = resolveGlobalSkillsOwner(dataDir, table)
  assert.equal(owner.email, 'jefe@mwt.one')
  assert.equal(owner.id, 'admin')
  assert.deepEqual(owner.entry, uidForHomeId(table, 'admin'))
  assert.equal(owner.path, path.join(dir, 'shared', 'skills'))
  // Sin Admin/CEO en la tabla no hay dueño: el directorio se queda en root.
  const sinAdmin = emptyTenantUidTable()
  assignTenantUid(sinAdmin, 'b2b')
  assert.equal(resolveGlobalSkillsOwner(dataDir, sinAdmin), null)
})
