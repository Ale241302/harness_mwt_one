# Agent Note: 让 Space 会话运行在其代理的提供方、模型与密钥之上

Status: implemented

[English](2026-10-12-agent-credential-route.md) | 中文

## Problem

产品此前已能记录代理的提供方、模型与 API 密钥，客户端也会采集这三项。但没有任何代码消费它们。所有聊天会话都跑在部署唯一的 DeepSeek 连接上，而写在代理上的密钥只会被写进代理记录，并仅以尾部的形式回显。把代理指派给某个 Space，或在聊天中点名一个代理，都无法计入该提供方的账户。平台也完全没有办法用调用方提供的凭据来认证单次调用：请求词汇只携带提供方路由与模型，从不携带密钥。

## Decision

**请求可以点名它用于认证的凭据。** `packages/llm/llm` 新增 `GenerateOptions.credentialRef` 与 `LlmCallConfig.credentialRef`，二者都使用凭据 seam 自身的 `CredentialRef` 类型，因此请求携带的是名字而绝非秘密。`llm-deepseek` 与 `llm-pi-ai` 按调用解析 `credentialRef ?? 路由自身配置的引用`，路径与它们此前解析路由引用完全一致，都经过 `ctx.credentials`。解析不到任何值的引用会让该次调用以 `MISSING_CREDENTIAL` 明确失败并点名该引用，且不会发出任何请求。该字段在文档中明确为请求期状态，永不持久化。

**密钥离开代理记录。** `packages/faberloom/agents` 用 `ctx.credentials.set(ref, value)` 写入保存的密钥；记录只保留 `hasApiKey` 与 `apiKeyTail`（最后四个字符），且 `hasApiKey` 由 `credentials.describe(ref).configured` 派生，因此在应用之外被轮换的密钥会立刻不再报告为存在。引用由代理 id 派生而非存储：`AGENT_CREDENTIAL_REF_PREFIX` 加上 id 的 UTF-8 字节的大写十六进制。该派生对引用语法合法、对该服务能生成的一切 id 都是全域的，并且是单射的；若按字符替换派生，`a-b` 与 `a_b` 就会相撞。此前写入、仍持有明文密钥的记录会在下一次读取时把密钥移入 seam，且幂等，写入被拒时保留原值。服务的任何方法都不解析或返回该值，因此 `duplicateAgent` 不再复制密钥：它读不回来。

**Space 会话默认使用其代理的路由。** `packages/faberloom/agent-plane` 在代理确实存有密钥时解析出平面的 `credentialRef`。`packages/faberloom/session-agent` 把它作为 `SessionComposition.route` 发布给所组合的会话。`packages/api/session-controller` 按以下顺序解析会话模型：持久投影中的显式选择，其次会话日志已记录的路由，其次该 Space 代理的路由（当代理同时声明了提供方与模型并存有密钥时），最后是部署默认值。只有在生效的提供方与模型都等于该代理路由时，才会为该请求附带代理的引用，因此在用户另选模型时会保留该路由自身的引用。

**委托调用计入被咨询代理的账户。** `packages/faberloom/tool-faberloom` 通过 `planeStartFields()` 把被咨询代理的引用写入 `AgentOptions`，因此 `faberloom_spaces_ask` 与 `faberloom_spaces_followup` 用该代理的密钥认证。子代理驱动只把被咨询代理的字段交给子会话，不从父会话继承任何字段，因此没有密钥的目标不会得到引用，并回退到部署默认值。

**该引用永不持久化。** `AgentOptions.credentialRef` 是请求期状态。循环在每一步都从自身选项重新播种它，因为日志中的 header 不携带它、而多步代理必须重新应用自己的密钥；同时在派发请求时把它从被记录的 `request/header` 中排除。模型选择投影、`SessionSelectModelRequest` 与 `model/selection` 事件都不携带该引用；测试直接断言这一点，而不是相信代码路径。

**提供方目录取代烧死的模型列表。** 新增的 `packages/faberloom/model-catalog`（`ctx.faberloomModelCatalog`）拥有冻结的提供方表（deepseek、openai、anthropic、kimi、google，各自附来源、协议与 models 路径）、`discover(providerId, credentialRef)`（向该提供方询问它今天提供哪些模型，并把四种响应形状归一化为同一个 `DiscoveredModel`）、`probe(providerId, credentialRef)`（回答 `ok`、`invalid-credential`、`quota-exhausted`、`unreachable` 或 `unsupported`），以及 `models()`（返回最近一次缓存的结果）。它复用 LLM 包的额度与凭据分类，因此判定结果与将来服务该请求的适配器一致。

## Alternatives considered

**把引用存到代理记录上而不是派生。** 那会引入可能与其所指 id 漂移的持久状态，并让凭据引用可通过一次记录写入而改变，收益为零。派生它则保持单一事实来源。

**把密钥留在代理记录里，在读取时复制进 seam。** 一份秘密两处存放，而且记录仍会是审计者必须检查的那一处。直接搬走只需一次惰性迁移，并消除了第二处存放。

**把 `credentialRef` 加到持久的 `ModelSelection` 上。** 它已经携带提供方与模型，是最方便的家，但恰恰是错的：投影与会话日志都是持久的，而平台规则是凡是到达模型请求的内容都必须可由日志重建，秘密则永远不能。派生的名字可重建，存下来的名字两样都不是。

**每个提供方一个适配器包。** 现有适配器已经同时说两家提供方所用的两种协议（OpenAI chat-completions 与 Anthropic messages），而每个目标提供方都暴露其中之一或一个 OpenAI 兼容的 shim，因此第二个适配器只会是第一个换个 base URL 的副本。

**为携带账单文案的限流单独设一个失败码。** HTTP 402 与携带账单文案的 403 或 429 描述的是产品需要报告的同一个账户级结果。第二个码会为一个消息造出一套并行分类，因此现有 `QUOTA` 分类覆盖两者，而普通 429 保持 `RATE_LIMIT`。

**让目录在 LLM 层内部自我刷新。** 那里的模型发现服务于 Models 页面草稿，而路由目录由 settings 拥有。刷新应当发生在把模型喂进池子的地方，那是产品自身的关切，因此目录位于产品域，并读取 LLM 层的分类，而不是反过来。

## Consequences

会话不再需要一把部署级密钥才能工作：一个 Space 可以用其代理持有的密钥运行，一次咨询用被咨询代理的密钥运行，而凭据 seam 按操作解析，因此被轮换的密钥无需重启即可作用于下一次请求。代理目录也无法泄漏它读不回来的密钥。提供方集合成为数据，提供方新增的模型会在下一次发现时出现，而不必等一个版本发布。

接受三项代价与限制。`llm-deepseek/src/common/models.ts` 中随包发布的 DeepSeek 模型列表仍是写死的，且已经落后于该提供方实际报告的答案（今天是 `deepseek-flash` 与 `deepseek-v4-pro`）；把池子指向该目录是下一步，也是该目录存在的原因。告诉用户其提供方账户已无额度的界面尚不存在：分类止于错误码，而客户端今天不渲染任何 `QUOTA` 或 `AUTH` 文案。此外本次工作所提供的凭据中只有 DeepSeek 认证成功，因此另外四家提供方由模拟服务器与已验证的端点覆盖，而非一次真实往返。

验证：改动过的包与消费方共 1364 个测试通过，改动过的运行时文件在语句、分支、函数与行上均为 100% 覆盖。一条 session-controller 测试断言代理的路由与引用到达适配器，而会话日志不携带引用；断言未配置密钥或未配置路由的代理仍走部署默认值；并断言用户的显式选择胜出且丢弃该引用。一条循环测试断言每个请求都派发该引用，而被记录的 header 省略它。
