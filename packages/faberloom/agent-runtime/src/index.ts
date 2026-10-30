/**
 * The agent runtime (`ctx.faberloomAgentRuntime`): the durable consultations a
 * caller session holds with a Space agent. One row per owner, Space, and caller
 * session, so a follow-up finds the child a continuable `spaces_ask` started
 * and the view can report the Space's live agents. Records are durable through
 * `ctx.storageDomain`; the service registers no tools and injects no prompt.
 * @module @deepseek-ai/dsh-faberloom-agent-runtime
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { agentRuntimeDomainSpec, type ConsultationRecord } from './spec.ts'
import type { AgentConsultation, AgentConsultationInput } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomAgentRuntime: FaberLoomAgentRuntime
  }
}

/** The table key for one owner, Space, and caller session. */
function keyOf(ownerId: string, spaceId: string, callerSessionId: string): string {
  return `${ownerId}\u0000${spaceId}\u0000${callerSessionId}`
}

/** Map one durable record to the consumer-facing consultation. */
function toConsultation(record: ConsultationRecord): AgentConsultation {
  return {
    spaceId: record.spaceId,
    callerSessionId: record.callerSessionId,
    childSessionId: record.childSessionId,
    label: record.label,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/**
 * The agent runtime service: durable consultations between caller sessions and
 * Space agents.
 */
export class FaberLoomAgentRuntime extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof agentRuntimeDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   */
  constructor(ctx: Context) {
    super(ctx, 'faberloomAgentRuntime')
    this.ctx.effect(() => () => this.closeDomain(), 'faberloom.agentRuntimeDomainClose')
  }

  /** Close the lazily opened domain, if any, when the service fiber unloads. */
  private async closeDomain(): Promise<void> {
    if (this.domainPromise === undefined) return
    await (await this.domainPromise).close()
  }

  /** Open the agent-runtime domain once and keep its handle. */
  private domain(): Promise<Domain<typeof agentRuntimeDomainSpec>> {
    this.domainPromise ??= this.ctx.storageDomain.open(agentRuntimeDomainSpec)
    return this.domainPromise
  }

  /** The consultations table handle. */
  private async consultations(): Promise<KvTable<string, ConsultationRecord>> {
    return (await this.domain()).table('consultations')
  }

  /**
   * Record one consultation, replacing the caller's earlier child for the same
   * Space and preserving its creation instant.
   * @param ownerId - the identity the consultation belongs to.
   * @param input - the Space, caller session, child, and label.
   * @returns the recorded consultation.
   */
  async record(ownerId: string, input: AgentConsultationInput): Promise<AgentConsultation> {
    const table = await this.consultations()
    const key = keyOf(ownerId, input.spaceId, input.callerSessionId)
    const at = new Date().toISOString()
    const existing = table.get(key)
    const record: ConsultationRecord = {
      ownerId,
      spaceId: input.spaceId,
      callerSessionId: input.callerSessionId,
      childSessionId: input.childSessionId,
      label: input.label,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    }
    await table.put(key, record)
    return toConsultation(record)
  }

  /**
   * Read the consultation one caller session holds with one Space.
   * @param ownerId - the identity the consultation belongs to.
   * @param spaceId - the consulted Space.
   * @param callerSessionId - the caller session.
   * @returns the consultation, or `undefined`.
   */
  async consultation(ownerId: string, spaceId: string, callerSessionId: string): Promise<AgentConsultation | undefined> {
    const record = (await this.consultations()).get(keyOf(ownerId, spaceId, callerSessionId))
    return record === undefined ? undefined : toConsultation(record)
  }

  /**
   * List every consultation a Space holds for one owner, newest first.
   * @param ownerId - the identity the consultations belong to.
   * @param spaceId - the Space whose consultations are read.
   * @returns the consultations.
   */
  async listForSpace(ownerId: string, spaceId: string): Promise<readonly AgentConsultation[]> {
    const rows: AgentConsultation[] = []
    for (const [, record] of (await this.consultations()).entries()) {
      if (record.ownerId === ownerId && record.spaceId === spaceId) rows.push(toConsultation(record))
    }
    return rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * Remove one consultation.
   * @param ownerId - the identity the consultation belongs to.
   * @param spaceId - the consulted Space.
   * @param callerSessionId - the caller session.
   * @returns true when a consultation was removed.
   */
  async remove(ownerId: string, spaceId: string, callerSessionId: string): Promise<boolean> {
    const table = await this.consultations()
    const key = keyOf(ownerId, spaceId, callerSessionId)
    if (table.get(key) === undefined) return false
    await table.delete(key)
    return true
  }
}

export default FaberLoomAgentRuntime
