import { describe, expect, it } from 'vitest'
import { classifyCloudSteps, classifyRoutine, vpsOwnsCloudRuns } from '../src/cloud.ts'
import type { RoutineDefinition } from '../src/types.ts'

/** A minimal stored definition with one step. */
function definition(handler: string, instruction: string): RoutineDefinition {
  return {
    intent: 'test',
    triggers: [],
    steps: [{
      id: 'step-1',
      instruction,
      handler,
      dependsOn: [],
      config: {},
      gateStepId: null,
      gateExpect: null,
      waitFor: null,
      effect: false,
      revalidateKey: null,
      revalidateExpect: null,
      maxAttempts: 1,
    }],
    expectedResult: 'done',
    permissions: [],
    failurePolicy: 'review',
    maxConcurrency: null,
  }
}

describe('who owns the cloud-ready runs', () => {
  it('is the VPS only for a desktop that mirrors to it', () => {
    expect(vpsOwnsCloudRuns({ FABERLOOM_MIRROR_ENABLED: '1' })).toBe(true)
    expect(vpsOwnsCloudRuns({ FABERLOOM_MIRROR_ENABLED: '1', FABERLOOM_MIRROR_PLATFORM: 'desktop' })).toBe(true)
    expect(vpsOwnsCloudRuns({ FABERLOOM_MIRROR_ENABLED: '1', FABERLOOM_MIRROR_PLATFORM: 'web' })).toBe(false)
    expect(vpsOwnsCloudRuns({})).toBe(false)
    expect(typeof vpsOwnsCloudRuns()).toBe('boolean')
  })
})

describe('cloud execution profile', () => {
  it('runs an email-only routine on the VPS', () => {
    const profile = classifyRoutine(definition('agent', 'Lee los correos, borra los que sean spam y envía un reporte diario por correo.'))
    expect(profile.cloudReady).toBe(true)
    expect(profile.requiresPc).toBe(false)
    expect(profile.scope).toBe('cloud')
    expect(profile.note).toContain('VPS')
  })

  it('marks a step that updates a local file as needing the PC', () => {
    const profile = classifyRoutine(definition('agent', 'Lee los correos y actualiza el archivo C:\\datos\\pedidos.xlsx con lo que venga.'))
    expect(profile.cloudReady).toBe(false)
    expect(profile.requiresPc).toBe(true)
    expect(profile.localSteps).toHaveLength(1)
    expect(profile.note).toContain('PC')
  })

  it('keeps a mixed routine honest about the local part', () => {
    const profile = classifyCloudSteps([
      { id: 'a', label: 'Lee el correo', handler: 'agent', text: 'Lee el correo y clasifícalo.' },
      { id: 'b', label: 'Actualiza el archivo', handler: 'agent', text: 'Actualiza el archivo de mi computador.' },
    ])
    expect(profile.scope).toBe('mixed')
    expect(profile.cloudReady).toBe(false)
    expect(profile.requiresPc).toBe(true)
    expect(profile.localSteps).toEqual(['Actualiza el archivo'])
  })

  it('treats an undeclared handler as local instead of promising a cloud run', () => {
    const profile = classifyCloudSteps([
      { id: 'x', label: 'Paso raro', handler: 'desktop.only', text: 'haz algo' },
    ])
    expect(profile.cloudReady).toBe(false)
    expect(profile.requiresPc).toBe(true)
  })
})
