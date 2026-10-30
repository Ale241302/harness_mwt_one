# Agent Note: 持久化 Space 咨询

Status: implemented

[English](2026-10-08-space-consultation-runtime.md) | 中文

## Problem

`faberloom_spaces_ask` 是一次性的：调用方只能向某个 Space 的代理问一个问题，且没有任何东西记录该对话。想要第二轮对话的调用方必须再次共享完整简报，而视图也无从得知哪些 Space 存在活动咨询。

## Decision

新增域 `faberloom_agent_runtime` 及其包 `@deepseek-ai/dsh-faberloom-agent-runtime` 与服务 `ctx.faberloomAgentRuntime`。它按所有者、Space 与调用方会话各保留一行持久记录——调用方的子会话与一个标签——并暴露 `record`、`consultation`、`listForSpace` 与 `remove`。`faberloom_spaces_ask` 新增 `continuable: true`：它通过 `ctx.subagents.startContinuable` 建立一个耐用子代理、记录该咨询，并返回子代理 id 与 `stopReason: 'continuable'`。新工具 `faberloom_spaces_followup` 读取调用方记录的咨询，并通过 `ctx.subagents.sendMessage` 向同一子代理再发送一条消息。视图暴露 `spaceAgentRuntime(spaceId)`，把每一行映射为客户端安全行，使面板可以报告某个 Space 的活动代理。

## Alternatives considered

**让每次咨询都保持一次性。** 否决：后续跟进应当继续同一子代理，使 Space 代理保持其轮次，而不是重新接收完整简报。

**为 Space 代理提供持久化的跨进程邮箱。** 本切片否决：子代理接缝没有持久邮箱或租约，因此驻留是进程本地的；被记录的子代理在其进程持有父级时可寻址，跨进程驻留等待该接缝工作。

**把咨询记录在 `spaces` 中。** 否决：它是关于会话的运行时事实，而非空间配置，且视图与工具会独立读取它。

## Consequences

调用方会话可以与某个 Space 代理保持多轮咨询，并以子代理 id 继续；来自同一调用方与 Space 的第二次可续提问会替换第一个子代理，因此调用方对每个 Space 保有一个持久咨询。`followup` 返回的是受理而非回复：答案落在子代理的会话中，并作为子代理结算通知到达父级，这正是该接缝对相邻代理消息的模型。运行时服务在 `spaces_ask` 与视图中是可选的（`ctx.get`），因此未挂载它的部署保持一次性咨询与空的运行时面板。

测试覆盖运行时服务（记录、读取、列出、删除、保留创建时刻的更新插入）、可续提问（启动、记录、无一次性运行）与后续跟进（向被记录的子代理发送，以及无记录咨询时的拒绝）。
