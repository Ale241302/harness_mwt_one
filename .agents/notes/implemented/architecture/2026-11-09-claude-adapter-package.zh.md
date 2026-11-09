# Agent Note: The Claude adapter packages a signed artifact without a token or an executable

Status: implemented

[English](2026-11-09-claude-adapter-package.md) | 中文

## Problem

签名可移植产物可以检查，但 Claude Code 无法加载。朴素适配器会把全局令牌变量加入 `.mcp.json`、打包 chat 与 Cowork 无法运行的二进制，或把有效清单当成组件已加载的证明。包还必须在任务前报告缺失能力，并在本地 runtime 缺失时留下未发送草稿。

## Decision

**适配器位于 portable 包内。** `planClaudePackage` 把一个签名产物转换为 Claude Code 插件：`.claude-plugin/plugin.json`、`CLAUDE.md`、`faberloom-space` 与 `faberloom-proposals` skills、`resources/` 下的产物资源、host 管理的连接描述符，以及带精确 host 与版本的加载记录。`installClaudePackage` 写入文件；`validateClaudePackage` 只检查清单与 skills，不声称已安装；`loadClaudePackage` 只在精确 host 版本下注册组件；`removeClaudePackage` 只删除包目录。

**连接是 host 管理的引用，不是令牌。** 包携带 `faberloom/connection.json`，包含不透明 `referenceId`、host id 与 `mcpServer: faberloom`。它不携带 bearer 令牌、`FABERLOOM_TOKEN` 变量或 `bin/` 目录。host 把引用解析为令牌并挂载 MCP；令牌形状的引用在包生成前被拒绝。

**路径相对包解析。** 插件清单指向 `./skills`；资源与 skill 路径在写入时校验并相对包目录解析。任何路径都不相对 checkout 或当前工作目录解析。

**Runtime 决定包或草稿。** 本地 runtime 可用时，计划写出 ready 插件与 `sent:false`、`mesa:false` 的加载记录。不可用时，计划只写 `faberloom/draft.md`，没有插件清单，状态为 `draft`；不发送任务，也不模拟 Mesa 条目。能力在任务前写入 `CLAUDE.md`：Code 支持；chat 与 Cowork 未认证；MCP 由 host 管理。

**安装测试在 checkout 外运行。** 它在系统临时目录下创建临时包目录，安装包、验证清单、用合成 host loader 在精确 `2.1.126` 版本加载组件，并拒绝其它版本。它还验证被排除的 N3 内容、合成机密、令牌与 `bin/` 不出现，以及移除包后源、提案与修订保持不变。安装了 Claude Code 的机器还会运行真实 `claude plugin validate`；当前 host 已通过。

## Alternatives considered

**在 `.mcp.json` 放令牌。** 全局令牌变量是所有连接共享的一个秘密，不能按对话撤销，还会泄漏到可移植文件。host 管理的引用把令牌留在包外。

**打包 MCP bridge 二进制。** 原生二进制不可移植到 chat、Cowork 或其它 host，并把可执行行为藏在产物里。MCP 连接已由 host 拥有；包只命名它。

**把有效清单当成安装。** 验证只证明文件格式正确，不证明 host 注册了组件。合成 loader 在验证后记录 `loaded:false`，只有在精确版本 host 加载后才记录 `loaded:true`。

**即使没有 runtime 也生成插件。** 那会让 Code 声称拥有无法到达的连接。没有清单、`sent:false` 的草稿才是安全状态。

## Consequences

Claude Code 可以从临时包加载签名空间的 skills 与资源，并使用 host 管理的引用；chat 与 Cowork 被明确标记为不支持。包不携带令牌或可执行文件，因此移除它不会撤销或删除源；host 连接是独立生命周期。代价是 host 必须解析引用并挂载 MCP，而针对 D01 账号的已认证模型任务不在本包的自动证据范围内。

## Verification

- `packages/faberloom/portable/tests/distribution.spec.ts`：checkout 外的包；清单有效但未安装；精确 host 版本的合成加载；错误版本；skills/资源映射；不出现 N3、机密、令牌或 `bin/`；未发送草稿；移除后源、提案与修订保留；CLI 存在时运行真实 `claude plugin validate`。
- `packages/faberloom/portable/tests/context-authorization.spec.ts` 与 `projection.spec.ts`：适配器消费的签名库存。
