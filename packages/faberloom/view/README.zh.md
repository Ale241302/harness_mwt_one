---
description: "面向浏览器的 FaberLoom 工作区视图：通过 Remote 读取登录 owner 的空间、代理、看板、例程与记忆，并提供创建与重命名写入；面向 FaberLoom 面板的维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-view

[English](README.md) | 中文

## 概述

工作区视图是 FaberLoom 浏览器面板使用的唯一宿主能力。它通过已挂载的产品服务暴露 `faberloomView.overview()`，返回纯 JSON 行，因此面板渲染真实记录而不是占位内容，并暴露这些面板所需的创建与重命名写入。身份来自部署配置而非调用本身：网关把已认证的 owner 注入本行，与 `tool-faberloom` 的做法一致，因此浏览器无法请求其他 owner 的行。记忆行同样在部署身份下取自 agent-memory 内核。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已包含 `ctx.faberloomSpaces`、`ctx.faberloomAgents`、`ctx.faberloomBoard` 与 `ctx.faberloomRoutines` 的组合中挂载本行，并配置 `ownerId`。配置 `memoryCoreUrl`、`memoryServiceId`、`memoryUserId` 与 `memoryGatewayKey` 后，总览会带上该 owner 的记忆行；未配置时记忆列表为空。浏览器侧在客户端 API 组装中挂载生成的 `./remote` 贡献并调用 `ctx.remote.faberloomView.overview()`。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`faberloomView` 的方法是浏览器能力：不注册工具、不注入提示文本、不写入会话事件。

#### Token 影响

每个请求零直接 token。

#### KV 缓存影响

与实时请求无关：该服务从不触碰请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **写入覆盖面板动作，而非全部产品操作。** 该命名空间创建并重命名空间与代理、停用代理、创建与审查看板项、创建并启停例程、并记录记忆语句；看板修订提交、模型策略与例程步骤编辑在其界面落地前不在此列。
- **记忆写入走流水线。** `remember` 把一条语句追加到 agent-memory 的会话入口；服务端异步把 L0 蒸馏为 L1，因此新行可能在下次读取后才出现。读取仍为只读。
- **自身没有变更事件。** 浏览器在 harness 转发会话活动事件时、挂载时以及每次写入后刷新；专用变更事件需要事件转发允许清单条目。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

actor 来自配置而非参数，因为 Remote 边界没有环境调用者身份。`./remote` 由 Typert 构建生成；方法名或签名变更后需重新运行 `pnpm run build:lib:host`。

</details>

**Runtime invariant:** 不发布 companion。该服务不持有派生状态：每次读取都在调用时解析已挂载服务并返回新投影，因此不存在可能发散的自有关系。
