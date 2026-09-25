# Agent Note: grill-me-lite steers a new Space without an interview

Status: implemented

English | [中文](2026-09-24-faberloom-grill-me-lite.zh.md)

## Problem

The email→Space seed applied `interview-me`, which runs a one-question-at-a-time interview until roughly 95% confidence. Applied to every opened email, that turned a simple "here is a message" into a cross-examination before anything moved. The user asked for a lighter exploratory skill that guides instead of interrogating.

## Decision

Add `grill-me-lite` as a model-invocable shared skill and point the email→Space seed at it.

- `grill-me-lite` restates the context in one line, names the most likely intent, proposes one concrete next step, and asks at most one question per turn and at most one clarifying round — and only when the answer changes the action.
- The seed applies `grill-me-lite`; `interview-me` stays in the catalog for the cases that genuinely need the deep pass, and the model can still invoke it.
- The skill ships under `skills-shared/` like `interview-me`, so it is model-invocable in every session with no catalog disable flag.

## Alternatives considered

**Keep `interview-me` in the seed and tell it to be brief.** The interview skill's contract is exhaustive by design; a single sentence of "be brief" fights the skill instead of providing a purpose-built one.

**Drop the exploratory pass entirely.** Some steering still helps a broad ask; the lite skill keeps it to one line and one optional question.

## Consequences

- Opening a Space from an email now starts with a one-line read and a proposed step, not an interview.
- The curated model-invocable catalog grows from 24 to 25 entries.
- `interview-me` remains available for explicit deep grilling.

## Testing

`packages/faberloom/view/tests/space-from-email.spec.ts` asserts the seed names `grill-me-lite`. A live session confirms the agent reads the email, proposes a step, and does not open with a question list.
