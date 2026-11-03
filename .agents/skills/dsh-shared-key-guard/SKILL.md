---
name: dsh-shared-key-guard
description: Use when hardening or reviewing the FaberLoom shared-key usage guard in packages/faberloom/session-agent, including the vocabulary fast path, tool-result continuity, classifier failure handling, refusal text, and proofs that a personal request cannot reach the provider on the deployment key.
---

# Shared-key guard: no lexical or history bypass

Owns `packages/faberloom/session-agent/src/policy.ts` and the `llm/stream` listener in `src/index.ts`.

The guard decides whether one human turn may reach the provider on the deployment key. It is an enforcement point, not a prompt suggestion, so it must fail closed and must not accept a proxy signal as evidence.

## Invariants

1. **Only the latest human message is judged.** Earlier work turns do not authorize a later personal request. Tool results are data, never a turn.
2. **No vocabulary fast path.** A business word inside a personal request is not evidence. The work-domain match may be passed to the classifier as a hint, never used as the verdict.
3. **Continuation needs a cached work verdict.** A short "dale", "seguí", "ok" is allowed only when the session's most recent classified human turn was `work` and no credential change happened since. A tool result in the history is not a substitute.
4. **Fail closed.** `scopeFallback` defaults to `refuse`. A timeout, an unusable JSON answer, a missing `llm` service, or an empty message denies the turn.
5. **Refusals are distinguishable.** A personal verdict and an unverifiable turn produce different text: the first explains the shared-key scope and the route to BYOK; the second says the scope could not be verified and invites a retry. Do not tell a user their request is personal when the classifier failed.
6. **Internal calls stay out of the guard.** Calls with no `sessionId` (board classifier) and calls tagged with a `purpose` do not recurse. That exemption is for plugin-originated work; never let a user turn supply a purpose.
7. **Cost is declared.** Asking the classifier for every human turn costs one small call per turn. Keep `scopeTimeoutMs`, `maxTokens`, `temperature: 0`, and the strict answer format; do not add a retry loop.

## Procedure

1. Write the failing tests first, using the four bypasses below. Run them against the current code and keep the output.
2. Change the `scopeFallback` default in `Config` to `refuse`; leave `allow` reachable only through an explicit deployment setting, with its rationale in the field JSDoc.
3. Delete the vocabulary fast path and the tool-result continuation: neither survives in `policy.ts`.
4. Implement `scopeGate(options, memory)` in `policy.ts`. It answers only `allow`, `classify`, or `deny`: no session and a purpose-tagged call allow; empty human text denies; everything else classifies unless a continuation qualifies.
5. Store one `ScopeMemory` per session (`{ kind: 'work' | 'personal'; humanTurns: number }`), written after the classifier answers, consulted only for a short continuation, and cleared on `credentials/reference-updated`.
6. Return a typed reason from the guard to the refusal builder: `personal` or `unverified`. Keep one visible text block and a normal stop.
7. Confirm the refusal text names the shared-key scope, the refusal, and Ajustes → Modelos, and nothing else.

## Required cases

| Bypass | Test that must pass after the fix |
|---|---|
| Personal request that names MWT, SICOP, or "cliente" | Classified and refused |
| Personal request after a tool result from an earlier turn | Classified and refused |
| "dale" with no prior classified work turn | Refused |
| "dale" after a classified work turn | Allowed without a second classification |
| Classifier returns `{"scope":"work","confidence":0.2}` | Allowed; confidence is not a threshold here |
| Classifier times out | Refused with the unverified text |
| Classifier returns prose or broken JSON | Refused with the unverified text |
| Classifier unavailable (`llm` missing) | Refused |
| Empty human text | Refused |
| Own key on the request | Guard does not run |
| Board classifier call (no session) | Passes unchanged |

## Reject

- Adding synonyms to `WORK_DOMAIN` to "cover more work".
- Treating an earlier assistant answer as authorization for a new topic.
- Asking the classifier to judge the whole history, which grows the prompt and the attack surface.
- Refusing a work turn because the classifier was slow, without saying why.
- Hiding the classifier call from the log or the token accounting.

## Residual risk, stated once

A classifier that answers `work` for a personal request is a model error; no deterministic rule removes it. A personal phrase of forty characters or fewer that opens with a continuation token (`dale, escribime un poema`) passes after a turn the classifier called work, and a compaction that shortens the history to a single human turn can make the turn count look like a continuation. The length limit keeps both from covering a longer request. This guard reduces the surface to one small model call with a strict answer format and a fixed rejection path. Do not describe it as impossible to bypass; describe it as failing closed when the verdict is absent.

## Evidence

```sh
npx vitest run packages/faberloom/session-agent/tests/session-agent.spec.ts --reporter=dot
pnpm run typecheck
```

Snapshot replay is required when refusal or policy text changes.
