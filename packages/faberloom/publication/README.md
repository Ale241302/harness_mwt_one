---
description: "Native publication module (ctx.faberloomPublication) that applies one approved diff to Git, stores the committed bytes under an immutable MinIO key, and activates the revision once."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-publication

English | [中文](README.zh.md)

## Summary

This package carries one approved change from a diff to a readable revision. It registers `ctx.faberloomPublication`, which applies the diff to the configured Git work tree, commits it under a deterministic subject, uploads the committed bytes to an immutable `publications/<commit>/<path>` key, verifies the stored object, and activates the revision through a conditional durable update. Durable state lives in the `faberloom_publication` storage domain, one row per `(itemId, revision, artifactHash)` plus one index row per commit, so a replay or a crash resumes from the last recorded fact instead of producing a second commit, object, or activation.

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
```

Credentials come from the deployment (`accessKey` and `secretKey`, or the SDK's default provider chain). They are never logged, returned, or written to durable state.

<a id="service-contract"></a>
## Service contract

- `publish(request)` — apply, commit, upload, and activate one approved diff. Idempotent by `(itemId, revision, artifactHash)`: a replay returns the same receipt, and a replay that carries a different diff for the same identity is refused with `PUBLICATION_REQUEST_CONFLICT`.
- `read(revision, path)` — read the published file by commit, verifying its length and SHA-256 against the durable record. A revision that is not activated is refused with `PUBLICATION_NOT_ACTIVE`; a revision is never re-resolved to a newer commit.
- `status(revision)` — the durable stage: `pending`, `committed`, `uploaded`, `activated`, or `failed`.
- `receipt(revision)` — base revision, commit, object key, digest, byte length, state, and `activatedAt`.
- `readiness()` — whether the deployment is complete, and which configuration is missing.
- `useObjectStore(store)` — mount another `PublicationObjectStore`; production uses the S3/MinIO adapter built from configuration.

The request's `revision` is the commit the change was reviewed against, never a branch. It must still be `HEAD` when the diff is applied, so a stale approval is refused with `PUBLICATION_BASE_STALE` and the work tree is left untouched. The repository, endpoint, and bucket are deployment values: when any is missing the service logs a warning and every operation refuses with `PUBLICATION_UNAVAILABLE` instead of falling back to a local store.

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

- **One file per publication.** A publication stores the one path its diff touches; `read` refuses any other path for that revision with `PUBLICATION_PATH_INVALID`. Multi-file artifacts need a later slice that records an inventory per revision.
- **MCP wiring exists; approval does not publish automatically.** `faberloom_publication_read` prefers this service and `faberloom_publication_publish` calls it for an approved item, but the board approval itself does not start a publication; the consumer invokes the tool. Wiring the approval event is a later slice.
- **No revocation operation.** State is `activated` or it is not; revoking an activated revision and denying later reads belongs to the consumer that owns the work reference.
- **Single-process Git serialization.** Publication effect chains are queued inside one service instance. Two processes sharing one work tree rely on Git's own index lock to refuse the second apply.
- **Object lock is a bucket property.** `retentionDays` writes an object-lock request; a bucket without object lock enabled rejects the write, which the adapter surfaces as `PUBLICATION_STORE_UNAVAILABLE`.

No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The effect chain is `pending` → Git apply/commit → `committed` → object upload → `uploaded` → conditional activation → `activated`. The durable row records the commit and object key before each next effect, so a retry resumes instead of repeating. Git has no compare-and-set; a service-local promise chain keeps one publication touching the work tree at a time.

</details>
