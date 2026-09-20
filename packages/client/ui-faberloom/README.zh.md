---
description: "FaberLoom 的 Web 界面：身份令牌、品牌名，以及 faberloom 配置提供的全局面板（Conversar、Mesa de trabajo、Espacios、Agentes、Rutinas、Memoria、Conexiones）；面向 FaberLoom 工作区的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-faberloom

[English](README.md) | 中文

## 概述

FaberLoom 界面把共享的 Web 外壳变成 FaberLoom 工作区：用 FaberLoom 身份覆盖强调色令牌、标注侧边栏品牌名，并为每个 FaberLoom 分区注册一个全局面板。每个面板从声明的 store 读取同一份总览；Espacios 与 Agentes 通过 `ctx.remote.faberloomView` 创建与重命名，每次写入都会重新发布刷新后的总览，因此所有面板同时更新。Conversar 面板把用户交给由 harness 拥有的对话与输入框。该包仅由 `faberloom` 配置挂载。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在存在 `ctx.slots`、`ctx.locale` 与 `ctx.theme` 的组合中挂载本插件。它会贡献：

- 通过 `ctx.theme.overrideTokens` 注册的强调色层，随浅色/深色模式变化；
- `sidebar.brand.name` 的占用者；
- 七个 `sidebar.panellist` 行及其对应的 `main` 面板，以共享的 `MainPanelId` 寻址。

所有注册都是调用方 fiber 上的 effect，并随其消失。

-----

<a id="model-experience"></a>
## 模型体验

### 面板注册

#### 模型看到的内容

没有。插件的 `apply` 只调用 `ctx.locale.register`、`ctx.theme.overrideTokens` 与 `ctx.slots.register`；不贡献工具、不注入提示文本、不写入会话事件。

#### Token 影响

每个请求零直接 token。

#### KV 缓存影响

与实时请求无关：面板注册从不触碰请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **在界面允许处提供面板动作** — Espacios 与 Agentes 支持创建、重命名与（代理）停用；Mesa 支持创建与批准/拒绝；Rutinas 支持创建与启停；Memoria 支持记录一条语句。看板修订提交、模型策略与例程步骤编辑在其界面落地前仍属于产品服务。
- **记忆遵循流水线** — 记录语句会追加到 agent-memory 入口，蒸馏后的行可能在下次读取后出现。
- **活动事件驱动刷新，而非推送** — 面板在 harness 转发会话活动事件时、挂载时以及每次写入后重新读取。
- **内置 locale 下使用西班牙语文案** — FaberLoom 的产品语言是西班牙语，而客户端 locale 运行时要求每个命名空间注册两个内置 locale，因此 `zh` 与 `en` 都承载西班牙语字典，直到出现一等公民的 `es` locale。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

分区身份集中在一个数组（`FABERLOOM_SECTIONS`）中：侧边栏 id、主面板 key、行顺序、标签 key，以及两个占用者。新增一个界面只需一条记录加上它的文案 key。

</details>

**Runtime invariant:** 不发布 companion。每个注册都是插件 fiber 上的 effect，浏览器规格证明侧边栏行、主面板与品牌名都会随该 fiber 的释放而消失。
