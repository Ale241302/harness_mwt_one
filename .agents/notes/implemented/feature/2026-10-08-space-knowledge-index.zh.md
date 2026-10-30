# Agent Note: Space 知识索引

Status: implemented

[English](2026-10-08-space-knowledge-index.md) | 中文

## Problem

`faberloom_spaces_find` 按某个空间的标题、上下文字典与记忆排序；精选上下文条目在此前的一个切片中加入，但空间附件文本以及任何 embeddings 或 Knowledge Hub 信号没有加入。持有文档的空间无法按内容被找到，拥有 Knowledge Hub 的部署也无从在搜索中使用它。

## Decision

`dsh-faberloom-spaces` 把某个空间附件的可读文本——每个空间上限 50 KB，且限于 text、JSON 与 XML 媒体——读入 `SpaceIndexEntry.filesText`，但仅在挂载了 `ctx.spaceIndex` 排序器时读取，因此默认词法路径零成本。新包 `@deepseek-ai/dsh-faberloom-knowledge-index` 提供该排序器：它对每个字段（标题、上下文、精选条目、记忆、附件）打分，用 `knowledgeRoot` 下与之匹配的 Knowledge Hub markdown 文档的词项扩展查询，并在设置 `embeddingUrl` 时按兼容 OpenAI 的 embeddings 端点排序。响应畸形或被拒时回退到词法排序器，除非关闭 `lexicalFallback`，因此配置错误的端点会降级而非中断搜索。faberloom bundle 挂载它。

## Alternatives considered

**要求一个 embeddings provider。** 否决：harness 不提供，因此可配置端点让 embeddings 保持可选，未配置的部署保留词法排序器。

**把 Knowledge Hub 文档作为结果返回。** 否决：`ctx.spaceIndex` 接缝排序的是产品空间，因此 Knowledge Hub 用于扩展查询，而非回答问题。

**无条件读取附件。** 否决：内置词法排序器不会对附件打分，因此每次 `find` 读字节是浪费；按挂载排序器门控使默认路径零成本。

## Consequences

空间按文档文本被找到，并被 Knowledge Hub 的词汇提升；配置了 embeddings 端点的部署按相似度排序。附件读取有界且只针对可读媒体，Knowledge Hub 树仅读取一次并缓存；读取失败不贡献任何内容，而不会使搜索失败。排序器在匹配理由中报告其信号（`files`、`context-entries`、`knowledge`、`embedding`），因此调用方可判断某个空间为何匹配。

测试覆盖 spaces 服务（条目中的附件文本、跳过二进制媒体），以及知识索引（每个打分字段、空查询的最近优先、limit、Knowledge Hub 扩展，以及 embeddings 余弦排序与畸形/被拒的回退）。
