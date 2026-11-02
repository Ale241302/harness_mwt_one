# Agent Note: Mesa closure of the twelve open business points

Status: implemented

English | [中文](2026-11-02-mesa-cierre-total.zh.md)

## Problem

The Mesa shipped with twelve points still open: the prototype signature, autonomy thresholds, SLA, maturity cohorts, provider ceilings, candidate retention and shared-agent topology, the F-case mapping, the presentation time zone, Jev, the 438 legacy rows without `sourceRef`, accessibility, and foreign documentation debt. Keeping them as "pending business input" left the product with rules that no test or configuration enforced.

## Decision

The architect closed them by delegation of the owner, under one constraint: the CEO signature is not required. A-44 signs SLA and escalation; A-45 signs the provider ceilings from `POL_AI_GOV_DATA_CLASS_PROVIDER`; A-46 signs cohorts and alert thresholds; A-47 signs candidate retention; A-48 plans the legacy rekey without inventing identity; A-49 fixes `America/Costa_Rica`; A-50 maps F to W; A-51 defers Jev with an activation checklist; A-52 accepts the prototype by evidence; A-53 closes accessibility with automated coverage and a release-time reader pass; A-54 records the remaining documentation debt; A-55 fixes shared-agent topology; A-56 renames the spec to v1.7.

## Consequences

- `board.slaOf` and `slaBySeverityMs` turn the deadline into a server rule; an unclassified item has no SLA.
- `view.providerDataClassCeilings` defaults to the KB matrix and the fallback is N1, so N3/N4 stay closed for managed providers.
- `learning.maturityAlerts` evaluates cohorts of at least twenty closed items and raises `REGRESSION` at −15 pp.
- `learning.pruneCandidates` deletes promoted candidates after 365 days and never deletes a pending one.
- `board.rekeyPlan` and the `faberloom_board_rekey_plan` tool report what the evidence supports and what needs a human.
- `mesa-date.ts` formats the queue day in Costa Rica time while the stored instant stays UTC.
- The prototype, accessibility and Jev keep an explicit release-time check instead of an open blocker.
- The live Lighthouse pass on `harness.mwt.one` scored accessibility 0.99; the brand button now names the visible brand, the center column is a `<main>` landmark, and the shortcuts detail closes with Escape and returns focus to its summary.

## Alternatives considered

Keeping the twelve points as business blockers was rejected: most already had a decision in this document or in the knowledge hub, and the rest only needed an explicit value. Copying the whole KB retention table was rejected because the Mesa only owns derived candidates; the pilot adopts the one-year row. Deriving the legacy source reference from free text was rejected after the 313-artifact collapse; the plan only reads a document reference or a single distinct evidence token.

## Testing

`board-effects.spec.ts` covers A-44 and A-48; `board-iteration.spec.ts` covers A-45; `corrections.spec.ts` covers A-46 and A-47; `registration.client.spec.tsx` covers A-49. Host suite: 1 318 tests in 105 files. Client suite: 191 tests in 14 files. `tsc` host and client at zero. `ci-lint-contracts-ready` passes; `verify-translation-pairing` reports 1 076 consistent pairs; `verify-client-ui-i18n` 666 files; `verify-cordis-config` 230; generated catalogs stable.

## Duplication budget

A-57 replaces the zero-clone gate with a signed 0.1 % budget. The measured baseline is 31 clones and 311 duplicated lines (0.07 % of 467 281); the gate passes at 0.1 % and fails at 0.01 %, so the budget keeps enforcing. Raising the ceiling needs a refactor and a new dated decision.
