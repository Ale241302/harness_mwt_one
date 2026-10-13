---
description: "原生产品模型目录（ctx.faberloomModelCatalog）：固定的提供方协议表、用调用方指定的凭据通过各提供方的 models 端点进行动态模型发现，以及回答引用是否可用、账户是否耗尽额度的凭据探测。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-model-catalog

[English](README.md) | 中文

## 概述

模型目录提供 `ctx.faberloomModelCatalog`：固定的提供方协议表、通过各提供方自己的 models 端点进行动态模型发现，以及凭据探测。`discover` 通过 `ctx.credentials` 解析你指定的凭据引用，未挂载该接缝时改用启动环境，并把每种提供方响应归一化为同一行模型。`probe` 发出一次有界请求并报告 `ok`、`no-credential`、`invalid-credential`、`quota-exhausted`、`rate-limited`、`bad-request`、`unreachable` 或 `unsupported`，每种都带有稳定的机器码（`MISSING_CREDENTIAL`、`INVALID_CREDENTIAL`、`QUOTA`、`RATE_LIMIT`、`BAD_REQUEST`、`TRANSPORT`、`UNSUPPORTED`）。`models` 返回每个提供方最近一次发现的缓存快照及其时间戳。任何返回载荷都不携带密钥。

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

`providers()` 返回此表，在模块加载时冻结。`discover` 与 `probe` 从 origin 读取出网地址，从 models 路径读取请求地址，从 auth 条目读取凭据传输方式，从 error shape 读取被拒响应的解析方式。

| id | 标签 | origin | protocol | models 路径 | auth | error shape |
|---|---|---|---|---|---|---|
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | `openai` | `/models` | bearer | openai |
| `openai` | OpenAI | `https://api.openai.com/v1` | `openai` | `/models` | bearer | openai |
| `anthropic` | Anthropic | `https://api.anthropic.com` | `messages` | `/v1/models` | `x-api-key` + `anthropic-version: 2023-06-01` | anthropic |
| `kimi` | Kimi Code | `https://api.kimi.com/coding/v1` | `openai` | `/models` | bearer | openai |
| `moonshotai` | Moonshot（平台） | `https://api.moonshot.ai/v1` | `openai` | `/models` | bearer | openai |
| `google` | Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | `google` | `/models` | `key` 查询参数 | google |

`auth` 是下列之一：`{ kind: 'bearer' }` 发送 `Authorization: Bearer <key>`；`{ kind: 'header', name, static? }` 把密钥放在指定请求头中并附带常量请求头；`{ kind: 'query', name }` 把密钥作为查询参数发送。每个条目还带有 `docs`，即其 origin、models 路径与 auth 所依据的提供方文档页面。

每个条目在其协议事实之外还带有两项 Harness 事实。`routes` 列出把各自请求的模型列表解析自该提供方发现结果的 Harness LLM 路由 id——目前只有 `deepseek` 列出其一（`deepseek-official`）；未列入的路由读取自身适配器的知识。`credentialRef` 是调用方未指定时发现用来认证的常规凭据引用。投影某路由发现行的选择界面读取这两个字段并自行调用 `discover`，因此打开的选择器无需单独的调和步骤即可显示实时 id。

`kimi` 是 Kimi Code 编码套餐（`https://api.kimi.com/coding/v1/models`），即产品 `kimi` 路由所调用的接口；其 models 端点无论用 `x-api-key` 还是 `Authorization: Bearer` 都会以 `200` 返回 `{ "data": [ ... ] }` 列表。平台文档说明 Kimi Code API 与按量付费 API 相互独立、两者密钥不可互换（[产品对比](https://platform.kimi.ai/docs/guide/product-plans)）；因此其凭据引用为 `KIMI_API_KEY`。`moonshotai` 是独立的按量付费平台接口，文档见 `https://platform.kimi.ai/docs/api/list-models`，其密钥引用为 `MOONSHOT_API_KEY`；中国区控制台为 `https://api.moonshot.cn/v1` 签发密钥，暴露相同路径。

`error shape` 指明被拒响应把消息放在何处、以及用哪个标识符对失败分类。`openai` 读取 `error.message`、`error.type` 与 `error.code`（DeepSeek、OpenAI、Kimi）。`anthropic` 读取 `error.message` 与 `error.type`。`google` 读取 `error.message` 与 `error.status`；Google 把无效密钥报告为带 `API_KEY_INVALID` 状态的 400，而非 401，正是这一形状把它排除在 `bad-request` 之外。

-----

<a id="credentials-and-failure-kinds"></a>
## 凭据与失败类型

`discover` 与 `probe` 每次调用解析一次你指定的引用，顺序为：挂载了凭据 provider 时用 `ctx.credentials.resolve(reference)`，否则用该引用的启动环境值。已挂载的 provider 解析不到值时不回退到环境，因此空的存储值不会被继承的导出遮蔽。不缓存任何值：更改后的凭据在下一次调用即生效而无需重启，且密钥不进入任何返回载荷。

`probe` 以 `requestTimeoutMs` 为超时发出一次请求，并报告八种类型之一，每种都带有来自 `PROBE_FAILURE_CODES` 的稳定机器码。`ok` 表示凭据通过认证且提供方返回了模型列表。`no-credential` 表示该引用解析不到可用值——缺失或为空——并带有 `MISSING_CREDENTIAL`，与被拒密钥截然不同。`invalid-credential` 涵盖 401、不带计费措辞的 403、提供方自身错误正文标记为无效密钥的 400（Google），以及解析出的值无法放入任何 HTTP 请求头的情况。`quota-exhausted` 涵盖 402，以及正文带有余额、点数、预算或额度措辞的任何状态。`rate-limited` 涵盖指明速率而非余额的 429。`bad-request` 涵盖未指明凭据问题的 400。`unreachable` 表示请求从未完成。`unsupported` 表示提供方 id 未知，或提供方返回的状态或正文是本探测无法处理的。`detail` 携带提供方自己的消息摘录，长度有界，密钥已被替换为 `[redacted]`。`discover` 抛出携带相同机器码的 `LlmError`。

-----

<a id="model-experience"></a>
## Model Experience

### 发现与探测请求

#### 模型看到的内容

没有直接内容。模型目录在调用方与其提供方之间于主机侧发起请求，不注册工具、提示段或会话事件。把某行发现结果渲染进模型请求的调用方承担全部模型可见后果；此类调用方能转发的归一化字段是 `id`、`name`、`contextWindow`、`maxOutputTokens`、`inputModalities`、`outputModalities`、`effortLevels` 与 `systemPromptUpdate`。DeepSeek 在 `api_capabilities.anthropic_messages.system_prompt_update` 下报告一行的 `systemPromptUpdate`；仅 `in-history` 会被建模，其他写法保持缺失。

#### Token 影响

零直接 token：没有任何请求字段、提示段或工具 schema 来自此包。

#### KV 缓存影响

与实时请求无关：模型目录从不读取或改写请求前缀。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **提供方集合固定。** `providers()` 报告六个提供方；新增一个是源码改动，因为该表同时固定了凭据传输方式、models 路径与错误形状。`origins` 仅重定向出网。
- **发现读取提供方响应，而非能力清单。** 省略 `context_window`/`context_length`、`max_output_tokens`、模态、努力档位或 `api_capabilities` 声明的提供方会产生缺少这些字段的行，调用方不得凭空补上。
- **探测只分类，不重试。** 每次调用一次尝试，受 `requestTimeoutMs` 约束，每种失败都保留稳定的机器码。限流退避与 `Retry-After` 处理不在此处。
- **缓存快照限于本进程。** `models()` 只反映本进程做过的发现；它不持久，也没有定时器刷新它。

不发布 invariant 伴随包，因为单元测试已断言该表、每种提供方归一化、两条凭据解析路径、探测分类与缓存快照。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

凭据解析与 `dsh-llm-deepseek` 的 `resolveApiKey` 一致，额度分类复用 `dsh-llm` 的 `isQuotaExceededError`、`QUOTA_EXCEEDED_CODE` 与 `INVALID_CREDENTIAL_CODE`，因此额度判定与将要服务该请求的适配器一致。提供方 models 响应是不可信的线上 JSON：无法读取模型列表的 200 正文会显式失败，而不会报告空目录；缺少 id 的行会被丢弃，而不会被归一化为无名模型。

</details>
