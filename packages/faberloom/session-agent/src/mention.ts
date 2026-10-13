/**
 * The `@Name` mention rule shared with the chat picker and the `faberloom:mentions`
 * instruction: a message that opens with `@` followed by a catalog agent's name,
 * then a space or the end of the text, addresses that agent. These are pure
 * helpers; the service in `index.ts` applies the route one resolves.
 * @module @deepseek-ai/dsh-faberloom-session-agent/src/mention
 */

import type { FaberLoomAgent } from '@deepseek-ai/dsh-faberloom-agents'
import type { UserMessage } from '@deepseek-ai/dsh-session'

/** The character that may end a mention name; the picker inserts `@Name ` with a trailing space. */
const NAME_END = /\s/

/**
 * Read the text of the latest user-role message among a claimed step's messages.
 * @param messages - messages removed from the inbox for one step.
 * @returns the text blocks of the newest user message joined by newlines, or
 * `undefined` when no user message carries text.
 */
export function latestUserText(messages: readonly UserMessage[]): string | undefined {
  const message = [...messages].reverse().find(candidate => candidate.source.kind === 'user')
  if (message === undefined) return undefined
  const text = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  return text.length === 0 ? undefined : text
}

/**
 * Resolve the catalog agent one message opens with. The name must appear right
 * after the opening `@` and be followed by whitespace or the end of the text;
 * the longest matching name wins, so a name that is a prefix of another does not
 * shadow it.
 * @param text - the latest user message's text.
 * @param agents - the catalog agents to match.
 * @returns the addressed agent, or `undefined` when the message names none.
 */
export function matchMentionedAgent(text: string, agents: readonly FaberLoomAgent[]): FaberLoomAgent | undefined {
  if (!text.startsWith('@')) return undefined
  let matched: FaberLoomAgent | undefined
  let matchedLength = 0
  for (const agent of agents) {
    const name = agent.name
    if (name.length === 0) continue
    if (!text.startsWith(`@${name}`)) continue
    const following = text.charAt(name.length + 1)
    if (following !== '' && !NAME_END.test(following)) continue
    if (name.length <= matchedLength) continue
    matched = agent
    matchedLength = name.length
  }
  return matched
}
