import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { StepContext, StepHandler } from '@deepseek-ai/dsh-faberloom-routines'
import { extractSpreadsheetLink, HANDLER_NAMES } from '../src/index.ts'
import FaberLoomHandlers from '../src/index.ts'

describe('email.extract-spreadsheet-link', () => {
  it('finds an xlsx link inside a body', () => {
    const body = 'Adjunto el SAP: https://sap.mwt.one/export/OC-504983.xlsx?token=abc y saludos.'
    expect(extractSpreadsheetLink(body)).toBe('https://sap.mwt.one/export/OC-504983.xlsx?token=abc')
  })

  it('finds an xls link and stops at punctuation', () => {
    expect(extractSpreadsheetLink('mira http://host/a.xls, gracias')).toBe('http://host/a.xls')
  })

  it('returns null when there is no spreadsheet link', () => {
    expect(extractSpreadsheetLink('sin enlaces')).toBeNull()
    expect(extractSpreadsheetLink('https://host/page.html')).toBeNull()
  })
})

describe('handler registration set', () => {
  it('registers the email handlers alongside the base ones', () => {
    expect(HANDLER_NAMES).toContain('email.send')
    expect(HANDLER_NAMES).toContain('email.extract-spreadsheet-link')
    expect(HANDLER_NAMES).toContain('email.followup')
  })
})

/** Boot the handlers service over a mock routines/connections/inbound graph. */
async function harness() {
  const handlers = new Map<string, StepHandler>()
  const publish = vi.fn(async (input: { ownerId: string; kind: string; title: string; body: string }) => ({ id: 'n-1', ...input }))
  const ctx = new Context()
  ctx.provide('faberloomRoutines', {
    registerHandler: (name: string, handler: StepHandler) => {
      handlers.set(name, handler)
      return () => { handlers.delete(name) }
    },
    getExecution: async () => ({ ownerId: 'owner@muitowork.com' }),
  } as never)
  ctx.provide('faberloomBackup', {} as never)
  ctx.provide('faberloomConnections', { sendMail: vi.fn() } as never)
  ctx.provide('faberloomNotices', { publish } as never)
  ctx.provide('faberloomInbound', { readEmail: vi.fn(async () => 'Adjunto: https://h/a.xlsx fin') } as never)
  await ctx.plugin(FaberLoomHandlers)
  return { handlers, publish }
}

/** A step context with the fields a handler reads. */
function step(overrides: Partial<StepContext>): StepContext {
  return {
    executionId: 'e1',
    routineId: 'r1' as StepContext['routineId'],
    stepId: 's1',
    input: undefined,
    event: undefined,
    config: {},
    results: {},
    events: [],
    ...overrides,
  }
}

describe('email.send', () => {
  it('refuses to send from a routine: the write is denied in E1', async () => {
    const { handlers } = await harness()
    const handler = handlers.get('email.send')
    expect(handler).toBeDefined()
    await expect(handler?.(step({ input: { to: ['a@b.c'], subject: 'Hola', text: 'Cuerpo' } })))
      .rejects.toThrow(/WRITE_NOT_APPROVED/u)
  })
})

describe('email.followup', () => {
  const sent = { handler: 'email.send', to: ['a@b.c'], subject: 'Hola', text: 'Cuerpo', messageId: '<sent@mwt.one>' }

  it('notifies the owner instead of re-sending', async () => {
    const { handlers, publish } = await harness()
    const outcome = await handlers.get('email.followup')?.(step({ results: { s1: sent } }))
    expect(outcome).toMatchObject({ handler: 'email.followup', resent: false, reason: 'no reply' })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ kind: 'email-followup' })
  })

  it('does not resend when the thread was answered', async () => {
    const { handlers, publish } = await harness()
    const outcome = await handlers.get('email.followup')?.(step({
      results: { s1: sent },
      events: [{ key: 'k', type: 'email', data: { 'in-reply-to': '<sent@mwt.one>' } }],
    }))
    expect(outcome).toMatchObject({ handler: 'email.followup', resent: false, reason: 'replied' })
    expect(publish).not.toHaveBeenCalled()
  })
})
