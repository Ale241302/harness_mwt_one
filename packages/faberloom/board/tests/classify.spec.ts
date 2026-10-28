import { describe, expect, it } from 'vitest'
import {
  CLASSIFY_RULES_VERSION,
  Config,
  DATA_CLASS_POLICY,
  DATA_CLASS_POLICY_VERSION,
  PROVISIONAL_PERMITTED_FIELDS,
  SEVERITY_RULES,
  classifyDataClass,
  contentProjection,
  resolveSeverity,
  severityRule,
} from '../src/index.ts'
import type { BoardClassifyRules, BoardDataClassPolicy } from '../src/types.ts'
import { ACTOR_A, bootBoard } from './helpers/harness.ts'

const THRESHOLD = 0.8

const accountRules: BoardClassifyRules = {
  version: 'test-rules',
  rules: [
    { artifactType: 'proforma', severity: 'MEDIUM' },
    { artifactType: 'proforma', accountRef: 'Eguisa', severity: 'CRITICAL' },
  ],
}

const proformaPolicy: BoardDataClassPolicy = {
  version: 'test-policy',
  rules: [
    { artifactType: 'proforma', accountRef: 'Eguisa', dataClass: 'N1', permittedFields: ['lines', 'total'] },
  ],
}

describe('entry classification', () => {
  it('W-37 · a deterministic rule resolves severity without the classifier', () => {
    const decision = resolveSeverity({ artifactType: 'proforma', accountRef: 'Eguisa' }, { confidenceThreshold: THRESHOLD })

    expect(decision).toEqual({ severity: 'HIGH', source: 'RULE', confidence: 1 })
    expect(severityRule({ artifactType: 'proforma', accountRef: null })?.severity).toBe('HIGH')
    expect(SEVERITY_RULES.version).toBe(CLASSIFY_RULES_VERSION)
  })

  it('W-37 · an account rule wins over the type-wide rule', () => {
    const eguisa = resolveSeverity(
      { artifactType: 'proforma', accountRef: 'Eguisa' },
      { confidenceThreshold: THRESHOLD, rules: accountRules },
    )
    const other = resolveSeverity(
      { artifactType: 'proforma', accountRef: 'Sonepar' },
      { confidenceThreshold: THRESHOLD, rules: accountRules },
    )

    expect(eguisa).toEqual({ severity: 'CRITICAL', source: 'RULE', confidence: 1 })
    expect(other).toEqual({ severity: 'MEDIUM', source: 'RULE', confidence: 1 })
  })

  it('W-37 · a classifier timeout leaves severity null and the item still enters', async () => {
    const timedOut = resolveSeverity(
      { artifactType: 'desconocido', accountRef: null },
      { confidenceThreshold: THRESHOLD, classifier: { status: 'timeout' } },
    )
    expect(timedOut).toEqual({ severity: null, source: null, confidence: null })

    const { board } = await bootBoard()
    const item = await board.submit(ACTOR_A, {
      runId: 'run-timeout',
      idempotencyKey: 'idem-timeout',
      businessKey: 'bkey-timeout',
      summary: 'excepción sin clasificar',
      evidence: ['oc:505288'],
      artifactType: 'desconocido',
    })

    expect(item.severity).toBeNull()
    expect(item.severitySource).toBeNull()
    expect((await board.list(ACTOR_A)).map(row => row.id)).toEqual([item.id])
  })

  it('W-37 · an invalid answer or a low confidence leaves severity null', () => {
    const request = { artifactType: 'desconocido', accountRef: null }

    expect(resolveSeverity(request, {
      confidenceThreshold: THRESHOLD,
      classifier: { status: 'invalid', detail: 'unparseable' },
    })).toEqual({ severity: null, source: null, confidence: null })

    expect(resolveSeverity(request, {
      confidenceThreshold: THRESHOLD,
      classifier: { status: 'classified', severity: 'HIGH', confidence: THRESHOLD - 0.01 },
    })).toEqual({ severity: null, source: null, confidence: null })

    expect(resolveSeverity(request, {
      confidenceThreshold: THRESHOLD,
      classifier: { status: 'classified', severity: 'HIGH', confidence: 1.4 },
    })).toEqual({ severity: null, source: null, confidence: null })

    expect(resolveSeverity(request, {
      confidenceThreshold: THRESHOLD,
      classifier: { status: 'classified', severity: 'HIGH', confidence: THRESHOLD },
    })).toEqual({ severity: 'HIGH', source: 'LLM', confidence: THRESHOLD })
  })

  it('W-37 · submit keeps a below-threshold severity unclassified and still stores the item', async () => {
    const { board } = await bootBoard()
    const item = await board.submit(ACTOR_A, {
      runId: 'run-low-confidence',
      idempotencyKey: 'idem-low-confidence',
      businessKey: 'bkey-low-confidence',
      summary: 'propuesta por debajo del umbral',
      evidence: ['oc:505288'],
      severity: 'HIGH',
      severityConfidence: 0.5,
    })

    expect(item).toMatchObject({ severity: null, severitySource: null, severityConfidence: null })
    expect((await board.get(ACTOR_A, item.id)).severity).toBeNull()
  })

  it('keeps the 0.80 threshold in the validated board config (D-08)', () => {
    expect(Config.parse({}).classifierConfidenceThreshold).toBe(0.8)
    expect(() => Config.parse({ classifierConfidenceThreshold: 1.2 })).toThrow()
    expect(() => Config.parse({ classifierConfidenceThreshold: -0.1 })).toThrow()
  })

  it('W-38 · an unknown artifact routes only to N2 providers and keeps the provisional mark', () => {
    const decision = classifyDataClass({ artifactType: 'desconocido', accountRef: 'Eguisa' })

    expect(decision).toEqual({ dataClass: 'N2', provisional: true, providerClass: 'N2', permittedFields: [] })
    expect(DATA_CLASS_POLICY.version).toBe(DATA_CLASS_POLICY_VERSION)
  })

  it('W-38 · a signed rule assigns the definitive class and its fields', () => {
    const decision = classifyDataClass({ artifactType: 'proforma', accountRef: 'Eguisa' }, proformaPolicy)
    expect(decision).toEqual({
      dataClass: 'N1',
      provisional: false,
      providerClass: 'N1',
      permittedFields: ['lines', 'total'],
    })
    expect(contentProjection(decision)).toMatchObject({
      contentVisible: true,
      fields: ['lines', 'total'],
    })
    expect(classifyDataClass({ artifactType: 'proforma', accountRef: 'Sonepar' }, proformaPolicy).provisional).toBe(true)
  })

  it('W-93 · a provisional item feeds no derived product', () => {
    const projection = contentProjection(classifyDataClass({ artifactType: 'proforma', accountRef: null }))

    expect(projection).toEqual({
      contentVisible: false,
      fields: [],
      indexed: false,
      learningCandidates: false,
      classificationCache: false,
      sharedContext: false,
    })
  })

  it('W-99 · with no permitted-field list a provisional item shows and sends nothing', () => {
    expect(PROVISIONAL_PERMITTED_FIELDS).toEqual([])

    const decision = classifyDataClass({ artifactType: 'respuesta', accountRef: null })
    const projection = contentProjection(decision)

    expect(decision.permittedFields).toHaveLength(0)
    expect(projection.fields).toHaveLength(0)
    expect(projection.contentVisible).toBe(false)
  })
})
