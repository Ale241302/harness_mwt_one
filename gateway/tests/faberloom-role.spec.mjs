import assert from 'node:assert/strict'
import { test } from 'node:test'
import { faberloomRole } from '../faberloom-role.mjs'

test('an operator domain keeps the console role', () => {
  assert.equal(faberloomRole({ email: 'alvaro@muitowork.com', role: 'admin' }), 'admin')
  assert.equal(faberloomRole({ email: 'Alejandro@MuitoWork.com', role: 'ceo' }), 'ceo')
})

test('an external admin or CEO is a client, not an installation admin', () => {
  assert.equal(faberloomRole({ email: 'joao.neves@marluvas.com.br', role: 'admin' }), 'client_b2b')
  assert.equal(faberloomRole({ email: 'ceo@cliente.example', role: 'ceo' }), 'client_b2b')
  assert.equal(faberloomRole({ email: 'ops@cliente.example', role: 'superadmin' }), 'client_b2b')
})

test('a client role passes through untouched', () => {
  assert.equal(faberloomRole({ email: 'compras@sondelsa.com', role: 'client_b2b' }), 'client_b2b')
  assert.equal(faberloomRole({ email: 'test@muitowork.com', role: 'manager' }), 'manager')
  assert.equal(faberloomRole({ email: 'nadie@marluvas.com.br', role: 'viewer' }), 'viewer')
})

test('a missing identity falls back to the client role', () => {
  assert.equal(faberloomRole({}), 'client_b2b')
  assert.equal(faberloomRole({ email: 'sin-arroba', role: 'admin' }), 'client_b2b')
  assert.equal(faberloomRole({ email: 'nadie@', role: 'admin' }), 'client_b2b')
})
