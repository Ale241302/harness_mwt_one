# Agent Note: ECC agents ship as native dsh presets

Status: implemented

English | [中文](2026-09-24-faberloom-native-agent-presets.zh.md)

## Problem

The ECC catalog was imported as skills, so its agents arrived as user-invocable skills that inject instructions into a step; they were not selectable agent compositions. The team wanted the ECC agents as real dsh agents: a session composed with the agent's own persona and toolset, chosen before the session starts.

## Decision

Generate one dsh agent preset per ECC agent and seed them into each user's roster.

- `agents-shared/<id>/` holds `agent.cordis.yml` — a copy of the shipped `standard` composition with the persona `prefix` replaced by the ECC agent body — and `preset.yml` with the display name, description, and order.
- Each preset's tool rows are scoped from the ECC `tools:` field: the shell stack (`tool-bash`/`tool-pwsh`) and background jobs are kept only when the agent declares `Bash`, and `tool-web` only on `WebSearch`/`WebFetch`. The file and search plugins stay for every agent because all of them declare `Read` and `Grep`.
- `writeUserPresets(home)` copies `agentsSharedRoot` (`/opt/agents-shared`) into the user's `<DSH_HOME>/.agent-presets` at instance start, where `dsh-agent-presets`' `includeUserRoot` discovers it; an existing user preset is never overwritten.
- The Dockerfile bakes `/opt/agents-shared` and `push-to-vps.ps1` uploads `agents-shared/`.

## Alternatives considered

**Author each preset from scratch.** Reusing the known-good `standard` composition and swapping only the persona keeps every generated preset loadable without re-deriving the tool, skill, compaction, and delegation rows.

**Configure a deployment `roots` entry.** It would need to override the base `agent-presets` row from the per-user patch; the user root is the supported extension point and needs no row merge.

**Scope every ECC tool.** The dsh tool plugins group tools (`tool-fs` is read, write, edit, and read_image), so a per-tool restriction is not expressible; the preset keeps the file and search plugins and scopes only the shell, jobs, and web rows.

## Consequences

- Every ECC agent is a selectable preset, distinguished by its persona and by whether it carries the shell and web rows.
- The 68 preset rows appear in the picker alongside `standard`, `ptc`, `cordis`, and `minimal`.
- The seeded presets are user-root copies; editing one is local and persists until removed.

## Testing

A validator confirmed all 68 generated compositions parse and carry a persona prefix and preset metadata. The gateway seeding runs at instance start and is exercised by the deploy smoke; a live session confirms an ECC preset is selectable and starts with its persona.
