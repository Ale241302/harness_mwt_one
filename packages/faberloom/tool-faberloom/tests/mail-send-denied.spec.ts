/**
 * T10-E1 · the agent tool surface cannot send, even when the authority holds a
 * valid `mail.send` grant. A grant authorizes an action, not a message, and E1
 * has no object that approves the exact text.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import { apply, type Config } from '../src/index.ts'

const OWNER = 'compras2@sondelsa.com'

/** The product tool row as the pilot mounts it. */
const CONFIG: Config = { ownerId: OWNER, role: 'admin', companyId: 'co-sondel', readOnly: false }

/** One captured tool definition. */
interface CapturedTool {
  readonly name: string
  readonly execute: (args: Record<string, unknown>) => Promise<unknown>
}

/** Boot storage plus the real authority, and capture the registered tools. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  const grant = await ctx.faberloomAccess.grant(OWNER, { action: 'mail.send' })

  const registered = new Map<string, CapturedTool>()
  const sendMail = vi.fn(async () => ({ messageId: 'should-not-happen', accepted: [] }))
  const services: Record<string, unknown> = {
    faberloomAccess: ctx.faberloomAccess,
    faberloomConnections: { sendMail },
  }
  const toolsCtx = {
    tools: { register: (definition: CapturedTool) => { registered.set(definition.name, definition); return () => {} } },
    get: (name: string) => services[name],
    effect: (callback: () => unknown) => { callback(); return () => {} },
    logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
  }
  apply(toolsCtx as never, CONFIG)
  return { access: ctx.faberloomAccess, grant, registered, sendMail }
}

describe('T10-E1 · the agent cannot send mail', () => {
  it('refuses with a valid grant in the authority and never touches the transport', async () => {
    const { access, grant, registered, sendMail } = await harness()

    // The grant is real: the authority itself would authorize the action.
    const decision = await access.check({ ownerId: OWNER, action: 'mail.send', context: grant.id })
    expect(decision.allowed).toBe(true)

    const tool = registered.get('faberloom_mail_send')
    expect(tool).toBeDefined()
    await expect(tool?.execute({ to: ['cliente@ejemplo.com'], subject: 'Hola', text: 'Cuerpo' }))
      .rejects.toThrow(/WRITE_NOT_APPROVED/u)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('keeps the tool definition honest: it says the message leaves and still denies', async () => {
    const { registered } = await harness()
    const tool = registered.get('faberloom_mail_send') as unknown as {
      readonly description: string
      readonly execute: (args: Record<string, unknown>) => Promise<unknown>
    }
    expect(tool.description).toContain('external effect')
    await expect(tool.execute({ to: ['cliente@ejemplo.com'], subject: 'Hola', text: 'Cuerpo' }))
      .rejects.toThrow(/needs an approved message/u)
  })
})
