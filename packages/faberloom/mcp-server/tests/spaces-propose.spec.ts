import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomBoard from '../../board/src/index.ts'
import FaberLoomPublication from '../../publication/src/index.ts'
import { MemoryPublicationStore } from '../../publication/tests/support/memory-store.ts'
import { createTestRepository, type TestRepository } from '../../publication/tests/support/git-repo.ts'
import FaberLoomSpaces from '../../spaces/src/index.ts'
import { FaberLoomToolHost } from '../src/tools.ts'
import { SPACES_PROPOSE_CHILDREN_TOOL } from '../src/protocol.ts'

const OWNER = 'owner@test'
const COMPANY = 'co-1'
const ACTOR = { id: OWNER, role: 'client_b2b', companyId: COMPANY, readOnly: false }
const WRITER = { id: OWNER, companyId: COMPANY }

const keys = generateKeyPairSync('ed25519')
const SIGNING_KEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()

let repositories: TestRepository[] = []

afterEach(() => {
  for (const repository of repositories) repository.dispose()
  repositories = []
})

/** Boot Spaces and Board, create the pair, then mount Publication with the child path. */
async function boot(): Promise<{
  readonly ctx: Context
  readonly repo: TestRepository
  readonly parentId: string
  readonly childId: string
  readonly path: string
}> {
  const repo = createTestRepository()
  repositories.push(repo)
  repo.commit('README.md', 'base\n', 'base')
  const path = 'knowledge/spaces/revisions.json'
  repo.commit(path, '{}\n', 'revisions')
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomSpaces)
  await ctx.plugin(FaberLoomBoard)
  const parent = await ctx.faberloomSpaces.create(ACTOR, { title: 'Padre' })
  await ctx.faberloomSpaces.update(ACTOR, parent.id, { context: { 'regla-padre': 'secreto del padre' } })
  const child = await ctx.faberloomSpaces.create(ACTOR, { title: 'Hijo', parentId: parent.id })
  await ctx.faberloomSpaces.update(ACTOR, child.id, { context: { 'regla-hija': 'contenido del hijo' } })
  const childId = String(child.id)
  await ctx.plugin(FaberLoomPublication, {
    repo: repo.root,
    endpoint: 'http://127.0.0.1:9000',
    bucket: 'faberloom-test',
    region: 'us-east-1',
    accessKey: 'test-access',
    secretKey: 'test-secret',
    publisherId: 'publisher:qa',
    signingKeyPem: SIGNING_KEY,
    keyId: 'qa-key',
    publicKeyPem: PUBLIC_KEY,
    inventory: [path],
  })
  const store = new MemoryPublicationStore()
  ctx.faberloomPublication.useObjectStore(store)
  return { ctx, repo, parentId: String(parent.id), childId, path }
}

describe('faberloom_spaces_propose_children', () => {
  it('opens a publishable proposal with the child content and the parent as a reference', async () => {
    const { ctx, repo, parentId, childId, path } = await boot()
    const host = new FaberLoomToolHost(ctx, OWNER, null, COMPANY)
    const result = await host.call(SPACES_PROPOSE_CHILDREN_TOOL, {
      parentId,
      revision: repo.head(),
      motivo: 'El padre cambió',
      evidencia: ['oc:1'],
    })
    const body = JSON.parse(result.content[0]?.text ?? '{}') as {
      proposals: { proposalId: string; children: string[] }[]
      skipped: { childId: string; reason: string }[]
    }
    expect(body.skipped).toEqual([])
    expect(body.proposals).toHaveLength(1)
    const proposal = body.proposals[0]
    expect(proposal?.children).toEqual([childId])

    const item = await ctx.faberloomBoard.get(WRITER, proposal?.proposalId as never)
    const content = item.content
    const diff = String(content['cambio'])
    expect(String(content['archivo'])).toBe(path)
    expect(diff).toContain(childId)
    expect(diff).toContain('regla-hija')
    expect(diff).toContain('contenido del hijo')
    expect(diff).not.toContain('regla-padre')
    expect(diff).not.toContain('secreto del padre')

    const receipt = await ctx.faberloomPublication.publish({
      itemId: String(item.id),
      revision: String(content['versionBase']),
      path: String(content['archivo']),
      diff: diff.endsWith('\n') ? diff : `${diff}\n`,
      motivo: String(content['motivo']),
      evidence: ['oc:1'],
      artifactHash: 'a'.repeat(64),
    })
    expect(receipt.state).toBe('activated')
    const read = await ctx.faberloomPublication.read(receipt.commit, path)
    expect(read.text).toContain('regla-hija')
    expect(read.text).not.toContain('regla-padre')

    // A second run against the new revision is unchanged; the last publication stands.
    const again = await host.call(SPACES_PROPOSE_CHILDREN_TOOL, {
      parentId,
      revision: receipt.commit,
      motivo: 'El padre cambió',
      evidencia: ['oc:1'],
    })
    const replay = JSON.parse(again.content[0]?.text ?? '{}') as { proposals: unknown[]; skipped: { reason: string }[] }
    expect(replay.proposals).toEqual([])
    expect(replay.skipped).toEqual([{ childId: '(batch)', reason: 'unchanged' }])
  })

  it('keeps the last publication when the context budget blocks the child', async () => {
    const { ctx, repo, parentId, childId } = await boot()
    const host = new FaberLoomToolHost(ctx, OWNER, null, COMPANY)
    const result = await host.call(SPACES_PROPOSE_CHILDREN_TOOL, {
      parentId,
      revision: repo.head(),
      motivo: 'El padre cambió',
      evidencia: ['oc:1'],
      maxBytes: 1,
    })
    const body = JSON.parse(result.content[0]?.text ?? '{}') as {
      proposals: unknown[]
      skipped: { childId: string; reason: string }[]
    }
    expect(body.proposals).toEqual([])
    expect(body.skipped).toEqual([{ childId, reason: 'context-budget' }])
  })
})
