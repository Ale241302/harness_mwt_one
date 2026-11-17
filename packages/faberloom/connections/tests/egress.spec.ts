/**
 * O3-06 egress: a host the deployment did not authorize never gets credentials,
 * so no socket opens. The lab declared this policy in a JSON file; here it is a
 * check on the choke point.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomConnections from '../src/index.ts'
import { checkEgress, egressPolicyFromEnv, hostMatches } from '../src/egress.ts'

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

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('egress policy', () => {
  it('matches a host exactly or by suffix, and nothing else', () => {
    expect(hostMatches('127.0.0.1', '127.0.0.1')).toBe(true)
    expect(hostMatches('*.hostinger.com', 'imap.hostinger.com')).toBe(true)
    expect(hostMatches('*.hostinger.com', 'hostinger.com')).toBe(false)
    expect(hostMatches('*.hostinger.com', 'evil-hostinger.com')).toBe(false)
  })

  it('is unconfigured without the variables', () => {
    const policy = egressPolicyFromEnv({})
    expect(policy.configured).toBe(false)
    expect(checkEgress(policy, 'imap.hostinger.com').allowed).toBe(true)
  })

  it('denies a listed host and defaults to deny once configured', () => {
    const policy = egressPolicyFromEnv({ FABERLOOM_EGRESS_DENY: '*.hostinger.com' })
    expect(checkEgress(policy, 'imap.hostinger.com').allowed).toBe(false)
    expect(checkEgress(policy, 'smtp.hostinger.com').reason).toContain('DENIED_BY')
    // Configured = default deny: an unlisted host is not authorized either.
    expect(checkEgress(policy, 'example.com').allowed).toBe(false)
  })

  it('lets an allow list open the exceptions', () => {
    const policy = egressPolicyFromEnv({ FABERLOOM_EGRESS_DENY: '*', FABERLOOM_EGRESS_ALLOW: '127.0.0.1' })
    expect(checkEgress(policy, '127.0.0.1').allowed).toBe(true)
    expect(checkEgress(policy, 'imap.hostinger.com').allowed).toBe(false)
  })

  it('refuses the IMAP credentials of a denied host, before any socket', async () => {
    vi.stubEnv('FABERLOOM_EGRESS_DENY', '*.hostinger.com')
    const connections = await harness()
    await connections.save(OWNER, {
      kind: 'imap', label: 'Correo', host: 'imap.hostinger.com', port: 993, secure: true,
      username: 'owner', secret: 'canario-de-prueba',
    })
    await expect(connections.imap(OWNER)).rejects.toThrow(/EGRESS_DENIED/u)
  })

  it('refuses the SMTP credentials of a denied host', async () => {
    vi.stubEnv('FABERLOOM_EGRESS_DENY', '*.hostinger.com')
    const connections = await harness()
    await connections.save(OWNER, {
      kind: 'smtp', label: 'Saliente', host: 'smtp.hostinger.com', port: 465, secure: true,
      username: 'owner', secret: 'canario-de-prueba', primary: true,
    })
    await expect(connections.sendMail(OWNER, { to: ['a@b.c'], subject: 's', text: 't' }))
      .rejects.toThrow(/EGRESS_DENIED/u)
  })

  it('keeps the lab reachable when the policy allows loopback only', async () => {
    vi.stubEnv('FABERLOOM_EGRESS_DENY', '*')
    vi.stubEnv('FABERLOOM_EGRESS_ALLOW', '127.0.0.1')
    const connections = await harness()
    await connections.save(OWNER, {
      kind: 'imap', label: 'Laboratorio', host: '127.0.0.1', port: 3143, secure: false,
      username: 'piloto-a', secret: 'lab-only-a',
    })
    const credentials = await connections.imap(OWNER)
    expect(credentials?.host).toBe('127.0.0.1')
  })

  it('refuses the SMTP accessor itself, not only the send path', async () => {
    vi.stubEnv('FABERLOOM_EGRESS_DENY', '*.hostinger.com')
    const connections = await harness()
    await connections.save(OWNER, {
      kind: 'smtp', label: 'Saliente', host: 'smtp.hostinger.com', port: 465, secure: true,
      username: 'owner', secret: 'canario-de-prueba', primary: true,
    })
    await expect(connections.smtp(OWNER)).rejects.toThrow(/EGRESS_DENIED/u)
  })

  it('does not open a socket to probe a denied host', async () => {
    vi.stubEnv('FABERLOOM_EGRESS_DENY', '*.hostinger.com')
    const connections = await harness()
    const mailbox = await connections.save(OWNER, {
      kind: 'imap', label: 'Correo', host: 'imap.hostinger.com', port: 993, secure: true,
      username: 'owner', secret: 'canario-de-prueba',
    })
    const probe = await connections.probe(OWNER, mailbox.id)
    expect(probe.ok).toBe(false)
    expect(probe.detail).toContain('no autorizado')
  })
})
