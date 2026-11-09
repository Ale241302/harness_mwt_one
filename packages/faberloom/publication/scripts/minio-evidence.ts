/**
 * Real MinIO evidence for wave 3A.3. It publishes one synthetic document
 * through the production S3 adapter, verifies the signed manifest and object,
 * then attempts delete and overwrite with the publisher storage credential.
 * Both must be refused by COMPLIANCE object lock.
 *
 * Credentials and the endpoint come only from the environment. The script
 * writes a JSON evidence record under `.artifacts/faberloom-portable/` and
 * exits non-zero when the deployment cannot prove retention. It never prints a
 * credential or writes one to the evidence.
 *
 * Run:
 *   FABERLOOM_PUBLICATION_ENDPOINT=... \
 *   FABERLOOM_PUBLICATION_BUCKET=... \
 *   FABERLOOM_PUBLICATION_ACCESS_KEY=... \
 *   FABERLOOM_PUBLICATION_SECRET_KEY=... \
 *   FABERLOOM_PUBLICATION_SIGNING_KEY=... \
 *   FABERLOOM_PUBLICATION_KEY_ID=... \
 *   FABERLOOM_PUBLICATION_PUBLISHER_ID=... \
 *   pnpm exec tsx scripts/faberloom-portable/minio-evidence.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomPublication from '../src/index.ts'
import { createTestRepository } from '../tests/support/git-repo.ts'

/** Read one required environment value. */
function required(name: string): string {
  const value = process.env[name] ?? ''
  if (value.trim().length === 0) throw new Error(`${name} is required`)
  return value
}

/** Whether a storage attempt was refused. */
function refused(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode
  return status === 403 || status === 409 || status === 400 || status === 412
}

/** Run the evidence chain. */
async function main(): Promise<void> {
  const endpoint = required('FABERLOOM_PUBLICATION_ENDPOINT')
  const bucket = required('FABERLOOM_PUBLICATION_BUCKET')
  const accessKey = required('FABERLOOM_PUBLICATION_ACCESS_KEY')
  const secretKey = required('FABERLOOM_PUBLICATION_SECRET_KEY')
  const signingKeyPem = required('FABERLOOM_PUBLICATION_SIGNING_KEY')
  const keyId = required('FABERLOOM_PUBLICATION_KEY_ID')
  const publisherId = required('FABERLOOM_PUBLICATION_PUBLISHER_ID')
  const region = process.env.FABERLOOM_PUBLICATION_REGION ?? 'us-east-1'
  const retentionDays = Number(process.env.FABERLOOM_PUBLICATION_RETENTION_DAYS ?? '30')
  const repo = createTestRepository()
  const runId = new Date().toISOString().replaceAll(':', '-')
  const evidenceDirectory = join('.artifacts', 'faberloom-portable', runId)
  let evidence: Record<string, unknown>
  try {
    repo.commit('knowledge/note.md', '# Nota\n\nEvidencia MinIO.\n', 'base')
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    await ctx.plugin(FaberLoomPublication, {
      repo: repo.root,
      endpoint,
      bucket,
      region,
      accessKey,
      secretKey,
      retentionDays,
      inventory: ['knowledge/note.md'],
      publisherId,
      signingKeyPem,
      keyId,
    })
    const receipt = await ctx.faberloomPublication.publish({
      itemId: 'evidence-3a3',
      revision: repo.head(),
      path: 'knowledge/note.md',
      diff: repo.diff('knowledge/note.md', '# Nota\n\nEvidencia MinIO verificada.\n'),
      motivo: 'evidence run',
      evidence: ['minio:evidence'],
      artifactHash: 'a'.repeat(64),
    })
    const read = await ctx.faberloomPublication.read(receipt.commit, 'knowledge/note.md')
    const client = new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    })
    let deleteRefused = false
    let deleteError = ''
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: receipt.objectKey }))
    } catch (error) {
      deleteRefused = refused(error)
      deleteError = error instanceof Error ? error.name : String(error)
    }
    let overwriteRefused = false
    let overwriteError = ''
    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: receipt.objectKey,
        Body: 'sobrescritura',
        IfNoneMatch: '*',
        ObjectLockMode: 'COMPLIANCE',
        ObjectLockRetainUntilDate: new Date(Date.now() + retentionDays * 86_400_000),
      }))
    } catch (error) {
      overwriteRefused = refused(error)
      overwriteError = error instanceof Error ? error.name : String(error)
    }
    evidence = {
      wave: '3A.3',
      runId,
      endpoint,
      bucket,
      region,
      retentionDays,
      publisherId,
      keyId,
      commit: receipt.commit,
      objectKey: receipt.objectKey,
      manifestKey: receipt.manifestKey,
      manifestDigest: receipt.manifest?.digest ?? null,
      sha256: receipt.sha256,
      bytes: receipt.bytes,
      state: receipt.state,
      activatedAt: receipt.activatedAt,
      readVerified: read.sha256 === receipt.sha256 && read.manifestDigest === receipt.manifest?.digest,
      deleteRefused,
      deleteError,
      overwriteRefused,
      overwriteError,
      ok: deleteRefused && overwriteRefused && read.sha256 === receipt.sha256,
    }
    mkdirSync(evidenceDirectory, { recursive: true })
    writeFileSync(join(evidenceDirectory, 'minio-publication.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    if (evidence['ok'] !== true) {
      throw new Error('object lock did not refuse delete and overwrite')
    }
    console.log(`minio evidence: ${join(evidenceDirectory, 'minio-publication.json')}`)
  } catch (error) {
    evidence = {
      wave: '3A.3',
      runId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    mkdirSync(evidenceDirectory, { recursive: true })
    writeFileSync(join(evidenceDirectory, 'minio-publication.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    throw error
  } finally {
    repo.dispose()
  }
}

await main()
