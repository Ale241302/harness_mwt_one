// @vitest-environment node
/**
 * The publication chain over a real temporary Git repository and the in-memory
 * object store: commit, upload, activate, read, replay, recovery, and every
 * refusal the service owns.
 */

import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomPublication, {
  canonicalJson,
  publicationKeyOf,
  sha256Of,
  type Config,
  type PublicationRecord,
  type PublicationRequest,
} from '../src/index.ts'
import { createTestRepository, type TestRepository } from './support/git-repo.ts'
import { MemoryPublicationStore } from './support/memory-store.ts'

const PATH = 'knowledge/note.md'
const BASE = '# Nota\n\nlínea uno\n'
const CHANGED = '# Nota\n\nlínea uno\nlínea dos\n'
const SECOND = '# Nota\n\nlínea uno\nlínea dos\nlínea tres\n'

/** One Ed25519 pair used only by these specs. */
const keys = generateKeyPairSync('ed25519')
const SIGNING_KEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()

let repositories: TestRepository[] = []

afterEach(() => {
  for (const repository of repositories) repository.dispose()
  repositories = []
})

/** Create one repository the spec disposes after the test. */
function repository(): TestRepository {
  const created = createTestRepository()
  repositories.push(created)
  return created
}

/** Boot the real storage composition plus the publication service. */
async function boot(options: {
  readonly repo: string
  readonly maxBytes?: number
  readonly config?: Partial<Config>
}): Promise<{
  readonly publication: FaberLoomPublication
  readonly store: MemoryPublicationStore
  readonly facility: DomainFacility
}> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomPublication, {
    repo: options.repo,
    endpoint: 'http://127.0.0.1:9000',
    bucket: 'faberloom-test',
    region: 'us-east-1',
    accessKey: 'test-access',
    secretKey: 'test-secret',
    ...options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes },
    publisherId: 'publisher:qa',
    signingKeyPem: SIGNING_KEY,
    keyId: 'qa-key',
    publicKeyPem: PUBLIC_KEY,
    inventory: [PATH],
    ...options.config,
  })
  const store = new MemoryPublicationStore()
  ctx.faberloomPublication.useObjectStore(store)
  return { publication: ctx.faberloomPublication, store, facility }
}

/** One approval-bound request against the repository's current HEAD. */
function request(
  repo: TestRepository,
  overrides: Partial<PublicationRequest> & Pick<PublicationRequest, 'path' | 'diff'>,
): PublicationRequest {
  return {
    itemId: 'item-1',
    revision: repo.head(),
    motivo: 'mejora aprobada',
    evidence: ['oc:505288'],
    artifactHash: 'a'.repeat(64),
    ...overrides,
  }
}

/** Read one durable publication row. */
function row(facility: DomainFacility, key: string): PublicationRecord {
  const domain = facility.get('faberloom_publication')
  if (domain === undefined) throw new Error('the publication domain is not open')
  const record = domain.table('publications').get(key)
  if (record === undefined) throw new Error(`no publication row ${key}`)
  return record as PublicationRecord
}

describe('FaberLoomPublication', () => {
  it('applies the approved diff, commits it, uploads the bytes, and activates the revision', async () => {
    const repo = repository()
    const base = repo.commit(PATH, BASE, 'base')
    const diff = repo.diff(PATH, CHANGED)
    const { publication, store } = await boot({ repo: repo.root })

    const receipt = await publication.publish(request(repo, { path: PATH, diff }))

    expect(receipt.state).toBe('activated')
    expect(receipt.revision).toBe(base)
    expect(receipt.commit).toMatch(/^[0-9a-f]{40}$/u)
    expect(receipt.objectKey).toBe(`publications/${receipt.commit}/${PATH}`)
    expect(receipt.bytes).toBe(Buffer.byteLength(CHANGED, 'utf8'))
    expect(receipt.sha256).toBe(sha256Of(new TextEncoder().encode(CHANGED)))
    expect(receipt.activatedAt).not.toBeNull()
    expect(receipt.itemId).toBe('item-1')
    expect(receipt.path).toBe(PATH)
    expect(receipt.manifestKey).toBe(`publications/${receipt.commit}/.faberloom/manifest.json`)
    expect(receipt.manifest?.publisherId).toBe('publisher:qa')
    expect(receipt.signature?.keyId).toBe('qa-key')
    expect(receipt.failure).toBeNull()
    expect(repo.head()).toBe(receipt.commit)
    expect(repo.commitCount()).toBe(2)
    expect(repo.read(PATH)).toBe(CHANGED)
    expect(store.puts).toBe(2)
    expect(store.objects.get(receipt.objectKey)?.metadata).toEqual({ sha256: receipt.sha256, itemId: 'item-1' })
    expect(store.objects.get(receipt.objectKey)?.contentType).toBe('text/markdown')
    expect(store.objects.get(receipt.manifestKey)).toBeDefined()

    const read = await publication.read(receipt.commit, PATH)
    expect(read).toEqual({
      revision: receipt.commit,
      path: PATH,
      bytes: receipt.bytes,
      sha256: receipt.sha256,
      manifestKey: receipt.manifestKey,
      manifestDigest: receipt.manifest?.digest,
      text: CHANGED,
    })
    expect(await publication.status(receipt.commit)).toBe('activated')
    expect(await publication.receipt(receipt.commit)).toEqual(receipt)
  })

  it('treats a replay of the same approval as one commit, one object, and one activation', async () => {
    const repo = repository()
    repo.commit(PATH, BASE, 'base')
    const { publication, store } = await boot({ repo: repo.root })
    const approved = request(repo, { path: PATH, diff: repo.diff(PATH, CHANGED) })

    const first = await publication.publish(approved)
    const second = await publication.publish(approved)

    expect(second).toEqual(first)
    expect(store.puts).toBe(2)
    expect(repo.commitCount()).toBe(2)
    expect(repo.head()).toBe(first.commit)
  })

  it('applies a second diff on top of the first publication and keeps the first revision readable', async () => {
    const repo = repository()
    repo.commit(PATH, BASE, 'base')
    const harness = await boot({ repo: repo.root })
    const firstReceipt = await harness.publication.publish(request(repo, { path: PATH, diff: repo.diff(PATH, CHANGED) }))

    const secondDiff = repo.diff(PATH, SECOND)
    const secondReceipt = await harness.publication.publish(request(repo, {
      path: PATH,
      diff: secondDiff,
      artifactHash: 'b'.repeat(64),
    }))

    expect(secondReceipt.commit).not.toBe(firstReceipt.commit)
    expect(secondReceipt.revision).toBe(firstReceipt.commit)
    expect(repo.commitCount()).toBe(3)
    await expect(harness.publication.read(firstReceipt.commit, PATH)).resolves.toMatchObject({ text: CHANGED })
    await expect(harness.publication.read(secondReceipt.commit, PATH)).resolves.toMatchObject({ text: SECOND })
  })

  it('refuses a stale base revision and writes nothing', async () => {
    const repo = repository()
    const base = repo.commit(PATH, BASE, 'base')
    const { publication } = await boot({ repo: repo.root })
    const firstReceipt = await publication.publish(request(repo, { path: PATH, diff: repo.diff(PATH, CHANGED) }))
    const secondDiff = repo.diff(PATH, SECOND)

    await expect(publication.publish(request(repo, {
      path: PATH,
      diff: secondDiff,
      revision: base,
      artifactHash: 'c'.repeat(64),
    }))).rejects.toThrow('PUBLICATION_BASE_STALE')

    expect(repo.head()).toBe(firstReceipt.commit)
    expect(repo.commitCount()).toBe(2)
    expect(repo.read(PATH)).toBe(CHANGED)
  })

  it('refuses path traversal, absolute paths, Windows separators, and branch names', async () => {
    const repo = repository()
    repo.commit(PATH, BASE, 'base')
    const { publication } = await boot({ repo: repo.root })
    const diff = repo.diff(PATH, CHANGED)

    for (const path of ['../secret.md', '/etc/passwd', 'docs\\note.md', 'C:/note.md', 'knowledge/./note.md', '']) {
      await expect(publication.publish(request(repo, { path, diff }))).rejects.toThrow('PUBLICATION_PATH_INVALID')
    }
    await expect(publication.publish(request(repo, {
      path: PATH,
      diff,
      revision: 'main',
    }))).rejects.toThrow('PUBLICATION_REVISION_INVALID')

    expect(repo.commitCount()).toBe(1)
  })

  it('refuses a diff that touches another file', async () => {
    const repo = repository()
    repo.commit(PATH, BASE, 'base')
    repo.commit('knowledge/other.md', 'otro\n', 'other')
    const { publication } = await boot({ repo: repo.root })
    const diff = [
      'diff --git a/knowledge/note.md b/knowledge/note.md',
      '--- a/knowledge/note.md',
      '+++ b/knowledge/note.md',
      '@@ -1 +1 @@',
      '-# Nota',
      '+# Nota cambiada',
      'diff --git a/knowledge/other.md b/knowledge/other.md',
      '--- a/knowledge/other.md',
      '+++ b/knowledge/other.md',
      '@@ -1 +1 @@',
      '-otro',
      '+otro cambiado',
    ].join('\n')

    await expect(publication.publish(request(repo, { path: PATH, diff }))).rejects.toThrow('PUBLICATION_PATCH_PATH')
    expect(repo.commitCount()).toBe(2)
    expect(repo.read('knowledge/other.md')).toBe('otro\n')
  })

  it('recovers a crash after upload without a second commit or object, and activates once', async () => {
    const repo = repository()
    repo.commit(PATH, BASE, 'base')
    const { publication, store, facility } = await boot({ repo: repo.root })
    const approved = request(repo, { path: PATH, diff: repo.diff(PATH, CHANGED) })
    const first = await publication.publish(approved)

    // Exactly the durable state a crash between the upload write and the
    // activation write leaves: the object and its record exist, activation does not.
    const key = publicationKeyOf(approved)
    const domain = facility.get('faberloom_publication')
    if (domain === undefined) throw new Error('the publication domain is not open')
    await domain.table('publications').update(key, current => ({
      ...(current as PublicationRecord),
      state: 'uploaded',
      activatedAt: null,
    }))
    expect(row(facility, key)).toMatchObject({ state: 'uploaded', activatedAt: null })

    const recovered = await publication.publish(approved)

    expect(recovered.commit).toBe(first.commit)
    expect(recovered.activatedAt).not.toBeNull()
    expect(store.puts).toBe(2)
    expect(repo.commitCount()).toBe(2)

    const replayed = await publication.publish(approved)
    expect(replayed.activatedAt).toBe(recovered.activatedAt)
    expect(store.puts).toBe(2)
    expect(repo.commitCount()).toBe(2)
  })

  it('authenticates the manifest and refuses tampered manifest bytes or a bad signature', async () => {
    const repo = repository()
    repo.commit(PATH, BASE, 'base')
    const { publication, store, facility } = await boot({ repo: repo.root })
    const approved = request(repo, { path: PATH, diff: repo.diff(PATH, CHANGED) })
    const receipt = await publication.publish(approved)
    if (receipt.manifest === null || receipt.signature === null) throw new Error('the manifest is missing')
    expect(receipt.manifest.publisherId).toBe('publisher:qa')
    expect(receipt.manifest.publisherId).not.toBe('test-access')
    expect(receipt.signature.keyId).toBe('qa-key')
    expect(receipt.manifest.digest).toHaveLength(64)

    store.corrupt(receipt.manifestKey)
    await expect(publication.read(receipt.commit, PATH)).rejects.toThrow('PUBLICATION_MANIFEST_INVALID')

    store.objects.set(receipt.manifestKey, {
      key: receipt.manifestKey,
      bytes: new TextEncoder().encode(canonicalJson(receipt.manifest)),
      contentType: 'application/json',
      metadata: { sha256: receipt.manifest.digest, itemId: receipt.itemId, keyId: receipt.signature.keyId },
    })
    const domain = facility.get('faberloom_publication')
    if (domain === undefined) throw new Error('the publication domain is not open')
    await domain.table('publications').update(publicationKeyOf(approved), current => ({
      ...(current as PublicationRecord),
      signature: 'AAAA',
    }))
    await expect(publication.read(receipt.commit, PATH)).rejects.toThrow('PUBLICATION_SIGNATURE_INVALID')
  })

  it('keeps the commit and approval when the source is down, then resumes without duplicating', async () => {
    const repo = repository()
    repo.commit(PATH, BASE, 'base')
    const { publication, store, facility } = await boot({ repo: repo.root })
    const approved = request(repo, { path: PATH, diff: repo.diff(PATH, CHANGED) })
    const key = publicationKeyOf(approved)

    store.failPuts = true
    await expect(publication.publish(approved)).rejects.toThrow('PUBLICATION_STORE_UNAVAILABLE')
    const failed = row(facility, key)
    expect(failed.state).toBe('failed')
    expect(failed.commit).not.toBeNull()
    expect(failed.sha256).toBeNull()
    expect(failed.failure).toContain('PUBLICATION_STORE_UNAVAILABLE')

    store.failPuts = false
    const recovered = await publication.publish(approved)
    expect(recovered.state).toBe('activated')
    expect(recovered.commit).toBe(failed.commit)
    expect(repo.commitCount()).toBe(2)
    expect(store.puts).toBe(2)
    expect(row(facility, key).failure).toBeNull()
  })

  it('refuses overwrite and delete of a protected object with the publisher identity', async () => {
    const repo = repository()
    repo.commit(PATH, BASE, 'base')
    const { publication, store } = await boot({ repo: repo.root })
    store.protectOnPut = true
    const receipt = await publication.publish(request(repo, { path: PATH, diff: repo.diff(PATH, CHANGED) }))

    expect(receipt.manifest?.publisherId).toBe('publisher:qa')
    expect(() => { store.remove(receipt.objectKey) }).toThrow('PUBLICATION_RETENTION')
    expect(() => { store.remove(receipt.manifestKey) }).toThrow('PUBLICATION_RETENTION')
    await expect(store.put({
      key: receipt.objectKey,
      bytes: new TextEncoder().encode('otro contenido'),
      contentType: 'text/markdown',
      metadata: { sha256: 'otro', itemId: 'item-1' },
    })).rejects.toThrow('PUBLICATION_RETENTION')
    expect(Buffer.from(store.objects.get(receipt.objectKey)?.bytes ?? []).toString('utf8')).toBe(CHANGED)
  })

  it('refuses a stored object whose digest no longer matches', async () => {
    const repo = repository()
    repo.commit(PATH, BASE, 'base')
    const { publication, store } = await boot({ repo: repo.root })
    const receipt = await publication.publish(request(repo, { path: PATH, diff: repo.diff(PATH, CHANGED) }))

    store.corrupt(receipt.objectKey)

    await expect(publication.read(receipt.commit, PATH)).rejects.toThrow('PUBLICATION_DIGEST_MISMATCH')
  })

  it('refuses a revision that is not activated yet', async () => {
    const repo = repository()
    repo.commit(PATH, BASE, 'base')
    const { publication, facility } = await boot({ repo: repo.root })
    const approved = request(repo, { path: PATH, diff: repo.diff(PATH, CHANGED) })
    const receipt = await publication.publish(approved)

    const domain = facility.get('faberloom_publication')
    if (domain === undefined) throw new Error('the publication domain is not open')
    await domain.table('publications').update(publicationKeyOf(approved), current => ({
      ...(current as PublicationRecord),
      state: 'committed',
      objectKey: null,
      sha256: null,
      bytes: null,
    }))

    await expect(publication.read(receipt.commit, PATH)).rejects.toThrow('PUBLICATION_NOT_ACTIVE')
    await expect(publication.read(receipt.commit, 'knowledge/other.md')).rejects.toThrow('PUBLICATION_PATH_INVALID')
    await expect(publication.read('0'.repeat(40), PATH)).rejects.toThrow('PUBLICATION_NOT_FOUND')
    await expect(publication.receipt(receipt.commit)).rejects.toThrow('PUBLICATION_INCOMPLETE')
  })

  it('refuses an object a foreign writer left at the immutable key', async () => {
    const repo = repository()
    repo.commit(PATH, BASE, 'base')
    const { publication, store, facility } = await boot({ repo: repo.root })
    const approved = request(repo, { path: PATH, diff: repo.diff(PATH, CHANGED) })
    const receipt = await publication.publish(approved)

    const domain = facility.get('faberloom_publication')
    if (domain === undefined) throw new Error('the publication domain is not open')
    await domain.table('publications').update(publicationKeyOf(approved), current => ({
      ...(current as PublicationRecord),
      state: 'committed',
      objectKey: null,
      sha256: null,
      bytes: null,
    }))
    store.corrupt(receipt.objectKey)

    await expect(publication.publish(approved)).rejects.toThrow('PUBLICATION_OBJECT_CONFLICT')
    expect(repo.commitCount()).toBe(2)
    expect(store.puts).toBe(2)
  })

  it('refuses a publish whose bytes exceed the ceiling and leaves no commit behind', async () => {
    const repo = repository()
    repo.commit(PATH, BASE, 'base')
    const diff = repo.diff(PATH, 'x'.repeat(64))
    const { publication } = await boot({ repo: repo.root, maxBytes: 16 })

    await expect(publication.publish(request(repo, { path: PATH, diff }))).rejects.toThrow('PUBLICATION_TOO_LARGE')

    expect(repo.commitCount()).toBe(1)
    expect(repo.read(PATH)).toBe(BASE)
  })

  it('refuses a replay that carries another diff for the same approval identity', async () => {
    const repo = repository()
    repo.commit(PATH, BASE, 'base')
    const { publication } = await boot({ repo: repo.root })
    const approved = request(repo, { path: PATH, diff: repo.diff(PATH, CHANGED) })
    await publication.publish(approved)

    const other = repo.diff(PATH, SECOND)
    await expect(publication.publish({ ...approved, diff: other }))
      .rejects.toThrow('PUBLICATION_REQUEST_CONFLICT')
    expect(repo.commitCount()).toBe(2)
  })

  it('is unavailable and refuses loudly when the deployment does not configure the store', async () => {
    const repo = repository()
    repo.commit(PATH, BASE, 'base')
    const { publication } = await boot({ repo: repo.root, config: { endpoint: '', bucket: '' } })

    expect(publication.readiness()).toEqual({
      available: false,
      reason: 'the publication service requires endpoint, bucket',
    })
    await expect(publication.publish(request(repo, { path: PATH, diff: repo.diff(PATH, CHANGED) })))
      .rejects.toThrow('PUBLICATION_UNAVAILABLE')
    await expect(publication.read('0'.repeat(40), PATH)).rejects.toThrow('PUBLICATION_UNAVAILABLE')
  })

  it('refuses a credential pair that is only half configured', () => {
    const ctx = new Context()
    expect(() => new FaberLoomPublication(ctx, {
      repo: '.',
      endpoint: 'http://127.0.0.1:9000',
      bucket: 'faberloom-test',
      accessKey: 'test-access',
      secretKey: '',
    })).toThrow('PUBLICATION_CONFIG_INVALID')
  })
})
