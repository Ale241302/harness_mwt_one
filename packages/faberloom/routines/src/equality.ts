/**
 * Semantic comparison of two routine definitions, so deployment-owned built-ins
 * converge without rewriting a version on every poll. The stored definition has
 * every optional step field materialized (`config: {}`, `waitFor: null`,
 * `maxAttempts: 1`), while an authored input omits them; a raw JSON comparison
 * therefore never matches and turns every reconciliation into a new version.
 * @module @deepseek-ai/dsh-faberloom-routines/equality
 */

/** One trigger field that decides whether the routine sees an event. */
interface ComparableTrigger {
  readonly kind: string
  readonly match?: string | null
}

/** One step field that decides what the routine does. */
interface ComparableStep {
  readonly id: string
  readonly instruction: string
  readonly handler: string
  readonly dependsOn?: readonly string[]
  readonly config?: Readonly<Record<string, unknown>>
  readonly waitFor?: string | null
  readonly effect?: boolean
  readonly maxAttempts?: number
}

/** The definition fields a deployment-owned routine owns. */
interface ComparableDefinition {
  readonly intent: string
  readonly triggers: readonly ComparableTrigger[]
  readonly steps: readonly ComparableStep[]
  readonly expectedResult: string
  readonly permissions: readonly string[]
  readonly failurePolicy: string
}

/** Project one definition onto the fields a seeded routine owns. */
function comparable(definition: ComparableDefinition): unknown {
  return {
    intent: definition.intent,
    triggers: definition.triggers.map(trigger => ({ kind: trigger.kind, match: trigger.match ?? null })),
    steps: definition.steps.map(step => ({
      id: step.id,
      instruction: step.instruction,
      handler: step.handler,
      dependsOn: [...(step.dependsOn ?? [])],
      config: { ...(step.config ?? {}) },
      waitFor: step.waitFor ?? null,
      effect: step.effect === true,
      maxAttempts: step.maxAttempts ?? 1,
    })),
    expectedResult: definition.expectedResult,
    permissions: [...definition.permissions],
    failurePolicy: definition.failurePolicy,
  }
}

/**
 * Whether two routine definitions have the same owned fields.
 * @param left - the stored definition or an authored input.
 * @param right - the definition to compare.
 * @returns true when no owned field differs.
 */
export function routineDefinitionsMatch(left: ComparableDefinition, right: ComparableDefinition): boolean {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right))
}
