---
description: "原生产品连接（ctx.faberloomConnections）：由 owner 输入的每用户 IMAP 与知识备份设置，独立于 MWT.ONE MCP；面向 FaberLoom Conexiones 模块的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-connections

[English](README.md) | 中文

## 概述

连接服务拥有 owner 为自己配置的集成：一个 IMAP 邮箱与一个知识备份目标。它们是 FaberLoom 自己的数据，通过 `ctx.storageDomain` 按身份存储，从不是 MWT.ONE MCP 操作。密码会被保存但绝不返回；`probe` 会真正检查配置——登录 IMAP 或写入备份目标。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在存在 `ctx.storageDomain` 的组合中挂载本行。浏览器通过 `ctx.faberloomView.connections()`、`saveConnection`、`removeConnection` 与 `probeConnection` 读写它。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`ctx.faberloomConnections` 是供浏览器面板读取的宿主侧服务：不注册工具、不注入提示文本、不写入会话事件。

#### Token 影响

每个请求零直接 token。

#### KV 缓存影响

与实时请求无关：该服务从不触碰请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **密码存储在产品域中。** 目前没有字段级加密；静态保护依赖宿主卷与加密备份。托管密钥库延期。
- **仅限 IMAP 与备份目标。** 邮箱同步、日历与其他提供方在其模块落地前不在此列。
- **远程备份目标不在此处探测。** `probe` 会说明 rclone 目标由备份流程检查。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

IMAP 探测直接通过 `node:tls`/`node:net` 说协议，因为宿主没有 IMAP 客户端；它读取问候语、发送 `LOGIN`，在带标记的回复上结束，并始终销毁套接字。

</details>

**Runtime invariant:** 不发布 companion。该服务不持有派生状态：每次读取都在调用时从存储域解析该 owner 的行。
