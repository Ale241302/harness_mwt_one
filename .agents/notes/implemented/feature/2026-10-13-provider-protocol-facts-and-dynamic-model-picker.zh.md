# Agent Note: provider protocol facts, distinct discovery failures, and a discovery-backed model picker

Status: implemented

[English](2026-10-13-provider-protocol-facts-and-dynamic-model-picker.md) | 中文

## Problem

模型目录过去只保存每个提供方的一条协议事实——models 路径与由协议推导出的凭据传输方式——并把每次被拒的 models 请求归入四种类型之一，不区分被拒的密钥、缺失的密钥、耗尽的余额、限流与格式错误的请求。提供方自己的错误正文把无效密钥报为 400（Google）时会被归类为 `unsupported`，而缺失凭据会被报成 `invalid-credential`，界面因此无法区分「配置密钥」与「更换密钥」。

composer 的模型选择器为两个写死的 DeepSeek 模型 id 本地化了说明，这与「目录存在的意义就是替代烧入的列表」相矛盾；它只在 Host 事件上重读目录，既无新鲜度策略，也看不到上次检查状态。`llm-deepseek` 把一个写死的上游模型 id 列表当作默认目录，因此用户挑选的列表是源码常量，而非提供方实际服务的内容。

## Decision

- `ProviderDescriptor`（`packages/faberloom/model-catalog/src/types.ts`）新增 `auth`（凭据传输的可辨识联合：`bearer`、带常量请求头的具名 `header`，或 `query` 参数）、`errorShape`（`openai`、`anthropic` 或 `google`）与 `docs`（该条目所依据的提供方文档页面）。每个 `PROVIDERS` 条目都写明这三者。`kimi` 是 Kimi 编码套餐——`https://api.kimi.com/coding/v1/models`，即产品 `kimi` 路由所调用的接口——而按量付费的 Moonshot 平台是其自身的 `moonshotai` 条目，文档记录在其来源 URL。（实时修正见[选择器/发现笔记](2026-10-13-live-discovery-picker-and-kimi-origin.zh.md)：编码套餐确实发布 models 端点，因此它是此处的一行，而不只是 pi-ai 路由。）
- `ProbeKind` 新增 `no-credential`、`rate-limited` 与 `bad-request`。`probe` 对解析不到任何值的引用报告 `no-credential`，对无法放入请求头的值保留 `invalid-credential`，因此缺失与畸形是不同状态。分类读取提供方自己的错误正文（`error.message` 加 `error.type`/`error.code`，或 Google 的 `error.status`），先判断计费措辞，再判断状态：429 视为限流，正文点名凭据的 400 视为凭据被拒，401/403 视为凭据被拒。
- 导出 `PROBE_FAILURE_CODES` 及各机器码（`NO_CREDENTIAL_CODE`、`RATE_LIMITED_CODE`、`BAD_REQUEST_CODE`、`UNREACHABLE_CODE`、`UNSUPPORTED_CODE`）。面向用户的文案仍归渲染结论的界面所有；目录只暴露机器码与提供方自己的有界消息摘录。
- `llm-pi-ai` 的端点发现同样为每种拒绝给出各自的机器码：401/403 为 `INVALID_CREDENTIAL`，402 为 `QUOTA`，429 为 `RATE_LIMIT`，400 为 `BAD_REQUEST`，其他为 `DISCOVERY_FAILED`。
- `ui-model-selection` 删除写死的模型 id 说明表；模型详情改为提供方名称加上 Host 报告的说明。`ModelCatalogDirectory` 新增新鲜度窗口：窗口内打开使用缓存，窗口过后重新读取；composer 菜单显示上次检查行并提供刷新控件。
- `llm-deepseek` 以部署的发现结果解析目录：`resolveCatalogModels` 对写明的 `models` 列表原样返回，否则返回 `ctx.faberloomModelCatalog.models()` 为 `deepseek` 报告的行，尚未发现任何模型时则为空。插件通过 `ctx.get` 读取快照，并以快照时间作为记忆版本，因此新的发现无需重启即可到达下一个请求。（本条曾点名的复核回退已由[选择器/发现笔记](2026-10-13-live-discovery-picker-and-kimi-origin.zh.md)退役；端点本身会报告回退所承载的能力。）

## Alternatives considered

- **协议表只保留协议事实，让每个调用方自行推断鉴权与错误处理。** 否决：Moonshot 与 Google 读取密钥的方式不同、失败正文的字段也不同，这种推断属于提供方条目，而不属于每个调用方。
- **把 `google` 提供方 id 改名为 `gemini`。** 否决：该 id 会进入 `packages/llm/llm`、`packages/api/session-controller` 与产品面板，这些由其他工作流负责；标签本身已经写作「Google Gemini」。
- **所有提供方共用一个错误解析器。** 否决：Google 把无效密钥报为带 `API_KEY_INVALID` 状态的 400，只看状态的解析器会把它当作坏请求，让用户去修错的地方。
- **`failureKind` 读取共享分类器。** 目录的探测分类委托给 `providerAccountFailureCode` 与 `isContextWindowExceededError`，因此 Kimi 按计费周期的 403 配额拒绝会被判为账户耗尽，而不是密钥被拒（[详情](2026-10-13-live-discovery-picker-and-kimi-origin.zh.md)）。
- **彻底删除 `DEFAULT_MODELS`，把 DeepSeek 目录默认为空。** 最初否决：已提交的会话快照与 `apps/web` 模型设置金样编码了默认目录的 id，且 `systemPromptUpdate: in-history` 看起来是列表端点不会报告的事实。[选择器/发现笔记](2026-10-13-live-discovery-picker-and-kimi-origin.zh.md)推翻了该决定：实时端点在 `api_capabilities` 下报告该能力，回放组合禁用 `llm-deepseek`，无密钥的快照组合现在写明自己的列表。
- **让 composer 选择器改读 faberloom 模型池，而不是 `ctx.llm.listModels`。** 否决：该投影位于 `packages/api/session-controller` 与 `packages/faberloom/view`，不在本次改动的所有权范围内。

## Consequences

- 调用方可以基于稳定机器码路由并自行选择文案：缺失凭据、凭据被拒、余额耗尽、限流、格式错误的请求、无法到达的端点与无法归类的响应是七种不同结果。
- 发现结果是决定存在哪些 DeepSeek id 的来源；一旦发现运行过，提供方新开始服务的模型无需改动代码即可出现，且在其运行之前不会公布任何模型。
- 实时验证用各自的真实密钥覆盖 DeepSeek、OpenAI 与 Kimi 编码套餐，并覆盖 Kimi、Moonshot 与 Google 的无密钥状态：`packages/faberloom/model-catalog/tests/live-discovery.e2e.ts` 在没有密钥时自行跳过，并对真实端点验证发现与探测。
- composer 选择器读取由 `packages/api/session-controller/src/catalog.ts` 构建的 Host 投影，而该投影现在会为目录描述符关联的路由纳入发现：[选择器/发现笔记](2026-10-13-live-discovery-picker-and-kimi-origin.zh.md)承载了该改动。
