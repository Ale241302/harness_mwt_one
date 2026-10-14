import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  BACKEND_CHOICE_FILENAME,
  readBackendChoice,
  resolveBackend,
  writeBackendChoice,
} from '../src/backend-choice.ts'
import { DEFAULT_GATEWAY_URL, GATEWAY_URL_ENV } from '../src/gateway.ts'

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-backend-choice-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('has no choice before anything is stored', () => {
  expect(readBackendChoice(fixture())).toBeUndefined()
})

it('round-trips a stored choice and leaves no temporary file behind', () => {
  const home = fixture()
  writeBackendChoice(home, { mode: 'gateway' })
  expect(readBackendChoice(home)).toEqual({ mode: 'gateway' })
  expect(JSON.parse(readFileSync(join(home, BACKEND_CHOICE_FILENAME), 'utf8'))).toEqual({ mode: 'gateway' })
  expect(readdirSync(home)).toEqual([BACKEND_CHOICE_FILENAME])
})

it('creates a missing Harness home before writing', () => {
  const home = join(fixture(), 'nested', 'home')
  writeBackendChoice(home, { mode: 'local' })
  expect(readBackendChoice(home)).toEqual({ mode: 'local' })
})

it('replaces a previous choice', () => {
  const home = fixture()
  writeBackendChoice(home, { mode: 'local' })
  writeBackendChoice(home, { mode: 'gateway' })
  expect(readBackendChoice(home)).toEqual({ mode: 'gateway' })
})

it('tolerates a damaged or unknown record', () => {
  const home = fixture()
  writeFileSync(join(home, BACKEND_CHOICE_FILENAME), 'not json')
  expect(readBackendChoice(home)).toBeUndefined()
  writeFileSync(join(home, BACKEND_CHOICE_FILENAME), JSON.stringify({ mode: 'cloud' }))
  expect(readBackendChoice(home)).toBeUndefined()
  writeFileSync(join(home, BACKEND_CHOICE_FILENAME), JSON.stringify('gateway'))
  expect(readBackendChoice(home)).toBeUndefined()
  writeFileSync(join(home, BACKEND_CHOICE_FILENAME), JSON.stringify({ mode: 'gateway', gatewayUrl: 7 }))
  expect(readBackendChoice(home)).toEqual({ mode: 'gateway' })
})

it('boots the local harness when neither the environment nor the home chooses', () => {
  expect(resolveBackend(fixture(), {})).toEqual({ mode: 'local' })
})

it('follows the stored choice when the environment defers', () => {
  const home = fixture()
  writeBackendChoice(home, { mode: 'gateway' })
  expect(resolveBackend(home, {})).toEqual({ mode: 'gateway', url: DEFAULT_GATEWAY_URL })
})

it('lets the launching environment outrank the stored choice', () => {
  const home = fixture()
  writeBackendChoice(home, { mode: 'gateway' })
  expect(resolveBackend(home, { [GATEWAY_URL_ENV]: '' })).toEqual({ mode: 'local' })
  expect(resolveBackend(home, { [GATEWAY_URL_ENV]: 'https://staging.example.test/' }))
    .toEqual({ mode: 'gateway', url: 'https://staging.example.test/' })
})
