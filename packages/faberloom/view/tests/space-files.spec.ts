import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  assertSpaceParentRealPath, assertSpaceRealPath, isLinkedSpaceEntry, readSpaceTree, resolveSpacePath,
} from '../src/space-files.ts'

const roots: string[] = []

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'space-files-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('reads the whole area with paths, kinds, sizes, and hidden entries', async () => {
  const root = fixture()
  mkdirSync(join(root, 'skills'))
  mkdirSync(join(root, '.agents'))
  writeFileSync(join(root, 'skills', 'uno.md'), 'uno')
  writeFileSync(join(root, 'AGENTS.md'), '# reglas\n')
  writeFileSync(join(root, '.env'), 'A=1\n')

  const rows = await readSpaceTree(root)
  const byPath = new Map(rows.map(row => [row.path, row]))

  expect(byPath.get('skills')?.kind).toBe('directory')
  expect(byPath.get('skills/uno.md')?.bytes).toBe(3)
  expect(byPath.get('.agents')?.kind).toBe('directory')
  expect(byPath.get('.env')?.name).toBe('.env')
  expect(byPath.get('AGENTS.md')?.bytes).toBe('# reglas\n'.length)
  expect(Date.parse(byPath.get('AGENTS.md')?.modifiedAt ?? '')).toBeGreaterThan(0)
  expect(Date.parse(byPath.get('AGENTS.md')?.createdAt ?? '')).toBeGreaterThan(0)
})

it('lists a folder before the files it contains', async () => {
  const root = fixture()
  mkdirSync(join(root, 'carpeta'))
  writeFileSync(join(root, 'carpeta', 'dentro.pdf'), 'pdf')
  writeFileSync(join(root, 'suelto.txt'), 'txt')

  const paths = (await readSpaceTree(root)).map(row => row.path)

  expect(paths.indexOf('carpeta')).toBeLessThan(paths.indexOf('carpeta/dentro.pdf'))
})

it('refuses a path that leaves the area and reads an absent folder as empty', async () => {
  const root = fixture()

  expect(() => resolveSpacePath(root, '../')).toThrow('fuera de la carpeta')
  expect(() => resolveSpacePath(root, 'docs/../..')).toThrow('fuera de la carpeta')
  await expect(readSpaceTree(join(root, 'todavia-no-existe'))).resolves.toEqual([])
})

it('refuses a link inside the area that resolves outside it', async () => {
  const root = fixture()
  const outside = fixture()
  writeFileSync(join(outside, 'secreto.txt'), 'x')
  symlinkSync(outside, join(root, 'enlace'), process.platform === 'win32' ? 'junction' : 'dir')

  await expect(assertSpaceRealPath(root, resolveSpacePath(root, 'enlace/secreto.txt')))
    .rejects.toThrow('fuera de la carpeta')
  await expect(assertSpaceParentRealPath(root, resolveSpacePath(root, 'enlace/nuevo.txt')))
    .rejects.toThrow('fuera de la carpeta')
  await expect(isLinkedSpaceEntry(join(root, 'enlace'))).resolves.toBe(true)
})

it('accepts a real entry and a new name in a real folder', async () => {
  const root = fixture()
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'uno.pdf'), 'pdf')

  await expect(assertSpaceRealPath(root, resolveSpacePath(root, 'docs/uno.pdf'))).resolves.toBeUndefined()
  await expect(assertSpaceParentRealPath(root, resolveSpacePath(root, 'docs/dos.pdf'))).resolves.toBeUndefined()
  await expect(isLinkedSpaceEntry(join(root, 'docs', 'uno.pdf'))).resolves.toBe(false)
})
