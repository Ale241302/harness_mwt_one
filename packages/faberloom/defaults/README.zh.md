---
description: "原生产品默认值（ctx.faberloomDefaults）：FaberLoom 依据产品计划为新 owner 播种的代理与例程，且只分配 owner 角色实际随附的技能；面向前端 Agentes（代理）与 Rutinas（例程）模块的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-defaults

[English](README.md) | 中文

## 概述

默认值服务让新 owner 得到可用的起点，而不是空面板：它是产品计划中走通的代理与例程，播种一次之后即由面板接管。它只把 owner 角色实际随附的技能分配给代理，并把播种出的例程留在 `draft`，因此在 owner 激活之前不会有任何东西运行。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在存在 `ctx.faberloomAgents` 与 `ctx.faberloomRoutines` 的位置挂载这一行，并带上部署身份：`ownerId`、`role`、`readOnly` 与 `skillsCatalogRoot`。服务在激活时播种。

目录就是计划中走通的示例：来自代理界面的代理名册（`Recepción`、`Revisión de pedidos`、`Proformas`），以及例程 `Pedido a proforma` —— 它的四个步骤分别走一次真实的代理轮次、一次 MCP 操作，以及在结案前等待复核。

播种以 owner home 为范围，标记文件为 `<DSH_HOME>/faberloom-defaults.json`：

- 只读身份或空 owner 的那一趟不做任何事；
- 名称已存在的条目会被跳过，因此部分完成后重试也不会重复；
- 成功的一趟会写标记，包括没有新条目可创建的那一趟，因此下次启动不会复生 owner 已删除的条目；抛错的一趟既不留下标记也不留下认领，因此下次启动重试。

同一个 home 可能同时启动两个进程，而两者都可能在对方写入落盘之前读到彼此的域。因此每一趟先用独占创建认领 `<DSH_HOME>/faberloom-defaults.claim`：胜者播种，败者报告 `another pass is seeding`；若某一趟在完成前死亡，其认领会在十分钟后被清除，下一次启动重试。

技能会与实际存在的内容匹配 —— owner 自己在 `<DSH_HOME>/skills` 下的上传，以及 `skillsCatalogRoot/<role>` 下的角色目录 —— 角色没有随附的声明技能不会被分配。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

播种时不涉及模型。这一趟通过 `ctx.faberloomAgents.createAgent` 与 `ctx.faberloomRoutines.createRoutine` 创建的条目只通过代理与例程工具变得模型可见，与 owner 手工创建完全一致。

#### Token 影响

每次请求的额外 token 为零。

#### KV 缓存影响

与实时请求无关：该服务从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **目录固定在源码中。** 改变新 owner 收到什么需要修改 `src/catalog.ts`；目前还没有由部署提供的目录文件。
- **播种以 owner home 为键，而不是以身份为键。** 共享同一个 home 的两个部署会共享同一个标记。
- **每个进程只跑一趟。** 服务缓存自己的 promise，因此在进程存活期间删除标记不会有任何变化；要让已删除的播种条目回来，需要删除标记并重启进程，从而重跑这一趟。
- **播种出的例程永不自动激活。** 它连同其触发器一直保持 `draft`，因此在 owner 激活之前，由邮件驱动的例程不会运行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

这一趟通过产品服务完成，而不是直接写存储行，因此播种出的代理与例程携带与面板中创建者相同的校验、版本与身份。`seed()` 会缓存自己的 promise，因此激活调用与任何后续调用者观察到的是同一趟。

</details>

**运行时不变式：** 不发布 companion。该服务不持有派生状态：磁盘上的标记与两个产品域就是全部状态，这一趟在调用时读取它们。
