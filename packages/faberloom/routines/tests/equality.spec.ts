import { describe, expect, it } from 'vitest'
import { LIVE_MAIL_ROUTINE, MARLUVAS_AGENT_NAME, marluvasLiveMailRoutine, routineDefinitionsMatch } from '../src/index.ts'

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
    const authored = marluvasLiveMailRoutine()
    expect(routineDefinitionsMatch(stored(authored), authored.definition)).toBe(true)
  })

  it('treats the generic live routine as equal to its stored shape', () => {
    expect(routineDefinitionsMatch(stored(LIVE_MAIL_ROUTINE), LIVE_MAIL_ROUTINE.definition)).toBe(true)
  })

  it('treats an authored empty matcher as the store\'s null matcher', () => {
    const authored = marluvasLiveMailRoutine()
    const withNull = {
      ...authored.definition,
      triggers: authored.definition.triggers.map(trigger => ({ ...trigger, match: null })),
    }
    expect(routineDefinitionsMatch(withNull, authored.definition)).toBe(true)
  })

  it('names the catalog agent, not a home-local id', () => {
    const routine = marluvasLiveMailRoutine()
    expect(routine.definition.steps.every(step => step.config?.['agentName'] === MARLUVAS_AGENT_NAME)).toBe(true)
  })

  it('reports a changed agent name or instruction', () => {
    const left = marluvasLiveMailRoutine()
    const renamed = {
      ...left.definition,
      steps: left.definition.steps.map(step => ({ ...step, config: { agentName: 'Otro' } })),
    }
    expect(routineDefinitionsMatch(left.definition, renamed)).toBe(false)

    const changed = {
      ...left.definition,
      steps: left.definition.steps.map(step => ({ ...step, instruction: `${step.instruction} ` })),
    }
    expect(routineDefinitionsMatch(left.definition, changed)).toBe(false)
  })
})
