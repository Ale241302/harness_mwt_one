# Agent Note: Space knowledge index

Status: implemented

English | [中文](2026-10-08-space-knowledge-index.zh.md)

## Problem

`faberloom_spaces_find` ranked a Space by its title, context map, and memory; the curated context entries joined in an earlier slice, but the text of a Space's attached files and any embeddings or Knowledge Hub signal did not. A Space holding a document could not be found by its content, and a deployment with a Knowledge Hub had no way to use it in search.

## Decision

`dsh-faberloom-spaces` reads the readable text of a Space's attached files — bounded to 50 KB per Space and restricted to text, JSON, and XML media — into `SpaceIndexEntry.filesText`, but only while a `ctx.spaceIndex` ranker is mounted, so the default lexical path pays nothing. The new package `@deepseek-ai/dsh-faberloom-knowledge-index` provides that ranker: it scores every field (title, context, curated entries, memory, files), expands the query with the terms of the Knowledge Hub markdown documents under `knowledgeRoot` that match it, and ranks by an OpenAI-compatible embeddings endpoint when `embeddingUrl` is set. A malformed or rejected response falls back to the lexical ranker unless `lexicalFallback` is off, so a misconfigured endpoint degrades rather than breaking a search. The faberloom bundle mounts it.

## Alternatives considered

**Require an embeddings provider.** Rejected: the harness ships none, so a configurable endpoint keeps embeddings optional and a deployment without one keeps the lexical ranker.

**Return Knowledge Hub documents as results.** Rejected: the `ctx.spaceIndex` seam ranks product spaces, so the Knowledge Hub informs the query (expansion) rather than answering it.

**Read attached files unconditionally.** Rejected: reading bytes on every `find` is wasted work for the built-in lexical ranker, which does not score them; gating on a mounted ranker keeps the default path free.

## Consequences

A Space is found by its documents' text and is boosted by the Knowledge Hub's vocabulary, and a deployment with an embeddings endpoint ranks by similarity. The attached-file read is bounded and only for readable media, and the Knowledge Hub tree is read once and cached; a read failure contributes nothing rather than failing the search. The ranker reports its signal in the match reasons (`files`, `context-entries`, `knowledge`, `embedding`), so a caller can tell why a Space matched.

Tests cover the spaces service (attached-file text in the entry, binary media skipped), and the knowledge index (each scored field, recency for an empty query, the limit, the Knowledge Hub expansion, and the embeddings cosine ranking with the malformed and rejected fallbacks).
