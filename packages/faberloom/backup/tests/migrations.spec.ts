import { describe, expect, it } from 'vitest'
import { FABERLOOM_DATA_MIGRATIONS } from '../src/index.ts'

describe('FABERLOOM_DATA_MIGRATIONS', () => {
  it('migrates a legacy board status once and keeps the event', () => {
    const migration = FABERLOOM_DATA_MIGRATIONS.find(entry => entry.id === '2026-10-27-board-state-v1')
    expect(migration).toBeDefined()
    const legacy = {
      ownerId: 'owner@example.com',
      status: 'waiting_approval',
      version: 1,
      events: [],
      updatedAt: '2026-10-01T00:00:00.000Z',
    }
    const migrated = migration!.apply(legacy) as Record<string, unknown>
    expect(migrated['state']).toBe('PENDIENTE_CRITERIO')
    expect(migrated['rowVersion']).toBe(1)
    expect((migrated['events'] as { command: string }[])[0]?.command).toBe('migrate_state')

    // A second run is a no-op: the state is already persisted.
    expect(migration!.apply(migrated)).toBe(migrated)
  })

  it('maps the terminal legacy states', () => {
    const migration = FABERLOOM_DATA_MIGRATIONS[0]!
    const state = (status: string): unknown => {
      const record = migration.apply({ status })
      if (record === null) throw new Error(`migration dropped ${status}`)
      return record['state']
    }
    expect(state('approved')).toBe('APROBADO')
    expect(state('completed')).toBe('EJECUTADO')
    expect(state('failed')).toBe('ERROR_RECUPERABLE')
  })
})
