# Agent Note: A readable proposal card and a publication reader pinned to the work reference

Status: implemented

English | [中文](2026-11-06-knowledge-proposal-card-and-publication-reader.zh.md)

## Problem

The Mesa listed a knowledge proposal as a board item but could not show the proposal itself: the reviewer saw a title and a status, not the file, base revision, motive, scope, diff, evidence, or history. Reading the item as JSON was the only way to judge it. The MCP server also had no way to return the published bytes a proposal refers to, so the initial host could not demonstrate that reading and proposing share one authorized target instead of trusting a model-supplied string.

## Decision

**The board detail projects the proposal and its history.** `FaberLoomBoardDetail` carries `proposal: FaberLoomKnowledgeProposal | null` and `revisions: readonly FaberLoomBoardRevisionRow[]`. `knowledgeProposalOf` reads the seven business fields from the item's last revision when `artifactType` is `propuesta-conocimiento`; an incomplete record projects null instead of a half card. A restricted data class projects null and an empty list, matching the existing rule that hides its content and summaries.

**The card renders untrusted text only.** `ProposalCard` shows file, base revision, motive, scope (`file · +added −removed`), the change line by line in a `<pre>`, evidence, revision history, and the decision. It uses no `dangerouslySetInnerHTML`, no link element, and no remote image: a `<script>`, an `<a href>`, or a Markdown image in any field stays visible text and creates no node that could execute or fetch. Approve and Reject reuse the Mesa's existing `openApprove` and `setShowDiscard(true)` controls, so the check, signature, and reason flows are not duplicated. The controls stay disabled while the item is stale, has a pending candidate, misses declared checks, has a blocking check failure, or the reader may not edit.

**The reader takes its revision from the work reference.** `faberloom_publication_read` reads `git show <commit>:<path>` from `publicationRepo`, where `<commit>` is the revision the authorized reference fixed. The caller supplies only a repository-relative path: absolute paths, `..`, and a branch name are refused, the file is capped at 1 MiB, and the answer carries `revision`, `path`, `bytes`, `sha256`, and `text`. Without a configured repository the tool is not advertised; without a reference revision it refuses with `PUBLICATION_REFERENCE_REQUIRED`.

**A fixed publication also fences the proposal base.** When `publicationRepo` is configured, `faberloom_proposal_submit` rejects a `versionBase` that differs from the reference revision with `PROPOSAL_BASE_MISMATCH`. This binds the proposal to the bytes the person authorized when the installation serves them.

**Pending connections show their revision.** The pending-authorization row now carries `revision`, and the connections panel labels it (`Revisión: …` or `sin revisión fijada`), so an authorized connection is distinguishable from one with no fixed publication. This does not claim the content was loaded.

**A failed detail keeps the draft and offers retry.** The Mesa's detail error state renders `action.retry`, which raises the read counter and reissues `boardDetail`; the editor and its draft stay mounted.

## Alternatives considered

**Rendering the diff as HTML.** It would allow headings and colors inside the change but would make model- and repository-supplied text executable. The line classes already distinguish additions and deletions without active content.

**Accepting a revision or branch as a tool argument.** A caller could read a newer commit than the one the person approved, which 3A.4 forbids. The reference is the only revision source.

**Simulating the reader for 1.5.** The plan requires a real reader and forbids closing Fase 1 with a double. The local Git reader is real; the MinIO retrieval of 3A.3/3A.4 remains a separate, unimplemented adapter.

**One token carrying read and propose.** The 1.3 contract makes the proposal tool exclusive. The end-to-end demonstration therefore authorizes a read connection and a proposal connection in the same Space with the same fixed revision, and asserts that the read bytes at that revision are the file the proposal names; each token still refuses the other operation (CON-02).

## Consequences

The reviewer can judge a proposal without reading JSON, and a hostile value in any field remains inert. The bytes returned for a reference never move with its branch, and a proposal on a publication-serving installation cannot silently target another revision.

The MinIO path is still open: a publication that exists only in object storage cannot be read through this tool. On an installation with `publicationRepo`, a token whose reference revision came from the Space's `updatedAt` must propose with that value; an authorization that serves a publication should name the commit explicitly. The bridge still does not forward the work reference, so the read tool works on the local loopback endpoint.

## Verification

- `packages/faberloom/mcp-server/tests/publication-reader.spec.ts`: fixed-commit bytes and digest; branch, traversal, absolute path, and missing file refused; non-Git directory refused; byte ceiling.
- `packages/faberloom/mcp-server/tests/oauth.spec.ts`: read scope pinned to a commit returns that revision and text; a read token cannot propose and a proposal token cannot read; the proposal on the same fixed revision is filed in its Space; a different base is `PROPOSAL_BASE_MISMATCH`.
- `packages/faberloom/view/tests/board-iteration.spec.ts`: the detail projects the seven fields and the revision history.
- `packages/client/ui-faberloom/tests/registration.client.spec.tsx`: the card shows file, motive, diff, scope, evidence, and versions; `<script>`, `<a>`, and an image Markdown produce no executable node; Approve opens the confirmation and calls `boardApprove`; Reject opens the real reason panel; a failed detail keeps the draft and retries; a pending connection shows its fixed revision and decides through the server.
