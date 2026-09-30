# Agent Note: the gateway refreshes deployment-seeded agent presets

Status: implemented

English | [中文](2026-09-30-shared-preset-refresh.zh.md)

## Problem

`writeUserPresets` copied each `agents-shared/<preset>` directory into `<DSH_HOME>/.agent-presets` only when the destination did not exist, so an owner provisioned before a preset changed kept the stale composition — its persona, tool rows, and skill rows — for good. Two consecutive deployments of the same owner silently served the first copy, and a persona fix reached only owners created afterwards.

## Decision

- The gateway records the presets it seeded in `.agent-presets/.deployment-seeded.json`. On every instance start it re-copies a marked preset from `agents-shared/`. A preset with no marker is left untouched unless it is byte-identical to its source, in which case it is adopted into the marker first, migrating owners seeded before the marker existed. A preset the owner created or edited never matches its source and is never overwritten.
- `dsh-agent-presets` discovers only directories whose name matches its preset-id grammar, so the marker file beside the preset directories is inert.

## Alternatives considered

**Overwrite every `agents-shared/<name>` unconditionally.** It would clobber an owner's own preset that happens to share a name with a deployment preset; the marker keeps the two sources distinct.

**Refresh at read time.** The preset roster is read by the harness per session; mutating the home from that path would couple deployment data to a session-time read.

## Consequences

- A change to `agents-shared/` reaches every owner on the next dsh start, not only owners created later.
- An owner who edits a deployment-seeded preset loses that edit on the next start; the preset is deployment-owned by definition.

## Testing

Deployed to the VPS and observed: the `sicop-analyst` preset of an owner seeded before the persona change was refreshed to the new persona on start, and `.deployment-seeded.json` was written beside it. No gateway test harness exists, so the behavior is verified by that deployed run.
