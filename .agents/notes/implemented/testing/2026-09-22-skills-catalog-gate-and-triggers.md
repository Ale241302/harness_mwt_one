# Agent Note: the skills catalog is a verified artifact with routing-trigger descriptions

Status: implemented

English | [中文](2026-09-22-skills-catalog-gate-and-triggers.zh.md)

## Problem

Two recurring weaknesses in the role skills catalog. Every parse-class defect (the unquoted-colon and underscored-name bug fixed on 2026-09-22) was discovered by users staring at an empty `/` menu, not by a gate — nothing checked the catalog as an artifact. And the descriptions, which are the harness's only routing signal for model-invoked skills, named the role/module/action but never said *when* to use the skill, so the assistant picked tools by guesswork instead of by an explicit trigger.

## Decision

A validator gate and generated routing triggers, both idempotent and both enforced from now on.

- `scripts/verify-skills-catalog.ts` (`pnpm run verify-skills-catalog`, covered by `scripts/verify-skills-catalog.spec.ts` in the vitest suite) rejects: a skill directory without SKILL.md, missing or unparseable YAML frontmatter (js-yaml, the same bug class as 2026-09-22), a `name` that violates the harness's kebab-case grammar or mismatches its directory, a missing `description` or one without the routing trigger, a missing `module`, and an unknown `action` (the closed set view/create/update/delete/download_doc/view_doc/upload_doc). The spec runs the real catalog plus synthetic fixtures reproducing each bug class.
- Every description now carries a generated trigger, e.g. view → "Úsala cuando el usuario quiera consultar, listar, ver, buscar o revisar <module> (por ejemplo 'muéstrame <module>' o 'busca en <module>').", inserted by `scripts/rewrite-skill-triggers.mjs` before the "Herramientas MCP:" marker (652 files, idempotent). `scripts/flatten-skills.mjs` injects the same sentence on regeneration, so the trigger cannot be lost the next time the catalog is regenerated from the Skills-MCP source.

## Alternatives considered

- **Hand-written triggers per skill.** Rejected: 675 files of hand copy drifts immediately; the module+action template covers the whole catalog deterministically, and hand-tuned exceptions can still be written later (the rewriter only fills descriptions lacking a trigger).
- **Routing metadata in a separate field (e.g. `triggers:`).** Rejected: the harness's skill router reads `description`, not custom fields; the ECC analysis (agents/code-reviewer.md) confirmed the description-as-routing-policy pattern.
- **Validating with the harness registry itself instead of js-yaml.** Rejected for the gate: booting the skill registry over the catalog is an integration test (already proven manually for the repaired catalog), while the gate needs to be a fast, source-plane check that runs in the standard suite; the validator mirrors the registry's own rules (kebab grammar, YAML parse, name/description presence).

## Consequences

- A catalog regression now fails `pnpm run verify-skills-catalog` and the vitest suite within seconds, locally and in CI, before it can reach a deploy.
- The assistant's skill selection has explicit Spanish routing text in all 652 descriptions, which is what the harness's `/` menu and model invocation both read.
- Regenerating the catalog from source keeps frontmatter validity, kebab names, and triggers by construction (one template in the flattener, checked by the gate).
