import { describe, expect, it } from 'vitest'
import { LIVE_MAIL_ROUTINE, marluvasLiveMailRoutine, routineDefinitionsMatch } from '../src/index.ts'

/** Add the values the store materializes for optional step fields. */
function stored(input: typeof LIVE_MAIL_ROUTINE) {
  return {
    ...input.definition,
    steps: input.definition.steps.map(step => ({
      ...step,
      dependsOn: step.dependsOn ?? [],
      config: step.config ?? {},
      waitFor: step.waitFor ?? null,
      effect: step.effect === true,
      maxAttempts: step.maxAttempts ?? 1,
    })),
  }
}

describe('routineDefinitionsMatch', () => {
  it('treats an authored definition and its stored normalized shape as equal', () => {
    const authored = marluvasLiveMailRoutine('agent-1')
    expect(routineDefinitionsMatch(stored(authored), authored.definition)).toBe(true)
  })

  it('treats the generic live routine as equal to its stored shape', () => {
    expect(routineDefinitionsMatch(stored(LIVE_MAIL_ROUTINE), LIVE_MAIL_ROUTINE.definition)).toBe(true)
  })

  it('reports a changed agent binding or instruction', () => {
    const left = marluvasLiveMailRoutine('agent-1')
    const right = marluvasLiveMailRoutine('agent-2')
    expect(routineDefinitionsMatch(left.definition, right.definition)).toBe(false)

    const changed = {
      ...left.definition,
      steps: left.definition.steps.map(step => ({ ...step, instruction: `${step.instruction} ` })),
    }
    expect(routineDefinitionsMatch(left.definition, changed)).toBe(false)
  })
})
