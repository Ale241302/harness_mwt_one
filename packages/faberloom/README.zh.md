---
description: "本 DeepSeek Harness 构建的原生产品模块：主题空间、带模型策略的代理目录、例程、持久化执行、记忆、自主与备份。"
kind: "package-group"
---

# 原生产品模块

[English](README.md) | 中文

## 概述

此组以一等 Cordis 子系统承载本 DeepSeek Harness 构建的原生产品能力：主题空间、带模型策略的代理目录、声明式例程、持久化执行、记忆、选择性自主与知识备份。每个包注册一个 `ctx.faberloom*` 主机服务，并遵循仓库的包规则。

子系统参考为 [docs/subsystems/faberloom.zh.md](../../docs/subsystems/faberloom.zh.md)。

## 目录

- [包](#packages)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

- `@deepseek-ai/dsh-faberloom-spaces` — 主题空间与有效上下文。
- `@deepseek-ai/dsh-faberloom-agents` — 代理目录与版本化模型策略。
- `@deepseek-ai/dsh-faberloom-board` — 工作台：版本化工单、批准与重新校验。
- `@deepseek-ai/dsh-faberloom-routines` — 声明式版本化例程。
- `@deepseek-ai/dsh-faberloom-execution` — 持久化执行、等待与效应账本。
- `@deepseek-ai/dsh-faberloom-learning` — 记忆、版本化教学与情境绩效。
- `@deepseek-ai/dsh-faberloom-access` — 身份绑定、连接与选择性自主。
- `@deepseek-ai/dsh-faberloom-backup` — 知识导出、恢复、完整性与迁移。
- `@deepseek-ai/dsh-tool-faberloom` — 面向模型的产品工具（`faberloom_*`）。
- `@deepseek-ai/dsh-faberloom-app` — 挂载模块与工具的 profile bundle。

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。此组只注册主机服务：没有工具、没有提示文本，也不写入会话事件，因此请求字段不携带其数据。

#### Token 影响

每次请求直接消耗为零。

#### KV 缓存效果

与实时请求无关：这些注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **骨架切片** — 各包目前只暴露服务面，尚无持久化记录、设置或工具；它们在后续切片加入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
