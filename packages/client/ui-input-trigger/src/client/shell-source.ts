/**
 * The built-in `!` source: one menu row that turns the typed shell command
 * into the model-facing request the composer inserts. The row's copy is
 * locale-owned through the `slash.menu` dictionaries; the inserted text itself
 * is the model-facing protocol form produced by `../core/shell-command.ts` and
 * reaches the model unchanged as the user's message.
 *
 * The source reads no backing data — the command is the live query — so it
 * lives with the trigger pipeline rather than in a data-owning package.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { CandidateRequest, ClientSessionContext, InputTriggerSource } from '../types.ts'
import { formatShellCommandMention } from '../core/shell-command.ts'

/** Source (group) name; also the `slash.menu` key of its menu group title. */
export const SHELL_SOURCE_NAME = 'shell'

/**
 * Build the built-in `!` source bound to this package's menu dictionary.
 * @param t - `slash.menu` translator for the row copy.
 * @returns the source registered into the trigger pipeline.
 */
export function createShellCommandSource(t: TranslateNS<'slash.menu'>): InputTriggerSource {
  return {
    trigger: '!',
    name: SHELL_SOURCE_NAME,
    candidates(_session: ClientSessionContext, req: CandidateRequest) {
      const command = req.query.trim()
      if (command === '') return Promise.resolve([])
      return Promise.resolve([{ name: command, description: t('shell.run'), value: command }])
    },
    onPick({ candidate }) {
      const text = formatShellCommandMention(candidate.value ?? '')
      return text === undefined ? undefined : { text }
    },
  }
}
