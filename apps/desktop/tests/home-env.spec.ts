import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  ensureHomeEnvFile,
  parseHomeEnvDefaults,
  readHomeEnv,
  resolveHomeEnvDefaults,
  HOME_ENV_FILENAME,
} from '../src/home-env.ts'

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-home-env-'))
  roots.push(root)
  return root
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('writes every default into a missing home .env', () => {
  const home = fixture()
  const appended = ensureHomeEnvFile(home, { DEEPSEEK_API_KEY: 'sk-one', OTHER: 'two' })
  expect(appended).toEqual(['DEEPSEEK_API_KEY', 'OTHER'])
  expect(readFileSync(join(home, HOME_ENV_FILENAME), 'utf8')).toBe('DEEPSEEK_API_KEY=sk-one\nOTHER=two\n')
})

it('appends only the missing names and preserves the file byte-for-byte otherwise', () => {
  const home = fixture()
  const path = join(home, HOME_ENV_FILENAME)
  const existing = '# user layer\nDEEPSEEK_API_KEY=sk-mine\nexport FABERLOOM_MCP_URL=https://example.test/mcp\n'
  writeFileSync(path, existing)
  const appended = ensureHomeEnvFile(home, { DEEPSEEK_API_KEY: 'sk-default', NEW_NAME: 'added' })
  expect(appended).toEqual(['NEW_NAME'])
  expect(readFileSync(path, 'utf8')).toBe(`${existing}NEW_NAME=added\n`)
})

it('adds a trailing newline before appending to an unterminated document', () => {
  const home = fixture()
  const path = join(home, HOME_ENV_FILENAME)
  writeFileSync(path, 'KEEP=1')
  ensureHomeEnvFile(home, { ADDED: '2' })
  expect(readFileSync(path, 'utf8')).toBe('KEEP=1\nADDED=2\n')
})

it('does nothing when every default is already assigned', () => {
  const home = fixture()
  const path = join(home, HOME_ENV_FILENAME)
  const existing = 'DEEPSEEK_API_KEY=sk-mine\n'
  writeFileSync(path, existing)
  expect(ensureHomeEnvFile(home, { DEEPSEEK_API_KEY: 'sk-default' })).toEqual([])
  expect(readFileSync(path, 'utf8')).toBe(existing)
})

it('parses a deployment defaults document', () => {
  expect(parseHomeEnvDefaults('source', '{"DEEPSEEK_API_KEY":"sk-x","FABERLOOM_MCP_URL":"https://m"}'))
    .toEqual({ DEEPSEEK_API_KEY: 'sk-x', FABERLOOM_MCP_URL: 'https://m' })
})

it.each([
  ['not JSON', 'nope', /not valid JSON/u],
  ['an array', '[]', /JSON object of environment names to values/u],
  ['a non-string value', '{"A":1}', /value for A must be a non-empty string/u],
  ['an empty value', '{"A":""}', /value for A must be a non-empty string/u],
  ['an invalid name', '{"1BAD":"x"}', /invalid environment name/u],
  ['a bootstrap name', '{"DSH_HOME":"/tmp"}', /which the Harness \.env layer refuses/u],
  ['a bootstrap prefix', '{"XDG_CACHE_HOME":"/tmp"}', /which the Harness \.env layer refuses/u],
])('rejects %s', (_label, text, pattern) => {
  expect(() => parseHomeEnvDefaults('source', text)).toThrow(pattern)
})

it('resolves defaults from the inline document before any file', () => {
  const resources = fixture()
  writeFileSync(join(resources, 'desktop-home-env.json'), '{"A":"from-file"}')
  expect(resolveHomeEnvDefaults({ DSH_DESKTOP_HOME_ENV: '{"A":"inline"}' }, resources)).toEqual({ A: 'inline' })
})

it('resolves defaults from an explicit file over the bundled resource', () => {
  const explicit = fixture()
  writeFileSync(join(explicit, 'given.json'), '{"A":"explicit"}')
  const resources = fixture()
  writeFileSync(join(resources, 'desktop-home-env.json'), '{"A":"bundled"}')
  expect(resolveHomeEnvDefaults({ DSH_DESKTOP_HOME_ENV_FILE: join(explicit, 'given.json') }, resources))
    .toEqual({ A: 'explicit' })
})

it('falls back to the bundled resource and then to no defaults', () => {
  const resources = fixture()
  writeFileSync(join(resources, 'desktop-home-env.json'), '{"A":"bundled"}')
  expect(resolveHomeEnvDefaults({}, resources)).toEqual({ A: 'bundled' })
  expect(resolveHomeEnvDefaults({}, fixture())).toEqual({})
})

it('reads every assignment the Harness-home layer carries', () => {
  const home = fixture()
  expect(readHomeEnv(home)).toEqual({})
  writeFileSync(join(home, HOME_ENV_FILENAME), [
    '# comment',
    'PLAIN=value',
    'export EXPORTED=other',
    'SPACED = padded ',
    'QUOTED="with spaces"',
    "SINGLE='single'",
    'EMPTY=',
    'BROKEN lower',
    '',
  ].join('\n'))
  expect(readHomeEnv(home)).toEqual({
    PLAIN: 'value',
    EXPORTED: 'other',
    SPACED: 'padded',
    QUOTED: 'with spaces',
    SINGLE: 'single',
    EMPTY: '',
  })
})

it('lets a later assignment win when the layer repeats a name', () => {
  const home = fixture()
  writeFileSync(join(home, HOME_ENV_FILENAME), 'NAME=first\nNAME=second\n')
  expect(readHomeEnv(home)).toEqual({ NAME: 'second' })
})
