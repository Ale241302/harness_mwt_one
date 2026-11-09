/**
 * The projection records this adapter consumes. It is structural on purpose:
 * `HarnessUsage` from the harness-projection package satisfies it without
 * coupling the portable package to that package's runtime or compiler face.
 * @module @deepseek-ai/dsh-faberloom-portable/src/usage
 */

import { canonicalJson } from './canonical.ts'
import type { PortableContribution } from './types.ts'

/** One scope agent as the projection reports it. */
export interface PortableUsageAgent {
  readonly id: string
  readonly name: string
  readonly responsibility: string
  readonly skills: readonly string[]
}

/** One resolved skill as the projection reports it. */
export interface PortableUsageSkill {
  readonly name: string
  readonly description: string
  readonly content: string
}

/** One workflow or routine as the projection reports it. */
export interface PortableUsageRecord {
  readonly id: string
  readonly name: string
  readonly status: string
}

/** One memory entry as the projection reports it. */
export interface PortableUsageMemory {
  readonly id: string
  readonly text: string
  readonly source: 'space' | 'teaching'
}

/** The subset of a projection usage this adapter reads. */
export interface PortableUsage {
  readonly agents: readonly PortableUsageAgent[]
  readonly skills: readonly PortableUsageSkill[]
  readonly workflows: readonly PortableUsageRecord[]
  readonly routines: readonly PortableUsageRecord[]
  readonly memory: readonly PortableUsageMemory[]
}

/** How the adapter classifies and links the projection records. */
export interface PortableUsageOptions {
  /** Classification per contribution id; a missing entry is denied by the planner. */
  readonly classifications: Readonly<Record<string, string>>
  /** Extra metadata per contribution id. */
  readonly metadata?: Readonly<Record<string, Readonly<Record<string, string>>>>
  /** Dependencies per contribution id. */
  readonly dependencies?: Readonly<Record<string, readonly string[]>>
}

/** Spread only when a classification is present, under exact optional properties. */
function withClassification(value: string | undefined): { classification?: string } {
  return value === undefined ? {} : { classification: value }
}

/** Spread only when metadata is present. */
function withMetadata(value: Readonly<Record<string, string>> | undefined): {
  metadata?: Readonly<Record<string, string>>
} {
  return value === undefined ? {} : { metadata: value }
}

/**
 * Fold a display name into a file-name slug.
 * @param name - display name.
 * @returns a non-empty lowercase slug.
 */
function slugOf(name: string): string {
  const folded = name
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
    .replace(/-+$/gu, '')
  return folded.length === 0 ? 'item' : folded
}

/**
 * Turn one projection usage into contributions.
 * @param usage - the scope records the projection read.
 * @param options - classifications and links keyed by contribution id.
 * @returns contributions, ordered by id.
 */
export function contributionsFromUsage(usage: PortableUsage, options: PortableUsageOptions): PortableContribution[] {
  const out: PortableContribution[] = []
  const metadata = (id: string): Readonly<Record<string, string>> | undefined => options.metadata?.[id]
  const dependsOn = (id: string): readonly string[] => options.dependencies?.[id] ?? []

  for (const agent of usage.agents) {
    const id = `agent:${agent.id}`
    const body = agent.responsibility.trim().length === 0 ? agent.name : agent.responsibility
    out.push({
      id,
      kind: 'agent',
      path: `agents/${slugOf(agent.name)}-${slugOf(agent.id)}.md`,
      title: agent.name,
      content: `# ${agent.name}\n\n${body}\n`,
      ...withClassification(options.classifications[id]),
      dependsOn: dependsOn(id),
      ...withMetadata(metadata(id)),
    })
  }
  for (const skill of usage.skills) {
    const id = `skill:${skill.name}`
    const description = skill.description.replace(/\s+/gu, ' ').trim()
    out.push({
      id,
      kind: 'skill',
      path: `skills/${skill.name}/SKILL.md`,
      title: skill.name,
      content: `---\nname: ${skill.name}\ndescription: ${description}\n---\n\n${skill.content.trim()}\n`,
      ...withClassification(options.classifications[id]),
      dependsOn: dependsOn(id),
      ...withMetadata(metadata(id)),
    })
  }
  for (const workflow of usage.workflows) {
    const id = `workflow:${workflow.id}`
    out.push({
      id,
      kind: 'workflow',
      path: `metadata/workflows/${slugOf(workflow.id)}.json`,
      title: workflow.name,
      content: canonicalJson({ id: workflow.id, name: workflow.name, status: workflow.status }),
      ...withClassification(options.classifications[id]),
      dependsOn: dependsOn(id),
      ...withMetadata(metadata(id)),
    })
  }
  for (const routine of usage.routines) {
    const id = `routine:${routine.id}`
    out.push({
      id,
      kind: 'routine',
      path: `metadata/routines/${slugOf(routine.id)}.json`,
      title: routine.name,
      content: canonicalJson({ id: routine.id, name: routine.name, status: routine.status }),
      ...withClassification(options.classifications[id]),
      dependsOn: dependsOn(id),
      ...withMetadata(metadata(id)),
    })
  }
  for (const memory of usage.memory) {
    const id = `memory:${memory.source}:${memory.id}`
    out.push({
      id,
      kind: 'memory',
      path: `metadata/memory/${slugOf(memory.source)}-${slugOf(memory.id)}.json`,
      title: memory.id,
      content: canonicalJson({ id: memory.id, source: memory.source, text: memory.text }),
      ...withClassification(options.classifications[id]),
      dependsOn: dependsOn(id),
      ...withMetadata(metadata(id)),
    })
  }
  return out.sort((left, right) => left.id.localeCompare(right.id))
}
