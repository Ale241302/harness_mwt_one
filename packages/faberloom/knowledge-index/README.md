---
description: "Native product knowledge index (ctx.spaceIndex): ranks the actor's spaces by an embeddings endpoint, the Knowledge Hub corpus, and a lexical fallback over each space's title, context, curated entries, memory, and attached-file text."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-knowledge-index

English | [中文](README.zh.md)

## Summary

The knowledge index provides the `ctx.spaceIndex` ranker `faberloom_spaces_find` uses. It scores a query over each space's title, context map, curated context entries, memory, and attached-file text. When an embeddings endpoint is configured it ranks by cosine similarity and falls back to the lexical ranker on a malformed or rejected response; when a Knowledge Hub root is configured it expands the query with the terms of the markdown documents that match it, boosting spaces that share their vocabulary. A deployment that mounts no ranker keeps the built-in lexical ranker in `dsh-faberloom-spaces`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.faberloomSpaces` is present. It registers the optional `ctx.spaceIndex` provider the spaces service reads. `knowledgeRoot` points at a Knowledge Hub markdown tree for query expansion; `embeddingUrl`/`embeddingModel` point at an OpenAI-compatible embeddings endpoint; `lexicalFallback` (default `true`) keeps a failing endpoint from breaking a search; `maxKnowledgeDocs` bounds the corpus read.

-----

<a id="model-experience"></a>
## Model Experience

### Ranking provider

#### What the model sees

Nothing directly. The ranker changes the order and the `reasons` of the `faberloom_spaces_find` result: a match carries `files`, `context-entries`, `knowledge`, or `embedding` when that signal ranked it. A deployment without the ranker keeps the built-in lexical `title`/`context`/`memory` reasons.

#### Token effect

Zero direct tokens: the ranker runs host-side between the tool call and its result.

#### KV Cache effect

Independent of live requests: the ranker never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The Knowledge Hub only expands the query.** It boosts spaces whose text shares a matched document's terms; it does not return Knowledge Hub documents as results, because the seam ranks product spaces.
- **Embeddings need an external endpoint.** The harness ships no embeddings provider, so `embeddingUrl` points at one; without it, or on a malformed/rejected response, ranking is lexical.
- **The attached-file text is bounded.** `dsh-faberloom-spaces` reads at most 50 KB of readable (text/json/xml) file bytes per space, and only while a ranker is mounted.

No invariant companion is published because the service's unit specs already assert the ranking, the Knowledge Hub expansion, and the embeddings fallback.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The Knowledge Hub tree is read once per service lifetime and cached; a read failure contributes no documents rather than failing the search. The ranker never throws for a missing endpoint or malformed response unless `lexicalFallback` is off, so a misconfigured deployment degrades instead of breaking.

</details>
