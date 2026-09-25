# Agent Note: a curated shared skills catalog rides every role

Status: implemented

English | [中文](2026-09-24-faberloom-shared-skills.zh.md)

## Problem

The harness exposed only the role's MCP business skills (`<skillsCatalogRoot>/<role>/<skill>`), so two users carried disjoint skill sets and neither could reach generalist skills — research, thinking, or operations playbooks — that apply across roles. Opening a Space from an email also began with an empty playbook: the agent had the message but no method to interrogate what the user actually wanted.

## Decision

The gateway exposes a second skill root, `<skillsSharedRoot>` (`/opt/skills-shared`), alongside the role catalog, so every user gets the same curated skills regardless of role. `skills-shared/` vendors 18 generalist skills from ECC (MIT) plus the owner's `interview-me`, and the email→Space seed applies `interview-me` on the first turn.

- `renderPatch` adds `skillsSharedRoot` to the `faberloom-skills` (`dsh-skill-filesystem`) source's `customSkillDirs` when the directory exists, even for a user with no role directory.
- The files ship in the repo (`skills-shared/**`, copied to `/opt/skills-shared` by the Dockerfile and pushed by `push-to-vps.ps1`) so they are versioned and deployed with the harness.
- ECC is MIT; `skills-shared/ECC-LICENSE.txt` records the source, version, file list, and license.

## Alternatives considered

**Copy all 292 ECC skills.** Most are irrelevant stacks (kotlin, laravel, swift); a curated set keeps the catalog signal high and the review small.

**Seed `$DSH_HOME/skills` per user.** The gateway would copy files at instance start; the repo already ships the role catalog the same way, so a second checkout root adds no value.

## Consequences

- The shared skills are model-invocable in every session; the role catalog still shadows a shared skill of the same name.
- The FaberLoom Skills panel lists only the role root, so shared skills do not appear there yet.
- Vendored skills are not npm dependencies, so they carry their own license file rather than a `THIRD_PARTY_NOTICES` entry.

## Testing

`packages/faberloom/view/tests/space-from-email.spec.ts` asserts the seed names `interview-me`. The gateway renders the source configuration and is exercised by the deploy smoke; a live session confirms the skill is loadable.
