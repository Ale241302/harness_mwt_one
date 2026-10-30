---
description: "Native product module (ctx.faberloomAccess) for elective autonomy grants and the CEO signatures that protected action types require in this DeepSeek Harness build."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-access

English | [中文](README.zh.md)

## Summary

This package carries elective autonomy and CEO signatures. It registers the `ctx.faberloomAccess` host service: a grant authorizes one action for one owner, agent, and context, and a signature authorizes a tenant's protected action types — money, inventory, and external shipments — before approval.

## Table of Contents

- [Use this package](#use-this-package)
- [Configuration](#configuration)
- [CEO signatures](#ceo-signatures)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition to expose `ctx.faberloomAccess`. The service is an effect on the calling plugin's fiber, so disposing that fiber removes it.

`grant` and `check` cover elective autonomy: `check` answers before an effect runs, and `revokeGrant` denies the next check. `issueSignature`, `requireSignature`, `signatureStatus`, and `revokeSignature` cover §7.4: an action type in the protected set has no default, so approval without an active signature is refused rather than warned about.

Every refusal the service raises is a `FaberLoomAccessRefusal` whose message starts with `faberloom: <CODE> — `, so a caller matches one error class and one prefix and branches on `code`. The grant codes are `GRANT_NOT_FOUND` and `GRANT_NOT_OWNER`; the signature codes are `SIGNATURE_REQUIRED`, `SIGNATURE_REVOKED`, `SIGNATURE_EXPIRED`, `SIGNATURE_NOT_FOUND`, `SIGNATURE_NOT_PERMITTED`, `SIGNATURE_AUTHORITY_UNCONFIGURED`, `SIGNATURE_SCOPE_REQUIRED`, `SIGNATURE_SCOPE_INVALID`, `SIGNATURE_WILDCARD_DISALLOWED`, and `SIGNATURE_INVALID_INSTANT`.

-----

<a id="configuration"></a>
## Configuration

| Field | Default | Meaning |
|---|---|---|
| `protectedActionTypes` | `[]` | Action types that require a CEO signature. Empty protects nothing and logs a warning at load. |
| `allowWildcardSignatures` | `false` | Whether one signature may cover every protected action type. §7.4 signs a signature per `action_type`, so the default refuses wildcards. |
| `signatureValiditySeconds` | `null` | Validity window applied when `issueSignature` receives no `expiresAt`. `null` keeps a signature valid until revocation. |
| `signingAuthorities` | `[]` | Identities allowed to issue a signature. Empty refuses issuance; it never lets any authenticated actor sign. |
| `revocationAuthorities` | `[]` | Identities, besides the signer, allowed to revoke any signature of their tenant. |
| `signerIdentityAudience` | `[]` | Identities, besides the signer, allowed to read the signer identity in `signatureStatus`. |

§7.4 leaves the action-type strings, the validity window, and the revocation authority open. The defaults above are what ships; a deployment that approves money, inventory, or external shipments declares its own values.

-----

<a id="ceo-signatures"></a>
## CEO signatures

A signature record is stored per signing act, scoped to one tenant: `tenantId`, `signedBy`, `signedAt`, `active`, `expiresAt`, `actionTypes`, `wildcard`, `revokedBy`, and `revokedAt`. A record covers the action types it names or, when the deployment allows it, every protected action type. The tenant comes from the actor's `companyId`, so a signature is only reachable by actors of that tenant: another tenant's signature is never listed and never accepted.

| Member | Answer |
|---|---|
| `requireSignature(actor, actionType, options?)` | The accepted signature, or `null` when the action type is unprotected. Throws `SIGNATURE_REQUIRED`, `SIGNATURE_REVOKED`, or `SIGNATURE_EXPIRED`. |
| `signatureStatus(actor, actionType, options?)` | `protected`, `state` (`ACTIVE`, `MISSING`, `REVOKED`, `EXPIRED`, `NOT_REQUIRED`), the matching signature id and instants, and the signer identity only for a reader allowed to see it. |
| `issueSignature(actor, input, options?)` | Stores a signature for the actor's tenant and identity. |
| `revokeSignature(actor, id, options?)` | Marks the signature inactive and keeps `revokedBy` and `revokedAt`. Revoking twice keeps the first revocation. |

A signature is repeatable: it authorizes every approval of a covered action type until it expires or is revoked. §7.4 states no single use, so consuming a signature for one approval does not weaken it for the next, and one signature can authorize the whole batch behind a set of approvals. `requireSignature` reads the current snapshot; a revocation that lands after the check does not revoke an approval the caller already made.

Expiry is evaluated at the instant of each check, and a signature expires at its own `expiresAt` instant. `active` records revocation only.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomAccess` is a host-side service: it registers no tools, injects no prompt text, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Not every value is signed.** §7.4 leaves the action-type strings, the signature validity window, the signing and revocation authorities, and the signer audience open; the defaults documented above are placeholders a deployment must replace.
- **No dispatch-time recheck.** `requireSignature` answers at the instant the caller asks. Whether a confirmation still holds between approval and dispatch is an open specification item, so this package offers no second check there.
- **No signature listing.** The service exposes one action type at a time through `signatureStatus`; a panel that lists every signature of a tenant needs a reader this package does not have yet.
- **One record per signing act, not per action type.** A record carries the set of action types it covers, so two signatures may cover the same action type of one tenant; the check prefers exact coverage over a wildcard, then the oldest signature.

No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The `signatures` table was added to the existing `faberloom_grants` domain without bumping its version: the change is additive, a stored document without the table opens with it empty, and the backend layout has no migration hook to restamp a version.

</details>
