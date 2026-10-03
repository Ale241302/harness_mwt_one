---
description: "本 DeepSeek Harness 构建中的原生产品模块（ctx.faberloomWorkflows）：带版本的工作流图、其编译为 routine，以及离线运行时。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-workflows

[English](README.md) | 中文

## 概述

此包承载原生 Work Flow 模块：一个带版本的节点与边有向图，按 Space 或个人范围划分，其事实来源是图，其运行时是由图编译出的 Routine。主机服务 `ctx.faberloomWorkflows` 拥有图记录；模型工具位于 `dsh-tool-faberloom`，浏览器编辑器是 `dsh-client-ui-faberloom` 中的一个面板。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在存在 `ctx.storageDomain`、`ctx.faberloomRoutines` 与 `ctx.faberloomSpaces` 处挂载此行。该服务是调用插件 fiber 上的副作用，释放该 fiber 即移除。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`ctx.faberloomWorkflows` 是主机服务：不注册工具、不注入提示文本，也不写入会话事件；图工具位于 `dsh-tool-faberloom` 且可选启用。

#### Token 影响

每次请求直接消耗为零。

#### KV 缓存影响

与实时请求无关：该注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅骨架** — 此包目前只暴露设计与模块表面；持久图域、编译为 Routine、节点处理器、聊天工具与浏览器编辑器在后续切片到来。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

图是事实来源，编译出的 `routineId` 是派生产物；运行时复用 routines 引擎及其调度器，而不新增第二个执行器。契约与阶段见 Work Flow 模块的提案 Agent Note。

</details>
