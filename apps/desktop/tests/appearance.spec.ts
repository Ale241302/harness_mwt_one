import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { APPEARANCE_FILENAME, readAppearance, writeAppearance } from '../src/appearance.ts'

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-appearance-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('has no preference before anything is stored', () => {
  expect(readAppearance(fixture())).toBeUndefined()
})

it('round-trips a stored appearance and leaves no temporary file behind', () => {
  const home = fixture()
  writeAppearance(home, 'dark')
  expect(readAppearance(home)).toBe('dark')
  expect(JSON.parse(readFileSync(join(home, APPEARANCE_FILENAME), 'utf8'))).toEqual({ appearance: 'dark' })
  expect(readdirSync(home)).toEqual([APPEARANCE_FILENAME])
})

it('creates a missing Harness home before writing', () => {
  const home = join(fixture(), 'nested', 'home')
  writeAppearance(home, 'light')
  expect(readAppearance(home)).toBe('light')
})

it('replaces a previous preference', () => {
  const home = fixture()
  writeAppearance(home, 'dark')
  writeAppearance(home, 'light')
  expect(readAppearance(home)).toBe('light')
})

it('tolerates a damaged or unknown record', () => {
  const home = fixture()
  writeFileSync(join(home, APPEARANCE_FILENAME), 'not json')
  expect(readAppearance(home)).toBeUndefined()
  writeFileSync(join(home, APPEARANCE_FILENAME), JSON.stringify({ appearance: 'blue' }))
  expect(readAppearance(home)).toBeUndefined()
  writeFileSync(join(home, APPEARANCE_FILENAME), JSON.stringify('dark'))
  expect(readAppearance(home)).toBeUndefined()
})
