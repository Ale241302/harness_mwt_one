/**
 * The skill-install domain declaration: one durable row per skill installed
 * from a folder, keyed by owner, destination, and name. The row records where
 * the skill came from and where it landed, so an install can be listed and
 * removed as an install instead of as an unnamed file under a skills root.
 * @module @deepseek-ai/dsh-faberloom-view/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Durable install row. */
export const skillInstallRecord = z.object({
  ownerId: z.string(),
  name: z.string(),
  sourcePath: z.string(),
  destination: z.union([z.literal('workspace'), z.literal('global')]),
  destinationRoot: z.string(),
  installedAt: z.string(),
})

/** One stored install, inferred from {@link skillInstallRecord}. */
export type SkillInstallRecord = z.infer<typeof skillInstallRecord>

/** The skill-install domain spec: one `installs` table from source path to skills root. */
export const skillInstallDomainSpec = defineDomain({
  name: 'faberloom_skill_installs',
  version: 1,
  tables: {
    installs: domainTable<string, SkillInstallRecord>(skillInstallRecord),
  },
})
