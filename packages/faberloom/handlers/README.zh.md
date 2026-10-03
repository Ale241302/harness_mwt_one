---
description: "原生产品例程步骤处理器（ctx.faberloomHandlers）：实现例程步骤声明的每个 handler 名称 —— wait、agent 与 mcp —— 并为每次执行提供一个隐藏的持久会话；面向前端 Rutinas（例程）模块的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-handlers

[English](README.md) | 中文

## 概述

处理器服务负责实现例程步骤声明的每个 `handler` 名称。例程引擎会拒绝激活步骤引用了未注册处理器的例程，因此这个包把已声明的例程变成可运行的例程。它通过 `ctx.faberloomRoutines` 注册助手轮次（`agent`、`mcp`）、Work Flow 步骤处理器（`condition`、`transform`、`delay`、`imap`、`smtp`、`memory.remember`、`memory.teach`、`board.create`、`reference`、`subroutine`、`notify`、`deadletter`）与 `wait`，并随贡献它们的 fiber 一起移除。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在存在 `ctx.faberloomRoutines` 的位置挂载这一行。

- **`wait`** 让运行停在等待状态，直到该步骤声明的事件到来：引擎会挂起设置了 `waitFor` 的步骤，处理器在该事件到来时结束它，并记录是哪个事件恢复了运行。`waitFor` 为空的步骤是人工关卡，由处理器在有人推进运行时结束。
- **`agent`** 以该步骤记录的 `instruction` 作为提示词，在执行所属的隐藏会话中运行一个轮次。
- **`mcp`** 运行同一轮次，但提示词要求使用部署所暴露的 MCP 工具，并记录该轮次发起的调用。
- **Work Flow 处理器** 从 `StepContext.config` 读取节点配置，并通过 `ctx.get` 解析可选服务，因此部署可只挂载其中的子集。`condition` 对 `event`、`input` 与先前步骤的 `result` 求值 `<path> <op> [value]`（`==`、`!=`、`contains`、`exists`、`>`、`<`）；`transform` 渲染 `{{path}}` 模板；`delay` 等待步骤的 `waitFor` 事件，或内联休眠最多 300 秒；`imap` 通过 `ctx.faberloomInbound` 标记、移动、读取或搜索 owner 的邮箱；`smtp` 通过 `ctx.faberloomConnections` 发送；`memory.remember` 与 `memory.teach` 写入 `ctx.faberloomSpaces` 与 `ctx.faberloomMemory`；`board.create`、`notify` 与 `deadletter` 在 `ctx.faberloomBoard` 建条目；`reference` 解析另一个 Space 的有效上下文；`subroutine` 幂等地启动另一个活动例程。
- **`agent` 的 Space 上下文** —— 当节点设置 `config.useSpaceContext` 时，步骤提示词会在 `Contexto del Space` 标题下加入 `config.spaceId` 的有效上下文；不设置时提示词不变。

执行的会话在第一个 `agent` 或 `mcp` 步骤时创建，并被同一次执行的后续步骤复用，因此多步骤例程会累积为同一段对话。步骤结果携带会话 id、最终助手文本、轮次结束类型与轮次发起的调用，读者可据此进入持久日志。

只有以 `completed` 结束的轮次才会结束其步骤。任何其他结束方式 —— `error`、`aborted`、`blocked`、`max-tokens`，或根本没有 `turn/end` —— 都会让该步骤失败，并在消息中给出会话 id 与失败原因，因此例程的 `failurePolicy` 决定后续处理，执行面板也会显示原因。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

每个 `agent` 与 `mcp` 步骤的提示词：一个稳定模板，携带步骤 id、运行版本记录的指令，以及案件上下文（`input` 与恢复运行的事件，JSON 形式，最多 4000 字符）。`mcp` 步骤会多一行，要求该轮次使用可用的 MCP 工具。隐藏会话保存整段对话，因此同一次执行的后续步骤能看到先前步骤的轮次。

#### Token 影响

每个 `agent` 与 `mcp` 步骤消耗一次普通的助手轮次：步骤提示词加上隐藏会话派生的历史，并使用该配置的常规工具。`wait` 不消耗 token。

#### KV 缓存影响

每个隐藏会话保有自己的请求前缀；同一次执行的步骤共享它，不同执行之间不共享。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **尚无条件边。** `condition` 计算布尔值、`transform` 计算值，但例程引擎执行的是依赖图：两个分支的步骤都会运行，真正的分支与循环要等 v2 图执行器。图应跳过的效果由处理器读取的步骤结果来把关。
- **`delay` 内联休眠**，上限 300 秒，与任何长处理器一样；更长的节奏应放在 schedule 触发器上。
- **效果步骤需要授权。** `imap`、`smtp` 与 `board.create` 仅在例程声明动作存在有效授权时运行，并由引擎记账。
- **隐藏会话就是普通会话。** 它们记录部署的工作目录 —— 组装后的系统提示词会读取它 —— 并标记为 `origin: "subagent"`，工作区树正是按该分类把 owner 的会话列表过滤掉它们。读取它们只能通过步骤结果携带的 id 去读会话存储。
- **步骤自身不指定模型、代理或权限。** 每个步骤轮次都使用部署的默认模型选择与配置的全局工具面。按步骤选择模型与权限留待后续。
- **会话存活到处理器服务被释放为止。** 执行完成时不会释放它们，因此只要进程仍在运行，其日志一直可读。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

注册表就是例程引擎自带的 `registerHandler`；本包向它贡献条目，而不是另建一套注册表，因此 `listHandlers()` 报告的是唯一的权威集合，并且释放走的是引擎自己的 disposer。创建会话失败时会从按执行划分的缓存中删除，使下一步可以重试，而不是继承一个已拒绝的 promise。

</details>

**运行时不变式：** 不发布 companion。该服务不持有派生状态：注册的处理器是对引擎注册表的闭包，它唯一持有的状态是自行释放的按执行划分的会话缓存。
