import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkUsabilityObservation } from '../src/usability.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const root = mkdtempSync(join(tmpdir(), 'faberloom-usability-'))
  roots.push(root)
  const recordPath = join(root, 'load.json')
  writeFileSync(recordPath, '{}\n', 'utf8')
  return {
    schemaVersion: 1,
    wave: '4A.3',
    surface: 'claude-code',
    hostVersion: '2.1.126',
    task: 'Conectar, leer, proponer, rechazar, aprobar y leer la publicación.',
    revisionUsed: 'a'.repeat(40),
    participant: { id: 'p-1', role: 'representative', firstTime: true },
    thresholds: {
      connectSeconds: 300,
      cycleSeconds: 600,
      maxHelp: 1,
      approvedBy: 'ux-owner',
      approvedAt: '2026-11-09T00:00:00.000Z',
    },
    timings: { connectSeconds: 120, cycleSeconds: 420 },
    help: { count: 0, notes: [] },
    diff: { explained: true, quote: 'El cambio añade una comprobación antes de publicar.' },
    recovery: { attempted: true, passed: true, preservedWork: true, nextAction: 'Reintentar el envío.' },
    normalPath: { tokens: false, commands: false, configEdits: false },
    load: {
      confirmed: true,
      revision: 'a'.repeat(40),
      packageDigest: 'b'.repeat(64),
      hostVersion: '2.1.126',
      recordPath,
    },
    ...overrides,
  }
}

describe('4A.3 usability evidence checker', () => {
  it('accepts one representative first-time session within approved thresholds and a matching load record', () => {
    expect(checkUsabilityObservation(observation())).toEqual({ ok: true, reasons: [] })
  })

  it('refuses a developer or synthetic observer, an unapproved threshold, and a token/command path', () => {
    expect(checkUsabilityObservation(observation({ participant: { id: 'p-1', role: 'developer', firstTime: true } })).reasons)
      .toContain('participant-not-representative')
    expect(checkUsabilityObservation(observation({ participant: { id: 'p-1', role: 'synthetic', firstTime: true } })).reasons)
      .toContain('participant-not-representative')
    expect(checkUsabilityObservation(observation({
      thresholds: { connectSeconds: 300, cycleSeconds: 600, maxHelp: 1, approvedBy: '', approvedAt: '' },
    })).reasons).toEqual(expect.arrayContaining(['threshold-approver', 'threshold-approval-date']))
    expect(checkUsabilityObservation(observation({ normalPath: { tokens: true, commands: false, configEdits: false } })).reasons)
      .toContain('normal-path-tokens')
  })

  it('refuses a slow session, an unexplained diff, and a load record from another revision', () => {
    const slow = checkUsabilityObservation(observation({ timings: { connectSeconds: 301, cycleSeconds: 601 } }))
    expect(slow.reasons).toEqual(expect.arrayContaining(['connect-over-threshold', 'cycle-over-threshold']))
    expect(checkUsabilityObservation(observation({ diff: { explained: false, quote: '' } })).reasons)
      .toEqual(expect.arrayContaining(['diff-not-explained', 'diff-quote']))
    expect(checkUsabilityObservation(observation({
      load: {
        confirmed: true,
        revision: 'c'.repeat(40),
        packageDigest: 'b'.repeat(64),
        hostVersion: '2.1.126',
        recordPath: (observation().load as { recordPath: string }).recordPath,
      },
    })).reasons).toContain('load-revision-mismatch')
  })

  it('refuses a missing external load record and an unconfirmed load', () => {
    const missing = observation()
    ;(missing['load'] as Record<string, unknown>)['recordPath'] = join(tmpdir(), 'no-such-load.json')
    expect(checkUsabilityObservation(missing).reasons).toContain('load-record-missing')
    const base = observation()
    const load = base['load'] as Record<string, unknown>
    const unconfirmed = observation({ load: { ...load, confirmed: false } })
    expect(checkUsabilityObservation(unconfirmed).reasons).toContain('load-unconfirmed')
  })
})
