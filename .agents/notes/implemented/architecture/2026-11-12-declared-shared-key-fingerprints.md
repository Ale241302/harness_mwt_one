# Agent Note: Declared fingerprints for a deployment key no layer carries

Status: implemented

## Problem

The shared-key policy separates the account's key from the deployment's by SHA-256 fingerprint, and it read those fingerprints only from the launch-environment layers (`process`, `project-env`, `user-env`). A desktop installer handed to an account ships no credential — that is the intended shape — so no layer holds the deployment's key and the fingerprint set is empty. A copy of the shared key pasted into Settings → Modelos then resolves from the writable store with no value to compare against, which makes it indistinguishable from the account's own key: the guard lifts the scope policy and the product tool mask, and the deployment pays for unlimited personal use. The policy text promised that a stored copy stays shared, so the product misstated its limit in exactly the configuration most accounts receive.

A real installation showed the shape of it: the writable store held a `DEEPSEEK_API_KEY` byte-identical to the deployment gateway's, no launch layer carried the value, and nothing in the composition could tell the two apart.

## Decision

`faberloom-session-agent` accepts `sharedCredentialFingerprints`: lowercase hex SHA-256 digests a deployment declares instead of a value. `deploymentCredentialFingerprints` seeds the set with them and still adds every value the launch layers carry, so a build that ships the key and one that never does are recognized the same way. The config schema pins the digest shape at load, so a malformed entry fails loud instead of silently never matching a stored key.

The digests are not secrets: a 35-character random key is not recoverable from its SHA-256, and the value they identify never enters the repository, the published plugin, or a patch document. The deployment that owns the key computes the digest at build time and writes that, so the guard keeps naming a shared key it was never given.

## Alternatives considered

**Shipping the deployment key in the desktop build so a launch layer exists** was rejected: it is the practice this note removes. Every account would then hold the deployment credential, and the first-run Models prompt the product wants would never appear.

**Asking the deployment gateway whether a stored value is the shared key** was rejected: a local decision would send a secret over the network, and the guard runs on every request.

**Hardcoding the current key's digest in the published plugin** was rejected: it binds a public package to one deployment's credential and serves no other deployment.

**Changing nothing** was rejected: the policy would keep claiming a limit that the builds handed to customers do not enforce.

## Consequences

- A build that ships no credential still enforces the shared-key scope over a pasted copy of the deployment's key.
- The behavior stays opt-in per deployment. An install that sets no digest keeps the layer scan alone, which is the previous behavior; the fingerprint list is configuration, not a new default.
- A deployment that rotates its key updates the digest and restarts; the fingerprints remain process memory and are never logged or persisted.
- The guard's cost is unchanged: one set lookup per request, on a set built once at construction.
- The note does not change whose key a fresh install uses. It only makes the shared-key policy able to recognize the shared key when the build does not carry it.

## Testing

`tests/policy.spec.ts` covers the declared digest with an empty launch environment, its union with a value a layer holds, and the empty case with neither. `tests/session-agent.spec.ts` covers a pasted copy of the deployment key under a keyless build — refused with the shared-key answer — and an account key outside the declared digests, which still runs the personal turn. Package suite: 81 tests passing; `tsc` on the package at zero.
