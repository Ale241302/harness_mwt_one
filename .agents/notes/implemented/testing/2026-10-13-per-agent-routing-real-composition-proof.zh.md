# Agent Note: 通过真实组合与提供商桩证明按代理路由

Status: implemented

[English](2026-10-13-per-agent-routing-real-composition-proof.md) | 中文

## Problem

代理声明的 provider、model 与自有 API key 必须决定其轮次的路由：有 key 的代理以自己的 key 经由自己的 provider 出站，无 key 的代理保持路由自身的 `.env` 凭证，账户额度耗尽则是一个带类型的结局而非通用失败。该包的既有测试在手工搭建的 `ctx.plugin(...)` 上下文里用脚本化的 `MockAdapter` 证明了路由选择。那只说明 `agent/request` 瀑布重写了一个配置对象；它无法说明请求到达了声明的 provider 并以声明的凭证认证，因为其中没有提供商边界，也没有凭证缝。包规则还要求产品可见插件具备真实组合测试，而该包此前没有。

## Decision

在 `packages/faberloom/session-agent/tests/` 下新增真实组合端到端套件。

- `routing-harness.ts` 通过真实的 Loader，从测试专用 `cordis.yml` 启动真实的 `dsh-llm`、`dsh-agent-loop`、`dsh-session`、`dsh-system-prompt`、`dsh-tools`、`dsh-credentials-local`、`dsh-faberloom-agent-plane` 与 `dsh-faberloom-session-agent`，并以自定义导入器镜像已部署的 `node_modules`。只有外部系统是替身：提供商端点，以及位于路由缝之外、属于持久产品存储的目录、工作区注册表与 Space 记录。
- `routing-provider.ts` 运行一个本地 OpenAI 兼容 HTTP 桩，记录每个请求的 `Authorization` 头与请求体，并包含执行该交换的适配器。该适配器经 `ctx.credentials` 解析请求的凭证引用，回退到路由自身的引用，并通过已发布的 `providerAccountFailureCode` 与 `providerFailureMessage` 映射提供商 HTTP 失败，因此额度耗尽由 `dsh-llm` 分类，而非由私有表分类。
- `routing-e2e.host.spec.ts` 固定 Fase 1 的论断：有 key 代理的轮次以自有 key 抵达其自有 provider，且部署环境 key 从未被使用；无 key 代理的轮次保持路由自身的 `.env` 凭证；同一会话在两个 provider 上运行两个代理；Space 会话运行其被指派的代理，而被提及代理的路由胜出；`402` `insufficient_balance` 请求体以带提供商后缀的 `QUOTA` 呈现，且会话能完成下一轮；原始 key 与 key 引用都不出现在会话日志或失败载荷中。
- `routing-live.e2e.ts` 是需要 key 的实时冒烟，针对真实提供商源运行，并在缺少各自所需凭证时自行跳过。覆盖三个轮次：带 key 的目录代理以自有 key 抵达 OpenAI（`OPENAI_API_KEY`）；无 key 的代理保持部署 DeepSeek 路由自身的 `.env` 凭证（`DEEPSEEK_API_KEY`）；带 key 的代理在路由自身凭证为空时以自有 key 抵达 DeepSeek。提供商替身记录每次交换的来源、model 与 `Authorization` 头，因此断言读取的是该轮次使用了哪个提供商与凭证，而非某条消息。没有额度的 OpenAI 账户以 OpenAI 自身的额度耗尽响应体作答，以带 `(provider "openai")` 后缀的类型化 `QUOTA` 结局呈现；这就是通过结果，因为它证明了 provider、model 与 key 都被使用。

README 现在陈述这些测试所验证的约定：提及在其轮次中优先于会话自身的路由，包括组合会话起始所用的 Space 代理路由。

## Alternatives considered

- **扩展现有 `MockAdapter` 套件。** 已否决：从不执行线上交换的适配器无法说明提供商收到了哪个凭证，且包规则要求产品可见插件具备 Loader 级组合测试。
- **对部署路由使用随产品发布的 DeepSeek 适配器，并对代理路由使用第二个真实适配器。** 已否决：`llm-deepseek` 注册固定的提供商路由且属于另一条工作流，`llm-pi-ai` 不在范围内；由本测试自有的桩让验证保持确定性且离线，而需要 key 的实时冒烟仍然跨越真实提供商边界。
- **仅针对桩自身的错误映射断言额度耗尽。** 已否决：该分类法位于 `dsh-llm`，因此替身通过随产品发布的分类器映射请求体，断言读取真实机器码；私有映射证明的会是测试夹具，而非产品。

## Consequences

- 按代理路由、凭证选择或账户失败类型的回归会在数秒内让 Loader 组合套件失败，无需网络调用，也无需提供商 key。
- 套件每个测试持有三个 HTTP 桩与一个临时 harness home，随组合一同释放；测试与其他 gate 进程并发运行。
- 夹具代理使用的每一条新提供商路由也必须由桩适配器提供，因此需要真实线上格式变更的路由改动要在同一次改动中更新该替身。
- 带 key 的实时冒烟是唯一跨越真实提供商边界的用例；没有凭证时它会跳过，因此它在有凭证处运行而非在无 key 的 CI 中运行，破坏真实提供商线上约定的路由改动只在那里被捕获。
