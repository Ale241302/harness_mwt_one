---
name: dsh-byok-composition
description: Use when a FaberLoom session's prompt section, tool allow list, or usage guard must follow the credential the request actually uses rather than the account role. Covers BYOK rollout, productToolFilter, the faberloom:usage-policy section, the product persona, and key changes mid-session.
---

# BYOK composition follows the credential

This skill owns `packages/faberloom/session-agent`. The credential layers live in `packages/credentials/credentials-local`; the references the writable store may override are declared in `packages/bundle/faberloom-app/cordis.patch.yml` (`storedOverridesEnvironment`).

The account role decides the default composition. The credential used by one request decides whether the shared-key restrictions apply to it. Two sessions of the same `client_b2b` account can therefore differ, and one session can differ between turns.

## Invariants

1. **Restriction is a function of the request's credential, never of the role alone.** `restricted` may stay as the role default; every consumer of it must read the effective credential for the current turn.
2. **Own key means all four conditions:** the request carries an explicit `credentialRef`; `credentials.resolve` returns `source: 'file'`; the value's SHA-256 is absent from the deployment fingerprint set for that reference; the value is non-empty. Anything else is the shared key.
3. **No reference fallback.** Never resolve `sharedCredentialRefs[0]` when the request names no reference. The route may authenticate with a different reference: the desktop proxy route sets `apiKeyEnv: 'CONSOLA_TOKEN'`, so a stored `DEEPSEEK_API_KEY` proves nothing about who pays.
4. **Recompute at the turn boundary.** When the effective credential changes, the next provider call must already run without `faberloom:usage-policy`, without the product tool allow list, and without the shared-key guard — and must regain all three when the key returns to shared.
5. **Space access does not move with the key.** `denyForeignRead`, read-only identities, tenant scope, and Space grants apply to both keys. BYOK widens what the model may do, never what the account may read.
6. **Model-visible stays reconstructable.** A section whose text varies with the key must derive from logged state; if the text appears or disappears, emit the session event that records why.

## Procedure

1. Read the current wiring before editing: `src/index.ts` constructor (`restricted`), the `install` fiber (`faberloom:usage-policy`), `compose`, `guardedStream`, and `usesOwnCredential`.
2. Replace the reference fallback in `usesOwnCredential` with an explicit check: no `options.credentialRef` means shared. Return early.
3. Extract one method that answers "is this session on its own key right now" from the last resolved credential, and have the guard, the prompt section, and the tool policy read that method instead of `this.restricted`.
4. Register the policy section with dynamic text: return the policy only while the session is on the shared key, and an empty string otherwise. Keep the section registered so its order and removal stay deterministic.
5. Make the product tool mask dynamic where it comes from the key policy (`productToolFilter` for a Space without a responsible agent). Keep the responsible agent's own `toolFilter`: it is the Space assignment, not the key policy.
6. **Never rebuild the fiber.** Register the policy section with a dynamic `text` getter and move the mask at `agent/pre-step` step 1; a credential event marks the session dirty, and the mask must not change inside a stream that already has its tool list.
7. Preserve the four-space test setup; add the negative cases below before changing behavior, and confirm they fail first.

## Required cases

| Case | Expected |
|---|---|
| Route with an explicit own `credentialRef`, value stored by the account | No policy section, no product allow list, personal request reaches the provider |
| Shared key | Policy section present, product tools only, guard active |
| Stored copy of the deployment key | Treated as shared; the store refuses the write |
| Stored key that the route does not use | Treated as shared (regression for the `sharedCredentialRefs[0]` fallback) |
| Key set while the session is open | Next turn loses the section and the allow list; the turn in flight is unchanged |
| Key removed while the session is open | Next turn regains both |
| Own key, read of a foreign Space file | Denied by the Space rule |
| Own key, `client_b2b` reading another tenant's board item | Unchanged denial from the API |

## Reject

- Inferring ownership from the provider name, the model id, or the presence of a store row.
- Comparing values in memory when a fingerprint answers the question; never log either.
- Rebuilding the fiber inside `llm/stream` or `tools/pre-execute`.
- Treating the Space agent's `toolFilter` as a key restriction and deleting it under BYOK.
- Editing `policy.ts` copy without the `dsh-usage-limits` skill: that copy is a limit statement.

## Evidence

```sh
npx vitest run packages/faberloom/session-agent/tests/session-agent.spec.ts \
  packages/faberloom/session-agent/tests/routing-e2e.host.spec.ts \
  packages/credentials/credentials-local/tests --reporter=dot
pnpm run typecheck
```

A model-visible prompt change also needs the recorded-session snapshot replay to pass. Do not record fixtures with a real provider key without explicit authorization.
