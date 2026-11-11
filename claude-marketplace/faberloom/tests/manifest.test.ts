import { expect, test } from 'claude-code/testing'
import { MANIFEST_PATH, parseProjection, scopeFolder, statusLine } from '../hooks/manifest.ts'

/** One projection manifest as `@deepseek-ai/dsh-faberloom-harness-projection` writes it. */
const MANIFEST = JSON.stringify({
  version: 1,
  scope: { kind: 'space', id: 'sp-1', title: 'Facturas ADN Logística' },
  generatedAt: '2026-11-11T09:00:00.000Z',
  files: ['AGENTS.md', 'CLAUDE.md', '.claude/agents/sicop.md'],
  agents: [{ id: 'ag-1', name: 'SICOP', file: 'sicop.md' }],
  skills: [{ name: 'mwt-admin-expedientes-leer' }],
  workflows: [{ name: 'Expediente MWT' }],
  routines: [],
  memory: [{ title: 'voz' }, { title: 'plazos' }],
  context: [{ title: 'cuenta' }],
})

test('reads the scope, agents, and skills a projection wrote', () => {
  const summary = parseProjection(MANIFEST)
  expect(summary).toBeDefined()
  expect(summary?.scope).toBe('Facturas ADN Logística')
  expect(summary?.kind).toBe('space')
  expect(summary?.agents).toEqual([{ id: 'ag-1', name: 'SICOP', file: 'sicop.md' }])
  expect(summary?.skills).toEqual(['mwt-admin-expedientes-leer'])
  expect(summary?.memory).toBe(2)
})

test('falls back to the folder name when the manifest names no scope', () => {
  const summary = parseProjection(JSON.stringify({ version: 1 }), 'prueba plugin')
  expect(summary?.scope).toBe('prueba plugin')
  expect(summary?.agents).toEqual([])
})

test('rejects text that is not a projection manifest', () => {
  expect(parseProjection('not json')).toBeUndefined()
  expect(parseProjection('{"agents": []}')).toBeUndefined()
})

test('folds the counts into one status line', () => {
  const summary = parseProjection(MANIFEST)
  expect(summary).toBeDefined()
  expect(statusLine(summary!)).toBe('FaberLoom · Facturas ADN Logística · 1 agentes · 1 skills · 1 flujos · 2 memoria')
})

test('names the manifest the folder carries and normalizes the folder path', () => {
  expect(MANIFEST_PATH).toBe('.faberloom/harness.json')
  expect(scopeFolder('C:\\work\\space\\')).toBe('C:\\work\\space')
  expect(scopeFolder('/work/space///')).toBe('/work/space')
})
