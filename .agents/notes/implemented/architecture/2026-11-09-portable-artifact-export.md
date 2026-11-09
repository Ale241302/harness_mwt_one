# Agent Note: A portable artifact is a versioned, signed inventory, not a file copy

Status: implemented

English | [中文](2026-11-09-portable-artifact-export.zh.md)

## Problem

A Space's documents and harness records live in different stores: document bodies in the authorized Git commit, agents and skills in the projection, and inheritance in the Space hierarchy. Copying files into a folder produced no complete inventory, no reproducible digest, and no way to tell an excluded contribution from one that was never there. A regex that guessed which references to include either missed a dependency or pulled in a session, and writing directly into an output directory could replace a valid artifact with an invalid one.

## Decision

**The planner is pure; the writer owns the filesystem.** `planPortable` merges the Space's own contributions with the parent's allowed inherited ones, applies the classification allowlist, resolves explicit dependency ids, assigns artifact paths, and returns files, manifest, digest, and per-file rejections. `stagePortable` validates the staging root, creates a fresh `mkdtemp` directory, writes every file, writes `manifest.json` last, and removes only that directory on failure. The plan is complete before a directory exists.

**Format, content, and software have three versions.** `formatVersion` is the layout, `contentVersion` is `sha256:` over the canonical inventory, and `softwareVersion` is the producer's version. Canonical JSON sorts object keys and keeps array order. The manifest digest excludes `digest` and `signature`, so it never signs itself; the detached Ed25519 signature covers the canonical manifest including its digest. The public key is a trust anchor supplied out of band and is never stored in the artifact.

**The export is an allowlist with a named rejection report.** Only `N0`, `N1`, and `N2` are included. A missing, unknown, or contradictory classification is denied under any metadata spelling; an excluded contribution never reaches the manifest, inventory, or a title, and no redaction marker is written. A session or transcript is refused by kind, known store path (English or Spanish), metadata, or dependency, even from the same Space. Content, metadata keys and values, id, title, path, and media type are scanned for private keys and common token shapes; a match refuses the contribution and the secret is not written. The report names a path and reason for ordinary refusals and uses `(restricted)` for a class, session, secret, or denied inheritance so the report itself does not leak the excluded title.

**Inheritance is minimal and fixed to one parent revision.** A parent contribution is considered only when it is marked inheritable and granted by contribution. The child's exclusion wins, the child with the same id replaces the parent, two child contributions cannot reuse an id, and a path claimed by two different ids is refused instead of resolved by read order. The parent revision is recorded in the manifest.

**Dependencies are ids, not text matches.** A contribution names `dependsOn` ids. A missing, rejected, session, or cyclic dependency refuses the dependent; nothing is silently truncated. The dependency closure decides what else from the same request enters the artifact.

**Paths are validated before writing and staging is atomic.** Traversal, absolute paths, drive letters, backslashes, Windows device names, reserved manifest names, case aliases, bidirectional characters, unpaired surrogates, and a file used as a directory are refused. A symlinked or missing staging root is refused before a directory is created. After the write, the new directory is re-listed: its path set must equal the plan and every file must be a single regular link; otherwise the directory is removed. Documents are read with `git cat-file blob` and `--no-replace-objects`; the revision must be a full 40- or 64-hex commit id that resolves to itself, so replace refs, short ids, and hash-shaped branch names cannot substitute content. The projection adapter maps agents, skills, workflows, routines, and memory without attributing atomicity to the projection.

## Alternatives considered

**Put the signature inside the manifest.** The signature would have to cover itself, or the digest would have to exclude a field inside the signed object. A detached signature keeps the two concerns separate and lets the caller store the trust anchor independently.

**Embed the public key in the artifact.** That authenticates the artifact with a key the artifact carries, so anyone who can replace the artifact can replace the key. The public key belongs to the consumer's trust store.

**Filter references with a regex over bodies.** A regex cannot tell a dependency from a example, misses an indirect dependency, and can pull a session path in. Explicit ids make the closure decidable and testable.

**Write into the requested output directory.** An invalid plan or a failed write would leave the previous valid artifact partially replaced. A fresh directory per run makes "invalid staging does not replace the valid output" structural.

**Inherit every ancestor by default.** D05 requires inheritance by contribution and an explicit exclusion that wins. The minimal parent-and-grant model implements the rule without claiming the full multi-level hierarchy that belongs to 3B.1.

**Compress the artifact now.** A tar or zip hides the inventory and adds a format that the digest would have to account for. The directory is inspectable, reproducible, and already a stable input for a later package/transport slice.

## Consequences

A caller gets a directory with a complete inventory, a reproducible manifest digest, a detached signature, and a rejection report. Two identical requests produce the same manifest and digest in different staging directories; a content, metadata, identity, classification, or software change moves the version that owns it. A denied contribution costs its dependents, not the whole artifact. The cost is one fixed parent revision instead of a full hierarchy, a directory instead of an archive, Windows-safe path restrictions, and signing-key management outside this package. Classification still comes from the caller's server policy: the planner enforces the allowlist but does not discover a class the caller never supplied. The session rule is signal-based: a record whose kind, known store path, or metadata does not identify it as a session can look like a document, because the exporter does not read the session store.

## Verification

- `packages/faberloom/portable/tests/projection.spec.ts`: document and skill inventory with recomputable hashes; two staging directories with identical manifest and digest; content, metadata, identity, and software changes moving the right version; reading the authorized commit instead of the work tree, ignoring a replace ref, and refusing a short revision; projection mapping; tampering, a wrong trust anchor, and a wrong key id.
- `packages/faberloom/portable/tests/context-authorization.spec.ts`: denied inheritance, excluded class in every kind, child exclusion, child override by id, duplicate child id, `CTR-PORTABLE-01` session/transcript refusal including a Spanish store path, missing/rejected/cyclic dependencies, contradictory classification under another metadata spelling, and a synthetic secret in content, metadata, a skill body, a path, and a media type.
- `packages/faberloom/portable/tests/filesystem.spec.ts`: duplicate path, case alias, case-variant file/directory overlap, traversal, absolute path, reserved manifest name, unpaired surrogate, missing or symlinked staging root, and an earlier valid artifact surviving a refused later staging request.
