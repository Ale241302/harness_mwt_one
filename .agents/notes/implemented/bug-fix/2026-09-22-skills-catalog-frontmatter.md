# Agent Note: the role skills catalog parses again

Status: implemented

English | [中文](2026-09-22-skills-catalog-frontmatter.zh.md)

## Problem

Every skill in the shipped role catalog (`skills-catalog/<role>/<skill>/SKILL.md`) was silently ignored by the harness skill registry, so the composer's `/` skill menu was empty for every user. Two defects compounded: each `description` contained an unquoted colon (`Herramientas MCP: …`), which makes the YAML frontmatter unparseable, and the `client_b2b` role's names carried underscores (`mwt-client_b2b-…`), which the harness's kebab-case `SKILL_NAME` rule rejects. The provider's warnings named both, one file at a time.

## Decision

The catalog is repaired in place and the flattener now emits valid output, so a regeneration cannot reintroduce the defect.

- A one-off repair quoted every `description` value (YAML double-quoted with escaping), normalized every `name` to kebab-case (non-`[a-z0-9]` runs become `-`), and renamed the 23 `client_b2b` skill directories to match their new names: 652 files repaired, 23 directories renamed.
- `scripts/flatten-skills.mjs` applies the same normalization when it writes each `SKILL.md`, quoting `description` and kebab-casing `name`, so the next catalog regeneration produces loadable files by construction.

No consumer referenced the old underscored names: the defaults catalog seeds agents with `mwt-compras-*` names (already kebab), and the view reads names live from the catalog.

## Alternatives considered

- **Relaxing `SKILL_NAME` to accept underscores.** Rejected: the name rule is an upstream model-visible contract (skill names appear in `/` invocations and prompt text), and only the `client_b2b` role was affected — normalizing the catalog is smaller than widening the grammar.
- **Fixing only the flattener and regenerating.** Rejected: the generation source (the Skills-MCP checkout) is not part of this repository, so an in-place repair was required regardless; the flattener fix keeps the two from drifting apart.

## Consequences

- Discovery loads the full catalog per role (verified with the package's own test harness: 132 admin, 23 client_b2b, 66 compras skills, zero warnings), so `/` lists role skills and `faberloom_mail`-style pre-step injection can load their bodies.
- Renamed `client_b2b` skills appear under their kebab names everywhere (menu, panel, agent assignments), with no compatibility shim: nothing durable referenced the old names.
- The flattener's repair is idempotent, matching the one-off script's output on an already-repaired tree.
