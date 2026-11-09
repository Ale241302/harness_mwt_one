# Agent Note: Usability evidence is a gate, not a synthetic estimate

Status: implemented

English | [中文](2026-11-09-usability-evidence-gate.zh.md)

## Problem

Wave 4A.3 must prove that a representative person can install, authorize, load, read, propose, approve, and recover on the final surface. The thresholds in D09 are still open, no D01 account is authenticated here, and D02 does not provide remote web or mobile chat. A developer estimate or a synthetic persona would turn an untested surface into a false certification.

## Decision

**The evidence kit is executable; the human observation is not simulated.** `packages/faberloom/portable/src/usability.ts` checks one observation against thresholds approved before the session. It refuses a participant whose role is developer or synthetic, a threshold without an approver and date, a session over the time or help limit, a normal path that needs a token, command, or configuration edit, an unexplained diff, a failed recovery, and a load record that does not match the revision the person used or the exact host version. `scripts/faberloom-portable/usability-check.ts` prints the verdict and exits non-zero for an incomplete observation. `docs/faberloom/evidence/4a3-usability.template.json` is the fill-in form; the checker rejects it.

**No UI change is made without a reproduced human defect.** The existing OAuth and proposal-card tests already cover UX-01 and UX-03; the Code package load is 4A.1/4A.2. The wave does not claim that Code certifies chat or Cowork, and it does not connect the home through an improvised tunnel. A message or guidance change waits for an observation that names the obstacle.

**The wave stays open until a representative person completes the session.** UX-02, UX-05, and HOST-03 remain `no-comprobada`; the chat/Cowork load remains explicitly unconfirmed. The accepted state is a ready kit plus an open requirement, not a synthetic pass.

## Alternatives considered

**Use a synthetic persona as the participant.** The acceptance asks for a representative person and first-person results. A model or developer role is refused by the checker for that reason.

**Use the developer's timing estimate.** UX-02 compares observation with approved thresholds, not with an estimate. The checker requires an approver, an approval instant, and observed times.

**Certify chat with the Code result.** D01 certifies Code first; chat and Cowork depend on D02 and their own traversal. Reusing the Code evidence would overstate the surface.

**Change the UI from the plan's assumptions.** The wave says to correct only reproduced defects. The kit records the obstacle and the next action, so a later change has evidence.

## Consequences

The kit prevents an unobserved session from being marked passed, and it forces the threshold and load record to be explicit. The cost is that 4A.3 remains open until a representative person, D09 approval, and the supported surface are available. Code, the package load, UX-01, and UX-03 remain demonstrated independently.

## Verification

- `packages/faberloom/portable/tests/usability.spec.ts`: accepted representative observation; developer/synthetic refusal; unapproved threshold; token path; over-threshold times; unexplained diff; recovery; mismatched or missing load record.
- `docs/faberloom/evidence/4a3-usability.template.json`: required form, rejected until filled by a real session.
- `packages/faberloom/mcp-server/tests/oauth.spec.ts` and `packages/client/ui-faberloom/tests/registration.client.spec.tsx`: UX-01 consent/scopes and UX-03 failure preservation.
