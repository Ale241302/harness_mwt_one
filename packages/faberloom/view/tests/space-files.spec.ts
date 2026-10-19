import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { listSpaceDirectory } from '../src/space-files.ts'

const roots: string[] = []

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'space-files-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('lists directories first and includes hidden entries', async () => {
  const root = fixture()
  mkdirSync(join(root, 'skills'))
  mkdirSync(join(root, '.agents'))
  writeFileSync(join(root, 'AGENTS.md'), '# reglas\n')
  writeFileSync(join(root, '.env'), 'A=1\n')

  const rows = await listSpaceDirectory(root, '')

  expect(rows.slice(0, 2).map(row => [row.name, row.kind])).toEqual([
    ['.agents', 'directory'],
    ['skills', 'directory'],
  ])
  expect(rows.map(row => row.name)).toContain('.env')
  expect(rows.find(row => row.name === 'AGENTS.md')?.bytes).toBe('# reglas\n'.length)
  expect(rows.find(row => row.name === 'skills')?.bytes).toBe(0)
})

it('lists one subdirectory and refuses a path that leaves the area', async () => {
  const root = fixture()
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'contrato.pdf'), 'pdf')

  const inner = await listSpaceDirectory(root, 'docs')
  expect(inner.map(row => row.name)).toEqual(['contrato.pdf'])

  await expect(listSpaceDirectory(root, '../')).rejects.toThrow('fuera de la carpeta')
  await expect(listSpaceDirectory(root, 'docs/../..')).rejects.toThrow('fuera de la carpeta')
  await expect(listSpaceDirectory(root, 'todavia-no-existe')).resolves.toEqual([])
})

it('reports a file modification time', async () => {
  const root = fixture()
  writeFileSync(join(root, 'uno.md'), 'x')

  const [row] = await listSpaceDirectory(root, '')

  expect(row?.kind).toBe('file')
  expect(Date.parse(row?.modifiedAt ?? '')).toBeGreaterThan(0)
})
