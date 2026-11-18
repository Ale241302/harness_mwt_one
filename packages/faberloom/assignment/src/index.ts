/**
 * Native assignment rules (`ctx.faberloomAssignment`): an exact criterion
 * assigns an item to one Space or agent, and the decision reports which rules
 * matched, who wrote them, and any conflict instead of picking a side.
 *
 * The service only decides. It never moves mail, never reads a mailbox, and
 * never widens a Space's access: a target is a value the consumer acts on under
 * its own authority. Conflicts return the candidates and no target, so two rules
 * that disagree cannot silently widen the scope.
 * @module @deepseek-ai/dsh-faberloom-assignment
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { assignmentDomainSpec, type AssignmentRuleRecord } from './spec.ts'
import type {
  AssignmentCriterion,
  AssignmentDecision,
  AssignmentMatch,
  AssignmentRule,
  AssignmentRuleInput,
  AssignmentSubject,
  AssignmentTarget,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomAssignment: FaberLoomAssignment
  }
}

/** Map one durable record to its consumer-facing rule. */
function toRule(id: string, record: AssignmentRuleRecord): AssignmentRule {
  return {
    id,
    ownerId: record.ownerId,
    criterion: record.criterion,
    target: record.target,
    origin: record.origin,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
  }
}

/** Whether two targets are the same assignment. */
function sameTarget(left: AssignmentTarget, right: AssignmentTarget): boolean {
  return left.spaceId === right.spaceId && left.agentId === right.agentId
}

/** Fold a value for comparison; the criterion's value is folded the same way. */
function fold(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Whether one subject satisfies one exact criterion.
 * @param criterion - the rule's field, operator and value.
 * @param subject - the item fields available.
 * @returns whether the field matches; a missing field never matches.
 */
export function criterionMatches(criterion: AssignmentCriterion, subject: AssignmentSubject): boolean {
  const raw = subject[criterion.field]
  if (raw === null || raw === undefined) return false
  const field = fold(raw)
  const needle = fold(criterion.value)
  switch (criterion.operator) {
    case 'equals': return field === needle
    case 'contains': return field.includes(needle)
    case 'startsWith': return field.startsWith(needle)
  }
}

/**
 * The assignment-rule service.
 */
export class FaberLoomAssignment extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof assignmentDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   */
  constructor(ctx: Context) {
    super(ctx, 'faberloomAssignment')
  }

  private async rules(): Promise<KvTable<string, AssignmentRuleRecord>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(assignmentDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.assignment.domainClose')
      return domain
    })()
    return (await this.domainPromise).table('rules')
  }

  /**
   * Create one rule for the owner.
   * @param ownerId - the owning identity.
   * @param input - exact criterion, target, and origin.
   * @returns the stored rule at version 1.
   * @throws when the criterion has no value or the target names nothing.
   */
  async createRule(ownerId: string, input: AssignmentRuleInput): Promise<AssignmentRule> {
    const value = input.criterion.value.trim()
    if (value.length === 0) throw new Error('faberloom: assignment criterion needs a value')
    if (input.target.spaceId === null && input.target.agentId === null) {
      throw new Error('faberloom: assignment rule needs a space or an agent')
    }
    const now = new Date().toISOString()
    const id = randomUUID()
    const record: AssignmentRuleRecord = {
      ownerId,
      criterion: { ...input.criterion, value },
      target: { ...input.target },
      origin: {
        kind: input.kind ?? 'human',
        by: ownerId,
        at: now,
        itemId: input.itemId ?? null,
      },
      version: 1,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    }
    await (await this.rules()).put(id, record)
    return toRule(id, record)
  }

  /**
   * Replace the criterion or target of one active rule and bump its version.
   *
   * The origin stays the one that created the rule; the edit is visible through
   * the version, so a decision can name exactly what decided. A revoked rule is
   * final: the caller creates a new one instead of reviving history.
   * @param ownerId - the owning identity.
   * @param id - rule id.
   * @param patch - criterion and/or target to replace.
   * @returns the updated rule.
   * @throws when the rule is absent, owned by another identity, revoked, or the patch is empty.
   */
  async updateRule(
    ownerId: string,
    id: string,
    patch: { readonly criterion?: AssignmentCriterion; readonly target?: AssignmentTarget },
  ): Promise<AssignmentRule> {
    const table = await this.rules()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: assignment rule ${id} not found`)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can edit this rule')
    if (record.revokedAt !== null) throw new Error('faberloom: a revoked rule cannot be edited')
    if (patch.criterion === undefined && patch.target === undefined) {
      throw new Error('faberloom: the patch changes nothing')
    }
    const criterion = patch.criterion === undefined ? record.criterion : patch.criterion
    const value = criterion.value.trim()
    if (value.length === 0) throw new Error('faberloom: assignment criterion needs a value')
    const target = patch.target === undefined ? record.target : patch.target
    if (target.spaceId === null && target.agentId === null) {
      throw new Error('faberloom: assignment rule needs a space or an agent')
    }
    const next: AssignmentRuleRecord = {
      ...record,
      criterion: { ...criterion, value },
      target: { ...target },
      version: record.version + 1,
      updatedAt: new Date().toISOString(),
    }
    await table.update(id, () => next)
    return toRule(id, next)
  }

  /**
   * Revoke one rule permanently. A revoked rule stays listed and stops matching.
   * @param ownerId - the owning identity.
   * @param id - rule id.
   * @returns the revoked rule; revoking twice returns it unchanged.
   * @throws when the rule is absent or owned by another identity.
   */
  async revokeRule(ownerId: string, id: string): Promise<AssignmentRule> {
    const table = await this.rules()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: assignment rule ${id} not found`)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can revoke this rule')
    if (record.revokedAt !== null) return toRule(id, record)
    const next: AssignmentRuleRecord = {
      ...record,
      revokedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: record.version + 1,
    }
    await table.update(id, () => next)
    return toRule(id, next)
  }

  /**
   * List every rule of the owner, revoked included, oldest first.
   * @param ownerId - the owning identity.
   * @returns the rules.
   */
  async listRules(ownerId: string): Promise<AssignmentRule[]> {
    const out: AssignmentRule[] = []
    for (const [id, record] of (await this.rules()).entries()) {
      if (record.ownerId !== ownerId) continue
      out.push(toRule(id, record))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }

  /**
   * Decide where one item goes without acting on it.
   *
   * Active rules are the only ones consulted. When every match names the same
   * target the decision is `assigned`; when they disagree it is `conflict`, and
   * `target` stays null so no consumer can pick a side by accident. The call
   * writes nothing: versions and revocation are exactly as they were.
   * @param ownerId - the owning identity.
   * @param subject - the item fields.
   * @returns the decision, the matching rules, and any conflicting targets.
   */
  async evaluate(ownerId: string, subject: AssignmentSubject): Promise<AssignmentDecision> {
    const matches: AssignmentMatch[] = []
    for (const [id, record] of (await this.rules()).entries()) {
      if (record.ownerId !== ownerId || record.revokedAt !== null) continue
      if (!criterionMatches(record.criterion, subject)) continue
      matches.push({ ruleId: id, version: record.version, target: record.target })
    }
    const targets: AssignmentTarget[] = []
    for (const match of matches) {
      if (!targets.some(target => sameTarget(target, match.target))) targets.push(match.target)
    }
    if (targets.length === 0) return { status: 'none', target: null, matches, conflicts: [] }
    if (targets.length === 1) return { status: 'assigned', target: targets[0] ?? null, matches, conflicts: [] }
    return { status: 'conflict', target: null, matches, conflicts: targets }
  }
}

export default FaberLoomAssignment
