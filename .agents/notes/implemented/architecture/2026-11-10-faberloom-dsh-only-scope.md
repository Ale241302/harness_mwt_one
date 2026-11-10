# Agent Note: FaberLoom portable targets DSH as its only host

Status: implemented

English | [中文](2026-11-10-faberloom-dsh-only-scope.zh.md)

## Problem

The portable plan carried four adapter phases — Claude, OpenAI, Kimi, and Gemini/Antigravity — while the product owner uses DeepSeek Harness. Every host-specific requirement (HOST-01/03, UX-02/05, CON-04) was scattered across phases that could not all be staffed, and the first certified surface was Claude Code even though DSH is the product runtime.

## Decision

**DSH is the only host.** `docs/scratch/faberloom-portable-fases-olas.md` states the scope in §2.2.2, and D12 is resolved: DSH Desktop on Windows, with the launcher version fixed when 4A.1 opens. Web, CLI, and headless are open matrix rows; none inherits Desktop's certification.

**Phases 4A and 4B keep their identifiers and change host.** 4A becomes the first complete DSH cycle and 4B the per-surface close-out. Waves 4B.2 (coexistence, update, context cost) and 4B.3 (state, accessibility, user evaluation) keep their scope. 6A remains the external bundle distribution. Phases 6B, 6C, and 6D are removed, not deferred.

**The Claude work stays as legacy.** `packages/faberloom/portable/src/adapters/claude.ts`, `surfaces.ts`, `zip.ts`, their tests, `docs/faberloom/evidence/4b1-claude-matrix.json`, and the 2026-11-10 notes remain in the tree and keep running. They are not advertised, not certified, and not edited except for a security fix. Conversion, inventory, signing, publication, and usability are host-agnostic and continue to serve DSH.

**A host-specific demonstration does not transfer.** The 58 cases keep their identifiers; the wave and observed host change. `HOST-01` returns to `no-comprobada` because its only evidence loaded a Claude plugin, and its replacement test is `portable/tests/dsh-distribution.spec.ts`, which does not exist yet. `IA-01` keeps its demonstrated status because `no-hidden-model.spec.ts` proves a property of the portable package, not of a host.

## Alternatives considered

**Keep the other adapters as optional work.** An optional phase still consumes a share of the plan, the ownership map, and the acceptance matrix, and it invites a host to inherit another host's result.

**Delete the Claude adapter and its evidence.** The code is tested and its conversion path feeds the DSH package; deleting it would remove working inventory and signing coverage to satisfy a naming preference.

**Collapse 4A, 4B, and 6A into one host phase.** It renumbers the waves, hides the difference between a per-surface cycle and external distribution, and discards the wave labels the owner already uses.

## Consequences

DSH Desktop is the first surface that can be certified; web, CLI, and headless remain open with their own installation and authentication. HOST-01, HOST-03, UX-02, and UX-05 are `no-comprobada` for DSH until their tests and a human session exist. The matrix and evidence for Claude remain readable as history but cannot close a DSH requirement. Restoring another host requires a new dated decision, its own matrix, and its own cycle.

## Verification

- `pnpm run check-faberloom-portable-plan`: 58 product cases, 8 harness cases, 10 conservation groups, 6 frozen files, 87 owned paths, with every requirement wave present in the plan.
- `pnpm run test:docs`: 20 gates passed, including translation pairing and documentation budgets.
- Both plan languages carry 37 wave headings; `requirements.json` names the plan digest.
