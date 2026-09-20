---
description: "本 DeepSeek Harness 构建中的原生产品模块（ctx.faberloomRoutines）：声明式版本化例程。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-routines

[English](README.md) | 中文

## 概述

此包承载声明式版本化例程。它注册 `ctx.faberloomRoutines` 主机服务；工具、设置与持久化记录在后续切片加入。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在组合中挂载此行即可暴露 `ctx.faberloomRoutines`。该服务是调用插件 fiber 上的副作用，释放该 fiber 即移除。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`ctx.faberloomRoutines` 是主机服务：不注册工具、不注入提示文本，也不写入会话事件。

#### Token 影响

每次请求直接消耗为零。

#### KV 缓存影响

与实时请求无关：该注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **等待带有截止期限。** 停在 `waitFor` 上的步骤会记录 `deadlineAt = now + waitTimeoutMs`（默认一天，是可配置的字段，部署可以缩短）。`expireWaits(now)` 会把无人应答的等待标记为 `WAIT_TIMEOUT` 失败并把执行移到复核；应答则会清除该期限。
- **带效果的步骤需要授权。** 在运行定义中记录了效果的步骤之前，引擎询问 `ctx.faberloomAccess`：owner 是否已授予该例程声明的第一个权限（或 `faberloom.effect.<stepId>`），并以该例程为上下文。没有授权时该步骤以 `NOT_AUTHORIZED` 失败，案件进入复核，因此撤销会阻止下一次效果。
- **删除例程会保留其历史。** `removeRoutine` 删除定义与其已存版本；它产生的执行与效果账本保留，因此已经运行过的案件仍保有其记录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
