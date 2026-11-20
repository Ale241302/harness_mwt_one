/**
 * O7 · signatures belong to the sending account.
 *
 * A signature is stored per outgoing mailbox, an empty body removes it, and a
 * send from an account without its own signature falls back to the primary one.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomConnections from '../src/index.ts'

const OWNER = 'owner@muitowork.com'

/** Boot storage plus the connections service. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomConnections)
  return ctx.faberloomConnections
}

describe('O7 signatures', () => {
  it('stores one signature per account and resolves the primary fallback', async () => {
    const connections = await harness()

    const primary = await connections.saveSignature(OWNER, { text: 'Álvaro\nCEO', auto: true })
    expect(primary?.account).toBeNull()
    const account = await connections.saveSignature(OWNER, {
      account: '506@muitowork.com',
      text: 'Soporte\nMuito Work',
      auto: true,
    })
    expect(account?.text).toBe('Soporte\nMuito Work')

    expect(await connections.listSignatures(OWNER)).toHaveLength(2)
    expect(await connections.signatureFor(OWNER, '506@muitowork.com')).toBe('Soporte\nMuito Work')
    // An account without its own signature inherits the primary one.
    expect(await connections.signatureFor(OWNER, 'otra@muitowork.com')).toBe('Álvaro\nCEO')
    expect(await connections.signatureFor(OWNER, null)).toBe('Álvaro\nCEO')
  })

  it('honours the automatic flag and deletes a cleared signature', async () => {
    const connections = await harness()
    await connections.saveSignature(OWNER, { text: 'Principal', auto: true })
    await connections.saveSignature(OWNER, { account: 'a@muitowork.com', text: 'Manual', auto: false })

    expect(await connections.signatureFor(OWNER, 'a@muitowork.com')).toBe('Principal')
    // Clearing the body removes the row instead of keeping an empty signature.
    expect(await connections.saveSignature(OWNER, { account: 'a@muitowork.com', text: '   ' })).toBeNull()
    expect((await connections.listSignatures(OWNER)).map(entry => entry.account)).toEqual([null])
    expect(await connections.deleteSignature(OWNER, 'a@muitowork.com')).toBe(false)
    expect(await connections.deleteSignature(OWNER, null)).toBe(true)
  })
})
