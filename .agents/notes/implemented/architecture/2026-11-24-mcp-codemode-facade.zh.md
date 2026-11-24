# Agent Note: 面向外部 MCP 客户端的双工具 Code Mode 门面

Status: implemented

[English](2026-11-24-mcp-codemode-facade.md) | 中文

## 问题

把聊天客户端指向 MWT、SICOP 或 FaberLoom 时，它会收到这些服务器公开的每一个工具 schema，并在每次请求中全部发送。数百个 schema 在模型读到问题之前就占满了提示词，而上游每增加一个工具，每个客户端请求都会更大。harness 已经有 Code Mode：`run_code` 针对 `tools.<name>` 执行程序，只有程序的输出到达模型。该工具位于 Cordis agent loop 内部，而 Claude Desktop、Cursor 或 ChatGPT 连接器无法挂载它。客户端需要同样的双工具表面，但以独立 MCP 服务器的形式提供。

## 决定

`packages/mcp/mcp-codemode` 交付 `@deepseek-ai/dsh-mcp-codemode`，一个恰好提供两个工具的 stdio MCP 进程。`run_code` 接收 `code` 和 `description`；`catalog` 接收可选的 `server` 并返回 TypeScript 声明。因此无论存在多少上游工具，客户端的 `tools/list` 都只携带两个 schema。

### 父进程拥有全部上游连接

启动时，门面为每个已配置的上游建立一个 MCP 客户端，通过 stdio 或 Streamable HTTP 连接，一次性列出每个服务器的工具并建立索引。HTTP 头、stdio 的 `env` 以及所有凭据都留在门面进程中。每次 `run_code` 调用都会启动一个新的 Node 进程，带有 `env: {}`、一条 IPC 通道、堆上限、输出上限和截止时间；子进程在运行程序之前会再次清空环境，这也移除了 Windows 为空 spawn 环境提供的机器默认值。程序只能通过调用已声明的绑定访问数据，只有它的控制台输出和返回值会到达客户端。

### 绑定与结果沿用 harness 自身的约定

程序调用 `tools.mcp__<server>__<rawToolName>`，这与 `@deepseek-ai/dsh-mcp-client` 中 `publicToolName` 推导出的键相同；有一个测试直接比较这两个函数，包括非法字符替换以及让有损名称保持互不相同的 12 位十六进制后缀。绑定以 harness MCP 桥接的标准 `{ content, structuredContent? }` 值解析，工具级错误会被拒绝，程序可以捕获它。因此同一段程序文本在 harness 内针对相同的服务器也能直接运行。

### 程序的 IPC 协议是纯状态机

`src/protocol.ts` 决定一帧可能意味着的一切：日志计量与输出上限、绑定调用的身份与顺序、在途调用上限、边界处的 JSON 无损性、终止帧，以及恰好一次结算。它不拥有进程、定时器或通道，因此测试把原始帧和生命周期事件作为数据喂给它。`src/drive.ts` 把子进程事件、定时器、stderr 上限和清理接到该状态机；`src/channel.ts` 发送帧并执行先软后硬的终止；`src/executor.ts` 只负责 spawn。`src/upstream.ts`、`src/sdk.ts`、`src/server.ts` 和 `src/startup.ts` 分别持有 MCP 客户端集合、catalog 渲染、两个工具注册以及配置文件入口。

### 边界是带显式默认值的配置

`timeoutMs`、`maxOutputBytes`、`maxUpstreamResultBytes`、`maxCatalogBytes`、`maxPendingCalls`、`maxOldGenerationSizeMb`、`nodeExecutable` 和 `cwd` 都是经过校验的配置字段。非正值或空上游列表会在启动时失败，而不是悄悄套用另一个边界。`catalog` 中的未知上游名称和冲突的绑定都是配置错误。

## 考虑过的替代方案

**复用 `packages/ptc-runtime/ptc-runtime-node`。** 拒绝：`NodePtcRuntime` 注入 `fs`、`subprocess`、`sandbox` 和 `sandboxPolicy`，而 sandbox policy 服务又注入 `sessionProjections`，因此实例化它意味着启动一个 Cordis 应用。Windows sandbox 后端也不在 Windows 测试通道中。本包实现了一个更小的执行器，保持相同的程序约定，而不是为了运行一个函数体去挂载整个应用。

**把每个上游工具原样再暴露一次的笨代理。** 拒绝：转发每个工具会同时保留这次改动要消除的两项成本——每次请求中的 schema 负载，以及每次调用一次模型往返。把 `run_code` 原样转发给单个上游的代理并不存在，而每个工具转发一次调用的代理无法在程序中组合调用。

**带按租户令牌的 HTTP 门面。** 暂时拒绝：HTTP 多租户、远程认证和部署是另一套运维面。已交付的入口是一个本地进程，凭据来自客户端本来就能控制的一个 JSON 文件。

**在程序进程内提供通用沙箱。** 拒绝：文件系统隔离、网络策略和审批是 harness PTC 运行时的职责。本门面限制输出、堆和时间，并明确记录它不是安全沙箱。

## 后果

- **不是安全沙箱。** Node API 仍可通过 `await import(...)` 访问；没有文件系统隔离、网络策略或审批步骤。需要这些能力的部署应改为挂载 harness PTC 运行时。
- **仅 stdio 传输。** 一个本地进程，凭据在配置文件中。HTTP 多租户、按租户令牌、远程认证和部署均未实现。
- **富内容以 JSON 返回。** 图像、音频和资源块以 base64 或 URI 文本的形式出现在 `{ content }` 内；客户端无法显示它们。
- **catalog 类型是有界的 JSON Schema 子集。** 对象、数组、标量、枚举、本地 `$ref` 以及 `anyOf`/`oneOf`/`allOf` 会被渲染；其他内容变成 `unknown`，每条描述截断到 240 个字符。
- **运行期间没有进度或流式输出。** 长时间运行的程序在结算或截止时间触发之前保持静默，上游工具列表在启动时捕获。

## 测试

`corepack pnpm exec vitest run packages/mcp/mcp-codemode --coverage --coverage.include="packages/mcp/mcp-codemode/src/**"` 通过 9 个测试文件和 93 个测试，每个文件的语句、分支、函数和行覆盖率均为 100%。协议状态机以纯数据方式覆盖了无效帧、子进程死亡、截止时间、取消和结算幂等；`channel.spec.ts` 覆盖软终止和 `SIGKILL` 升级；driver 使用假子进程覆盖 spawn 失败、通道关闭时的发送、stderr 捕获和启动前取消；门面测试套件运行真实 stdio 上游，`tests/stdio.e2e.spec.ts` 通过 tsx 启动源码入口。`upstream.ts` 中仅有的 `/* v8 ignore */` 指令覆盖 MCP 客户端已经从 JSON 解析出工具结果之后的非 JSON 检查，这些检查在构造上不可达。

`corepack pnpm exec tsc -b packages/mcp/mcp-codemode/tsconfig.json` 和 `corepack pnpm exec oxlint packages/mcp/mcp-codemode` 均已运行，无发现。
