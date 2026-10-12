---
description: "原生产品模型目录（ctx.faberloomModelCatalog）：固定的提供方协议表、用调用方指定的凭据通过各提供方的 models 端点进行动态模型发现，以及回答引用是否可用、账户是否耗尽额度的凭据探测。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-model-catalog

[English](README.md) | 中文

## 概述

模型目录提供 `ctx.faberloomModelCatalog`：固定的提供方协议表、通过各提供方自己的 models 端点进行动态模型发现，以及凭据探测。`discover` 通过 `ctx.credentials` 解析你指定的凭据引用，未挂载该接缝时改用启动环境，并把每种提供方响应归一化为同一行模型。`probe` 发出一次有界请求并报告 `ok`、`invalid-credential`、`quota-exhausted`、`unreachable` 或 `unsupported`。`models` 返回每个提供方最近一次发现的缓存快照及其时间戳。任何返回载荷都不携带密钥。

## 目录

- [使用此包](#use-this-package)
- [提供方](#providers)
- [凭据与失败类型](#credentials-and-failure-kinds)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在产品询问某个提供方服务哪些模型、或某个凭据是否可用处挂载此行。它提供 `ctx.faberloomModelCatalog`，不要求其他服务：凭据接缝是可选的，并在每次调用时读取一次。`requestTimeoutMs` 限定单次提供方请求（默认 5000，最大 60000）。`origins` 把某个提供方的出网指向自托管网关、区域主机或测试服务器；提供方 id、协议与 models 路径仍取自协议表。

-----

<a id="providers"></a>
## 提供方

`providers()` 返回此表，在模块加载时冻结。`discover` 与 `probe` 从 origin 读取出网地址，从 protocol 读取凭据传输方式。

| id | 标签 | origin | protocol | models 路径 |
|---|---|---|---|---|
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | `openai` | `/models` |
| `openai` | OpenAI | `https://api.openai.com/v1` | `openai` | `/models` |
| `anthropic` | Anthropic | `https://api.anthropic.com` | `messages` | `/v1/models` |
| `kimi` | Kimi (Moonshot) | `https://api.moonshot.ai/v1` | `openai` | `/models` |
| `google` | Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | `google` | `/models` |

`openai` 协议发送 `Authorization: Bearer <key>`。`messages` 协议发送 `x-api-key: <key>` 并附带 `anthropic-version: 2023-06-01`。`google` 协议把密钥作为 `key` 查询参数发送。

-----

<a id="credentials-and-failure-kinds"></a>
## 凭据与失败类型

`discover` 与 `probe` 每次调用解析一次你指定的引用，顺序为：挂载了凭据 provider 时用 `ctx.credentials.resolve(reference)`，否则用该引用的启动环境值。已挂载的 provider 解析不到值时不回退到环境，因此空的存储值不会被继承的导出遮蔽。不缓存任何值：更改后的凭据在下一次调用即生效而无需重启，且密钥不进入任何返回载荷。

`probe` 以 `requestTimeoutMs` 为超时发出一次请求，并报告五种类型之一。`ok` 表示凭据通过认证且提供方返回了模型列表。`invalid-credential` 涵盖 401、不带计费措辞的 403，以及解析不到可用值的引用。`quota-exhausted` 涵盖 402，以及正文带有余额、点数、预算或额度措辞的 429 或 403。`unreachable` 表示请求从未完成。`unsupported` 表示提供方 id 未知，或提供方返回的状态或正文是本探测无法处理的。`detail` 携带一段有界的响应摘录，其中密钥已被替换为 `[redacted]`。

-----

<a id="model-experience"></a>
## Model Experience

### 发现与探测请求

#### 模型看到的内容

没有直接内容。模型目录在调用方与其提供方之间于主机侧发起请求，不注册工具、提示段或会话事件。把某行发现结果渲染进模型请求的调用方承担全部模型可见后果；此类调用方能转发的归一化字段是 `id`、`name`、`contextWindow`、`maxOutputTokens`、`inputModalities`、`outputModalities` 与 `effortLevels`。

#### Token 影响

零直接 token：没有任何请求字段、提示段或工具 schema 来自此包。

#### KV 缓存影响

与实时请求无关：模型目录从不读取或改写请求前缀。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **提供方集合固定。** `providers()` 报告五个提供方；新增一个是源码改动，因为该表同时固定了凭据传输方式与 models 路径。`origins` 仅重定向出网。
- **发现读取提供方响应，而非能力清单。** 省略 `context_window`、`max_output_tokens`、模态或努力档位的提供方会产生缺少这些字段的行，调用方不得凭空补上。
- **探测只分类，不重试。** 每次调用一次尝试，受 `requestTimeoutMs` 约束。不带计费措辞的限流 429 会以 `unsupported` 连同其状态报告，因为本目录没有任何类型描述限流。
- **缓存快照限于本进程。** `models()` 只反映本进程做过的发现；它不持久，也没有定时器刷新它。

不发布 invariant 伴随包，因为单元测试已断言该表、每种提供方归一化、两条凭据解析路径、探测分类与缓存快照。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

凭据解析与 `dsh-llm-deepseek` 的 `resolveApiKey` 一致，额度分类复用 `dsh-llm` 的 `isQuotaExceededError`、`QUOTA_EXCEEDED_CODE` 与 `INVALID_CREDENTIAL_CODE`，因此额度判定与将要服务该请求的适配器一致。提供方 models 响应是不可信的线上 JSON：无法读取模型列表的 200 正文会显式失败，而不会报告空目录；缺少 id 的行会被丢弃，而不会被归一化为无名模型。

</details>
