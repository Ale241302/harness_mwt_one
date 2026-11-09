# Agent Note: Retirement and trust rotation survive a storage restore

Status: implemented

English | [中文](2026-11-09-publication-retirement-rotation.zh.md)

## Problem

A publication row carried the only record of its activation. A backup that restored an older row could therefore make a retired revision readable again, and a restored object store could serve bytes whose signing key the deployment had already retired. The service verified every manifest with one public key and never checked the publisher identity. Concurrent publications and incompatible manifest versions were not exercised.

## Decision

**Retirement is an append-only ledger.** `retire(revision, reason)` writes `faberloom_publication.revocations` and moves the row to `retired`. `read` checks the ledger before the row state and before returning bytes; `status` and `receipt` report `retired` even when a restored row says `activated`. A retired revision is refused with `PUBLICATION_RETIRED`, including a replay of its approval. Restoring an older publication row cannot reactivate it.

**Trust is an explicit key and publisher policy.** `verificationKeys` maps every accepted key id to its public key, status, and retirement instant. `rotateSigningKey(signingKeyPem, keyId, retiredAt)` makes the new key the only active signer and retires the previous key at that instant; the retirement is written to the durable `key_retirements` table with a SHA-256 of the SPKI DER, so the same material cannot return under another id after a restart. A manifest produced before `retiredAt` still verifies; one signed after it is refused with `PUBLICATION_KEY_RETIRED`. An unknown key id is `PUBLICATION_KEY_UNKNOWN`. `trustedPublishers` lists the publisher identities a manifest may name; an empty list trusts only the configured `publisherId`. A mismatch is `PUBLICATION_PUBLISHER_UNTRUSTED`.

**A restore is not a reactivation.** The read path re-verifies the stored object digest, the manifest digest, the signature under the policy-selected key, and the publisher trust on every call. A publication row without a signed manifest is refused as `PUBLICATION_INCOMPLETE` instead of being served; a revision whose row was restored under another commit is refused because the row must name the requested commit. Restoring the test object store after a loss makes a live revision readable again; it does not make a retired revision or a key-retired revision readable. A manifest whose `formatVersion` is newer than the software supports is refused with `PUBLICATION_MANIFEST_INVALID` instead of being served.

**Concurrent publications share one chain.** The service serializes the publication chain in one process; two concurrent calls for the same approval return the same commit and the same `activatedAt`, with one object write per stored key. A restart resumes from the durable row and does not repeat the commit or activation.

## Alternatives considered

**Store retirement only on the publication row.** A backup restore of an older row would resurrect the revision. The separate ledger is the point.

**Delete the object when a revision is retired.** Object-lock COMPLIANCE retention refuses deletes, and deleting would destroy the audit trail. Retirement changes authorization, not storage.

**Verify every manifest with the one current public key.** A rotation would make every old row unreadable, and a retired key could still sign a new row. The key map carries the explicit policy.

**Trust any `publisherId` written in the manifest.** The manifest is signed, but the signer still has to be an authorized publisher. The trusted-publisher set is separate from the storage credential.

## Consequences

A retired revision remains refused until the append-only ledger itself is restored from a snapshot that contains the revocation; restoring only the publication row is not enough. Key rotation keeps historical reads available before the retirement instant and refuses later signatures by the old key. A publisher not in the trusted set cannot publish or be served. A newer manifest format is refused, so a deployment must ship a compatible reader or keep the current version instead of degrading the stored format.

## Verification

- `packages/faberloom/publication/tests/lifecycle.spec.ts`: retirement and row-restore refusal; ledger refusal after the revision index is removed; test-store loss and restore; key rotation before and after retirement; same-key-material refusal; durable key retirement; untrusted publisher; concurrent publications; legacy manifest refusal; cross-index refusal; incompatible manifest format.
- `packages/faberloom/publication/tests/publication.spec.ts`: PUB-01/PUB-03/PUB-04/PUB-05 resume, tamper, retention, and source-outage evidence remains.
- `packages/faberloom/publication/tests/application.spec.ts`: PUB-07 cross-path and concurrency evidence remains.
- `packages/faberloom/mcp-server/tests/oauth.spec.ts`: VER-02 rollback revalidates the reference and refuses a revoked source.
