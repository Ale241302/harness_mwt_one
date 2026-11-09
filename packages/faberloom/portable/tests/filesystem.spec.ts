import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stagePortable, planPortable, type PortableContribution, type PortableRequest } from '../src/index.ts'

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

/** One Ed25519 private key. */
function privateKey(): string {
  return generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
}

/** One request with fixed versions. */
function request(contributions: readonly PortableContribution[]): PortableRequest {
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
  }
}

/** One document contribution. */
function document(overrides: Partial<PortableContribution> = {}): PortableContribution {
  return {
    id: 'document:knowledge/a.md',
    kind: 'document',
    path: 'knowledge/a.md',
    title: 'A',
    content: 'Contenido.\n',
    classification: 'N2',
    ...overrides,
  }
}

describe('3A.2 filesystem rules', () => {
  it('refuses a duplicate path, a case alias, and a file used as a directory', () => {
    const stagingRoot = temporary('portable-stage-')
    const config = { stagingRoot, signingKeyPem: privateKey(), keyId: 'qa-key' }
    const duplicate = stagePortable(config, request([
      document(),
      document({ id: 'document:other' }),
    ]))
    expect(duplicate.manifest.files).toEqual([])
    expect(duplicate.rejected.length).toBeGreaterThan(0)
    expect(existsSync(join(duplicate.path, 'knowledge/a.md'))).toBe(false)

    const alias = stagePortable(config, request([
      document({ path: 'Knowledge/A.md' }),
      document({ id: 'document:lower', path: 'knowledge/a.md' }),
    ]))
    expect(alias.manifest.files).toEqual([])

    const prefix = stagePortable(config, request([
      document({ id: 'document:file', path: 'knowledge' }),
      document({ id: 'document:inside', path: 'knowledge/b.md', title: 'B' }),
    ]))
    expect(prefix.manifest.files).toEqual([])
  })

  it('refuses a case-variant file and directory overlap before writing', () => {
    const stagingRoot = temporary('portable-stage-')
    const config = { stagingRoot, signingKeyPem: privateKey(), keyId: 'qa-key' }
    const staged = stagePortable(config, request([
      document({ id: 'document:file', path: 'A' }),
      document({ id: 'document:inside', path: 'a/b.md', title: 'B' }),
    ]))
    expect(staged.manifest.files).toEqual([])
    expect(existsSync(join(staged.path, 'A'))).toBe(false)
  })

  it('refuses an unpaired surrogate path instead of writing a different name', () => {
    const planned = planPortable(request([document({ path: 'knowledge/a\uD800b.md' })]))
    expect(planned.files).toEqual([])
    expect(planned.rejected).toEqual([{ path: '(invalid)', reason: 'path-invalid' }])
  })

  it('refuses traversal, an absolute path, and the reserved manifest name', () => {
    const stagingRoot = temporary('portable-stage-')
    const config = { stagingRoot, signingKeyPem: privateKey(), keyId: 'qa-key' }
    const staged = stagePortable(config, request([
      document({ id: 'document:traversal', path: '../outside.md' }),
      document({ id: 'document:absolute', path: 'C:/outside.md' }),
      document({ id: 'document:reserved', path: 'manifest.json' }),
      document({ id: 'document:reserved-signature', path: 'manifest.sig.json' }),
      document({ id: 'document:reserved-metadata', path: '.faberloom/ownership.json' }),
    ]))
    expect(staged.manifest.files).toEqual([])
    expect(staged.rejected.every(reason => reason.reason === 'path-invalid')).toBe(true)
    expect(existsSync(join(stagingRoot, '..', 'outside.md'))).toBe(false)
  })

  it('refuses a symlinked or missing staging root without writing into it', () => {
    const target = temporary('portable-target-')
    const link = join(temporary('portable-link-parent-'), 'staging')
    symlinkSync(target, link, 'junction')
    const keys = { signingKeyPem: privateKey(), keyId: 'qa-key' }

    expect(() => stagePortable({ stagingRoot: link, ...keys }, request([document()]))).toThrow('PORTABLE_SYMLINK')
    expect(readdirSync(target)).toEqual([])

    expect(() => stagePortable({ stagingRoot: join(target, 'missing'), ...keys }, request([document()])))
      .toThrow('PORTABLE_STAGING')
  })

  it('leaves an earlier valid artifact untouched when a later staging request is refused', () => {
    const stagingRoot = temporary('portable-stage-')
    const config = { stagingRoot, signingKeyPem: privateKey(), keyId: 'qa-key' }
    const first = stagePortable(config, request([document()]))
    expect(existsSync(join(first.path, 'knowledge/a.md'))).toBe(true)

    expect(() => stagePortable({ ...config, stagingRoot: join(stagingRoot, 'missing') }, request([document()])))
      .toThrow('PORTABLE_STAGING')
    expect(existsSync(join(first.path, 'knowledge/a.md'))).toBe(true)
  })
})
