---
description: "原生产品代理能力平面（ctx.faberloomAgentPlane）：解析某个目录代理被强制执行的工具掩码（MWT/SICOP 的 MCP 与开放网络）及其委托允许名单。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-agent-plane

[English](README.md) | 中文

## 概述

代理能力平面服务（`ctx.faberloomAgentPlane`）把某个目录代理声明的能力转换为被委托的子代理或 Space 会话所执行的工具掩码。代理无权使用的来源（`mwtMcp`、`sicopMcp`、`webAccess`）会变成针对该来源发布的、确切的已注册工具名的 `deny` 条目，因此掩码在发生委托之处被执行，而不是仅作声明。`resolve` 还携带代理的 persona、模型路由与技能，`allowsSubagent` 则回答调用方的委托允许名单。该服务不读取存储，也不注册工具。

## 目录

- [使用此包](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在同时存在 `ctx.tools` 与 `ctx.faberloomAgents` 的组合中挂载此行。该服务注册 `ctx.faberloomAgentPlane`。消费者按来源枚举已注册的工具名——例如用 `ctx.tools.schemas()` 结合 `mcp__<server>__` 前缀与开放网络名称进行分组——并调用 `resolve(agent, sources)`。当返回的 `toolFilter` 存在时，它会被传给子代理启动（`spawn` provider 会在子代理的创建窗口中将其作为作用域化的 `tools.restrict()` 应用）或作为作用域化限制应用；`deny` 只列出确实存在的名称，因此该限制绝不会因未知工具而失败。`enforceSources`（默认 `true`）把标志转换为强制执行；关闭后所有标志保持声明性，而 `resolve` 仍会报告 persona、模型与技能。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

什么都没有。`ctx.faberloomAgentPlane` 是主机侧服务：不注册工具、不注入提示文本，也不写入会话事件。模型看到的是消费者对已解析平面所做之事——缺少被禁用来源工具的子代理根本不会收到它们。

#### Token 影响

每次请求零直接 token。

#### KV 缓存影响

与实时请求无关：注册从不触及请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **调用方的 `subagents` 强制需要调用方代理。** `allowsSubagent` 回答某个咨询代理能否触达目标，但咨询代理的目录身份只有在会话按其 Space 代理组合之后才为人所知；在那之前，调用方检查没有可读取的代理。
- **掩码仅限于本包已知的来源。** `mwtMcp`、`sicopMcp` 与 `webAccess` 映射到 `mwt`/`sicop` MCP 服务器与开放网络工具名；新增来源需要在此添加标志与条目。
- **未知名称的限制会显式失败。** 该服务只拒绝消费者从实时注册表枚举出的名称；传入虚构名称的调用方会按设计触发 `tools.restrict()` 的未知名称检查。

不发布 invariant 伴随包，因为该服务的单元测试已断言可见性矩阵、空掩码的省略与允许名单。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

`resolve` 相对于代理与来源是纯函数：相同输入产生相同平面。`deny` 去重并排序，因此掩码是确定性的。开放网络名称（`web_search`、`web_fetch`）位于消费者的分组辅助函数中，而非此处，因此重命名某个 web 工具只需更新一处。

</details>
