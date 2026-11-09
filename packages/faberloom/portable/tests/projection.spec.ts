import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  committedDocuments,
  contributionsFromUsage,
  planPortable,
  sha256OfText,
  stagePortable,
  verifyPortableArtifact,
  type PortableContribution,
  type PortableRequest,
} from '../src/index.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One temporary directory owned by this spec. */
function temporary(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/** One Ed25519 pair; the public key is the out-of-band trust anchor. */
function keyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

/** One git runner for a temporary repository. */
function gitAt(root: string): (args: readonly string[], input?: string) => string {
  return (args, input) => execFileSync(
    'git',
    ['-C', root, ...args],
    { encoding: 'utf8', ...(input === undefined ? {} : { input }) },
  )
}

/** One request with fixed versions, so two runs are comparable. */
function request(contributions: readonly PortableContribution[], overrides: Partial<PortableRequest> = {}): PortableRequest {
  return {
    identity: {
      spaceId: 'sp-1',
      spaceTitle: 'Espacio QA',
      editorialRevision: 'a'.repeat(40),
      parentRevision: null,
    },
    generatedAt: '2026-11-09T00:00:00.000Z',
    softwareVersion: '1.0.0',
    contributions,
    ...overrides,
  }
}

/** One document contribution. */
const document: PortableContribution = {
  id: 'document:knowledge/a.md',
  kind: 'document',
  path: 'knowledge/a.md',
  title: 'Procedimiento',
  content: '# A\n\nContenido permitido.\n',
  classification: 'N2',
}

/** One skill contribution. */
const skill: PortableContribution = {
  id: 'skill:saludo',
  kind: 'skill',
  path: 'skills/saludo/SKILL.md',
  title: 'saludo',
  content: '---\nname: saludo\ndescription: Saluda al cliente\n---\n\nSaluda.\n',
  classification: 'N2',
}

describe('3A.2 portable artifact', () => {
  it('writes a document and a skill with a complete inventory and a valid signature', () => {
    const keys = keyPair()
    const stagingRoot = temporary('portable-stage-')
    const staged = stagePortable(
      { stagingRoot, signingKeyPem: keys.privateKeyPem, keyId: 'qa-key' },
      request([document, skill]),
    )

    expect(staged.written).toEqual(['knowledge/a.md', 'skills/saludo/SKILL.md', 'manifest.json'])
    expect(staged.manifest.files.map(file => file.path)).toEqual(['knowledge/a.md', 'skills/saludo/SKILL.md'])
    for (const file of staged.manifest.files) {
      const content = readFileSync(join(staged.path, file.path), 'utf8')
      expect(file.bytes).toBe(Buffer.byteLength(content, 'utf8'))
      expect(file.sha256).toBe(sha256OfText(content))
    }
    expect(staged.manifest.formatVersion).toBe(1)
    expect(staged.manifest.contentVersion).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(staged.manifest.softwareVersion).toBe('1.0.0')
    expect(staged.manifest.digest).toMatch(/^[0-9a-f]{64}$/u)
    expect(verifyPortableArtifact(staged.path, staged.signature, keys.publicKeyPem)).toEqual({ ok: true, reasons: [] })
  })

  it('is reproducible across two staging directories', () => {
    const keys = keyPair()
    const stagingRoot = temporary('portable-stage-')
    const config = { stagingRoot, signingKeyPem: keys.privateKeyPem, keyId: 'qa-key' }
    const first = stagePortable(config, request([document, skill]))
    const second = stagePortable(config, request([document, skill]))

    expect(first.path).not.toBe(second.path)
    expect(first.manifest).toEqual(second.manifest)
    expect(first.digest).toBe(second.digest)
    for (const file of first.written) {
      expect(readFileSync(join(first.path, file), 'utf8')).toBe(readFileSync(join(second.path, file), 'utf8'))
    }
  })

  it('changes the content version only when the inventory changes', () => {
    const keys = keyPair()
    const stagingRoot = temporary('portable-stage-')
    const config = { stagingRoot, signingKeyPem: keys.privateKeyPem, keyId: 'qa-key' }
    const base = stagePortable(config, request([document]))
    const content = stagePortable(config, request([{ ...document, content: '# A\n\nOtro contenido.\n' }]))
    const software = stagePortable(config, request([document], { softwareVersion: '1.0.1' }))

    expect(content.manifest.contentVersion).not.toBe(base.manifest.contentVersion)
    expect(content.manifest.digest).not.toBe(base.manifest.digest)
    expect(software.manifest.contentVersion).toBe(base.manifest.contentVersion)
    expect(software.manifest.digest).not.toBe(base.manifest.digest)
    expect(software.manifest.formatVersion).toBe(base.manifest.formatVersion)
  })

  it('changes the content version when metadata changes', () => {
    const keys = keyPair()
    const stagingRoot = temporary('portable-stage-')
    const config = { stagingRoot, signingKeyPem: keys.privateKeyPem, keyId: 'qa-key' }
    const base = stagePortable(config, request([document]))
    const metadata = stagePortable(config, request([{ ...document, metadata: { owner: 'qa' } }]))

    expect(metadata.manifest.contentVersion).not.toBe(base.manifest.contentVersion)
    expect(metadata.manifest.files[0]?.metadataSha256).not.toBe(base.manifest.files[0]?.metadataSha256)
    expect(metadata.manifest.digest).not.toBe(base.manifest.digest)
  })

  it('changes the digest when the space identity changes', () => {
    const keys = keyPair()
    const stagingRoot = temporary('portable-stage-')
    const config = { stagingRoot, signingKeyPem: keys.privateKeyPem, keyId: 'qa-key' }
    const base = stagePortable(config, request([document]))
    const renamed = stagePortable(config, request([document], {
      identity: { ...request([]).identity, spaceTitle: 'Otro espacio' },
    }))

    expect(renamed.manifest.contentVersion).toBe(base.manifest.contentVersion)
    expect(renamed.manifest.digest).not.toBe(base.manifest.digest)
  })

  it('reads the authorized commit, not the moving work tree', () => {
    const root = temporary('portable-git-')
    const git = gitAt(root)
    git(['init', '--initial-branch=main'])
    git(['config', 'user.email', 'qa@faberloom.invalid'])
    git(['config', 'user.name', 'FaberLoom QA'])
    git(['config', 'core.autocrlf', 'false'])
    git(['config', 'commit.gpgsign', 'false'])
    mkdirSync(dirname(join(root, 'knowledge', 'a.md')), { recursive: true })
    writeFileSync(join(root, 'knowledge', 'a.md'), '# A\n\nVersion uno.\n', 'utf8')
    git(['add', '--', 'knowledge/a.md'])
    git(['commit', '--no-gpg-sign', '-m', 'base'])
    const revision = git(['rev-parse', 'HEAD']).trim()
    writeFileSync(join(root, 'knowledge', 'a.md'), '# A\n\nVersion dos.\n', 'utf8')

    const documents = committedDocuments({
      repo: root,
      revision,
      paths: ['knowledge/a.md'],
      classifications: { 'knowledge/a.md': 'N2' },
    })
    expect(documents[0]?.content).toContain('Version uno')
    const staged = stagePortable(
      { stagingRoot: temporary('portable-stage-'), signingKeyPem: keyPair().privateKeyPem, keyId: 'qa-key' },
      request(documents, { identity: { ...request([]).identity, editorialRevision: revision } }),
    )
    expect(readFileSync(join(staged.path, 'knowledge/a.md'), 'utf8')).toContain('Version uno')
  })

  it('ignores replace refs and refuses a short revision', () => {
    const root = temporary('portable-git-')
    const git = gitAt(root)
    git(['init', '--initial-branch=main'])
    git(['config', 'user.email', 'qa@faberloom.invalid'])
    git(['config', 'user.name', 'FaberLoom QA'])
    git(['config', 'core.autocrlf', 'false'])
    mkdirSync(dirname(join(root, 'knowledge', 'a.md')), { recursive: true })
    writeFileSync(join(root, 'knowledge', 'a.md'), 'APROBADO\n', 'utf8')
    git(['add', '--', 'knowledge/a.md'])
    git(['commit', '--no-gpg-sign', '-m', 'base'])
    const revision = git(['rev-parse', 'HEAD']).trim()
    const blob = git(['rev-parse', 'HEAD:knowledge/a.md']).trim()
    const attack = git(['hash-object', '-w', '--stdin'], 'ATACANTE\n').trim()
    git(['replace', blob, attack])

    const documents = committedDocuments({
      repo: root,
      revision,
      paths: ['knowledge/a.md'],
      classifications: { 'knowledge/a.md': 'N2' },
    })
    expect(documents[0]?.content).toBe('APROBADO\n')
    expect(() => committedDocuments({
      repo: root,
      revision: revision.slice(0, 7),
      paths: ['knowledge/a.md'],
      classifications: { 'knowledge/a.md': 'N2' },
    })).toThrow('PORTABLE_SOURCE')
  })

  it('maps projection records without inventing a classification', () => {
    const contributions = contributionsFromUsage({
      agents: [{ id: 'ag-1', name: 'Comprador', responsibility: 'Compra.', skills: ['saludo'] }],
      skills: [{ name: 'saludo', description: 'Saluda', content: 'Saluda.' }],
      workflows: [{ id: 'wf-1', name: 'Pedido', status: 'active' }],
      routines: [{ id: 'rt-1', name: 'Diaria', status: 'active' }],
      memory: [{ id: 'mem-1', text: 'Recuerda', source: 'space' }],
    }, {
      classifications: {
        'agent:ag-1': 'N2',
        'skill:saludo': 'N2',
        'workflow:wf-1': 'N1',
        'routine:rt-1': 'N1',
      },
    })
    expect(contributions.map(entry => entry.id)).toEqual([
      'agent:ag-1', 'memory:space:mem-1', 'routine:rt-1', 'skill:saludo', 'workflow:wf-1',
    ])
    const planned = planPortable(request(contributions))
    expect(planned.files.map(file => file.path)).toEqual([
      'agents/comprador-ag-1.md', 'metadata/routines/rt-1.json', 'metadata/workflows/wf-1.json', 'skills/saludo/SKILL.md',
    ])
    expect(planned.rejected).toEqual([{ path: '(restricted)', reason: 'classification-missing' }])
  })

  it('detects tampering and a wrong trust anchor', () => {
    const keys = keyPair()
    const staged = stagePortable(
      { stagingRoot: temporary('portable-stage-'), signingKeyPem: keys.privateKeyPem, keyId: 'qa-key' },
      request([document]),
    )
    writeFileSync(join(staged.path, 'knowledge/a.md'), 'alterado\n', 'utf8')

    const tampered = verifyPortableArtifact(staged.path, staged.signature, keys.publicKeyPem)
    expect(tampered.ok).toBe(false)
    expect(tampered.reasons.some(reason => reason.startsWith('sha256:'))).toBe(true)

    const other = keyPair()
    const wrongAnchor = verifyPortableArtifact(staged.path, staged.signature, other.publicKeyPem)
    expect(wrongAnchor.reasons).toContain('signature')

    const wrongKeyId = verifyPortableArtifact(staged.path, staged.signature, keys.publicKeyPem, 'other-key')
    expect(wrongKeyId.reasons).toContain('signature')
  })
})
