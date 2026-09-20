---
description: "原生产品工作台（ctx.faberloomBoard）：带版本化修订、需证据的提交、绑定精确版本的批准、重新校验与需授权效应的工单。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-board

[English](README.md) | 中文

## 概述

此包承载工作台：带版本化修订的准备结果与例外，批准绑定到精确版本，变更后需重新校验，效应需要显式授权。它注册 `ctx.faberloomBoard` 主机服务；模型工具位于 `dsh-tool-faberloom`。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在组合中挂载此行即可暴露 `ctx.faberloomBoard`。该服务是调用插件 fiber 上的副作用，释放该 fiber 即移除。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`ctx.faberloomBoard` 是主机服务：不注册工具、不注入提示文本，也不写入会话事件。

#### Token 影响

每次请求直接消耗为零。

#### KV 缓存影响

与实时请求无关：该注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限所有者审阅** — 变更需要工单所有者；基于成员的审阅需要访问层。
- **不透明文档** — 文档以引用表示；二进制文档随 blob 存储加入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
