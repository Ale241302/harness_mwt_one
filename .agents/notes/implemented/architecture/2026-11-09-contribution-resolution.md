# Agent Note: Inheritance is resolved after authorization, never before it

Status: implemented

English | [中文](2026-11-09-contribution-resolution.zh.md)

## Problem

A child Space inherited its parent's context without checking whether the acting identity could read that parent. A parent in the same company could therefore contribute a rule or title to a child-only member. Shared parent memory was omitted even when the parent was readable. There was no resolver for child precedence, explicit exclusions, dependency graphs, cycles, duplicate names, or a context budget, and a parent change had no impact matrix.

## Decision

**The pure resolver works on authorized candidates only.** `packages/faberloom/spaces/src/resolve.ts` takes the root and parent contributions the caller already read. It applies child precedence by contribution id, explicit exclusions, dependency closure, cycle refusal, duplicate-name refusal, and a validated byte budget. When exactly one root contribution and an ancestor share a name, the root wins and the ancestor is reported as `name-conflict`; two root contributions with the same name remain unresolved. A missing or blocked dependency refuses the dependent; an over-budget contribution is reported as `context-budget`, and a second closure pass refuses dependents whose dependency the budget removed. No body is truncated to fit, and a non-finite or negative budget is rejected instead of disabling the ceiling. Issues carry the contribution id and a reason, never a private parent title or body. An exclusion names a Space, which hides its context contributions, or one contribution id; memory is an explicit capture and survives a Space exclusion while the ancestor is readable, matching `effectiveMemory`. `sources` lists Space ids in contribution id order.

**Spaces builds candidates after `mayRead`.** `FaberLoomSpaces.resolveContributions` walks the root and its ancestors; it adds a parent's rules, curated documents, and shared memory only after `mayRead(parent, actor)`. A private parent never enters the list, so it cannot reach a result, an issue, or a later publication. `effectiveContext` now applies the same parent check, and `effectiveMemory` includes shared entries from a readable ancestor instead of only the actor's own entries. A same-company identity is not access by itself. The authorization unit is the Space: the `mayRead` or active share grant decides the whole Space, and every contribution inside it inherits that decision. Per-item grants are not part of this model; a revoked or expired share stops the next resolution, as the grant-revocation test shows.

**A parent change produces an impact matrix.** `parentChangeImpact(actor, parentId)` walks each descendant's own inheritance chain, so a grandchild that opted out or a child that excluded the parent is not reported, and an unreadable intermediate stops the chain. It names only children the actor may read; an unreadable child is absent, so its id and revision do not leak. `permitted` means the actor may publish a new revision, so it uses `mayManage`, not `mayRead`. The result carries ids, current revisions, and no private titles; the query does not mutate a child or publish on its own, and the consumer publishes the permitted revisions.

## Alternatives considered

**Use company membership as the inheritance grant.** That is the bug: belonging to the organization would export a parent's material to a child member. The parent must be readable by contribution.

**Call `harness-projection.readUsage()` without an actor.** The projection reads durable records by scope, not by an authorized caller. The spaces resolver builds its candidates from authorized service reads, and no export path calls the projection without actor context.

**Resolve by read order and truncate on overflow.** Read order hides a name conflict, and truncation hides a missing dependency. The resolver rejects conflicts and reports a budget issue.

**Publish inside the impact query.** A query must not change durable state. The impact matrix identifies children and revisions; publication stays with the authorized consumer.

## Consequences

A child-only member sees only the child's contributions until the parent is granted. A readable parent's shared memory is inherited, while a private entry stays with its owner. Name conflicts, cycles, missing dependencies, and budget overflow are visible errors instead of silent omissions. The session scope also names how many memory entries, context keys, or curated entries the list cap omitted, so a prompt never drops them without a count. The resolver supports rule, document, skill, context, and memory kinds; the Space integration builds rules, curated documents, and memory, while skills from the agent catalog belong to the adapter slice. The impact matrix is a snapshot; the consumer still has to create the new revision and publish it.

## Verification

- `packages/faberloom/spaces/tests/contribution-resolution.spec.ts`: child-only member sees no parent context or private memory; after the parent grant the shared context and memory appear; a revoked view grant removes the parent contribution on the next resolution; skill child precedence; duplicate name, child-wins name conflict, cycle, missing dependency, budget closure that refuses a dependent, invalid budget, budget; Space exclusion that hides context but keeps memory; private title absent from issues; impact permitted only with manage rights, unreadable child omitted, opted-out and excluded descendants omitted, and a readable descendant behind an unreadable intermediate omitted.
- `packages/faberloom/session-agent/tests/session-agent.spec.ts`: the scope names omitted list items, context conflicts, omitted Sub Spaces, and extra out-of-scope Spaces instead of dropping them.
- `packages/faberloom/spaces/tests/reference.spec.ts`: existing reference composition and exclusion behavior still pass.
- `packages/faberloom/portable/tests/context-authorization.spec.ts`: the portable planner's own dependency and inheritance rules remain covered.
