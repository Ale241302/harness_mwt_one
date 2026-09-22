---
description: "原生产品连接（ctx.faberloomConnections）：由 owner 输入的每用户 IMAP、SMTP 与知识备份设置，独立于 MWT.ONE MCP；面向 FaberLoom Conexiones 模块的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-connections

[English](README.md) | 中文

## 概述

连接服务拥有 owner 为自己配置的集成：一个 IMAP 邮箱、一个 SMTP 发件服务器与一个知识备份目标。它们是 FaberLoom 自己的数据，通过 `ctx.storageDomain` 按身份存储，从不是 MWT.ONE MCP 操作。密码会被保存但绝不返回；`probe` 会真正检查配置——登录 IMAP 或 SMTP，或写入备份目标。`sendMail` 通过 owner 的 SMTP 行投递纯文本邮件，且每种类型各有一个默认行：SMTP 行的 `primary` 标志从不清除主要 IMAP 邮箱。

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
- **仅纯文本邮件。** `sendMail` 发送 UTF-8 纯文本正文，无附件、无 HTML；multipart 邮件在合成模块需要时再实现。`AUTH LOGIN` 是唯一的认证机制；OAuth 提供方不在此列。
- **远程备份目标不在此处探测。** `probe` 会说明 rclone 目标由备份流程检查。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

IMAP 探测直接通过 `node:tls`/`node:net` 说协议，因为宿主没有 IMAP 客户端；它读取问候语、发送 `LOGIN`，在带标记的回复上结束，并始终销毁套接字。

SMTP 一侧（`src/smtp.ts`）遵循同样的零依赖策略：`EHLO`、可选 `STARTTLS`、`AUTH LOGIN`，随后是发送时的 `MAIL FROM`/`RCPT TO`/`DATA`，带 dot-stuffing 与生成的 `Message-ID`。非 ASCII 头部按 RFC 2047 base64 编码，正文以 base64 发送，确保任何中继保留 UTF-8。

</details>

**Runtime invariant:** 不发布 companion。该服务不持有派生状态：每次读取都在调用时从存储域解析该 owner 的行。
