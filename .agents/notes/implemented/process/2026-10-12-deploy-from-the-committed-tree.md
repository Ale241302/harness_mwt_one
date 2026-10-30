# Agent Note: Package the deploy from the committed tree

Status: implemented

English | [中文](2026-10-12-deploy-from-the-committed-tree.zh.md)

## Problem

`scripts/push-to-vps.ps1` packaged the harness by staging the working tree with `git add -A` and archiving the resulting index, so the tarball could describe a tree that was no commit at all. A commit landing while the script ran made the deployed build lack it silently: the live `forkSha` named an earlier commit than the tree the checkout already held, so `/healthz` reported an identity the image did not contain. A deploy could ship less than the tree, and the deploy log and the health check agreed on a wrong answer.

## Decision

**The script refuses to package a tree that is not a commit.** Before it stages anything, it collects the files that differ between the working tree and the index (`git diff --name-only`), between the index and `HEAD` (`git diff --name-only --cached`), and the untracked files (`git ls-files --others --exclude-standard`); a non-empty list aborts the run, naming every path, unless `-AllowDirtyTree` is passed to package a dirty tree deliberately, which the script's usage comment documents.

**The archived tree is tied to `HEAD`.** The script writes the index to a tree, archives that tree, and compares the archived tree against `HEAD^{tree}`; a tree that is not `HEAD`'s aborts, and a `HEAD` re-read after the archive aborts the run when a commit landed mid-package and asks for a retry.

**The package carries its own identity.** The script records the archive's SHA-256, the tree, the archive name, and the fork SHA in a revision file next to the tarball (`vendor/deepseek-harness-src.revision.txt`), and prints the tree and the fork SHA, so the deploy log and `/healthz` can be compared. With a clean tree the fork SHA is the head commit; with `-AllowDirtyTree` it is the tree id, which is not a commit id.

**`manifestDrift` compares the deployed manifest to the running fork SHA.** In `gateway/server.mjs`, `buildIdentity()` reads the fork SHA file and the deployed `MANIFEST.md` and sets `manifestDrift` to whether the manifest does not contain the running fork SHA as text; it is `null` when either is missing, because then no signal exists. Drift is true here, and it is a deployment fact rather than a code defect: `MANIFEST.md` is hand-maintained and cites an earlier deploy, the tag `deploy-2026-10-09-faberloom-context-agents`, so the operator clears the verdict by updating the manifest's citations.

## Alternatives considered

**Printing `HEAD` without tying it to the archive.** A head revision read at any moment other than the archive's own attributes the build to a commit the tarball may not hold, which is the wrong attribution this change removes; the fork SHA is published from the archived tree instead.

**Rewriting `MANIFEST.md` from the push script.** Generating the manifest from the script would make `manifestDrift` always false and the verdict meaningless. The manifest states what was deployed, and the verdict is useful only while an operator maintains that statement.

## Consequences

A deploy now requires a committed tree; packaging a dirty tree is possible only through `-AllowDirtyTree`, which also publishes a tree id instead of a commit id. The revision file lets the tarball be identified after it has left the checkout. `manifestDrift` stays a substring test over the manifest's text, so it answers only whether the deployed manifest cites the running fork SHA; it does not compare contents.
