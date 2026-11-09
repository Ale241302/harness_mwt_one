# Agent Note: A published revision carries a signed manifest and follows the approval

Status: implemented

English | [中文](2026-11-09-publication-manifest-and-approval-trigger.zh.md)

## Problem

Wave 3A.3 closed the Git commit, object upload, digest check, and single activation, but a revision was authenticated only by a SHA-256 stored beside it. Nothing proved who published it, an approval still required a separate MCP call, and a source outage had no durable wait state or tested resume. The storage credential and the publisher identity were the same value, so the retention claim lived only in prose.

## Decision

**Every revision carries a canonical manifest and a detached signature.** The manifest names the item, base revision, commit, path, digest, byte length, artifact hash, publisher id, and generation instant. Canonical JSON sorts keys; the manifest digest excludes `digest`, and the detached Ed25519 signature covers the canonical manifest including its digest. The public key is an out-of-band trust anchor and is never stored in the object. The manifest lives at `publications/<commit>/.faberloom/manifest.json`; the content keeps `publications/<commit>/<path>`.

**Publisher identity is separate from the storage credential.** `publisherId`, `keyId`, and the signing key identify and authenticate the publisher; `accessKey` and `secretKey` only authorize object storage. The manifest records the publisher id and key id, so a receipt names who published the revision without exposing the storage credential.

**The upload is immutable by construction and by check.** The content object is written once, and a second writer at the same key is refused with `PUBLICATION_OBJECT_CONFLICT` when the bytes differ. The S3 adapter also sends `IfNoneMatch: '*'`, so a key that already exists is not replaced even where versioning would accept a second version. `retentionDays` writes an object-lock COMPLIANCE request; the adapter has no delete operation. Activation and every read load the manifest, recompute its digest, compare it with the row, and verify the signature before the content is trusted.

**A source outage is a durable wait, not a lost approval.** The commit is recorded before any upload. When the store refuses a read or write, the row becomes `failed` with the store refusal, keeps the commit and the approval, and the next `publish` resumes from the last durable fact. A retry uploads the missing object and manifest, verifies both, and activates once; it does not create a second commit, object, or activation.

**The approval triggers the publication.** `boardApprove` and `boardApproveWithEdits` call `apply`, then `publish` with the durable item's path, diff, base revision, artifact hash, reason, and evidence when the publication store is ready. A publication refusal is logged and leaves the approval intact; the MCP publisher remains an explicit retry path. A direct `publish` call still works for a replay.

## Alternatives considered

**Sign only the durable row.** A row is not the object a reader downloads; a reader would have no manifest to verify. Signing the canonical manifest and storing it beside the content binds the bytes to the revision.

**Embed the manifest inside the content file.** That changes the published bytes and the document a reader consumes. A separate immutable object keeps the content exact and the authentication document inspectable.

**Store the public key in the manifest.** The artifact would authenticate itself with a key it carries. The public key belongs to the consumer's trust store; the manifest carries only the key id.

**Use the storage credential as the publisher identity.** The credential authorizes writes, not authorship, and a rotation would change the identity. The signing key and publisher id are separate values.

**Rely on bucket versioning.** Versioning keeps old versions but does not stop a new version at the same key, and it does not retain a version after deletion. COMPLIANCE object lock plus `IfNoneMatch` and the service's digest check cover the actual invariants.

**Keep approval and publication separate.** The operator had to call the MCP publisher after approving. Calling `publish` from the same approval closes the gap; the explicit tool remains for retries and for deployments that cannot mount the store.

## Consequences

A revision now has two immutable objects: the content and the manifest. The manifest digest and key id are part of the receipt, so a reader can verify authorship offline with the trust anchor. A source outage leaves a `failed` row with a reason and a resumable commit; a retry converges without duplication. The cost is a required signing key and publisher id in every publishing deployment, two object writes instead of one, and a manifest key that must stay reserved. The real evidence run used a MinIO container with object lock: the publisher identity's delete was refused with `AccessDenied` and the overwrite with `PreconditionFailed`; the record is in `docs/faberloom/evidence/3a3-minio-publication.json`.

## Verification

- `packages/faberloom/publication/tests/publication.spec.ts`: apply, upload, manifest, signature, activation; replay; crash recovery; manifest tamper and bad signature; source down with `failed` row and resume; object digest tamper; foreign key conflict; publisher delete/overwrite refusal; stale base; oversized content; half credentials.
- `packages/faberloom/publication/tests/s3-store.spec.ts`: immutable key, COMPLIANCE retention, `IfNoneMatch`, missing object, byte ceiling, credential-free refusal.
- `docs/faberloom/evidence/3a3-minio-publication.json`: real MinIO run with bucket object lock, signed manifest digest, verified read, refused delete and overwrite.
- `packages/faberloom/view/tests/approvals.spec.ts`: approval calls `apply`, then `publish`; a publication refusal leaves the approval intact.
