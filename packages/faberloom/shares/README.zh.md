---
description: "原生产品共享（ctx.faberloomShares）：对 Space 与 Work Flow 的持久化按动作授权，含邮件接受、控制台传输与撤销。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-shares

[English](README.md) | 中文

## 概述

共享服务（`ctx.faberloomShares`）持有对 Space 与 Work Flow 的持久化按动作授权。所有者向指定邮箱授予一组权限；受邀者通过所有者自己的 SMTP 连接收到带接受链接的通知，只有授权处于 active 状态才真正放行动作。跨用户共享会发布到 MWT.ONE 控制台并导入受邀者进程；撤销会移除控制台镜像。Space 与 Work Flow 的每次读取与管理检查都会查询该服务。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已包含 `ctx.storageDomain` 的组合中挂载本行，并配置 `consoleBase`、`consoleToken` 与 `acceptBase`（留空则回退到 `CONSOLA_API_BASE`、`CONSOLA_TOKEN` 与控制台基址）。服务打开 `faberloom_shares` 域、注册 `ctx.faberloomShares`，并调用 `ctx.get('faberloomConnections')` 给受邀者发信。`create(ownerId, input)` 存入 pending 授权、向控制台发布可移植快照并发出接受链接；`accept(grantee, id)` 将其置为 active；`revoke(ownerId, id)` 撤销并删除控制台镜像；`list`、`permissionsFor` 与 `can` 驱动面板与强制检查；`sync(grantee)` 导入控制台的来向授权并清理已撤销的。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到什么

什么也没有。`ctx.faberloomShares` 是宿主侧服务：不注册工具、不注入提示文本、不写会话事件。可选的 `faberloom_workflows_share/_revoke/_permissions` 工具位于 `dsh-tool-faberloom`。

#### Token 影响

每个请求为零直接 token。

#### KV Cache 影响

与实时请求无关：注册从不触及请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **控制台是传输接缝** —— 发布与导入依赖 MWT.ONE 控制台端点；没有它们时服务保持本地且仅邮件。
- **接受是显式调用** —— 邮件链接由控制台处理并把授权置为 active；本地 `accept` 服务于同进程与测试路径。

不发布 invariant 伴随文件，因为该服务的单元用例已经断言权限矩阵与生命周期。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

权限集合是封闭的（`SHARE_PERMISSIONS`）。`can` 无条件放行所有者，受邀者仅通过 active 授权放行；pending 授权不放行任何动作，这正是接受步骤存在的意义。可移植快照随授权行一起传输，使导入的授权无需二次读取即可实体化。

</details>
