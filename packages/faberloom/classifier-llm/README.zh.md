---
description: "基于 ctx.llm 的 Mesa 严重度分类器：由部署挂载的 faberloomBoardClassifier，使用声明的提供方与模型。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-classifier-llm

[English](README.md) | 中文

## 摘要

看板先应用确定性严重度规则，只有当规则无法判定时才查询 `faberloomBoardClassifier` 端口（A-04、W-37）。本包通过 harness 的 LLM 接缝提供该端口：一次带声明提供方与模型的 `ctx.llm.stream` 调用、一个严格 JSON 回答，并且绝不向看板抛错。

`classifySeverity` 从不决定条目：它返回带置信度的建议、`timeout` 或 `invalid`。看板应用自己的置信度下限，并以完整的 §5.1 键缓存决定，其中模型段就是本行的 `modelVersion`（`<provider>/<model>@v1`）。缺少密钥、提供方不可达、严重度拼写错误或置信度越界，都让条目保持 `severity: null`；条目仍然入队。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `ctx.llm` 可用且看板已挂载的位置挂载本行。

```yaml
- id: faberloom-classifier-llm
  name: '@deepseek-ai/dsh-faberloom-classifier-llm'
  config:
    provider: deepseek-official
    model: deepseek-chat
    timeoutMs: 3000
    maxTokens: 200
```

`provider` 与 `model` 指定已注册的路由，并改变缓存身份；`timeoutMs` 限制一次分类（看板另有 3 秒上限）；`maxTokens` 限制回答长度。默认 bundle 已挂载本行，并从环境读取 `FABERLOOM_CLASSIFIER_PROVIDER`、`FABERLOOM_CLASSIFIER_MODEL` 与 `FABERLOOM_CLASSIFIER=0`。

提示词只携带看板已允许该提供方读取的内容：产物类型、账户引用、内容哈希，以及截断到 4 000 字符的摘要。回答必须是一个 JSON 对象，`severity` 属于 `LOW|MEDIUM|HIGH|CRITICAL`，`confidence` 在 `0..1`；其他一律为 `invalid`。

## Model Experience

### 分类调用

#### 模型看到什么

一条系统指令（严重度词汇与 JSON 回答约定）和一条用户消息（条目类型、账户、哈希与摘要）。没有工具 schema、没有会话历史，也没有高于条目数据类上限的字段。

#### Token 影响

每次未缓存的分类一次辅助调用：最多 4 000 字符输入，最多 `maxTokens`（默认 200）输出。缓存命中、确定性规则或提供方不可用时不消耗 token。

#### KV Cache 影响

与会话无关：调用自带两条消息，既不读取也不延长会话的提示前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **分类器读取摘要而非产物** — 看板交给它的是数据类允许的文本，因此含义存在于行内容中的报价单只能按摘要分类。需要更多输入的模型要另行做数据类决定。
- **不发布 token 计量** — 看板缓存决定而非用量；成本仍以提供方路由自身的计量为准。
- **回答不重试** — 每次分类一次调用：格式错误的回答保持 `invalid`，条目未分类。重试策略会在看板 3 秒预算内成倍增加提供方调用。
