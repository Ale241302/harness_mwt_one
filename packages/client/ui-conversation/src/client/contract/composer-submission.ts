/** Composer submission vocabulary shared by the input and settings domains. */

import type { BusyEnterBehavior } from '../../submission-settings.ts'

export type { BusyEnterBehavior } from '../../submission-settings.ts'

/** Delivery mode requested for one ordinary composer message. */
export type InputSubmitMode = BusyEnterBehavior

/** Keyboard gesture whose delivery mode the submission policy resolves. */
export type ComposerSubmitGesture = 'enter' | 'accelerated'

/**
 * Resolve one submission gesture against the busy-Enter preference. Plain
 * Enter and the primary Send button share the `enter` gesture, so the button
 * delivers exactly what Enter would. Direct `steer` is intentionally
 * best-effort: AgentLoop turns a closed-window submission into the next waking
 * Queue item.
 * @param preferred - the live busy-Enter preference.
 * @param running - whether the addressed agent currently reports busy.
 * @param gesture - plain Enter (or the Send button) or the Cmd/Ctrl-accelerated chord.
 * @param steeringAvailable - whether this session transport supports steering.
 * @returns Queue outside steer-capable busy state; otherwise the preferred mode or its opposite.
 */
export function resolveSubmitMode(
  preferred: BusyEnterBehavior,
  running: boolean,
  gesture: ComposerSubmitGesture,
  steeringAvailable: boolean,
): InputSubmitMode {
  if (!running || !steeringAvailable) return 'queue'
  if (gesture === 'enter') return preferred
  return preferred === 'queue' ? 'steer' : 'queue'
}
