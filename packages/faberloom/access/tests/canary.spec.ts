/**
 * T18 canary: one secret planted in custody must not appear in a description, a
 * refusal raised while using it, a log line, or a notice built from that failure.
 * The store itself keeps the value; what this proves is that every path out of
 * it is clean.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { FaberLoomAccessRefusal } from '../src/index.ts'
import { FaberLoomCredentialMediator } from '../src/credentials.ts'
import FaberLoomNotices from '../../notices/src/index.ts'

const OWNER = 'owner@muitowork.com'
const CANARY = 'CANARIO-6b1f0c-9d2e'

/** Boot storage, the credential mediator and the notices service. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomCredentialMediator)
  await ctx.plugin(FaberLoomNotices)
  return { ctx, credentials: ctx.faberloomCredentials, notices: ctx.faberloomNotices }
}

describe('credential canary', () => {
  it('never escapes a description, a refusal, a log line or a notice', async () => {
    const { ctx, credentials, notices } = await harness()
    const info = vi.spyOn(ctx.logger, 'info')
    const warn = vi.spyOn(ctx.logger, 'warn')
    const errorLog = vi.spyOn(ctx.logger, 'error')
    const debug = vi.spyOn(ctx.logger, 'debug')

    await credentials.put(OWNER, 'piloto-a', CANARY)

    // Every read surface.
    expect(JSON.stringify(await credentials.describe(OWNER, 'piloto-a'))).not.toContain(CANARY)
    expect(JSON.stringify(await credentials.list(OWNER))).not.toContain(CANARY)
    expect(await credentials.verify(OWNER, 'piloto-a', CANARY)).toBe(true)
    const revokeRefusal = await credentials.revoke(OWNER, 'otra').catch((caught: unknown) => caught)
    expect((revokeRefusal as Error).message).not.toContain(CANARY)

    // A transport failure that quotes the password.
    const failure = await credentials
      .withSecret(OWNER, 'piloto-a', 'iniciar sesión', async (secret) => {
        throw new Error(`535 authentication failed for ${secret}`)
      })
      .catch((caught: unknown) => caught)

    expect(failure).toBeInstanceOf(FaberLoomAccessRefusal)
    const refusal = failure as FaberLoomAccessRefusal
    expect(refusal.message).not.toContain(CANARY)
    expect(refusal.message).toContain('[redacted]')
    expect(JSON.stringify(refusal)).not.toContain(CANARY)

    // A notice built from that refusal keeps it clean too.
    const notice = await notices.publish({
      ownerId: OWNER,
      kind: 'credential-failure',
      title: 'No se pudo iniciar sesión',
      body: refusal.message,
      source: 'canvas:piloto-a',
    })
    expect(notice.body).not.toContain(CANARY)
    expect(JSON.stringify(await notices.list(OWNER))).not.toContain(CANARY)

    // Nothing reached a log sink.
    const logged = [...info.mock.calls, ...warn.mock.calls, ...errorLog.mock.calls, ...debug.mock.calls]
      .flat()
      .map(value => typeof value === 'string' ? value : JSON.stringify(value))
      .join(' ')
    expect(logged).not.toContain(CANARY)
  })

  it('does not write the canary into an error raised for a missing credential', async () => {
    const { credentials } = await harness()
    await credentials.put(OWNER, 'piloto-a', CANARY)
    // Another owner asks for a credential the canary holder owns.
    const refused = await credentials.withSecret('otra@muitowork.com', 'piloto-a', 'leer', async () => 'x')
      .catch((caught: unknown) => caught)
    expect(refused).toBeInstanceOf(FaberLoomAccessRefusal)
    expect((refused as Error).message).not.toContain(CANARY)
    expect((refused as Error).message).toContain('CREDENTIAL_NOT_FOUND')
  })
})
