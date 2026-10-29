/**
 * Deterministic entry classification for the Mesa: severity rules by artifact
 * type and account, the provisional N2 data class, and the content projection
 * that keeps a provisional item from showing or sending anything (D-05, D-07,
 * D-08).
 * @module @deepseek-ai/dsh-faberloom-board/src/classify
 */

import type {
  BoardClassifyRules,
  BoardClassifierResult,
  BoardContentProjection,
  BoardDataClassDecision,
  BoardDataClassPolicy,
  BoardSeverity,
  BoardSeverityDecision,
  BoardSeverityRule,
} from './types.ts'

/** Version of the shipped severity rules (§5.1). */
export const CLASSIFY_RULES_VERSION = '2026-10-27.1'

/** Version of the shipped data-class policy (§5.2). */
export const DATA_CLASS_POLICY_VERSION = '2026-10-27.1'

/** The shipped deterministic severity rules. Extending the table requires a new version. */
export const SEVERITY_RULES: BoardClassifyRules = {
  version: CLASSIFY_RULES_VERSION,
  rules: [
    // A priced commercial commitment.
    { artifactType: 'proforma', severity: 'HIGH' },
    // An outbound reply awaiting a decision.
    { artifactType: 'respuesta', severity: 'MEDIUM' },
    // A missing-data task with no external commitment.
    { artifactType: 'tarea', severity: 'LOW' },
  ],
}

/**
 * The shipped data-class policy. Its rule list is empty until a signed rule
 * enables fields, so every artifact enters as N2 provisional (D-05).
 */
export const DATA_CLASS_POLICY: BoardDataClassPolicy = {
  version: DATA_CLASS_POLICY_VERSION,
  rules: [
    // A board artifact carries business identifiers only: codes, amounts,
    // dates and product references. One deterministic rule per artifact type
    // is what D-05 asks for before any field may leave, so these are settled
    // classes rather than provisional ones.
    { artifactType: 'proforma', dataClass: 'N2', permittedFields: ['title', 'summary', 'evidence', 'content'] },
    { artifactType: 'tarea', dataClass: 'N2', permittedFields: ['title', 'summary', 'evidence', 'content'] },
  ],
}

/**
 * Fields a provisional item may show or send. Empty by signed decision D-05:
 * no content leaves, and the card shows none.
 */
export const PROVISIONAL_PERMITTED_FIELDS: readonly string[] = []

const UNCLASSIFIED: BoardSeverityDecision = { severity: null, source: null, confidence: null }

/** Pick the most specific matching rule: an account-scoped rule wins over a type-wide one. */
function mostSpecific<T extends { readonly artifactType: string; readonly accountRef?: string }>(
  rules: readonly T[],
  request: { readonly artifactType: string; readonly accountRef: string | null },
): T | undefined {
  const matching = rules.filter(rule => rule.artifactType === request.artifactType
    && (rule.accountRef === undefined || rule.accountRef === request.accountRef))
  return matching.find(rule => rule.accountRef !== undefined) ?? matching[0]
}

/**
 * Find the deterministic severity rule for one artifact.
 * @param request - artifact type and account of the item.
 * @param rules - rule table; the shipped table when omitted.
 * @returns the matching rule, or undefined when the rules do not resolve the field.
 */
export function severityRule(
  request: { readonly artifactType: string; readonly accountRef: string | null },
  rules: BoardClassifyRules = SEVERITY_RULES,
): BoardSeverityRule | undefined {
  return mostSpecific(rules.rules, request)
}

/** Whether a reported confidence is finite, in range, and at or above the threshold. */
function acceptsConfidence(confidence: number | null, confidenceThreshold: number): boolean {
  return confidence !== null
    && Number.isFinite(confidence)
    && confidence >= 0
    && confidence <= 1
    && confidence >= confidenceThreshold
}

/**
 * Resolve the severity of one item at entry: deterministic rules first, the
 * classifier only when they do not resolve. A timeout, an invalid answer, or a
 * confidence below the threshold leaves the item unclassified; the item still
 * enters the queue (W-37). The classifier has already enforced its own deadline
 * when it reports `timeout`. A deterministic rule reports full confidence.
 * @param request - artifact type and account of the item.
 * @param options - configured threshold, rule table, and the classifier outcome.
 * @returns the severity to persist with its source and confidence; all null when nothing resolved.
 */
export function resolveSeverity(
  request: { readonly artifactType: string; readonly accountRef: string | null },
  options: {
    readonly confidenceThreshold: number
    readonly rules?: BoardClassifyRules
    readonly classifier?: BoardClassifierResult
  },
): BoardSeverityDecision {
  const rule = severityRule(request, options.rules)
  if (rule !== undefined) return { severity: rule.severity, source: 'RULE', confidence: 1 }

  const classifier = options.classifier
  if (classifier === undefined || classifier.status !== 'classified') return UNCLASSIFIED
  if (!acceptsConfidence(classifier.confidence, options.confidenceThreshold)) return UNCLASSIFIED
  return { severity: classifier.severity, source: 'LLM', confidence: classifier.confidence }
}

/**
 * Normalize the severity a run reports for a new item. A confidence below the
 * configured threshold leaves the item unclassified so a human decides it
 * (D-08). A proposal that carries no confidence keeps its value with an empty
 * confidence, because nothing measures it against the threshold.
 * @param severity - reported severity, or undefined when the run reported none.
 * @param confidence - reported classifier confidence, or null.
 * @param confidenceThreshold - minimum accepted classifier confidence.
 * @returns the severity to persist with its source and confidence.
 */
export function submittedSeverity(
  severity: BoardSeverity | undefined,
  confidence: number | null,
  confidenceThreshold: number,
): BoardSeverityDecision {
  if (severity === undefined) return UNCLASSIFIED
  if (confidence === null) return { severity, source: 'LLM', confidence: null }
  return acceptsConfidence(confidence, confidenceThreshold)
    ? { severity, source: 'LLM', confidence }
    : UNCLASSIFIED
}

/**
 * Classify the data class with deterministic rules before any model call. An
 * artifact no rule resolves is N2 provisional and may reach only N2-permitted
 * providers, carrying the provisional mark until a later rule classifies it
 * (W-38). A later N3/N4 result must record in audit which fields were sent and
 * to which provider while the item was provisional.
 * @param request - artifact type and account of the item.
 * @param policy - data-class policy; the shipped policy when omitted.
 * @returns the class, the provisional mark, the provider class, and the fields a rule enabled.
 */
export function classifyDataClass(
  request: { readonly artifactType: string; readonly accountRef: string | null },
  policy: BoardDataClassPolicy = DATA_CLASS_POLICY,
): BoardDataClassDecision {
  const rule = mostSpecific(policy.rules, request)
  if (rule === undefined) {
    return {
      dataClass: 'N2',
      provisional: true,
      providerClass: 'N2',
      permittedFields: PROVISIONAL_PERMITTED_FIELDS,
    }
  }
  return {
    dataClass: rule.dataClass,
    provisional: false,
    providerClass: rule.dataClass,
    permittedFields: rule.permittedFields,
  }
}

/**
 * Derive what one item may show, send to a provider, and feed into derived
 * products. A provisional item shows nothing, sends none of its fields, and
 * stays out of the search index, learning candidates, the classification
 * cache, and other items' context (W-93, W-99).
 * @param decision - data class of the item.
 * @returns the visible fields and the derived-product flags.
 */
export function contentProjection(decision: BoardDataClassDecision): BoardContentProjection {
  if (decision.provisional) {
    return {
      contentVisible: false,
      fields: [],
      indexed: false,
      learningCandidates: false,
      classificationCache: false,
      sharedContext: false,
    }
  }
  return {
    contentVisible: true,
    fields: decision.permittedFields,
    indexed: true,
    learningCandidates: true,
    classificationCache: true,
    sharedContext: true,
  }
}
