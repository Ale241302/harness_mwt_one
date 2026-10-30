import { describe, expect, it } from 'vitest'
import type { FaberLoomAgent } from '@deepseek-ai/dsh-faberloom-agents'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { latestUserText, matchMentionedAgent } from '../src/mention.ts'

/** One catalog agent carrying only the name the mention rule reads. */
function named(name: string): FaberLoomAgent {
  return { name } as unknown as FaberLoomAgent
}

/** One user-role message with the given text. */
function user(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** One plugin-injected user-role message with the given text. */
function injected(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'test' } })
}

describe('latestUserText', () => {
  it('reads the text of the newest user message', () => {
    expect(latestUserText([user('first'), user('@AgentA hola')])).toBe('@AgentA hola')
  })

  it('returns undefined without a user message', () => {
    expect(latestUserText([])).toBeUndefined()
    expect(latestUserText([injected('context')])).toBeUndefined()
  })

  it('returns undefined when the newest user message carries no text', () => {
    expect(latestUserText([user('earlier'), createUserMessage({
      content: [],
      source: { kind: 'user' },
    })])).toBeUndefined()
  })

  it('joins the text blocks of the newest user message', () => {
    const message = createUserMessage({
      content: [{ type: 'text', text: '@AgentA' }, { type: 'text', text: 'hola' }],
      source: { kind: 'user' },
    })
    expect(latestUserText([message])).toBe('@AgentA\nhola')
  })
})

describe('matchMentionedAgent', () => {
  const agents = [named('AgentA'), named('AgentB')]

  it('resolves the agent a message opens with', () => {
    expect(matchMentionedAgent('@AgentA hola', agents)).toMatchObject({ name: 'AgentA' })
  })

  it('accepts a mention at the end of the text', () => {
    expect(matchMentionedAgent('@AgentB', agents)).toMatchObject({ name: 'AgentB' })
  })

  it('returns undefined when the message does not open with a mention', () => {
    expect(matchMentionedAgent('hola @AgentA', agents)).toBeUndefined()
  })

  it('returns undefined for an unknown name', () => {
    expect(matchMentionedAgent('@Nadie hola', agents)).toBeUndefined()
  })

  it('does not match a longer name that merely starts with a known one', () => {
    expect(matchMentionedAgent('@AgentAB hola', agents)).toBeUndefined()
  })

  it('ignores an agent whose name is empty', () => {
    expect(matchMentionedAgent('@ x', [named('')])).toBeUndefined()
  })

  it('prefers the longest matching name', () => {
    expect(matchMentionedAgent('@AgentA B hola', [named('AgentA'), named('AgentA B')]))
      .toMatchObject({ name: 'AgentA B' })
    expect(matchMentionedAgent('@AgentA B hola', [named('AgentA B'), named('AgentA')]))
      .toMatchObject({ name: 'AgentA B' })
  })
})
