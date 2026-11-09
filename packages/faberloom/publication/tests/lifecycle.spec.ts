import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomPublication, { type Config, type PublicationRequest } from '../src/index.ts'
import { createTestRepository, type TestRepository } from './support/git-repo.ts'
import { MemoryPublicationStore } from './support/memory-store.ts'

const PATH = 'knowledge/note.md'
const BASE = '# Nota\n\nuno\n'
const SECOND = '# Nota\n\nuno\ndos\n'

/** One key pair per trust role. */
const KEY_A = generateKeyPairSync('ed25519')
const KEY_B = generateKeyPairSync('ed25519')
const PRIVATE_A = KEY_A.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUBLIC_A = KEY_A.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const PRIVATE_B = KEY_B.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

let repositories: TestRepository[] = []

afterEach(() => {
  for (const repository of repositories) repository.dispose()
  repositories = []
})

/** Boot the real storage/domain composition plus publication and the memory store. */
async function boot(overrides: Partial<Config> = {}): Promise<{
  readonly ctx: Context
  readonly publication: FaberLoomPublication
  readonly store: MemoryPublicationStore
  readonly repo: TestRepository
  readonly facility: DomainFacility
}> {
  const repo = createTestRepository()
  repositories.push(repo)
  repo.commit(PATH, BASE, 'base')
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomPublication, {
    repo: repo.root,
    endpoint: 'http://127.0.0.1:9000',
    bucket: 'faberloom-test',
    region: 'us-east-1',
    accessKey: 'test-access',
    secretKey: 'test-secret',
    publisherId: 'publisher:qa',
    signingKeyPem: PRIVATE_A,
    keyId: 'key-a',
    publicKeyPem: PUBLIC_A,
    inventory: [PATH],
    ...overrides,
  })
  const store = new MemoryPublicationStore()
  ctx.faberloomPublication.useObjectStore(store)
  return { ctx, publication: ctx.faberloomPublication, store, repo, facility }
}

/** One request against the repository's current HEAD. */
function request(repo: TestRepository, overrides: Partial<PublicationRequest> & Pick<PublicationRequest, 'path' | 'diff'>): PublicationRequest {
  return {
    itemId: 'item-1',
    revision: repo.head(),
    motivo: 'mejora aprobada',
    evidence: ['oc:505288'],
    artifactHash: 'a'.repeat(64),
    ...overrides,
  }
}

/** Find and rewrite the durable publication row. */
async function rewriteRow(
  facility: DomainFacility,
  commit: string,
  replace: (row: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const domain = facility.get('faberloom_publication')
  if (domain === undefined) throw new Error('publication domain missing')
  const revisions = domain.table('revisions')
  const index = revisions.get(commit) as { publication: string } | undefined
  if (index === undefined) throw new Error('revision index missing')
  await domain.table('publications').update(index.publication, current => replace(current as Record<string, unknown>))
}

describe('3B.4 publication lifecycle', () => {
  it('retires a revision and keeps it retired after the row is restored', async () => {
    const { publication, store, repo, facility } = await boot()
    const input = request(repo, { path: PATH, diff: repo.diff(PATH, SECOND) })
    const receipt = await publication.publish(input)
    expect(await publication.read(receipt.commit, PATH)).toMatchObject({ text: SECOND })

    const retired = await publication.retire(receipt.commit, 'revocada por seguridad')
    expect(retired).toMatchObject({ state: 'retired', retiredReason: 'revocada por seguridad' })
    expect(await publication.status(receipt.commit)).toBe('retired')
    await expect(publication.read(receipt.commit, PATH)).rejects.toThrow('PUBLICATION_RETIRED')
    await expect(publication.publish(input)).rejects.toThrow('PUBLICATION_RETIRED')

    // Restore the old row as if a storage backup predated retirement. The
    // append-only ledger still refuses the content.
    await rewriteRow(facility, receipt.commit, row => ({
      ...row, state: 'activated', retiredAt: null, retiredReason: null,
    }))
    expect(await publication.status(receipt.commit)).toBe('retired')
    await expect(publication.read(receipt.commit, PATH)).rejects.toThrow('PUBLICATION_RETIRED')
    await expect(publication.readAt(receipt.commit, PATH)).rejects.toThrow('PUBLICATION_RETIRED')
    const domain = facility.get('faberloom_publication')
    if (domain === undefined) throw new Error('publication domain missing')
    await domain.table('revisions').delete(receipt.commit)
    expect(await publication.status(receipt.commit)).toBe('retired')
    await expect(publication.read(receipt.commit, PATH)).rejects.toThrow('PUBLICATION_RETIRED')
    expect(store.objects.size).toBeGreaterThan(0)
  })

  it('survives a test-store loss and rejects a retired revision after objects are restored', async () => {
    const { publication, store, repo } = await boot()
    const receipt = await publication.publish(request(repo, { path: PATH, diff: repo.diff(PATH, SECOND) }))
    const snapshot = new Map([...store.objects.entries()].map(([key, object]) => [
      key, { ...object, bytes: Uint8Array.from(object.bytes) },
    ]))
    store.objects.clear()
    await expect(publication.read(receipt.commit, PATH)).rejects.toThrow('PUBLICATION_NOT_FOUND')

    for (const [key, object] of snapshot) store.objects.set(key, object)
    expect(await publication.read(receipt.commit, PATH)).toMatchObject({ text: SECOND })

    await publication.retire(receipt.commit, 'revocada')
    // Restore the pre-retirement objects after retirement: the object bytes
    // are still there, but the ledger refuses the revision.
    store.objects.clear()
    for (const [key, object] of snapshot) store.objects.set(key, object)
    await expect(publication.read(receipt.commit, PATH)).rejects.toThrow('PUBLICATION_RETIRED')
  })

  it('rotates the signing key, keeps old revisions readable before retirement, and refuses a retired key', async () => {
    const { publication, repo } = await boot()
    const first = await publication.publish(request(repo, { path: PATH, diff: repo.diff(PATH, SECOND) }))
    const rotation = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    expect(await publication.rotateSigningKey(PRIVATE_B, 'key-b', rotation)).toEqual({
      previousKeyId: 'key-a', activeKeyId: 'key-b', retiredAt: rotation,
    })
    expect(await publication.read(first.commit, PATH)).toMatchObject({ text: SECOND })
    const second = await publication.publish(request(repo, {
      itemId: 'item-2', path: PATH, diff: repo.diff(PATH, `${SECOND}tres\n`), artifactHash: 'b'.repeat(64),
    }))
    expect(second.signature?.keyId).toBe('key-b')
    expect(await publication.read(second.commit, PATH)).toMatchObject({ text: `${SECOND}tres\n` })
  })

  it('refuses to rotate onto the same key material under a new id', async () => {
    const { publication } = await boot()
    await expect(publication.rotateSigningKey(PRIVATE_A, 'key-a2', new Date(Date.now() + 60_000).toISOString()))
      .rejects.toThrow('PUBLICATION_CONFIG_INVALID')
  })

  it('persists the retired key in the durable domain', async () => {
    const { publication, store, repo, facility } = await boot()
    const rotation = new Date(Date.now() + 60_000).toISOString()
    await publication.publish(request(repo, { path: PATH, diff: repo.diff(PATH, SECOND) }))
    await publication.rotateSigningKey(PRIVATE_B, 'key-b', rotation)
    const domain = facility.get('faberloom_publication')
    if (domain === undefined) throw new Error('publication domain missing')
    expect(domain.table('key_retirements').get('key-a')).toMatchObject({ keyId: 'key-a', retiredAt: rotation })
    expect(store.objects.size).toBeGreaterThan(0)
  })

  it('refuses a manifest signed before the retired key policy allows it', async () => {
    const { publication, repo } = await boot()
    const first = await publication.publish(request(repo, { path: PATH, diff: repo.diff(PATH, SECOND) }))
    await publication.rotateSigningKey(PRIVATE_B, 'key-b', '2000-01-01T00:00:00.000Z')
    await expect(publication.read(first.commit, PATH)).rejects.toThrow('PUBLICATION_KEY_RETIRED')
  })

  it('refuses an untrusted publisher', async () => {
    const { publication, repo } = await boot({
      publisherId: 'publisher:other',
      trustedPublishers: ['publisher:qa'],
    })
    await expect(publication.publish(request(repo, { path: PATH, diff: repo.diff(PATH, SECOND) })))
      .rejects.toThrow('PUBLICATION_PUBLISHER_UNTRUSTED')
  })

  it('serializes concurrent publications into one commit and one activation', async () => {
    const { publication, repo, store } = await boot()
    const input = request(repo, { path: PATH, diff: repo.diff(PATH, SECOND) })
    const [first, second] = await Promise.all([
      publication.publish(input),
      publication.publish(input),
    ])
    expect(first.commit).toBe(second.commit)
    expect(first.activatedAt).toBe(second.activatedAt)
    expect(repo.commitCount()).toBe(2)
    expect(store.puts).toBe(2)
    expect(await publication.status(first.commit)).toBe('activated')
  })

  it('refuses a legacy row without a signed manifest', async () => {
    const { publication, repo, facility } = await boot()
    const receipt = await publication.publish(request(repo, { path: PATH, diff: repo.diff(PATH, SECOND) }))
    await rewriteRow(facility, receipt.commit, row => ({
      ...row, manifestKey: null, manifestJson: null, signature: null, keyId: null,
    }))
    await expect(publication.read(receipt.commit, PATH)).rejects.toThrow('PUBLICATION_INCOMPLETE')
    await expect(publication.status(receipt.commit)).rejects.toThrow('PUBLICATION_INCOMPLETE')
  })

  it('refuses a revision index that points at another commit', async () => {
    const { publication, repo, facility } = await boot()
    const first = await publication.publish(request(repo, { path: PATH, diff: repo.diff(PATH, SECOND) }))
    const second = await publication.publish(request(repo, {
      itemId: 'item-2', path: PATH, diff: repo.diff(PATH, `${SECOND}tres\n`), artifactHash: 'b'.repeat(64),
    }))
    const domain = facility.get('faberloom_publication')
    if (domain === undefined) throw new Error('publication domain missing')
    const secondIndex = domain.table('revisions').get(second.commit)
    if (secondIndex === undefined) throw new Error('second index missing')
    await domain.table('revisions').put(first.commit, secondIndex)
    await expect(publication.read(first.commit, PATH)).rejects.toThrow('PUBLICATION_NOT_FOUND')
    await expect(publication.status(first.commit)).rejects.toThrow('PUBLICATION_NOT_FOUND')
  })

  it('reports an incompatible manifest instead of serving it', async () => {
    const { publication, store, repo } = await boot()
    const receipt = await publication.publish(request(repo, { path: PATH, diff: repo.diff(PATH, SECOND) }))
    const key = receipt.manifestKey
    const stored = store.objects.get(key)
    if (stored === undefined) throw new Error('manifest missing')
    const manifest = JSON.parse(new TextDecoder().decode(stored.bytes)) as Record<string, unknown>
    manifest['formatVersion'] = 999
    store.objects.set(key, { ...stored, bytes: new TextEncoder().encode(JSON.stringify(manifest)) })
    await expect(publication.read(receipt.commit, PATH)).rejects.toThrow('PUBLICATION_MANIFEST_INVALID')
  })
})
