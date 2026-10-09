---
description: "原生产品知识索引（ctx.spaceIndex）：通过 embeddings 端点、Knowledge Hub 语料与词法回退，对某个空间标题、上下文、精选条目、记忆与附件文本排序。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-knowledge-index

[English](README.md) | 中文

## 概述

知识索引提供 `faberloom_spaces_find` 所使用的 `ctx.spaceIndex` 排序器。它对某个空间标题、上下文字典、精选上下文条目、记忆与附件文本打分。配置了 embeddings 端点时，它按余弦相似度排序，并在响应畸形或被拒时回退到词法排序器；配置了 Knowledge Hub 根目录时，它用与之匹配的 markdown 文档的词项扩展查询，从而提升共享其词汇的空间。未挂载任何排序器的部署保留 `dsh-faberloom-spaces` 内置的词法排序器。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在同时存在 `ctx.faberloomSpaces` 的组合中挂载此行。它注册 spaces 服务读取的可选 `ctx.spaceIndex` provider。`knowledgeRoot` 指向用于查询扩展的 Knowledge Hub markdown 树；`embeddingUrl`/`embeddingModel` 指向兼容 OpenAI 的 embeddings 端点；`lexicalFallback`（默认 `true`）使失败的端点不会中断搜索；`maxKnowledgeDocs` 限定语料读取。

-----

<a id="model-experience"></a>
## Model Experience

### Ranking provider

#### 模型看到的内容

没有直接内容。排序器改变 `faberloom_spaces_find` 结果的顺序与 `reasons`：当 `files`、`context-entries`、`knowledge` 或 `embedding` 信号将其排序时，匹配会携带该信号。未挂载排序器的部署保留内置词法的 `title`/`context`/`memory` 理由。

#### Token 影响

零直接 token：排序器在工具调用与其结果之间于主机侧运行。

#### KV 缓存影响

与实时请求无关：排序器从不触及请求前缀。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Knowledge Hub 仅扩展查询。** 它提升与匹配文档共享词项的空间文本；它不把 Knowledge Hub 文档作为结果返回，因为该接缝排序的是产品空间。
- **Embeddings 需要外部端点。** harness 不提供 embeddings provider，因此 `embeddingUrl` 指向外部端点；没有它，或响应畸形/被拒时，排序为词法。
- **附件文本有界。** `dsh-faberloom-spaces` 每个空间最多读取 50 KB 的可读（text/json/xml）文件字节，且仅在挂载排序器时读取。

不发布 invariant 伴随包，因为该服务的单元测试已断言排序、Knowledge Hub 扩展与 embeddings 回退。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

Knowledge Hub 树在服务生命周期内读取一次并缓存；读取失败不贡献文档，而不会使搜索失败。除非关闭 `lexicalFallback`，排序器绝不因缺少端点或响应畸形而抛出，因此配置错误的部署会降级而非中断。

</details>
