/**
 * `!` shell-command token grammar and the model-facing form the composer
 * inserts, shared by trigger detection and the built-in `!` source. Pure and
 * browser-safe, the same split the `@file` grammar uses
 * (`activeAtToken` / `formatFileMention` in `@deepseek-ai/dsh-file-reference`).
 *
 * The inserted form IS the model-facing form: a pick replaces the `!` token
 * with {@link formatShellCommandMention}'s text, and a submit sends that same
 * text as the user message. No display-only projection exists in between.
 */

/** Active `!` shell-command token ending at the editor caret. */
export interface ActiveShellToken {
  /** Complete token a pick replaces: `!` plus the command text. */
  prefix: string
  /** Command text after the `!`: the menu query and the pick payload. */
  command: string
}

/**
 * Extract a `!command` token at the caret. The command runs to the end of the
 * line, spaces included, because a shell command is not a single word; an `!`
 * inside another token (`a!b`) and the `!=` / `!==` operators are not
 * triggers.
 * @param line - current editor text.
 * @param cursorCol - caret offset within that text.
 * @returns the active token, or undefined outside a `!` token.
 */
export function activeShellToken(line: string, cursorCol: number): ActiveShellToken | undefined {
  const beforeCursor = line.slice(0, cursorCol)
  const match = /(?:^|\s)(!([^\n]*))$/u.exec(beforeCursor)
  if (match?.[1] === undefined || match[2] === undefined) return undefined
  if (match[2].startsWith('=')) return undefined
  return { prefix: match[1], command: match[2] }
}

/**
 * Lead of the model-facing form. This text is protocol, not product copy: it
 * names the action the model already performs with its shell tool and stays
 * out of the locale dictionaries for the same reason a `@path` mention does.
 */
const COMMAND_LEAD = 'Run this shell command: '

/**
 * Format one typed shell command as the model-facing request the composer
 * inserts. The draft text a reader sees and the prompt text the model
 * receives are this one string.
 * @param command - command text typed after the `!`.
 * @returns the model-facing form, or undefined for a command the grammar
 * cannot express (empty, or carrying control characters).
 */
export function formatShellCommandMention(command: string): string | undefined {
  const trimmed = command.trim()
  if (trimmed === '') return undefined
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(trimmed)) return undefined
  return `${COMMAND_LEAD}${trimmed}`
}
