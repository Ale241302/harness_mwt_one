---
description: "Native publication module (ctx.faberloomPublication) that applies one approved diff to Git, stores the committed bytes under an immutable MinIO key, and activates the revision once."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-publication

English | [中文](README.zh.md)

## Summary

This package carries one approved change from a diff to a readable revision through `ctx.faberloomPublication`. `apply(approval)` resolves every diff path against the server inventory and, under a cross-process lock, revalidates the base, real path, symlinks, and clean work tree before committing the whole diff. The durable `applications` table records the identity, exact diff digest, commit, and changed files. `publish(request)` uploads one committed file to an immutable `publications/<commit>/<path>` key and activates the revision conditionally. Durable state lives in the `faberloom_publication` domain, so a replay or crash resumes instead of producing a second commit, object, or activation.

## Table of Contents

- [Use this package](#use-this-package)
- [Service contract](#service-contract)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row with the deployment's repository and object store. The service is an effect on the calling plugin's fiber, so disposing that fiber removes it.

```yaml
- id: publication
  plugin: '@deepseek-ai/dsh-faberloom-publication'
  config:
    repo: /srv/faberloom/knowledge
    endpoint: http://minio.internal:9000
    bucket: faberloom-publications
    region: us-east-1
    retentionDays: 30
    maxBytes: 1048576
    inventory:
      - knowledge/a.md
      - knowledge/b.md
```

Credentials come from the deployment (`accessKey` and `secretKey`, or the SDK's default provider chain). They are never logged, returned, or written to durable state. The inventory is the server's authority for destinations: an empty list refuses every application with `PUBLICATION_INVENTORY`.

<a id="service-contract"></a>
## Service contract

- `apply(approval)` — commit only the approved diff. Every diff path is resolved against the inventory; rename, copy, mode-only, and binary sections are refused with `PUBLICATION_PATCH_INVALID` because they carry no `---`/`+++` header. The base, real path, symlinks, work tree, and byte ceiling are revalidated under `.git/faberloom-apply.lock` immediately before writing; after applying, the staged path set must equal the inventory paths, each real destination must stay under the work tree, and a hardlink is refused. Idempotent by `(itemId, revision, artifactHash)` plus the exact diff digest: a replay returns the same receipt, a changed diff under the same identity is refused with `PUBLICATION_REQUEST_CONFLICT`, and a commit that already exists is reconciled by identity. A base, inventory, path, symlink, work-tree, lock, patch, or malformed-section refusal is recorded as `conflict`; other failures are recorded as `failed`.
- `application(itemId)` — the latest durable application receipt for one board item.
- `applicationReadiness()` — whether a repository is configured; object storage is not needed to apply.
- `publish(request)` — apply, commit, upload, and activate one approved diff. Idempotent by `(itemId, revision, artifactHash)`: a replay returns the same receipt, and a replay that carries a different diff for the same identity is refused with `PUBLICATION_REQUEST_CONFLICT`.
- `read(revision, path)` — read the published file by commit, verifying its length and SHA-256 against the durable record. A revision that is not activated is refused with `PUBLICATION_NOT_ACTIVE`; a revision is never re-resolved to a newer commit.
- `status(revision)` — the durable stage: `pending`, `committed`, `uploaded`, `activated`, or `failed`.
- `receipt(revision)` — base revision, commit, object key, digest, byte length, state, and `activatedAt`.
- `readiness()` — whether the deployment is complete, and which configuration is missing.
- `useObjectStore(store)` — mount another `PublicationObjectStore`; production uses the S3/MinIO adapter built from configuration.

The request's `revision` is the commit the change was reviewed against, never a branch. It must still be `HEAD` when the diff is applied, so a stale approval is refused with `PUBLICATION_BASE_STALE` and the work tree is left untouched. A second process that holds the application lock is refused with `PUBLICATION_LOCKED`. The repository, endpoint, and bucket are deployment values: when any is missing the service logs a warning and the corresponding operations refuse with `PUBLICATION_UNAVAILABLE` instead of falling back to a local store.

<a id="configuration"></a>
## Configuration

| Field | Meaning |
|---|---|
| `repo` | Local Git work tree the diff is applied to. |
| `endpoint` | S3/MinIO endpoint origin. |
| `bucket` | Bucket that holds published objects; it needs object lock for retention. |
| `accessKey`, `secretKey` | Static credentials; both or neither. Absent uses the SDK provider chain. |
| `region` | Signing region. |
| `retentionDays` | Object-lock COMPLIANCE retention; `0` stores without object lock. |
| `maxBytes` | Largest published object, enforced before the commit and on every read. |
| `inventory` | Repository-relative paths an application may touch; empty refuses every apply. |

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomPublication` is a host-side service: it registers no tools, injects no prompt text, and writes no session events. The revision a conversation may read is fixed by its authorized work reference; the consumer that serves that reference owns the model-visible result.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **`publish` stores one file per revision.** `apply` accepts a multi-file diff, but `publish` uploads the one path in its request and `read` refuses any other path for that revision with `PUBLICATION_PATH_INVALID`. Multi-file publication needs an inventory per revision.
- **Approval applies; publication does not upload automatically.** The view calls `apply` after a knowledge proposal is approved, so the Git commit follows the approval. `faberloom_publication_publish` still waits for an explicit consumer call; wiring approval to publication is a later slice.
- **No revocation operation.** State is `activated` or it is not; revoking an activated revision and denying later reads belongs to the consumer that owns the work reference.
- **The application lock is cross-process; publication chains remain service-local.** The applier holds `.git/faberloom-apply.lock` and refuses a live holder with `PUBLICATION_LOCKED`. Publication effect chains still queue inside one service instance.
- **Object lock is a bucket property.** `retentionDays` writes an object-lock request; a bucket without object lock enabled rejects the write, which the adapter surfaces as `PUBLICATION_STORE_UNAVAILABLE`.
- **A junction raced into place can cause a transient write.** The applier rechecks each real path after applying and reverses its own patch, but a local writer that swaps a parent directory for a junction between the pre-check and `git apply` can make Git write outside the work tree before that check. The applier detects and reverses the write; the zero-write guarantee covers every refusal the applier can decide. This is not a privilege boundary: the actor already needs write access to the work tree.

No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The application chain is `pending` → inventory, symlink, base, and clean-work-tree check → `git apply --index` → commit → `applied`; a base, inventory, path, symlink, work-tree, lock, or patch refusal becomes `conflict`, and a commit found under the deterministic subject is reused. The publication chain is `pending` → Git apply/commit (through the same applier) → `committed` → object upload → `uploaded` → conditional activation → `activated`. The durable row records the commit and object key before each next effect, so a retry resumes instead of repeating. Git has no compare-and-set; the cross-process lock serializes appliers, and a service-local promise chain keeps one publication touching the work tree at a time.

</details>
