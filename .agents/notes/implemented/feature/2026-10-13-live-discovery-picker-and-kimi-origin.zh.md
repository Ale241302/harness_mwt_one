# Agent Note: 选择器读取实时发现，适配器最后一份 id 清单退场

Status: implemented

[English](2026-10-13-live-discovery-picker-and-kimi-origin.md) | 中文

## Problem

为模型选择器提供数据的 Host 投影（[`packages/api/session-controller/src/catalog.ts`](../../../../packages/api/session-controller/src/catalog.ts)）通过 `ctx.llm.listModels` 列出各路由，但从不调用发现，因此只有部署的调和路径运行过之后，打开的选择器才会显示实时 id。在尚未发现任何内容时，`llm-deepseek` 仍会公布一份烧入的 id 清单（`FALLBACK_MODELS`），而选择器无法区分「发现得到的目录」与「凭空发明的目录」：无密钥或不可达的提供方与一个什么都不提供的提供方看起来完全相同。

今天实测的两条实时事实改变了目录表所能声称的内容。`kimi` 条目指向 Moonshot 平台接口，但产品持有的密钥属于 Kimi 编码套餐——该条目对一个可用的密钥报告 `invalid-credential`。而 Kimi 的一次生成拒绝以 403 到达，正文带有按计费周期的配额措辞（“You've reached your monthly usage limit for this billing cycle. Your quota will be refreshed in the next cycle.”），目录自己的分类表在查看正文之前就把它读成了凭据被拒。

## Decision

- `buildModelCatalog` 纳入发现。对每个已挂载路由，凡其描述符在 `routes` 中列出该路由者，都会在 `ctx.llm.listModels` 读取刚刚记录的快照之前，通过 `ctx.faberloomModelCatalog.discover` 询问该提供方，因此打开的选择器无需单独的调和步骤即可显示提供方的实时 id。`ProviderDescriptor` 新增 `routes`（其列表由该提供方解析的 Harness 路由 id）与 `credentialRef`（调用方未指定时发现用来认证的引用）。没有任何描述符列出的路由保持不动：不会为它调用 `discover`，其列表仍是其适配器自身的答案。
- 发现被拒会被报告，绝不隐藏。当某个路由的列表为空且其发现被拒时，投影会报告一个携带该拒绝机器码（`MISSING_CREDENTIAL`、`INVALID_CREDENTIAL`、`QUOTA`、`RATE_LIMIT`、`BAD_REQUEST`、`TRANSPORT`、`UNSUPPORTED`）的 `ModelCatalogFailure`，而不是空组或编造的组。`ModelCatalogModel` 新增 `contextWindow` 与 `maxOutputTokens`，取自发现行；提供方未声明的容量保持缺失。
- `llm-deepseek` 不携带任何 id 清单。`resolveCatalogModels` 返回写明的 `models` 列表，否则返回带有提供方声明的全部事实的发现行——包括 `systemPromptUpdate`，DeepSeek 在 `api_capabilities.anthropic_messages.system_prompt_update` 下报告它，目录现在会归一化该字段。`Config.models` 默认为空，因此既不写死、也未发现任何内容的部署不会公布任何模型。
- `kimi` 指向编码套餐（`https://api.kimi.com/coding/v1`），按量付费平台则是其自身的 `moonshotai` 条目，使用独立的 `MOONSHOT_API_KEY` 引用。
- `failureKind` 委托给共享的 `providerAccountFailureCode` 与 `isContextWindowExceededError`：401 是凭据被拒，任意状态上的配额措辞都表示账户耗尽，只有在此之后才由状态决定是限流还是被拒请求。
- 无密钥的快照组合（`snapshots/session/system-prompt-in-history/cordis.yml`）写明自己的 `llm-deepseek.models`，因为无密钥的录制期组合不挂载发现，也无法凭空发明一项能力。

## Alternatives considered

- **在发现之下保留复核过的回退并标注其可见。** 否决：该回退的 id 与 1,000,000 token 上下文相对实时端点已经过时（后者报告 1,048,576），因此它是一个形状正确却内容错误的答案。使其成立的这项能力本身由端点报告，因此仅靠发现就已足够。
- **在 base 或 `faberloom-app` 中写死复核过的目录。** 否决：写明的列表完全胜过发现，因此写死产品的 id 会为那个唯一持有可用密钥的部署关掉实时发现。只有无法发现的组合——无密钥的快照录制——才写死。
- **把路由与提供方的对应关系保留在 `session-controller` 中。** 否决：该对应关系属于拥有该接口的目录条目，而且没有任何发现行供给的路由不得触发网络调用。
- **保留目录自己的失败分类表。** 否决：它在查看正文之前就读取 403，因此 Kimi 的配额拒绝被报告为凭据问题；共享分类器已经把配额措辞排在状态之前，且各适配器都在使用它，一个分类器即可让界面显示的结论与请求将会遇到的结论保持一致。

## Consequences

- 打开的选择器在一次发现之后即显示提供方所服务的 id，并带有提供方自己的名称、上下文窗口与输出上限；页面不再需要部署级调和步骤。
- 什么都没提供的提供方会如实说明：缺少密钥是 `MISSING_CREDENTIAL`，渲染为本地化的「无凭据」文案；目录就绪但没有任何行时渲染无结果文案。任何地方都不会编造 id。
- `kimi` 能认证编码套餐密钥并列出其四个模型；`moonshotai` 仍是为持有该密钥的部署保留的平台接口。
- 已记录的会话回放不受影响：回放组合禁用 `llm-deepseek`，并通过 `llm-replay` 声明模型，因此适配器的目录从不会到达它们。
- 实时验证（`packages/faberloom/model-catalog/tests/live-discovery.e2e.ts`）用各自的真实密钥覆盖 DeepSeek、OpenAI 与 Kimi 编码套餐，并覆盖 Kimi、Moonshot 与 Google 的无密钥状态；组合后的选择器投影已针对 `https://api.deepseek.com/v1/models` 实时检查。
