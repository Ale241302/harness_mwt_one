# Agent Note: A replace writer keeps user files and a recoverable previous tree

Status: implemented

English | [中文](2026-11-09-recoverable-replace.zh.md)

## Problem

The portable writer only created a fresh `mkdtemp` directory. It could not update an existing destination, had no record of which files it owned, and could not tell a user's edit from an outdated artifact. A delete-then-copy update would lose the previous valid tree if the process stopped between the two steps, and a blind prune would delete files the user added.

## Decision

**One signed ownership manifest decides what is managed.** `packages/faberloom/portable/src/replace.ts` writes `.faberloom/ownership.json` and a detached Ed25519 signature beside it. The manifest records the Space id, the artifact digest, and each managed path with its byte length and SHA-256. Before an update, every managed file must still exist as a single regular file with the recorded hash; a deletion or edit is `PORTABLE_MANUAL_EDIT`. A manifest with a bad signature is `PORTABLE_OWNERSHIP_INVALID`, and no file is touched.

**Foreign files are copied forward.** A file absent from the ownership manifest is foreign: the writer copies its exact bytes into the staging tree before the swap. A new artifact path that overlaps a foreign file is `PORTABLE_FOREIGN_CONFLICT`; the writer never overwrites it. After staging it compares the whole foreign set again, so a file created, deleted, or changed during the write is `PORTABLE_CONCURRENT_CHANGE`.

**The swap is staged, journaled, and recoverable.** The writer builds a sibling staging directory on the same volume, writes the artifact and its manifest, copies foreign files, writes the ownership manifest and signature, then verifies the planned bytes. It records a signed journal in the destination's parent, renames the previous destination to a backup, renames staging into place, verifies the new tree, and only then removes the backup. The journal is signed with the deployment key; a forged or tampered journal is `PORTABLE_RECOVERY` and nothing is touched. A crash after the backup or after the swap leaves the journal and the backup; the next run restores the previous tree or keeps the verified new one and removes the backup. Once the new tree verifies, the replace is committed: a cleanup failure leaves the journal and backup for the next run and reports `cleanupPending` instead of rolling back a valid tree. Only directories named and recorded by this writer are removed.

**The destination is local, canonical, and link-free.** The destination must be absolute, non-UNC, and free of parent segments. The destination, its parent, and every entry beneath it must be a real directory or a single regular file; a symlink or junction is `PORTABLE_SYMLINK`. The destination is resolved to its real path, normalized to NFC, and case-folded on Windows before the journal key is derived, so a crash is recovered through another spelling of the same directory. The writer revalidates links, managed hashes, and the foreign set immediately before the swap, not only when it starts.

**The service exposes the writer.** `FaberLoomPortable.replace(destination, request)` uses the same signing key and byte ceiling as `stage`. It does not claim atomicity across volumes or synchronized folders; the sibling rename is the recovery unit on one local volume.

## Alternatives considered

**Delete the old tree, then copy the new one.** A crash between the two steps leaves no valid destination. The backup and journal exist to prevent exactly that.

**Write managed files in place.** There is no previous tree to restore after a partial write, and a user edit of one file would be silently overwritten.

**Trust an unsigned ownership file.** A local edit could claim a foreign file as managed and cause its deletion. The signature binds the manifest to the deployment key.

**Preserve managed files that disappeared from the plan.** That leaves stale content in the destination. The writer removes an old managed file only when its recorded hash still matches.

## Consequences

An update either keeps every managed file unchanged or stops with a named conflict; the user must resolve an edit or a foreign collision before the next run. Foreign file bytes and modes survive updates, and empty foreign directories are recreated. A crash leaves a recoverable previous tree and a signed journal, not a half-written destination. A destination that belongs to another Space is `PORTABLE_IDENTITY_CONFLICT`. One writer per destination is a precondition: the service takes no cross-process lock, so two concurrent `replace` calls must be serialized by the host. The writer does not merge blocks inside a managed file: an edited managed file is a conflict, not a three-way merge.

## Verification

- `packages/faberloom/portable/tests/replace.spec.ts`: first install with a foreign file and an empty directory; update that removes a managed file and keeps a foreign file; edited and deleted managed files; foreign collision and Unicode alias; symlinked destination and junction inside it; relative, UNC, and escaping destinations; occupied destination file; another Space; tampered ownership; crash after backup and after swap; blocked swap; disk-full staging write; concurrent foreign edit; a foreign file created or deleted during the write; an edit during the second validation; cleanup failure after a verified commit; a journal update failure after the swap; crash recovery through another case spelling on Windows; forged journal; edited manifest; binary foreign bytes; a foreign detached signature; POSIX file mode; verification of the managed destination.
- `packages/faberloom/portable/tests/filesystem.spec.ts`: the earlier path rules still pass.
- `packages/faberloom/publication/tests/application.spec.ts`: PUB-07 cross-path, hidden-file, link, and concurrency checks remain the publication consumer's evidence.
