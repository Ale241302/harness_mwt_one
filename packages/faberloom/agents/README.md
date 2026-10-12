---
description: "Native product module (ctx.faberloomAgents) for the agent catalog and versioned model policy in this DeepSeek Harness build."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-agents

English | [中文](README.zh.md)

## Summary

This package carries the agent catalog and versioned model policy, the model pool, the shared resolver and recommender, per-execution selection records, and contextual outcome evidence. It registers the `ctx.faberloomAgents` host service. An agent's provider API key lives in the credential seam (`ctx.credentials`), addressed by a reference derived from the agent id; the durable record keeps only the non-secret tail and a presence flag, and no read returns the key.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition to expose `ctx.faberloomAgents`. The service is an effect on the calling plugin's fiber, so disposing that fiber removes it. Durable state goes through `ctx.storageDomain`; the key goes through the optional credential seam.

### Where an agent's API key lives

`createAgent` and `updateAgent` accept `apiKey`. When a patch omits it the stored key is unchanged; `null` or an empty string clears it. A key is written through `ctx.credentials.set` and never persisted in the agent record:

```ts
const ref = agentCredentialRef(agentId)       // FABERLOOM_AGENT_API_KEY_<hex id>
await ctx.credentials.set(ref, value)         // createAgent / updateAgent do this for you
await ctx.credentials.unset(ref)              // clears the key
await ctx.credentials.describe(ref)           // { configured, source?, writable } — never the value
```

The reference is `AGENT_CREDENTIAL_REF_PREFIX` (`FABERLOOM_AGENT_API_KEY_`) followed by the uppercase hexadecimal UTF-8 encoding of the agent id. Hexadecimal encoding is injective and the prefix is constant, so no two agent ids can name one reference, and every reference is a valid POSIX environment-variable name. A route can call `agentCredentialRef(id)` to name the reference and resolve it itself; the agents service never needs the value.

`hasApiKey` is read from `ctx.credentials.describe(ref).configured`, so a key rotated or removed outside the app stops reporting as present. `apiKeyTail` is the last four characters of the key, kept in the record so its owner can recognize it; it is a convenience rather than a source of truth, so a key changed directly on the seam can leave a stale tail beside a correct flag.

### Compatibility and migration

A record written before the seam still carries a raw `apiKey`. Its first read moves the value into the seam and clears the field, setting the flag and the tail; the move is idempotent, and a second read changes nothing. If the seam refuses the write, the value stays in the record and the failure is logged, so a later read can retry and no secret is dropped.

### Without a credential provider

The seam is optional, so a composition may omit it. Then the record is the only store: a key is kept in the record's `apiKey` field, and `hasApiKey`/`apiKeyTail` fall back to the stored flag, tail, and value. Mounting the seam and reading such a record migrates the value as above. A key written while no seam is mounted is therefore not yet in the managed store.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomAgents` is a host-side service: it registers no tools, injects no prompt text, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A duplicate does not carry the key** — `duplicateAgent` copies configuration but never the credential, because a stored key cannot be read back; the copy starts without one.
- **Without the seam the key stays in the record** — a composition that mounts no credential provider has no managed store, so a key written there remains in the durable record until a seam-mounted read migrates it.
- **The tail can go stale** — a key changed directly on the seam keeps the record's last tail; `hasApiKey` stays correct because it follows `describe`.

No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
