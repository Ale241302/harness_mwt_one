# Agent Note: Baseline agents follow the account's key without an agent-by-agent edit

Status: implemented

## Problem

`faberloom-defaults` seeds the deployment's key into every baseline agent and wrote it only when the agent stored none, because a stored key can never be read back to compare. That was correct while the key never changed. With the product rule that FaberLoom's own key answers from the first sign-in and the account may replace it in Ajustes → Modelos, it broke the replacement: an agent that already holds a copy of the deployment key keeps authenticating with it (`routeFor` publishes the agent's key as its route credential), so saving an own key moved the route but not the forty baseline agents, and every Space session kept billing the deployment. The account had to edit agent by agent, which no one will do.

An agent without a key is not the answer either: an unkeyed agent leaves the session on the deployment default, so clearing the copy would silently move an agent off its configured provider and model.

## Decision

The convergence pass writes the **effective** key into baseline agents and remembers what it wrote:

- The effective key is the value the account saved for its provider route's credential reference when it differs from the deployment's, and the deployment's value otherwise. It is resolved through `ctx.credentials`, because the writable store outranks the environment; the reference comes from the route the LLM seam publishes for `agentProvider`, falling back to `agentApiKeyEnv`, because the account saves under the route's name (`DEEPSEEK_API_KEY`) while the gateway names its own variable.
- `<DSH_HOME>/faberloom-baseline-applied.json` now records the last four characters of the key the pass wrote. An agent whose stored tail matches that record holds the seeder's copy and is updated in the same pass the effective key changes; a tail the record does not name was set by the owner and is left alone.
- A home seeded before this record carries no tail. There the deployment's own tail is the only evidence, and a rotated deployment key leaves that copy unrecognized until the account saves a key once.

The copy is replaced, never cleared, so a baseline agent keeps its route under either key. A `credentials/reference-updated` event for that reference runs the same pass in the running process, so a key saved in the panel reaches the agents without a restart; one follow-up runs at a time.

## Alternatives considered

**Clearing the seeded key so agents follow the route live** was rejected: `routeFor` returns `undefined` for an unkeyed agent, so the agent would fall back to the deployment default and lose the provider and model the deployment configured for it.

**Resolving `agentApiKeyEnv` directly instead of the route's reference** was rejected: on the gateway that variable is `FABERLOOM_AGENT_API_KEY`, while the account's stored key lives under the reference the route uses. The gateway would never see the account's key.

**Comparing stored keys by value** is impossible: a key read back is not exposed, and the agent record only keeps `hasApiKey` and the tail. The tail is the discriminator, and its only false positive is an owner key that ends in the same four characters — which then falls back to the route's key, the same one the pass would have written.

**Making the account edit each agent** was rejected: the product promises the change applies everywhere, and forty edits is not a promise kept.

## Consequences

- Saving a key in Ajustes → Modelos moves every baseline agent on the next start, and removing it returns them to the deployment's key.
- A key the owner set on one agent is preserved, because its tail is not the one the record names.
- The account's key is now stored once per baseline agent through the credential seam, the same way the deployment's already was. That duplicates the secret across agent references inside one home; it does not leave the machine.
- The pass costs one credential resolution per start, not one per agent.
- A deployment key rotation reaches baseline agents only for homes that carry the record, which every home gets on its first pass after this change.

## Testing

`packages/faberloom/defaults/tests/defaults.spec.ts` covers the three restart paths — a saved account key replaces the deployment copy on every baseline agent, a key the owner set on one agent survives the pass, and removing the account key returns the agents to the deployment's key — plus the live path, where a `credentials/reference-updated` event for the route reference moves the agents in the running process. The existing F16 convergence and owner-choice cases still pass. Package suite: 21 tests; `tsc` on the package at zero.
