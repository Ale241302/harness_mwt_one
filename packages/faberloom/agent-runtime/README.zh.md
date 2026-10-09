---
description: "原生产品代理运行时（ctx.faberloomAgentRuntime）：调用方会话与 Space 代理之间的持久化咨询，按所有者、Space 与调用方会话为键。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-agent-runtime

[English](README.md) | 中文

## 概述

代理运行时服务（`ctx.faberloomAgentRuntime`）记录调用方会话与 Space 代理之间的持久化咨询。`faberloom_spaces_ask` 在启动可续子代理时记录一行，`faberloom_spaces_followup` 读取它以继续同一子代理；视图读取这些行以报告某个 Space 的活动代理。按所有者、Space 与调用方会话各一行，因此后续跟进能找到其子代理，且第二次可续提问会替换调用方此前的子代理。记录通过 `ctx.storageDomain` 持久化。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在已具备 `ctx.storageDomain` 的组合中挂载此行。该服务打开 `faberloom_agent_runtime` 域、注册 `ctx.faberloomAgentRuntime`，并暴露 `record`、`consultation`、`listForSpace` 与 `remove`。`record(ownerId, { spaceId, callerSessionId, childSessionId, label })` 为该 Space 更新插入调用方的咨询并保留其创建时刻。

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

什么都没有。`ctx.faberloomAgentRuntime` 是主机侧服务：不注册工具、不注入提示文本，也不写入会话事件。读取它的工具位于 `dsh-tool-faberloom`。

#### Token effect

每次请求零直接 token。

#### KV Cache effect

与实时请求无关：注册从不触及请求前缀。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **每个调用方与 Space 一个子代理。** 来自同一调用方会话的第二次可续提问会替换第一个子代理，因此调用方在同一时间对每个 Space 只保有一个持久化咨询。
- **驻留是进程本地的。** 被记录的子代理在其进程持有父级时可寻址；跨进程继续等待子代理接缝所推迟的持久邮箱工作。

不发布 invariant 伴随包，因为该服务的单元测试已断言更新插入、读取、列出与删除。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

键为 `${ownerId}\u0000${spaceId}\u0000${callerSessionId}`，因此同一 Space 中的两个调用方各自保留子代理。`listForSpace` 过滤并按最新优先排序；视图把这些行映射为其自身的客户端安全形状。

</details>
