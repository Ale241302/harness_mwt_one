/**
 * C-B02.12: the guard's deterministic fast path. A message that names only a
 * business record is work without asking the classifier, and the rule must stay
 * narrow enough that a personal request cannot ride it.
 * @module @deepseek-ai/dsh-faberloom-session-agent/tests/policy
 */

import { describe, expect, it } from 'vitest'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import {
  buildScopeQuestion,
  credentialFingerprint,
  deploymentCredentialFingerprints,
  isWorkReference,
} from '../src/policy.ts'

describe('C-B02.12 — a record reference is work without the classifier', () => {
  it.each([
    '2487-2026',
    'dame información de la 2487-2026',
    'de esta PO 505244',
    'y el pedido PF-1234?',
    'mostrame el detalle del expediente 2487-2026',
    'estado del envío OC/1234',
  ])('passes %s', (text: string) => {
    expect(isWorkReference(text)).toBe(true)
  })

  it.each([
    'resumime esta presentación personal',
    'escribime un poema de amor',
    'hacé la tarea 12',
    'receta de pan 1234',
    'poema 505244',
    'pedido',
    'dame una mano con esto',
    'necesito el estado del pedido 505244 de Sondel',
    '',
    '   ',
    'dame el número 1234 de la factura para la tarea de matemática de mi hijo',
  ])('rejects %s', (text: string) => {
    expect(isWorkReference(text)).toBe(false)
  })
})

describe('the classifier question carries the record of the previous turn', () => {
  it('names the Space and the previous human text as data', () => {
    const question = buildScopeQuestion('de esta PO 505244', 'Información sobre el caso 2487-2026', 'dame información de la 2487-2026')
    expect(question).toContain('Space: Información sobre el caso 2487-2026')
    expect(question).toContain('<previous>\ndame información de la 2487-2026\n</previous>')
    expect(question).toContain('<message>\nde esta PO 505244\n</message>')
  })

  it('omits what the request does not carry', () => {
    expect(buildScopeQuestion('de esta PO 505244', undefined)).toBe('<message>\nde esta PO 505244\n</message>')
  })
})

describe('C-B02.13 — a declared digest covers the build that ships no key', () => {
  /** The value a customer build never carries. */
  const DEPLOYMENT_KEY = 'sk-shared-deployment-key'

  /** A launch environment with nothing in the inherited layer. */
  function emptyEnvironment(): never {
    return createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]) as never
  }

  it('recognizes a deployment key no layer holds', () => {
    const fingerprints = deploymentCredentialFingerprints(
      emptyEnvironment(),
      ['DEEPSEEK_API_KEY'],
      [credentialFingerprint(DEPLOYMENT_KEY)],
    )
    expect(fingerprints.has(credentialFingerprint(DEPLOYMENT_KEY))).toBe(true)
  })

  it('adds the declared digests to the values the layers hold', () => {
    const environment = createLaunchEnvironmentSnapshot([
      { source: 'process', values: { DEEPSEEK_API_KEY: 'sk-from-the-layer' } },
    ])
    const fingerprints = deploymentCredentialFingerprints(
      environment,
      ['DEEPSEEK_API_KEY'],
      [credentialFingerprint(DEPLOYMENT_KEY)],
    )
    expect([...fingerprints].sort()).toEqual([
      credentialFingerprint('sk-from-the-layer'),
      credentialFingerprint(DEPLOYMENT_KEY),
    ].sort())
  })

  it('supplies nothing when neither a layer nor a digest names a key', () => {
    expect([...deploymentCredentialFingerprints(emptyEnvironment(), ['DEEPSEEK_API_KEY'])]).toEqual([])
  })
})
