// `!` shell-command grammar: token extraction at the caret plus the
// model-facing form a pick inserts, mirroring the `@file` split
// (activeAtToken / formatFileMention).
import { describe, expect, it } from 'vitest'
import { activeShellToken, formatShellCommandMention } from '../src/core/shell-command.ts'

describe('activeShellToken', () => {
  it('takes the whole command after the `!`, spaces included', () => {
    expect(activeShellToken('!git status --short', 19)).toEqual({
      prefix: '!git status --short',
      command: 'git status --short',
    })
  })

  it('opens at start of draft and after whitespace and newlines', () => {
    expect(activeShellToken('!ls', 3)).toEqual({ prefix: '!ls', command: 'ls' })
    expect(activeShellToken('say !ls -la', 11)).toEqual({ prefix: '!ls -la', command: 'ls -la' })
    expect(activeShellToken('first\n!echo hi', 14)).toEqual({ prefix: '!echo hi', command: 'echo hi' })
  })

  it('reads only to the caret', () => {
    expect(activeShellToken('!git status', 3)).toEqual({ prefix: '!gi', command: 'gi' })
  })

  it('does not open inside another token', () => {
    expect(activeShellToken('a!b', 3)).toBeUndefined()
    expect(activeShellToken('wow!', 4)).toBeUndefined()
  })

  it('never captures past the line end', () => {
    // The command on the first line reaches only its own line end; a caret
    // after the newline leaves no live `!` token.
    expect(activeShellToken('!echo hi\nnext', 8)).toEqual({ prefix: '!echo hi', command: 'echo hi' })
    expect(activeShellToken('!echo hi\nnext', 13)).toBeUndefined()
  })

  it('treats the `!=` operator as ordinary text', () => {
    expect(activeShellToken('a != b', 6)).toBeUndefined()
    expect(activeShellToken('a !== b', 7)).toBeUndefined()
  })

  it('returns undefined without a `!` token', () => {
    expect(activeShellToken('', 0)).toBeUndefined()
    expect(activeShellToken('plain text', 10)).toBeUndefined()
    expect(activeShellToken('@file', 5)).toBeUndefined()
  })

  it('keeps a lone `!` as a token with an empty command', () => {
    expect(activeShellToken('!', 1)).toEqual({ prefix: '!', command: '' })
  })
})

describe('formatShellCommandMention', () => {
  it('wraps a command in the model-facing request, trimmed', () => {
    expect(formatShellCommandMention('  git status  ')).toBe('Run this shell command: git status')
    expect(formatShellCommandMention('echo "hi"')).toBe('Run this shell command: echo "hi"')
  })

  it('refuses an empty or blank command', () => {
    expect(formatShellCommandMention('')).toBeUndefined()
    expect(formatShellCommandMention('   ')).toBeUndefined()
  })

  it('refuses a command the prompt cannot carry literally', () => {
    expect(formatShellCommandMention('echo\u0007')).toBeUndefined()
  })
})
