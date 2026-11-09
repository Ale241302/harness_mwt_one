# Agent Note: Host conversion reports every field and refuses silent equivalence

Status: implemented

English | [中文](2026-11-09-component-conversion.zh.md)

## Problem

The Claude adapter treated every non-skill artifact file as a resource. A workflow, routine, memory record, or unsupported tool could therefore appear in the plugin as ordinary content, and an agent's `tools` field disappeared without a record. The inventory carried the classification but not whether a file came from the child or the fixed parent revision. D13 is still open, so no adapter may claim it replaces the legacy generator.

## Decision

**Conversion is a field-level report, not a copy loop.** `packages/faberloom/portable/src/adapters/conversion.ts` maps every portable file to `preserved`, `translated`, `omitted`, or `rejected`, with a stable reason. `document`, `context`, `resource`, and skill-resource files are preserved; a valid skill is preserved as `skills/<name>/SKILL.md`; an agent is translated to `agents/<name>.md`, its frontmatter and `tools` field are preserved, and only its name is normalized to the host slug. Omitting `tools` would make the host inherit every tool, so the writer never drops it. A workflow is rejected as `workflow-not-representable`; a tool, session, transcript, or full backup is rejected with its own reason; `routine`, `memory`, and `metadata` are omitted as `not-a-host-component`. An invalid skill or agent is rejected, not repaired. The converter also rechecks the content hash and kind against the manifest, so a forged plan cannot smuggle a session, a transcript, or different bytes past the adapter.

**Rejection keeps the source.** A rejected component remains in the signed portable artifact and is absent from the host package. The report counts accepted, omitted, and rejected components and lists every limitation. The adapter packages the accepted remainder; it does not invent an equivalent Markdown file for a workflow or a resource for a tool.

**The inventory carries origin and policy.** Each manifest file records `origin` (`child` or `inherited`) in addition to the existing classification, media type, byte length, SHA-256, and metadata digest. Changing the origin changes the content version and manifest digest, so two exports with the same bytes but different origin are distinguishable.

**D13 stays open.** The conversion report records `legacyGenerator: retained` and `legacyReason: D13-open`. The legacy generator keeps its consumers until its source and migration are demonstrated; this wave does not claim total replacement. Removing an installed Claude package removes only that directory; it does not publish, revoke, or rewrite the source artifact or any product record.

## Alternatives considered

**Copy every non-skill file into `resources/`.** That is the bug: a workflow or a tool would look like an ordinary resource and an agent would lose its tool restriction without a report.

**Reject the whole package when one component is incompatible.** That discards usable components. The source artifact still holds the rejected component, and the report tells the human which one was left out.

**Omit an agent's `tools` field to avoid a host mismatch.** In Claude Code an omitted `tools` field means every available tool, which widens the agent's permissions. The converter preserves the declared field; if a host cannot represent it, that agent is rejected instead.

**Rewrite a workflow as Markdown.** The formats are not equivalent. A workflow is rejected and the source remains; the report says why.

**Bump the format version to add origin.** The field is additive and the inventory's canonical digest already covers it; keeping `formatVersion` at 1 avoids forcing every consumer to parse a new layout.

## Consequences

A host package may be partial. The conversion report is the authority on what was omitted or rejected, and `faberloom/conversion.json` travels with a ready package. It also records how many planner contributions were withheld and their reasons, without exposing paths. An agent's tools are preserved, never silently widened or dropped; a duplicate or reserved skill name is rejected as its own component instead of aborting the package. A skill resource follows the normalized skill directory; a resource whose skill was rejected is rejected as `skill-resource-orphan`. The inventory distinguishes inherited content from child content, so identity changes move the digest. D13 remains a recorded limitation rather than an unstated replacement claim.

## Verification

- `packages/faberloom/portable/tests/conversion.spec.ts`: supported preservation; agent tools preserved; workflow rejection; routine omission; skill-resource preservation; invalid skill, tool, backup, session, and transcript rejection; withheld count; origin in the inventory and origin-only digest change; reproducibility.
- `packages/faberloom/portable/tests/distribution.spec.ts`: the Claude package carries the agent with its `tools` field, refuses the workflow, writes `faberloom/conversion.json`, and validates the agent component.
- `packages/faberloom/portable/tests/projection.spec.ts`: PKG-03/PKG-04 canonical inventory, digest, and identity changes.
- `packages/faberloom/portable/tests/context-authorization.spec.ts`: CTR-PORTABLE-01 sessions and transcripts remain refused.
