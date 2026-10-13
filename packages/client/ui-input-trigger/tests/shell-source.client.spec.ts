// The built-in `!` source: one row carrying the live command, and a pick that
// inserts the model-facing request form.
import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { CandidateRequest, ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { en } from '../src/client/locales.ts'
import { SHELL_SOURCE_NAME, createShellCommandSource } from '../src/client/shell-source.ts'

const session: ClientSessionContext = { sessionId: 'a' as ClientSessionContext['sessionId'] }
const t = makeTranslate(en)

function request(query: string): CandidateRequest {
  return { query, position: 'leading', drilled: false, signal: new AbortController().signal }
}

describe('createShellCommandSource', () => {
  it('binds the `!` trigger under the menu group name', () => {
    const source = createShellCommandSource(t)
    expect(source.trigger).toBe('!')
    expect(source.name).toBe(SHELL_SOURCE_NAME)
    expect(source.name).toBe('shell')
  })

  it('offers one row carrying the trimmed command as its name and value', async () => {
    const source = createShellCommandSource(t)
    await expect(source.candidates(session, request('  git status  '))).resolves.toEqual([
      { name: 'git status', description: 'Run this command', value: 'git status' },
    ])
  })

  it('offers no row before a command is typed', async () => {
    const source = createShellCommandSource(t)
    await expect(source.candidates(session, request(''))).resolves.toEqual([])
    await expect(source.candidates(session, request('   '))).resolves.toEqual([])
  })

  it('inserts the model-facing form as plain text', () => {
    const source = createShellCommandSource(t)
    const outcome = source.onPick({
      candidate: { name: 'git status', value: 'git status' },
      session,
      position: 'leading',
      via: 'menu',
      action: 'pick',
      span: { start: 0, end: 10, draftRev: 1 },
    })
    expect(outcome).toEqual({ text: 'Run this shell command: git status' })
  })

  it('inserts nothing for a row without a command value or one the form refuses', () => {
    const source = createShellCommandSource(t)
    const pick = (value?: string) => source.onPick({
      candidate: { name: 'row', ...(value === undefined ? {} : { value }) },
      session,
      position: 'leading',
      via: 'menu',
      action: 'pick',
      span: { start: 0, end: 1, draftRev: 1 },
    })
    expect(pick()).toBeUndefined()
    expect(pick('echo\u0007')).toBeUndefined()
    expect(pick('echo "hi"')).toEqual({ text: 'Run this shell command: echo "hi"' })
  })
})
