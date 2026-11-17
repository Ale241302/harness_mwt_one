/**
 * E1 credential custody: denial by default, rotation and revocation that the
 * transport must honour, and a contract that carries no secret in a description,
 * a refusal message or an error raised while using it.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { FaberLoomAccessRefusal } from '../src/index.ts'
import { FaberLoomCredentialMediator } from '../src/credentials.ts'

const OWNER = 'alvaro@muitowork.com'
const OTHER = 'otra@muitowork.com'
const CONNECTION = 'piloto-a'
const SECRET = 'clave-de-laboratorio'
const ROTATED = 'clave-rotada-2026'

/** Boot the storage/domain composition plus the mediator. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomCredentialMediator)
  return { ctx, credentials: ctx.faberloomCredentials }
}

/** Run a refusal and return its code. */
async function refusalCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    if (error instanceof FaberLoomAccessRefusal) return error.code
    throw error
  }
  throw new Error('expected a refusal')
}

describe('FaberLoomCredentialMediator', () => {
  it('denies by default: nothing stored means nothing usable', async () => {
    const { credentials } = await harness()
    expect(await credentials.verify(OWNER, CONNECTION, SECRET)).toBe(false)
    expect(await credentials.describe(OWNER, CONNECTION)).toEqual({
      connectionId: CONNECTION,
      present: false,
      updatedAt: null,
      revoked: false,
    })
    expect(await refusalCode(() => credentials.withSecret(OWNER, CONNECTION, 'probar', async () => 'ok')))
      .toBe('CREDENTIAL_NOT_FOUND')
    expect(await credentials.list(OWNER)).toEqual([])
  })

  it('refuses an empty scope and an empty secret', async () => {
    const { credentials } = await harness()
    expect(await refusalCode(() => credentials.withSecret('', CONNECTION, 'probar', async () => 'ok')))
      .toBe('CREDENTIAL_SCOPE_REQUIRED')
    expect(await refusalCode(() => credentials.put(OWNER, CONNECTION, '   '))).toBe('CREDENTIAL_EMPTY')
  })

  it('runs the work with the secret and returns only the result', async () => {
    const { credentials } = await harness()
    await credentials.put(OWNER, CONNECTION, SECRET)
    const seen = await credentials.withSecret(OWNER, CONNECTION, 'enviar', async secret => secret.length)
    expect(seen).toBe(SECRET.length)
    expect(await credentials.verify(OWNER, CONNECTION, SECRET)).toBe(true)
  })

  it('carries no secret in a description', async () => {
    const { credentials } = await harness()
    const description = await credentials.put(OWNER, CONNECTION, SECRET)
    expect(Object.keys(description).sort()).toEqual(['connectionId', 'present', 'revoked', 'updatedAt'])
    expect(JSON.stringify(description)).not.toContain(SECRET)
    expect(JSON.stringify(await credentials.list(OWNER))).not.toContain(SECRET)
  })

  it('keeps one owner out of another owner\'s connection', async () => {
    const { credentials } = await harness()
    await credentials.put(OWNER, CONNECTION, SECRET)
    expect(await credentials.verify(OTHER, CONNECTION, SECRET)).toBe(false)
    expect(await refusalCode(() => credentials.withSecret(OTHER, CONNECTION, 'probar', async () => 'ok')))
      .toBe('CREDENTIAL_NOT_FOUND')
    expect(await credentials.list(OTHER)).toEqual([])
  })

  it('rotates: the old secret stops working and the new one works in the same scope', async () => {
    const { credentials } = await harness()
    await credentials.put(OWNER, CONNECTION, SECRET)
    await credentials.put(OWNER, CONNECTION, ROTATED)

    expect(await credentials.verify(OWNER, CONNECTION, SECRET)).toBe(false)
    expect(await credentials.verify(OWNER, CONNECTION, ROTATED)).toBe(true)
    const used = await credentials.withSecret(OWNER, CONNECTION, 'enviar', async secret => secret)
    expect(used).toBe(ROTATED)
  })

  it('revokes: the next use refuses and the description says so', async () => {
    const { credentials } = await harness()
    await credentials.put(OWNER, CONNECTION, SECRET)
    const revoked = await credentials.revoke(OWNER, CONNECTION)
    expect(revoked.revoked).toBe(true)
    expect(revoked.present).toBe(false)
    expect(await credentials.verify(OWNER, CONNECTION, SECRET)).toBe(false)
    expect(await refusalCode(() => credentials.withSecret(OWNER, CONNECTION, 'probar', async () => 'ok')))
      .toBe('CREDENTIAL_REVOKED')
  })

  it('refuses to revoke what it never stored', async () => {
    const { credentials } = await harness()
    expect(await refusalCode(() => credentials.revoke(OWNER, CONNECTION))).toBe('CREDENTIAL_NOT_FOUND')
  })

  it('redacts the secret from an error the transport raises', async () => {
    const { credentials } = await harness()
    await credentials.put(OWNER, CONNECTION, SECRET)
    const error = await credentials
      .withSecret(OWNER, CONNECTION, 'iniciar sesión', async (secret) => {
        throw new Error(`535 authentication failed for password ${secret}`)
      })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(FaberLoomAccessRefusal)
    const refusal = error as FaberLoomAccessRefusal
    expect(refusal.code).toBe('CREDENTIAL_USE_FAILED')
    expect(refusal.message).not.toContain(SECRET)
    expect(refusal.message).toContain('[redacted]')
  })

  it('does not log a secret while storing or using it', async () => {
    const { ctx, credentials } = await harness()
    const log = vi.spyOn(ctx.logger, 'info')
    const warn = vi.spyOn(ctx.logger, 'warn')
    await credentials.put(OWNER, CONNECTION, SECRET)
    await credentials.withSecret(OWNER, CONNECTION, 'probar', async () => 'ok')
    const written = [...log.mock.calls, ...warn.mock.calls].flat().join(' ')
    expect(written).not.toContain(SECRET)
  })
})
