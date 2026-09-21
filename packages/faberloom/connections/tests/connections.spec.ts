import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomConnections from '../src/index.ts'

/** Boot the real storage/domain composition plus the connections service. */
async function harness() {
  const pool = new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomConnections)
  return { ctx, connections: ctx.faberloomConnections }
}

describe('FaberLoomConnections', () => {
  it('stores several mailboxes per owner with their encryption mode', async () => {
    const { connections } = await harness()
    const first = await connections.save('owner@example.com', {
      kind: 'imap', label: 'Personal', host: 'imap.example.com', port: 993, secure: true, starttls: false, username: 'a@example.com', secret: 'one',
    })
    const second = await connections.save('owner@example.com', {
      kind: 'imap', label: 'Trabajo', host: 'imap.hostinger.com', port: 143, secure: false, starttls: true, username: 'b@example.com', secret: 'two',
    })
    const rows = await connections.list('owner@example.com')
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.id === first.id)).toMatchObject({ secure: true, starttls: false, primary: false })
    expect(rows.find(row => row.id === second.id)).toMatchObject({ secure: false, starttls: true })
    // The browser never receives the stored password.
    expect(JSON.stringify(rows)).not.toContain('one')
  })

  it('keeps one primary mailbox and hands its credentials to the receiver', async () => {
    const { connections } = await harness()
    const first = await connections.save('owner@example.com', {
      kind: 'imap', label: 'Personal', host: 'imap.example.com', port: 993, secure: true, username: 'a@example.com', secret: 'one', primary: true,
    })
    const second = await connections.save('owner@example.com', {
      kind: 'imap', label: 'Trabajo', host: 'imap.hostinger.com', port: 143, starttls: true, username: 'b@example.com', secret: 'two', primary: true,
    })
    const rows = await connections.list('owner@example.com')
    expect(rows.find(row => row.id === first.id)?.primary).toBe(false)
    expect(rows.find(row => row.id === second.id)?.primary).toBe(true)

    const chosen = await connections.imap('owner@example.com')
    expect(chosen).toMatchObject({ id: second.id, host: 'imap.hostinger.com', port: 143, secure: false, starttls: true, username: 'b@example.com', password: 'two' })
    // An explicit id still wins over the flag.
    expect(await connections.imap('owner@example.com', first.id)).toMatchObject({ id: first.id, password: 'one' })
    // Another owner sees nothing.
    expect(await connections.imap('other@example.com')).toBeUndefined()
  })

  it('falls back to the first complete mailbox when none is flagged', async () => {
    const { connections } = await harness()
    const incomplete = await connections.save('owner@example.com', { kind: 'imap', label: 'Sin secreto', host: 'imap.example.com', port: 993, secure: true, username: 'a@example.com' })
    expect(await connections.imap('owner@example.com')).toBeUndefined()
    const complete = await connections.save('owner@example.com', { kind: 'imap', label: 'Completo', host: 'imap.example.com', port: 993, secure: true, username: 'a@example.com', secret: 'one' })
    expect(await connections.imap('owner@example.com')).toMatchObject({ id: complete.id, secure: true, starttls: false })
    expect(incomplete.id).not.toBe(complete.id)
  })

  it('refuses to probe an incomplete mailbox without touching the network', async () => {
    const { connections } = await harness()
    const row = await connections.save('owner@example.com', { kind: 'imap', label: 'A medias', host: 'imap.example.com', username: 'a@example.com' })
    expect(await connections.probe('owner@example.com', row.id)).toEqual({ ok: false, detail: 'faltan host, puerto, usuario o contraseña' })
    expect(await connections.probe('owner@example.com', 'missing')).toEqual({ ok: false, detail: 'conexión no encontrada' })
  })
})
