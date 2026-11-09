# Agent Note: One evidence chain from proposal receipt to loaded revision

Status: implemented

[English](2026-11-09-cycle-evidence-chain.md) | 中文

## Problem

1.x、3A 与 4A.1 各自证明了自己的段落，但没有测试把同一个提案带过完整路径，并把每个答案与持久行比较：提案回执、Mesa 拒绝或人工批准、Git commit、对象、激活，以及按固定引用读取。拒绝可能悄悄改源，回执可能与存储不一致，会话可能跨修订，隐藏模型调用可能代替本地 runtime 回答。

## Decision

**循环是真实服务上的一个场景。** `packages/faberloom/mcp-server/tests/oauth.spec.ts` 组合 board、带真实 Git 仓库和内存对象存储的发布服务、MCP 服务器与工作引用。一个提案通过 `faberloom_proposal_submit` 进入；人工丢弃后检查源与对象存储未变；第二个提案由人工批准、应用并发布，再通过固定到结果 commit 的引用读取。发布回执（`commit`、`objectKey`、`sha256`、`state`）与持久 `publications` 行比较，读取在引用上记录 `loadedAt`。

**A1/A2 与新会话保持分离。** 3A.4 的引用测试把每个引用固定到两个已发布修订之一；第一个只返回自己的修订，第二个只返回自己的。循环也只在实际读取的引用上记录加载。到新修订的新引用就是新会话；旧引用绝不会被重新解析。

**IA-01 被观察，而不是推断。** `portable/tests/no-hidden-model.spec.ts` 在计划、安装、验证、加载和移除 Claude 包期间监视 `globalThis.fetch`，断言从未调用。它扫描每个包文件中的提供方端点、`fetch(`、`XMLHttpRequest`、`child_process`、`spawn(` 与 `exec(`。包只含 skills 与资源；MCP 连接由 host 挂载。

**外部 host 证据是独立记录。** Claude 包写出 `faberloom/load.json`，包含精确 host 版本与组件。该记录不是 DSH 发布回执；循环把回执与持久发布行比较，host 记录证明 Code 加载了什么。

**没有 model-visible DSH 改动时不添加会话 snapshot。** 循环使用外部包与 MCP 工具面；它不改变 DSH 的 model-visible 事件或提示。若后续改动改变其中之一，snapshot 要求适用于该改动，而不是这个纯包切片。

## Alternatives considered

**保留各波测试并声称循环已覆盖。** 每个测试证明一条边，而不是边之间的交接。回执可以通过自己的测试，却仍与读取使用的行不一致。

**使用发布测试的内存存储但不接 MCP 服务器。** 那会遗漏提案、批准与引用层，而链通常在那里断裂。循环组合四者。

**运行真实 Claude 模型任务。** 它需要 D01 账号与网络模型；4A.2 认证本地链，而人工观察的聊天任务属于 4A.3。host 记录与 MCP 工具调用是这里的外部证据。

**为包虚构会话 snapshot。** snapshot 只对 model-visible DSH 改动必需。适配器是外部包，不改变 DSH 请求前缀。

## Consequences

现在一个测试会在拒绝写入、回执与存储不一致、引用跨修订或适配器出现隐藏模型调用时失败。循环使用内存对象存储；真实 MinIO 保留证据仍是 3A.3 的运行，本地 Claude 包加载仍是 4A.1。代价是更慢的集成测试，以及需要把 board、发布、MCP 与引用测试架保持在同一组合中。

## Verification

- `packages/faberloom/mcp-server/tests/oauth.spec.ts`：提案、拒绝后源不变且零对象写入、人工批准、commit、对象、激活、持久回执比较、固定引用读取与 `loadedAt`。
- `packages/faberloom/mcp-server/tests/oauth.spec.ts` 的 A1/A2 与 rollback 测试：固定修订、新引用、已撤销引用。
- `packages/faberloom/portable/tests/no-hidden-model.spec.ts`：包构建/加载/移除期间没有 `fetch`、提供方端点、进程或 shell 调用；包内没有禁止文本。
- `packages/faberloom/publication/tests/publication.spec.ts`：上传后崩溃、源关闭恢复，以及循环读取的签名对象与清单。
