---
name: dsh-shared-key-guard
description: Use when hardening or reviewing the FaberLoom shared-key usage guard in packages/faberloom/session-agent, including the record-reference fast path, continuation memory, classifier failure handling, refusal text, and proofs that a personal request cannot reach the provider on the deployment key while business work is not blocked by a doubt.
---

# Shared-key guard: refuse only a confident personal verdict

Owns `packages/faberloom/session-agent/src/policy.ts` and the `llm/stream` listener in `src/index.ts`.

The guard decides whether one human turn may reach the provider on the deployment key. It is an enforcement point, not a prompt suggestion, so it must not accept a proxy signal as evidence. It also must not refuse business work because the classifier hesitated: the product tool mask already bounds what any turn can reach, and a refusal the user cannot act on is a defect, not a protection.

## Invariants

1. **Only the latest human message is judged, with the previous human turn as context.** Earlier work turns do not authorize a later personal request. Tool results are data, never a turn. The previous human text reaches the classifier inside `<previous>` as data, so a fragment is judged in its conversation.
2. **No intent vocabulary.** A business word inside a personal request is not evidence. The one deterministic allow is `isWorkReference`: a message built only from a leading asking word, record nouns, and at least one identifier — `2487-2026`, `de esta PO 505244`, `y el pedido PF-1234?`. It matches a token class, never a list of intents, and anything else reaches the classifier.
3. **Continuation needs a cached work verdict.** A short "dale", "seguí", "ok" is allowed only when the session's most recent classified human turn was `work` and no credential change happened since. A tool result in the history is not a substitute.
4. **A doubt does not refuse.** Only a `personal` verdict at or above `scopeWorkConfidence` (0.50) refuses; `scopeFallback` defaults to `allow`, so an unavailable, illegible, or truncated answer lets the turn through. Refusing on doubt blocked real business work whenever the classifier was slow, rate-limited, or answered in prose.
5. **Refusals are distinguishable.** A personal verdict and a turn with no human text produce different text: the first explains the shared-key scope and the route to BYOK; the second says the scope could not be verified. Do not tell a user their request is personal when the classifier never said so.
6. **Internal calls stay out of the guard.** Calls with no `sessionId` (board classifier) and calls tagged with a `purpose` do not recurse. That exemption is for plugin-originated work; never let a user turn supply a purpose.
7. **Cost is declared.** A record reference costs no call, a `personal` verdict one small call, and a `work` verdict two: the verdict at or above the floor plus `CONFIRM_INSTRUCTION` on `scopeConfirmProvider`/`scopeConfirmModel` when pinned. The confirmation may refuse only when it answers `personal` at or above the floor. Keep `scopeTimeoutMs`, `maxTokens` (512, room for a reasoning route's hidden tokens), `temperature: 0`, and the strict answer format; do not add a retry loop.

## Procedure

1. Write the failing tests first, using the cases below. Run them against the current code and keep the output.
2. Implement or change `isWorkReference` in `policy.ts` before touching the listener, and keep it narrow: a token class plus record nouns, never an intent phrase.
3. `scopeGate(options, memory)` answers only `allow`, `classify`, or `deny`: no session and a purpose-tagged call allow; empty human text denies; a record reference and a qualifying continuation allow; everything else classifies.
4. Store one `ScopeMemory` per session (`{ kind: 'work' | 'personal'; humanTurns: number }`) after a work verdict, consult it only for a short continuation, and clear it on `credentials/reference-updated`.
5. In the listener, resolve the floor and the fallback once: a `personal` verdict at or above the floor refuses with `refusal`; any other doubt follows `scopeFallback`; only a `work` verdict at or above the floor calls the confirmation, and only a confident `personal` answer there refuses.
6. Confirm the refusal text names the shared-key scope, the refusal, and Ajustes → Modelos, and nothing else.

## Required cases

| Case | Expected |
|---|---|
| `2487-2026`, `dame información de la 2487-2026`, `de esta PO 505244`, `y el pedido PF-1234?` | Allowed, no classifier call |
| `poema 505244`, `hacé la tarea 12`, `receta de pan 1234` | Classified, never allowed by the reference rule |
| Personal request that names MWT, SICOP, or "cliente" | Classified `personal`, refused with the personal text |
| Personal request after a tool result from an earlier turn | Refused |
| `personal` at 0.9 | Refused with the personal text |
| `personal` at 0.2 | Allowed as a doubt |
| `work` at 0.2 | Allowed as a doubt |
| `work` at 0.9 and the confirmation returns `personal` at 0.95 | Refused with the personal text |
| Confirmation route missing, unsure, or timing out | Allowed |
| Classifier timing out, returning prose, or missing | Allowed by default, unverified text under `scopeFallback: 'refuse'` |
| `dale` with no prior classified work turn | Classified and refused when personal |
| `dale` after a classified work turn | Allowed without a second classification |
| Empty human text | Refused with the unverified text |
| Own key on the request | Guard does not run |
| Board classifier call (no session) | Passes unchanged |

## Reject

- Adding intent phrases or synonyms to widen the work scope; the reference rule accepts token classes, not meanings.
- Treating an earlier assistant answer as authorization for a new topic.
- Asking the classifier to judge the whole history, which grows the prompt and the attack surface.
- Refusing a work turn because the classifier was slow or unsure.
- Hiding the classifier call from the log or the token accounting.

## Residual risk, stated once

A classifier that answers `work` for a personal request is a model error; no deterministic rule removes it. One wrong answer no longer suffices in either direction: a `work` verdict needs the floor and a second, independently framed answer, and a `personal` verdict needs the floor to refuse. Two answers that both call it `work` remain a model error, and a personal request that arrives while the classifier is unavailable passes on the shared key, bounded by the product tool mask. A personal phrase of up to twenty characters that is exactly a continuation token (`dale, escribime un poema` is not one) passes after a turn the classifier called work, and a compaction that shortens the history to a single human turn can make the turn count look like a continuation. Do not describe the guard as impossible to bypass; describe it as refusing only what the classifier positively called personal, and as treating any doubt as the product tool mask's problem.

## Evidence

```sh
npx vitest run packages/faberloom/session-agent/tests --reporter=dot
pnpm run typecheck
```

Snapshot replay is required when refusal or policy text changes.
