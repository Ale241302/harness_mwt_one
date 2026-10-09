/**
 * The agent-runtime domain declaration: the durable consultations between a
 * caller session and a Space agent. One row per owner, Space, and caller
 * session, keyed so a later follow-up finds its child.
 * @module @deepseek-ai/dsh-faberloom-agent-runtime/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Durable consultation row. */
export const consultationRecord = z.object({
  ownerId: z.string(),
  spaceId: z.string(),
  callerSessionId: z.string(),
  childSessionId: z.string(),
  label: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored consultation, inferred from {@link consultationRecord}. */
export type ConsultationRecord = z.infer<typeof consultationRecord>

/** The agent-runtime domain spec: a `consultations` table. */
export const agentRuntimeDomainSpec = defineDomain({
  name: 'faberloom_agent_runtime',
  version: 1,
  tables: {
    consultations: domainTable<string, ConsultationRecord>(consultationRecord),
  },
})
