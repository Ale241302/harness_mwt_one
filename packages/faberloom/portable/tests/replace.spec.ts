import { generateKeyPairSync } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  replacePortable,
  verifyPortableArtifact,
  type PortableContribution,
  type PortableReplaceHooks,
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

/** One Ed25519 pair used by every replace in this spec. */
const KEYS = generateKeyPairSync('ed25519')
const SIGNING_KEY = KEYS.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUBLIC_KEY = KEYS.publicKey.export({ type: 'spki', format: 'pem' }).toString()

/** One request with fixed versions. */
function request(
  contributions: readonly PortableContribution[],
  spaceId = 'sp-1',
): PortableRequest {
  return {
    identity: {
      spaceId,
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
    content: 'Contenido A.\n',
    classification: 'N2',
    ...overrides,
  }
}

/** One skill contribution. */
function skill(overrides: Partial<PortableContribution> = {}): PortableContribution {
  return {
    id: 'skill:saludo',
    kind: 'skill',
    path: 'skills/saludo/SKILL.md',
    title: 'saludo',
    content: '---\nname: saludo\ndescription: Saluda\n---\n\nSaluda.\n',
    classification: 'N2',
    ...overrides,
  }
}

/** One replace config over a temporary parent. */
function config(destination: string, hooks?: PortableReplaceHooks): {
  destination: string
  signingKeyPem: string
  keyId: string
  hooks?: PortableReplaceHooks
} {
  return { destination, signingKeyPem: SIGNING_KEY, keyId: 'qa-key', ...hooks === undefined ? {} : { hooks } }
}

/** Parent entries that belong to the replace writer. */
function writerEntries(parent: string): string[] {
  return readdirSync(parent).filter(name => (
    name.startsWith('.faberloom-staging-')
    || name.startsWith('.faberloom-backup-')
    || name.startsWith('.faberloom-replace-')
  ))
}

/** One crash marker the writer leaves for the next run. */
function crash(): Error {
  return Object.assign(new Error('simulated crash'), { faberloomCrash: true })
}

describe('3B.2 replace writer', () => {
  it('restores the previous tree when the swap is blocked', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))

    expect(() => replacePortable(
      config(destination, { afterBackup: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }) } }),
      request([document({ content: 'A2.\n' })]),
    )).toThrow('PORTABLE_WRITE_FAILED')
    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('Contenido A.\n')
    expect(writerEntries(parent)).toEqual([])
  })

  it('preserves foreign bytes exactly and refuses an occupied destination file', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    mkdirSync(destination)
    const binary = Buffer.from([0, 255, 1, 2, 128])
    writeFileSync(join(destination, 'binary.bin'), binary)
    replacePortable(config(destination), request([document()]))
    expect(readFileSync(join(destination, 'binary.bin'))).toEqual(binary)

    const occupied = join(parent, 'occupied')
    writeFileSync(occupied, 'no soy un directorio\n', 'utf8')
    expect(() => replacePortable(config(occupied), request([document()])))
      .toThrow('PORTABLE_DESTINATION')
    expect(readFileSync(occupied, 'utf8')).toBe('no soy un directorio\n')
  })

  it('refuses a Unicode alias of a foreign file', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    mkdirSync(destination)
    writeFileSync(join(destination, 'café.md'), 'ajeno\n', 'utf8')
    expect(() => replacePortable(config(destination), request([
      document({ id: 'document:cafe', path: 'cafe\u0301.md', title: 'Café' }),
    ]))).toThrow('PORTABLE_FOREIGN_CONFLICT')
    expect(readFileSync(join(destination, 'café.md'), 'utf8')).toBe('ajeno\n')
  })

  it('treats an edited manifest as a manual edit', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))
    writeFileSync(join(destination, 'manifest.json'), '{"editado":true}\n', 'utf8')
    expect(() => replacePortable(config(destination), request([document({ content: 'A2.\n' })])))
      .toThrow('PORTABLE_MANUAL_EDIT')
  })

  it.skipIf(process.platform === 'win32')('preserves the mode of a foreign file', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    mkdirSync(destination)
    writeFileSync(join(destination, 'script.sh'), '#!/bin/sh\n', { mode: 0o755 })
    replacePortable(config(destination), request([document()]))
    const stat = lstatSync(join(destination, 'script.sh'))
    expect(stat.mode & 0o777).toBe(0o755)
  })

  it.skipIf(process.platform !== 'win32')('does not report a case-only rename as removed', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document({ path: 'knowledge/A.md' })]))
    const result = replacePortable(config(destination), request([document({ path: 'knowledge/a.md' })]))
    expect(result.removed).toEqual([])
  })

  it('refuses a foreign detached signature path', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))
    writeFileSync(join(destination, 'manifest.sig.json'), '{}\n', 'utf8')
    expect(() => replacePortable(config(destination), request([document({ content: 'A2.\n' })])))
      .toThrow('PORTABLE_FOREIGN_CONFLICT')
  })

  it('verifies the managed destination with the package verifier', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    const result = replacePortable(config(destination), request([document()]))
    expect(verifyPortableArtifact(destination, result.signature, PUBLIC_KEY, 'qa-key'))
      .toEqual({ ok: true, reasons: [] })
  })

  it('refuses a foreign file created during the staging write', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))

    expect(() => replacePortable(
      config(destination, { beforeWrite: () => { writeFileSync(join(destination, 'nuevo.txt'), 'creado\n', 'utf8') } }),
      request([document({ content: 'A2.\n' })]),
    )).toThrow('PORTABLE_CONCURRENT_CHANGE')
    expect(readFileSync(join(destination, 'nuevo.txt'), 'utf8')).toBe('creado\n')
    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('Contenido A.\n')
    expect(writerEntries(parent)).toEqual([])
  })

  it('refuses a managed edit or a foreign deletion during the staging write without leaking staging', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))
    writeFileSync(join(destination, 'foreign.txt'), 'ajeno\n', 'utf8')

    expect(() => replacePortable(
      config(destination, { beforeWrite: () => { writeFileSync(join(destination, 'knowledge/a.md'), 'editado\n', 'utf8') } }),
      request([document({ content: 'A2.\n' })]),
    )).toThrow('PORTABLE_MANUAL_EDIT')
    expect(writerEntries(parent)).toEqual([])

    writeFileSync(join(destination, 'knowledge/a.md'), 'Contenido A.\n', 'utf8')
    expect(() => replacePortable(
      config(destination, { beforeWrite: () => { unlinkSync(join(destination, 'foreign.txt')) } }),
      request([document({ content: 'A3.\n' })]),
    )).toThrow('PORTABLE_CONCURRENT_CHANGE')
    expect(writerEntries(parent)).toEqual([])
    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('Contenido A.\n')
  })

  it('keeps the verified tree when the journal update fails after the swap', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))

    const result = replacePortable(
      config(destination, {
        afterBackup: () => {
          const journal = readdirSync(parent).find(name => name.startsWith('.faberloom-replace-'))
          if (journal === undefined) throw new Error('journal missing')
          unlinkSync(join(parent, journal))
          mkdirSync(join(parent, journal))
        },
      }),
      request([document({ content: 'A2.\n' })]),
    )
    expect(result.cleanupPending).toBe(true)
    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('A2.\n')
  })

  it('commits the verified tree and leaves cleanup to the next run when cleanup fails', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))

    const result = replacePortable(
      config(destination, { beforeCleanup: () => { throw Object.assign(new Error('busy file'), { code: 'EBUSY' }) } }),
      request([document({ content: 'A2.\n' })]),
    )
    expect(result.cleanupPending).toBe(true)
    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('A2.\n')
    expect(writerEntries(parent).length).toBeGreaterThan(0)

    const next = replacePortable(config(destination), request([document({ content: 'A3.\n' })]))
    expect(next.cleanupPending).toBe(false)
    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('A3.\n')
    expect(writerEntries(parent)).toEqual([])
  })

  it('recovers a crash through a differently-cased destination on Windows', () => {
    if (process.platform !== 'win32') return
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))

    expect(() => replacePortable(
      config(destination, { afterBackup: () => { throw crash() } }),
      request([document({ content: 'A2.\n' })]),
    )).toThrow('simulated crash')
    const result = replacePortable(config(join(parent, 'SPACE')), request([document({ content: 'A3.\n' })]))
    expect(result.path.toLowerCase()).toBe(destination.toLowerCase())
    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('A3.\n')
    expect(writerEntries(parent)).toEqual([])
  })

  it('refuses a forged journal without deleting the destination or a planted tree', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))
    expect(() => replacePortable(
      config(destination, { afterBackup: () => { throw crash() } }),
      request([document({ content: 'A2.\n' })]),
    )).toThrow('simulated crash')
    const victim = join(parent, '.faberloom-staging-victim')
    mkdirSync(victim)
    writeFileSync(join(victim, 'keep.txt'), 'no borrar\n', 'utf8')
    const journal = readdirSync(parent).find(name => name.startsWith('.faberloom-replace-'))
    if (journal === undefined) throw new Error('journal missing')
    writeFileSync(join(parent, journal), '{}\n', 'utf8')

    expect(() => replacePortable(config(destination), request([document({ content: 'A3.\n' })])))
      .toThrow('PORTABLE_RECOVERY')
    expect(readFileSync(join(victim, 'keep.txt'), 'utf8')).toBe('no borrar\n')
    expect(readdirSync(parent).some(name => name.startsWith('.faberloom-backup-'))).toBe(true)
  })

  it('creates a destination and preserves a foreign file', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    mkdirSync(destination)
    mkdirSync(join(destination, 'vacia'))
    writeFileSync(join(destination, 'foreign.txt'), 'ajeno\n', 'utf8')

    const result = replacePortable(config(destination), request([document()]))

    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('Contenido A.\n')
    expect(readFileSync(join(destination, 'foreign.txt'), 'utf8')).toBe('ajeno\n')
    expect(existsSync(join(destination, 'vacia'))).toBe(true)
    expect(result.preserved).toEqual(['foreign.txt'])
    expect(result.preservedDirectories).toEqual(['vacia'])
    expect(result.removed).toEqual([])
    const ownership = JSON.parse(readFileSync(join(destination, '.faberloom/ownership.json'), 'utf8')) as {
      files: { path: string }[]
      artifactDigest: string
    }
    expect(ownership.artifactDigest).toBe(result.digest)
    expect(ownership.files.map(file => file.path)).toEqual(['knowledge/a.md', 'manifest.json'])
    expect(writerEntries(parent)).toEqual([])
  })

  it('updates a managed file, removes a dropped file, and keeps foreign files', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document(), skill()]))
    writeFileSync(join(destination, 'notes.txt'), 'mías\n', 'utf8')

    const result = replacePortable(config(destination), request([
      document({ content: 'Contenido A2.\n' }),
      document({ id: 'document:knowledge/b.md', path: 'knowledge/b.md', title: 'B', content: 'B.\n' }),
    ]))

    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('Contenido A2.\n')
    expect(readFileSync(join(destination, 'knowledge/b.md'), 'utf8')).toBe('B.\n')
    expect(existsSync(join(destination, 'skills/saludo/SKILL.md'))).toBe(false)
    expect(readFileSync(join(destination, 'notes.txt'), 'utf8')).toBe('mías\n')
    expect(result.removed).toEqual(['skills/saludo/SKILL.md'])
    expect(result.preserved).toEqual(['notes.txt'])
  })

  it('refuses an edited or removed managed file and leaves the destination unchanged', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))
    writeFileSync(join(destination, 'knowledge/a.md'), 'editado a mano\n', 'utf8')

    expect(() => replacePortable(config(destination), request([document({ content: 'nuevo\n' })])))
      .toThrow('PORTABLE_MANUAL_EDIT')
    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('editado a mano\n')

    unlinkSync(join(destination, 'knowledge/a.md'))
    expect(() => replacePortable(config(destination), request([document()])))
      .toThrow('PORTABLE_MANUAL_EDIT')
  })

  it('refuses to overwrite a foreign file and a case alias', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))
    writeFileSync(join(destination, 'knowledge/b.md'), 'ajeno\n', 'utf8')

    expect(() => replacePortable(config(destination), request([
      document({ id: 'document:knowledge/b.md', path: 'knowledge/b.md', title: 'B' }),
    ]))).toThrow('PORTABLE_FOREIGN_CONFLICT')
    expect(readFileSync(join(destination, 'knowledge/b.md'), 'utf8')).toBe('ajeno\n')

    expect(() => replacePortable(config(destination), request([
      document({ id: 'document:alias', path: 'Knowledge/B.md', title: 'Alias' }),
    ]))).toThrow('PORTABLE_FOREIGN_CONFLICT')
  })

  it('refuses a symlinked destination and a junction inside it', () => {
    const parent = temporary('portable-replace-')
    const target = join(parent, 'target')
    mkdirSync(target)
    const link = join(parent, 'linked')
    symlinkSync(target, link, 'junction')
    expect(() => replacePortable(config(link), request([document()]))).toThrow('PORTABLE_SYMLINK')
    expect(readdirSync(target)).toEqual([])

    const destination = join(parent, 'space')
    const outside = join(parent, 'outside')
    mkdirSync(destination)
    mkdirSync(outside)
    symlinkSync(outside, join(destination, 'inside-link'), 'junction')
    expect(() => replacePortable(config(destination), request([document()]))).toThrow('PORTABLE_SYMLINK')
    expect(readdirSync(outside)).toEqual([])
  })

  it('refuses a relative, UNC, or parent-escaping destination', () => {
    const parent = temporary('portable-replace-')
    expect(() => replacePortable(config('relative/space'), request([document()])))
      .toThrow('PORTABLE_DESTINATION')
    expect(() => replacePortable(config('\\\\server\\share\\space'), request([document()])))
      .toThrow('PORTABLE_DESTINATION')
    expect(() => replacePortable(config(`${parent}\\a\\..\\space`), request([document()])))
      .toThrow('PORTABLE_DESTINATION')
  })

  it('refuses another Space and a tampered ownership manifest', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))
    expect(() => replacePortable(config(destination), request([document()], 'sp-2')))
      .toThrow('PORTABLE_IDENTITY_CONFLICT')

    const ownershipPath = join(destination, '.faberloom/ownership.json')
    const ownership = JSON.parse(readFileSync(ownershipPath, 'utf8')) as { files: unknown[] }
    ownership.files.push({ path: 'foreign.txt', bytes: 1, sha256: 'a'.repeat(64) })
    writeFileSync(ownershipPath, JSON.stringify(ownership), 'utf8')
    expect(() => replacePortable(config(destination), request([document()])))
      .toThrow('PORTABLE_OWNERSHIP_INVALID')
  })

  it('recovers the previous tree after a crash between backup and swap', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))

    expect(() => replacePortable(
      config(destination, { afterBackup: () => { throw crash() } }),
      request([document({ content: 'A2.\n' })]),
    )).toThrow('simulated crash')
    expect(writerEntries(parent).length).toBeGreaterThan(0)

    const result = replacePortable(config(destination), request([document({ content: 'A3.\n' })]))
    expect(result.written).toContain('knowledge/a.md')
    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('A3.\n')
    expect(writerEntries(parent)).toEqual([])
  })

  it('keeps the new tree and removes the backup after a crash following the swap', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))

    expect(() => replacePortable(
      config(destination, { afterSwap: () => { throw crash() } }),
      request([document({ content: 'A2.\n' })]),
    )).toThrow('simulated crash')
    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('A2.\n')

    const result = replacePortable(config(destination), request([document({ content: 'A3.\n' })]))
    expect(result.written).toContain('knowledge/a.md')
    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('A3.\n')
    expect(writerEntries(parent)).toEqual([])
  })

  it('keeps the previous tree on a failed staging write and on a concurrent foreign edit', () => {
    const parent = temporary('portable-replace-')
    const destination = join(parent, 'space')
    replacePortable(config(destination), request([document()]))
    writeFileSync(join(destination, 'foreign.txt'), 'ajeno\n', 'utf8')

    expect(() => replacePortable(
      config(destination, { beforeWrite: () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }) } }),
      request([document({ content: 'A2.\n' })]),
    )).toThrow('PORTABLE_WRITE_FAILED')
    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('Contenido A.\n')
    expect(writerEntries(parent)).toEqual([])

    expect(() => replacePortable(
      config(destination, { beforeWrite: () => { writeFileSync(join(destination, 'foreign.txt'), 'cambiado\n', 'utf8') } }),
      request([document({ content: 'A3.\n' })]),
    )).toThrow('PORTABLE_CONCURRENT_CHANGE')
    expect(readFileSync(join(destination, 'foreign.txt'), 'utf8')).toBe('cambiado\n')
    expect(readFileSync(join(destination, 'knowledge/a.md'), 'utf8')).toBe('Contenido A.\n')
  })
})
