# Agent Note: ECC agents ship as native dsh presets

Status: implemented

English | [中文](2026-09-24-faberloom-native-agent-presets.zh.md)

## Problem

The ECC catalog was imported as skills, so its agents arrived as user-invocable skills that inject instructions into a step; they were not selectable agent compositions. The team wanted the ECC agents as real dsh agents: a session composed with the agent's own persona and toolset, chosen before the session starts.

## Decision

Generate one dsh agent preset per ECC agent and seed them into each user's roster.

- `agents-shared/<id>/` holds `agent.cordis.yml` — a copy of the shipped `standard` composition with the persona `prefix` replaced by the ECC agent body — and `preset.yml` with the display name, description, and order.
- `writeUserPresets(home)` copies `agentsSharedRoot` (`/opt/agents-shared`) into the user's `<DSH_HOME>/.agent-presets` at instance start, where `dsh-agent-presets`' `includeUserRoot` discovers it; an existing user preset is never overwritten.
- The Dockerfile bakes `/opt/agents-shared` and `push-to-vps.ps1` uploads `agents-shared/`.

## Alternatives considered

**Author each preset from scratch.** Reusing the known-good `standard` composition and swapping only the persona keeps every generated preset loadable without re-deriving the tool, skill, compaction, and delegation rows.

**Configure a deployment `roots` entry.** It would need to override the base `agent-presets` row from the per-user patch; the user root is the supported extension point and needs no row merge.

**Scope each preset's tools to the ECC `tools:` field.** The mapping (`Read`→`read`/`read_image`, `Grep`/`Glob`→`grep`/`glob`, `Bash`→`bash`, `Web*`→`web`) is ready, but a wrong row marks the whole preset broken; this version keeps the standard toolset and leaves scoping as follow-up.

## Consequences

- Every ECC agent is a selectable preset, distinguished by its persona rather than its toolset.
- The 68 preset rows appear in the picker alongside `standard`, `ptc`, `cordis`, and `minimal`.
- The seeded presets are user-root copies; editing one is local and persists until removed.

## Testing

A validator confirmed all 68 generated compositions parse and carry a persona prefix and preset metadata. The gateway seeding runs at instance start and is exercised by the deploy smoke; a live session confirms an ECC preset is selectable and starts with its persona.
