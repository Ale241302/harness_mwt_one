# Agent Note: the ECC catalog rides every role as shared skills

Status: implemented

English | [中文](2026-09-24-faberloom-shared-skills.zh.md)

## Problem

The harness exposed only the role's MCP business skills (`<skillsCatalogRoot>/<role>/<skill>`), so two users carried disjoint skill sets and neither could reach the generalist research, thinking, and operations playbooks the team already keeps in ECC. Opening a Space from an email also began with an empty playbook: the agent had the message but no method to interrogate what the user actually wanted. And the durable skill catalog is model-visible, so naively importing hundreds of skills would spend context on every session.

## Decision

The gateway exposes a second skill root, `<skillsSharedRoot>` (`/opt/skills-shared`), alongside the role catalog, so every user gets the same shared skills regardless of role. `skills-shared/` vendors the ECC catalog (MIT) plus the owner's `interview-me`, and the email→Space seed applies `interview-me` on the first turn.

- Import scope: 292 ECC skills copied verbatim, 94 commands rewritten as user-invocable skills named `cmd-<command>`, and 68 agents rewritten as user-invocable skills named `agent-<agent>`. The prefixes avoid the nine names that collide between an ECC skill and command.
- Model visibility is the token lever: only the 24 curated skills — including `interview-me` and the requested `security-scan`, `production-audit`, `plan-orchestrate`, `code-tour`, `skill-scout` — are model-invocable and enter the durable skill catalog. Every other skill, command, and agent carries `disable-model-invocation: true`, so the catalog stays at 24 entries while the whole set stays reachable through `/name`.
- `renderPatch` adds `skillsSharedRoot` to the `faberloom-skills` (`dsh-skill-filesystem`) source's `customSkillDirs` when the directory exists, even for a user with no role directory.
- The files ship in the repo (`skills-shared/**`, copied to `/opt/skills-shared` by the Dockerfile and pushed by `push-to-vps.ps1`) so they are versioned and deployed with the harness.
- ECC is MIT; `skills-shared/ECC-LICENSE.txt` records the source, version, counts, and license.

## Alternatives considered

**Import nothing but the curated set.** It keeps the catalog small but withholds the rest of ECC; user-invocable skills cost no catalog tokens, so the full set costs nothing to hold.

**Make every ECC entry model-invocable.** The catalog would carry ~380 descriptions into every session; the `/name` path covers the long tail at zero catalog cost.

**Map ECC agents to dsh agent presets.** Presets compose plugins and tool selections per session; the agent bodies are instruction sets, so rewriting them as user-invocable skills keeps their content without a per-agent tool-name mapping.

## Consequences

- Only the 24 curated skills consume catalog tokens; the remaining skills, commands (`/cmd-<name>`), and agents (`/agent-<name>`) are reachable by name at no catalog cost.
- The role catalog still shadows a shared skill of the same name.
- The FaberLoom Skills panel lists only the role root, so shared skills do not appear there yet.
- Vendored skills are not npm dependencies, so they carry their own license file rather than a `THIRD_PARTY_NOTICES` entry.

## Testing

`packages/faberloom/view/tests/space-from-email.spec.ts` asserts the seed names `interview-me`. The gateway renders the source configuration and is exercised by the deploy smoke; a live session confirms a curated skill loads from the catalog and a `cmd-`/`agent-` skill loads from `/name`.
