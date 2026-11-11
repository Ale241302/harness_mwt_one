import { expect, test } from 'claude-code/testing'
import { MANIFEST_PATH, boardReport, parseBoard, parseSpaces, parseProjection, scopeFolder, statusLine } from '../hooks/manifest.ts'

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

/** One board storage unit as the product writes it under `storages/`. */
const BOARD = JSON.stringify({
  unit: { name: 'faberloom_board', version: 1 },
  global: null,
  tables: {
    items: {
      a: { title: 'Reconfirmar producción', status: 'waiting_approval', severity: 'HIGH', spaceId: 'sp-1', dueAt: '2026-06-26T00:00:00.000Z' },
      b: { title: 'Revisar itinerario', status: 'in_progress', severity: null, spaceId: 'sp-1', dueAt: null },
      c: { title: 'Factura conciliada', status: 'completed', severity: 'LOW', spaceId: '' },
    },
  },
})

const SPACES = JSON.stringify({ tables: { spaces: { 'sp-1': { title: 'Facturas ADN Logística' } } } })

test('reads the Mesa queue from the board unit, worst first and open only', () => {
  const items = parseBoard(BOARD, parseSpaces(SPACES))
  expect(items?.map(item => item.title)).toEqual(['Reconfirmar producción', 'Revisar itinerario', 'Factura conciliada'])
  expect(items?.[0]).toMatchObject({ severity: 'HIGH', space: 'Facturas ADN Logística' })
  const report = boardReport(items ?? [])
  expect(report).toContain('2 ítems abiertos')
  expect(report).toContain('[HIGH] Reconfirmar producción · waiting_approval · Facturas ADN Logística · vence 2026-06-26')
  expect(report).not.toContain('Factura conciliada')
})

test('reports an empty queue and tolerates unknown documents', () => {
  expect(boardReport([])).toBe('La Mesa no tiene ítems abiertos.')
  expect(parseBoard('nope')).toBeUndefined()
  expect(parseSpaces('nope').size).toBe(0)
})
