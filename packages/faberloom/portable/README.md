---
description: "Native portable artifact module (ctx.faberloomPortable): a versioned, inventoried, signed export of one Space's allowed documents and harness records, staged atomically."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-portable

English | [中文](README.zh.md)

## Summary

This package turns one Space's allowed contributions into a portable directory. The planner applies the classification allowlist, refuses sessions, transcripts, and secrets, resolves explicit dependencies, and writes a complete inventory with a canonical digest. The writer stages the artifact in a fresh directory, writes the manifest last, and returns a detached Ed25519 signature whose public key is an out-of-band trust anchor. Format, content, and software versions are independent. Nothing is read from the moving work tree: documents come from the authorized Git commit.

## Table of Contents

- [Use this package](#use-this-package)
- [Service contract](#service-contract)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row with a staging root and an Ed25519 signing key. The service is an effect on the calling plugin's fiber, so disposing that fiber removes it.

```yaml
- id: portable
  plugin: '@deepseek-ai/dsh-faberloom-portable'
  config:
    stagingRoot: /srv/faberloom/staging
    signingKeyPem: ${PORTABLE_SIGNING_KEY}
    keyId: faberloom-2026-11
    maxBytes: 1048576
```

The signing key stays in deployment configuration. The verifying public key is never written inside the artifact; a consumer supplies it as the trust anchor.

<a id="service-contract"></a>
## Service contract

- `plan(request)` — pure: merge child and inherited contributions, apply the allowlist and the session/secret rules, resolve dependencies, and return files, manifest, digest, and per-file rejections. It writes nothing.
- `stage(request)` - plan, create a new `mkdtemp` directory under the staging root, write every file, write `manifest.json` last, and return the directory, manifest, detached signature, digest, and rejections. A failed write removes only that directory.
- `replace(destination, request)` - plan, sign, and update an existing destination in place. It verifies the signed ownership manifest, refuses a managed file the user edited or a foreign file collision, copies foreign files and empty directories forward, stages a sibling directory, keeps the previous tree as a backup, verifies the new tree, and cleans up; a crash leaves a signed journal the next run recovers. Same-volume rename only; no atomicity across volumes or sync folders, and one writer per destination at a time.
- `verify(directory, signature, publicKeyPem, expectedKeyId?)` — recompute every inventory digest and byte length, reject an extra or missing file, recompute the content version and manifest digest, and verify the signature; an expected key id binds the trust anchor the caller selected.
- `committedDocuments({ repo, revision, paths, classifications })` — read document bodies from the authorized commit, not from the work tree.
- `contributionsFromUsage(usage, options)` — map the harness projection's agents, skills, workflows, routines, and memory to contributions. A record without a classification is denied by the planner.

### Versions and canonical form

`formatVersion` is the artifact layout. `contentVersion` is `sha256:` over the canonical inventory, so a content or metadata change moves it. `softwareVersion` is supplied by the caller and is independent of both. The manifest digest is SHA-256 over the canonical manifest without `digest`; the detached signature covers the canonical manifest including `digest`.

### Classification and inheritance

Only `N0`, `N1`, and `N2` are exported. A missing, unknown, or conflicting classification is denied, and an excluded class never appears in the manifest, inventory, or a title; no redaction marker is written. A parent contribution is inherited only when it is marked inheritable and granted by contribution; an exclusion in the child wins; a child with the same id replaces the parent; a path claimed by two different ids is refused. The parent revision is fixed in the manifest.

### Dependencies, sessions, and secrets

A contribution's `dependsOn` names other contribution ids. A missing, rejected, session, or cyclic dependency refuses the dependent instead of truncating the reference. A session or transcript is refused by kind, known store path (English or Spanish), or metadata (`sessionId`, `transcriptId`, `source`, `kind`), even when it belongs to the same Space. Content, metadata keys and values, id, title, path, and media type are scanned for private keys and common token shapes; a match refuses the contribution and the secret is never written to the artifact or the manifest.

### Reading the authorized commit

`committedDocuments` reads each body with `git cat-file blob` and `--no-replace-objects`. The revision must be a full 40- or 64-hex commit id that `git rev-parse --verify <id>^{commit}` resolves to itself, so a short id or a branch named like a hash cannot substitute content. The work tree is never read.

### Claude Code adapter

`planClaudePackage` turns one signed artifact into a Claude Code plugin: `.claude-plugin/plugin.json`, `CLAUDE.md`, the `faberloom-space` and `faberloom-proposals` skills, the artifact resources, a host-managed connection descriptor, and a load record with the exact host version. `installClaudePackage` writes it into a directory; `validateClaudePackage` checks the manifest and skills without claiming installation; `loadClaudePackage` registers components only for the exact host version; `removeClaudePackage` removes only the package directory. No bearer token, global token variable, or `bin/` is packaged: the connection descriptor carries an opaque host-managed reference. When the local runtime is absent, the plan is a draft with `sent:false` and `mesa:false`; it is never sent and never simulates Mesa.

`convertPortable` produces the field-level conversion table the adapter uses: documents, skills, agents, and skill resources are preserved or translated; an agent's frontmatter and `tools` field are preserved and only its name is normalized, because omitting `tools` would widen the host's permissions; a workflow, a tool, a session, a transcript, or a full backup is rejected and kept only in the source artifact; routines, memory, and metadata are omitted as non-host components. The inventory carries each file's origin (`child` or `inherited`). The legacy generator keeps its consumers and the report records `legacyGenerator: retained` with `D13-open`; no total replacement is claimed.

`CLAUDE_SURFACE_MATRIX` is the dated per-surface contract. Code and its desktop extension are certified for the recorded version with a plugin directory and local loopback OAuth; chat and Cowork remain open with a ZIP and their own remote/host authentication. `planClaudePackage` returns a draft with no operational components for an open surface; `ignored` lists what the conversion omitted or rejected. `archiveClaudePackage` builds a deterministic ZIP for the surfaces that consume one, and `removeClaudePackage` removes only that package.

`checkUsabilityObservation` validates one representative person's 4A.3 session against thresholds approved before it: it refuses developer or synthetic observers, an unapproved threshold, an over-threshold time or help count, a token/command/config path, an unexplained diff, a failed recovery, and a load record from another revision. The fill-in form is `docs/faberloom/evidence/4a3-usability.template.json`; the checker rejects the template until a real session fills it.

<a id="configuration"></a>
## Configuration

| Field | Meaning |
|---|---|
| `stagingRoot` | Existing directory under which every run creates a new artifact directory. |
| `signingKeyPem` | PKCS#8 Ed25519 private key in PEM form; never logged or written. |
| `keyId` | Trust-anchor key id written beside the signature. |
| `maxBytes` | Largest artifact file; defaults to 1 MiB and can be overridden per request. |

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomPortable` registers no tool, prompt section, or session event. Only a consumer that serves an artifact file to a model makes it model-visible.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the service never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One parent revision, not a full hierarchy.** The planner resolves one fixed parent revision and a flat inherited list. Multi-level inheritance, per-contribution source trails, and alias declarations belong to 3B.1.
- **Documents come from Git, records from the projection.** A context entry's body is not read from the harness projection's title list; callers export document bodies from the authorized commit. The projection adapter covers agents, skills, workflows, routines, and memory.
- **The artifact is a directory, not a compressed archive.** Packaging, transport, and object storage belong to a later slice; the inventory and digest are already stable inputs for one.
- **The session rule is signal-based, not a session-store lookup.** A record whose kind, known store path, or metadata does not identify it as a session can look like a document; the exporter trusts the producer's labels for that distinction. The packager never reads the session store.
- **The Claude package is certified for Code only.** Claude chat and Cowork are not certified by this adapter and are listed as unsupported before a task. A real authenticated model task against the D01 account is not part of this package's automated evidence; the adapter's manifest is validated with the installed Claude Code version and its components load through the synthetic host loader.
- **A rollback and a connection reference are host state.** The package names an opaque reference; the host resolves it to a token and decides whether the connection is still live. The package never carries that authority.
- **Path rules are Windows-safe.** Spaces, drive letters, backslashes, device names, case aliases, bidirectional characters, and unpaired surrogates are refused, so an artifact cannot express every legal POSIX name. That is deliberate for a Windows-first product.
- **The signing key is deployment state.** Key rotation, revocation, and key distribution are not part of this package; the trust anchor is the caller's public key.

No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`src/plan.ts` owns merge, classification, path assignment, dependency resolution, and the manifest; it is pure. `src/stage.ts` owns the fresh directory and the write order, manifest last. `src/verify.ts` recomputes the inventory, both digests, and the signature. `src/policy.ts` owns the allowlist, the secret shapes, and the session rule. `src/git-source.ts` reads the authorized commit through `git cat-file blob`, never the work tree.

</details>
