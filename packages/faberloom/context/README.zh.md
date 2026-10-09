---
description: "工作区/Space 上下文（ctx.faberloomContext）：独立于 Memory 的持久化、带版本与审批的上下文条目，支持按所有者索引与恢复。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-context

[English](README.md) | 中文

## 概述

上下文服务（`ctx.faberloomContext`）持有工作区或 Space 共享的、持久化且带版本的上下文条目。所有者或持有 `index-context` 授权的成员写入的条目直接进入共享上下文；其他成员的贡献以 `pending` 起始，仅其作者与 Space 所有者可见，直到所有者将其索引（`approve`）、保持私有（`reject`）或删除。每次变更都会追加一个不可变版本，因此可以恢复任意更早的上下文。记录通过 `ctx.storageDomain` 持久化。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limited)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在已具备 `ctx.storageDomain` 的组合中挂载此行；`ctx.faberloomSpaces` 与 `ctx.faberloomShares` 是可选的，仅用于更精确地决定归属。该服务打开 `faberloom_context` 域、注册 `ctx.faberloomContext`，并暴露 `create`、`list`、`get`、`listForSpace`、`update`、`versions`、`restore`、`approve`、`reject`、`remove`、`export`、`import` 与 `replace`。`listForSpace(actor, spaceId)` 返回某一空间下该行为者可读的条目；`ctx.faberloomSpaces.find` 与 `reference` 据此呈现另一空间的精选上下文。`create(actor, { title, body, spaceId })` 决定可见性：个人条目保持 `local`；Space 条目对其所有者（或持有有效 `index-context` 授权的成员）为 `shared`，否则为 `pending`。放入行为者不可读的 Space 会被拒绝。`update` 追加版本并把成员的编辑退回 `pending`；`restore(actor, id, version)` 将更早的版本前移为一个新版本。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`ctx.faberloomContext` 是主机服务：不注册工具、不注入提示文本，也不写入会话事件。可选的 `faberloom_context_*` 工具位于 `dsh-tool-faberloom`。

#### Token 影响

每次请求直接消耗为零。

#### KV 缓存影响

与实时请求无关：该注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limited"></a>

- **归属需要 Space 或授权** — 挂载 `ctx.faberloomSpaces` 时，条目只能放入行为者可读的 Space（不可读的 Space 会被拒绝）；没有 `ctx.faberloomShares` 时非所有者成员的条目总是落到 `pending`。没有 spaces 服务的裸组合把执行者当作所有者。
- **审批是按条目而非按行** — 所有者索引或拒绝整条记录；没有字段级合并。

未发布 invariant companion，因为该服务的单元测试已断言其生命周期、可见性矩阵与版本历史。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

可见性在写入时依据 Space 所有者与 `index-context` 授权一次性决定。读取时，行为者自己写入或拥有的条目，或所属 Space 对行为者可读的 `shared` 条目会被放行；此外的 `local` 或 `pending` 条目保持隐藏。版本行以 `${entryId}:${version}` 为键且只追加，因此 `restore` 从不改写历史。该域惰性打开、随调用 fiber 关闭，与其他 FaberLoom 服务一致。

</details>
