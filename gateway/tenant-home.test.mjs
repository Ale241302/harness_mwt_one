/**
 * La Opción B nombra una casa y una instancia por tenant, y el gateway decide
 * con esas dos respuestas si comparte o no el proceso `dsh`. Estas pruebas fijan
 * las tres promesas de las que depende: dos usuarios del mismo tenant caen en
 * el mismo proceso, dos tenants no se tocan, y con el flag apagado la ruta es
 * la de siempre.
 *
 * Se ejecuta solo: `node --test gateway/tenant-home.test.mjs`. El resto de las
 * pruebas del gateway viven en `gateway/tests/*.spec.mjs` bajo vitest; este
 * archivo usa `node:test` para no depender de la inclusión de vitest.
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'

import {
  homeFor,
  instanceKeyFor,
  shouldShareTenantHome,
  tenantHome,
  tenantInstanceKey,
  tenantKey,
} from './tenant-home.mjs'

const DATA_DIR = '/data/users'
const ON = { FABERLOOM_TENANT_HOME: '1' }
const OFF = {}

const alice = { id: 'u-alice', email: 'alice@acme.test', tenantId: 'acme', legalEntityIds: ['acme', 'beta'] }
const bob = { id: 'u-bob', email: 'bob@acme.test', tenantId: 'acme' }
const carol = { id: 'u-carol', email: 'carol@globex.test', tenantId: 'globex' }

describe('clave de tenant', () => {
  it('prefiere tenantId, después legalEntityIds[0], después id', () => {
    assert.equal(tenantKey({ id: 'u', legalEntityIds: ['ent'], tenantId: 'ten' }), 'ten')
    assert.equal(tenantKey({ id: 'u', legalEntityIds: ['ent'] }), 'ent')
    assert.equal(tenantKey({ id: 'u', legalEntityIds: [] }), 'u')
    // Una lista que no es lista no nombra empresa: se cae al id.
    assert.equal(tenantKey({ id: 'u', legalEntityIds: 'ent' }), 'u')
  })

  it('recorta los extremos sin normalizar el resto', () => {
    assert.equal(tenantKey({ tenantId: '  acme  ' }), 'acme')
    assert.equal(tenantKey({ tenantId: 'acme.spa-2' }), 'acme.spa-2')
    // El espacio de los extremos no cambia de tenant; el de dentro sí invalida.
    assert.equal(tenantKey({ tenantId: 'acme\n' }), 'acme')
  })

  it('rechaza un usuario sin ninguna clave', () => {
    for (const user of [{}, { id: '' }, { id: '   ' }, { tenantId: '  ', legalEntityIds: [], id: '' }, null]) {
      assert.throws(() => tenantKey(user), /no tiene tenantId/)
    }
  })

  it('rechaza una clave que no sirve como nombre de directorio', () => {
    for (const raw of ['../../etc', 'a/b', 'a\\b', '..', '.', 'ac\nme', 'x'.repeat(129)]) {
      assert.throws(() => tenantKey({ tenantId: raw }), /no sirve como nombre de directorio/)
    }
    assert.throws(() => tenantKey({ tenantId: 42 }), /no es texto/)
  })

  it('no cae al siguiente campo cuando el primero está roto', () => {
    // Caer al id movería al usuario de casa sin un error visible.
    assert.throws(() => tenantKey({ tenantId: '../x', legalEntityIds: ['acme'], id: 'u' }), /tenantId no sirve/)
  })
})

describe('casa compartida', () => {
  it('dos usuarios del mismo tenant comparten casa y clave de instancia', () => {
    assert.equal(tenantKey(alice), 'acme')
    assert.equal(tenantHome(DATA_DIR, alice), path.join(DATA_DIR, 'tenants', 'acme'))
    assert.equal(tenantHome(DATA_DIR, alice), tenantHome(DATA_DIR, bob))
    assert.equal(tenantInstanceKey(alice), tenantInstanceKey(bob))
    assert.equal(homeFor(DATA_DIR, alice, ON), homeFor(DATA_DIR, bob, ON))
    assert.equal(instanceKeyFor(alice, ON), instanceKeyFor(bob, ON))
  })

  it('dos tenants distintos no comparten casa ni instancia', () => {
    assert.notEqual(tenantHome(DATA_DIR, alice), tenantHome(DATA_DIR, carol))
    assert.notEqual(tenantInstanceKey(alice), tenantInstanceKey(carol))
    assert.notEqual(homeFor(DATA_DIR, alice, ON), homeFor(DATA_DIR, carol, ON))
    assert.notEqual(instanceKeyFor(alice, ON), instanceKeyFor(carol, ON))
  })

  it('la casa del tenant nunca se confunde con la casa por usuario de un id igual', () => {
    const same = { id: 'user-1', tenantId: 'user-1' }
    const shared = homeFor(DATA_DIR, same, ON)
    assert.equal(shared, path.join(DATA_DIR, 'tenants', 'user-1'))
    assert.notEqual(shared, homeFor(DATA_DIR, { id: 'user-1' }, OFF))
  })

  it('sin una clave propia, cada usuario conserva su casa aunque el flag esté encendido', () => {
    // Un despliegue de un solo tenant no gana nada compartiendo por id, pero no
    // debe romperse: cada id cae en su propia casa bajo tenants/.
    assert.equal(homeFor(DATA_DIR, { id: 'u-1' }, ON), path.join(DATA_DIR, 'tenants', 'u-1'))
    assert.notEqual(homeFor(DATA_DIR, { id: 'u-1' }, ON), homeFor(DATA_DIR, { id: 'u-2' }, ON))
  })
})

describe('flag de activación', () => {
  it('solo el literal 1 lo enciende', () => {
    assert.equal(shouldShareTenantHome({ FABERLOOM_TENANT_HOME: '1' }), true)
    assert.equal(shouldShareTenantHome({ ...ON, OTHER: 'x' }), true)
    for (const env of [undefined, {}, { FABERLOOM_TENANT_HOME: 'true' }, { FABERLOOM_TENANT_HOME: '0' }, { FABERLOOM_TENANT_HOME: 'yes' }, { FABERLOOM_TENANT_HOME: '' }]) {
      assert.equal(shouldShareTenantHome(env), false)
    }
  })

  it('apagado devuelve el home por usuario de hoy', () => {
    assert.equal(homeFor(DATA_DIR, alice, OFF), path.join(DATA_DIR, 'u-alice'))
    assert.equal(homeFor(DATA_DIR, bob, OFF), path.join(DATA_DIR, 'u-bob'))
    assert.equal(homeFor(DATA_DIR, alice, undefined), path.join(DATA_DIR, 'u-alice'))
    assert.notEqual(homeFor(DATA_DIR, alice, OFF), homeFor(DATA_DIR, bob, OFF))
    assert.equal(instanceKeyFor(alice, OFF), 'u-alice')
    assert.equal(instanceKeyFor(bob, undefined), 'u-bob')
  })

  it('apagado reproduce la ruta actual sin sanear el id', () => {
    // `startInstance` compone `path.join(dataDir, user.id)` tal cual; apagar el
    // flag tiene que devolver esa misma ruta, espacios incluidos.
    assert.equal(homeFor(DATA_DIR, { id: ' 5072 ' }, OFF), path.join(DATA_DIR, ' 5072 '))
  })

  it('rechaza un id por usuario vacío', () => {
    assert.throws(() => homeFor(DATA_DIR, { id: ' ' }, OFF), /no tiene id/)
    assert.throws(() => instanceKeyFor({}, OFF), /no tiene id/)
  })
})
