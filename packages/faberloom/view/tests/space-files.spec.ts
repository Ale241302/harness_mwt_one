import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readSpaceTree, resolveSpacePath, writeSpaceFile } from '../src/space-files.ts'

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

it('writes a nested file, creates its folders, and reports its digest', async () => {
  const root = fixture()

  const result = await writeSpaceFile(root, 'B2B/ENT_cliente.md', '# Cliente\n')

  expect(result.path).toBe('B2B/ENT_cliente.md')
  expect(result.bytes).toBe(Buffer.byteLength('# Cliente\n'))
  expect(result.sha256).toBe(createHash('sha256').update('# Cliente\n').digest('hex'))
  expect(readFileSync(join(root, 'B2B', 'ENT_cliente.md'), 'utf8')).toBe('# Cliente\n')
  expect(readdirSync(join(root, 'B2B'))).toEqual(['ENT_cliente.md'])
})

it('replaces the same path so a repeated import converges', async () => {
  const root = fixture()

  await writeSpaceFile(root, 'B2B/uno.md', 'primera')
  await writeSpaceFile(root, 'B2B/uno.md', 'segunda')

  expect(readFileSync(join(root, 'B2B', 'uno.md'), 'utf8')).toBe('segunda')
  expect(readdirSync(join(root, 'B2B'))).toEqual(['uno.md'])
})

it('refuses absolute paths, drive roots, and alias segments', async () => {
  const root = fixture()

  await expect(writeSpaceFile(root, '../fuera.md', 'x')).rejects.toThrow('ruta segura')
  await expect(writeSpaceFile(root, '/etc/passwd', 'x')).rejects.toThrow('relativa al espacio')
  await expect(writeSpaceFile(root, 'C:\\Windows\\x.md', 'x')).rejects.toThrow('relativa al espacio')
  await expect(writeSpaceFile(root, 'a/../../x.md', 'x')).rejects.toThrow('ruta segura')
})

it('refuses a file above the write cap', async () => {
  const root = fixture()

  await expect(writeSpaceFile(root, 'grande.md', 'x'.repeat(1_000_001))).rejects.toThrow('pasa de 1000000 bytes')
})

it.skipIf(process.platform === 'win32')('refuses to write through a symbolic link inside the area', async () => {
  const root = fixture()
  const outside = fixture()
  symlinkSync(outside, join(root, 'enlace'))

  await expect(writeSpaceFile(root, 'enlace/x.md', 'x')).rejects.toThrow('enlace simbólico')
  expect(readdirSync(outside)).toEqual([])
})
