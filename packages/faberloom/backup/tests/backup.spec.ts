import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomBackup from '../src/index.ts'

/** Boot the storage/domain composition plus the access and backup services. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomBackup)
  return { ctx, access: ctx.faberloomAccess, backup: ctx.faberloomBackup, facility }
}

/** Overwrite one stored record's raw payload, to simulate medium tampering. */
async function tamperPayload(facility: DomainFacility, id: string, replace: (payload: string) => string): Promise<void> {
  const domain = facility.get('faberloom_backup')
  if (domain === undefined) throw new Error('backup domain not open')
  const record = domain.table('backups').get(id) as { payload: string }
  await domain.table('backups').update(id, current => ({ ...(current as object), payload: replace(record.payload) }))
}

const OWNER = 'alvaro@muitowork.com'

describe('FaberLoomBackup', () => {
  it('captures a live domain, lists the manifest, and verifies its integrity', async () => {
    const { access, backup } = await harness()
    const grant = await access.grant(OWNER, { action: 'mail.send', agentId: 'a1', context: 'eguisa' })
    const manifest = await backup.createBackup(OWNER, { note: 'cierre de jornada' })
    const grants = manifest.domains.find(domain => domain.domain === 'faberloom_grants')
    expect(grants?.tables).toEqual([expect.objectContaining({ table: 'grants', recordCount: 1 })])
    expect(manifest.note).toBe('cierre de jornada')
    expect((await backup.listBackups(OWNER)).map(entry => entry.id)).toContain(manifest.id)
    const verdict = await backup.verifyBackup(OWNER, manifest.id)
    expect(verdict.ok).toBe(true)
    expect(verdict.actualDigest).toBe(verdict.expectedDigest)
    expect(verdict.tables).toEqual([expect.objectContaining({ table: 'grants', ok: true })])
    await expect(backup.getBackup(OWNER, manifest.id)).resolves.toMatchObject({ id: manifest.id })
    expect(grant.revoked).toBe(false)
  })

  it('F20/F32 · restores a mutated record, and a dry run touches nothing', async () => {
    const { access, backup } = await harness()
    const grant = await access.grant(OWNER, { action: 'mail.send' })
    const manifest = await backup.createBackup(OWNER)
    await access.revokeGrant(OWNER, grant.id)
    expect((await access.check({ ownerId: OWNER, action: 'mail.send' })).reason).toBe('REVOKED')

    const dry = await backup.restoreBackup(OWNER, manifest.id, { dryRun: true })
    expect(dry.dryRun).toBe(true)
    expect(dry.tables).toEqual([expect.objectContaining({ domain: 'faberloom_grants', table: 'grants', written: 1 })])
    expect((await access.check({ ownerId: OWNER, action: 'mail.send' })).reason).toBe('REVOKED')

    const restored = await backup.restoreBackup(OWNER, manifest.id)
    expect(restored.skipped).toEqual([])
    expect(restored.tables).toEqual([expect.objectContaining({ domain: 'faberloom_grants', table: 'grants', written: 1 })])
    expect(await access.check({ ownerId: OWNER, action: 'mail.send' })).toMatchObject({ allowed: true, reason: 'GRANTED' })
  })

  it('refuses a snapshot whose payload no longer matches its digest', async () => {
    const { access, backup, facility } = await harness()
    await access.grant(OWNER, { action: 'mail.send' })
    const manifest = await backup.createBackup(OWNER)
    await tamperPayload(facility, manifest.id, payload => payload.replace('"revoked":false', '"revoked":true'))
    const verdict = await backup.verifyBackup(OWNER, manifest.id)
    expect(verdict.ok).toBe(false)
    await expect(backup.restoreBackup(OWNER, manifest.id)).rejects.toThrow('integrity check')
  })

  it('guards ownership and deletes', async () => {
    const { access, backup } = await harness()
    await access.grant(OWNER, { action: 'mail.send' })
    const manifest = await backup.createBackup(OWNER)
    await expect(backup.getBackup('otro', manifest.id)).rejects.toThrow('only the owner')
    await expect(backup.deleteBackup('otro', manifest.id)).rejects.toThrow('only the owner')
    await backup.deleteBackup(OWNER, manifest.id)
    expect(await backup.listBackups(OWNER)).toEqual([])
  })

  it('G8 — applies a data migration once, records it, and rewrites the records', async () => {
    const { access, backup, facility } = await harness()
    const grant = await access.grant(OWNER, { action: 'mail.send' })
    const migration = {
      id: 'normalize-grants',
      domain: 'faberloom_grants',
      table: 'grants',
      describe: 'normaliza el campo note',
      apply: (record: Record<string, unknown>) => ({ ...record, note: record['note'] ?? 'migrado' }),
    }
    const first = await backup.runMigrations(OWNER, [migration])
    expect(first).toEqual({ applied: ['normalize-grants'], skipped: [] })
    const grants = facility.get('faberloom_grants')?.table('grants')
    expect(grants?.get(grant.id)).toMatchObject({ note: 'migrado' })
    const info = await backup.listMigrations(OWNER, [migration, { ...migration, id: 'pendiente' }])
    expect(info.map(row => [row.id, row.applied])).toEqual([['normalize-grants', true], ['pendiente', false]])
    // A second pass skips the applied one and only runs the pending entry.
    const second = await backup.runMigrations(OWNER, [migration, { ...migration, id: 'pendiente', apply: record => record }])
    expect(second.applied).toEqual(['pendiente'])
  })
})
