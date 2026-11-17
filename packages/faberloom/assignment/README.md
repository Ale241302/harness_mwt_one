---
description: "Assignment rules (ctx.faberloomAssignment): exact criteria, origin, version, conflict reporting and persistent revocation for the FaberLoom work assignment, without acting on any mailbox or Space."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-assignment

English | [中文](README.zh.md)

## Summary

The assignment service decides where one item goes. A rule reads one item field (`from`, `subject`, `account`, `company`) with one exact operator (`equals`, `contains`, `startsWith`) and names a Space, an agent, or both. `evaluate` returns the decision, every rule that matched, and any conflict: two active rules that name different targets produce `conflict` and no target, so nothing widens the scope silently. The service never moves mail, never reads a mailbox, and never grants Space access; the consumer acts on the decision under its own authority.

Rules carry their origin (who wrote them, when, from which item), a version that changes on every edit, and a permanent `revokedAt`. A revoked rule stays listed and stops matching; a revoked rule cannot be edited, so history is not revived by accident.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.storageDomain` is present. The service is backend-only: authoring and the visible label arrive with O5-02B/C, and the rules are durable through the storage domain.

```ts
const rule = await ctx.faberloomAssignment.createRule(ownerId, {
  criterion: { field: 'from', operator: 'contains', value: 'eguisa' },
  target: { spaceId: 'sp-eguisa', agentId: null },
})
const decision = await ctx.faberloomAssignment.evaluate(ownerId, { from: 'compras@eguisa.example' })
// { status: 'assigned', target: { spaceId: 'sp-eguisa', agentId: null }, matches: [...], conflicts: [] }
```

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing directly. The service registers no tools and writes no prompt text.

#### Token effect

Zero direct tokens.

#### KV Cache effect

Independent of live requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No authoring surface yet.** The `faberloom-assignment` row mounts the service in the product composition and O5-02C adds the assignment gesture with the visible rule and its `asignado por regla` label.
- **Criteria are single-field and text-only.** Compound conditions, numeric ranges and message bodies are deferred; a rule never inspects an attachment or a body.
- **The decision is advisory.** Nothing here enforces the target; enforcement belongs to the consumer that owns the item.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Comparison folds case and trims the criterion value, so a sender line with different casing still matches. A missing field never matches. `evaluate` reads only: it writes nothing, and the test fixes that evaluating twice leaves versions and revocation untouched.

</details>

**Runtime invariant:** No companion is published. Every read resolves the owner's rules from the storage domain at call time and sorts by creation instant.
