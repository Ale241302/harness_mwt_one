---
description: "原生产品 Space 会话组合（ctx.faberloomSessionAgent）：Space 会话以其负责代理的 persona、工具平面与技能运行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-session-agent

[English](README.md) | 中文

## 概述

会话组合服务（`ctx.faberloomSessionAgent`）让 Space 会话以其负责代理运行。当某个会话的工作目录是被某个 Space 镜像的已注册工作区时，该服务仅为该会话安装：代理的 persona（遮蔽部署 persona）、代理对无权使用的来源的工具掩码，以及列出其技能的指令。Space 之外的会话，或没有负责代理的 Space，保持部署组合不变。组合发生在被等待的 `agent/created` 窗口内，即首个轮次之前。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在同时存在 `ctx.agents`、`ctx.faberloomSpaces`、`ctx.faberloomAgents`、`ctx.faberloomAgentPlane` 与工作区注册表的组合中挂载此行，并把 `ownerId`、`role`、`companyId`、`readOnly` 设为行为身份。该服务注册 `ctx.faberloomSessionAgent`，从每个会话的工作目录解析其 Space 代理，并通过 `agent.ctx.inject` 把组合安装到该代理的作用域上。它作用于挂载时列出的代理以及每一个 `agent/created`；组合随其代理一同释放。模型路由不在此设置：会话从自身记录的 header 或部署默认值解析路由，代理的模型策略在其委托时生效。

-----

<a id="model-experience"></a>
## 模型体验

### 会话组合

#### 模型看到的内容

Space 会话的请求把负责代理的 persona 作为 `deployment:persona-prefix` 段落携带，把列出代理技能的简短 `faberloom:session-agent` 指令携带，并携带移除了被禁用来源工具的工具集。Space 之外的会话看到部署组合不变。

#### Token 影响

每个该会话的请求携带一个 persona 段落，以及当代理声明技能时的一条简短指令；被移除的工具也从请求中移除其 schema。

#### KV 缓存影响

在会话生命周期内前缀稳定：组合在首个轮次之前安装一次，且从不重读。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **模型路由不在此组合。** 会话的路由来自其记录的 header 或部署默认值，且不存在按代理的创建接缝来覆盖它；代理的模型策略在其委托时生效。
- **解析需要工作区镜像。** 工作目录不是被某个 Space 镜像的已注册工作区的会话不携带组合，这对普通会话而言是正确默认值。
- **在工作区注册之前启动的 Space 会话不会被组合。** 会话创建时工作区必须已存在；Spaces 面板在打开 Space 时注册它。

不发布 invariant 伴随包，因为该服务的单元测试已断言组合矩阵与释放。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

persona 以与子代理组合相同的方式遮蔽 `deployment:persona-prefix`，因此 Space 会话无需新的提示槽即可读作其代理。工具掩码复用 `ctx.faberloomAgentPlane`，因此工作区会话与委托子代理强制同一个平面。解析链（工作目录 → 工作区 → Space → 代理）与 `spaces_ask` 调用方检查所用的一致。

</details>
